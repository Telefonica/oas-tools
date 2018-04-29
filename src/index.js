/*!
OAS-tools module 0.0.0, built on: 2017-03-30
Copyright (C) 2017 Ignacio Peluaga Lozada (ISA Group)
https://github.com/ignpelloz
https://github.com/isa-group/project-oas-tools

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.*/

'use strict';

var _ = require('lodash-compat');
var fs = require('fs');
var pathModule = require('path');
var jsyaml = require('js-yaml');
var config = require('./configurations'),
  logger = config.logger;
var ZSchema = require("z-schema");
var deref = require('json-schema-deref');
var validator = new ZSchema({
  ignoreUnresolvableReferences: true
});
var controllers;
var customConfigurations = false;
var schemaV3 = fs.readFileSync(pathModule.join(__dirname, './schemas/openapi-3.0.json'), 'utf8');
schemaV3 = JSON.parse(schemaV3);

var router_property = 'x-router-controller';

/**
 * Function .
 *@param {object}  - .
 *@param {object}  - .
 *@param {object}  - .
 */
function init_checks(specDoc, callback, schemaV3) {
  if (_.isUndefined(specDoc)) {
    throw new Error('specDoc is required');
  } else if (!_.isPlainObject(specDoc)) {
    throw new TypeError('specDoc must be an object');
  }

  if (_.isUndefined(callback)) {
    throw new Error('callback is required');
  } else if (!_.isFunction(callback)) {
    throw new TypeError('callback must be a function');
  }

  validator.validate(specDoc, schemaV3, function(err, valid) {
    if (err) {
      throw new Error('specDoc is not valid: ');
      logger.info("Error: " + err);
    } else {
      logger.info("Valid specification file");
    }
  });
}

/**
 * Function to set configurations. Initializes local variables that then will be used in the callback inside initializeMiddleware function.
 *@param {object} options - Parameter containing controllers location, enable logs, and strict checks. It can be a STRING or an OBJECT.
 */
var configure = function configure(options) {
  config.setConfigurations(options);
};

/**
 * Transforms yaml's spec path format to Express format.
 *@param {object} path - Path to transform.
 */
function transformToExpress(path) {
  var res = "";
  for (var c in path) {
    if (path[c] == '{') {
      res = res + ':';
    } else if (path[c] == '}') {
      res = res + '';
    } else {
      res = res + path[c];
    }
  }
  return res;
}

/**
 * Returns a simple, frinedly, intuitive name deppending on the requested method.
 * @param {object} method - Method name taken directly from the req object.
 */
function nameMethod(method) {
  method = method.toString();
  var name;
  if (method == 'get') {
    name = "list";
  } else if (method == 'post') {
    name = "create";
  } else if (method == 'put') {
    name = "update";
  } else if (method == 'delete') {
    name = "delete";
  }
  return name;
}

/**
 * Returns the resource name, contained in the requested url/path (as appears on the oasDoc file), without any slashes.
 * @param {object} requestedSpecPath - Requested path as appears on the oasDoc file.
 * @param {object} single - Operation is related to single resource, then last 's' must be removed.
 */
function resourceName(requestedSpecPath, single) {
  var resource = requestedSpecPath.toString().split("/")[1];
  if (single) {
    return resource.charAt(0).toUpperCase() + resource.slice(1, resource.length - 2);
  } else {
    return resource.charAt(0).toUpperCase() + resource.slice(1);
  }
}

/**
 * Checks if operationId (or generic) exists for a given pair path-method.
 *@param {object} load - .
 *@param {object} pathName - .
 *@param {object} methodName - .
 *@param {object} methodSection - .
 *@param {object} single - .
 */
function checkOperationId(load, pathName, methodName, methodSection, single) {
  var opId;
  if (methodSection.operationId != undefined && load[methodSection.operationId] == undefined) {
    logger.error("      There is no function in the controller for " + methodName.toUpperCase() + " - " + pathName);
    process.exit();
  } else {
    if (load[methodSection.operationId] != undefined) {
      opId = methodSection.operationId;
    } else {
      opId = nameMethod(methodName) + resourceName(pathName, single);
    }
    if (load[opId] == undefined) {
      logger.error("      There is no function in the controller for " + methodName.toUpperCase() + " - " + pathName);
      process.exit();
    } else {
      logger.debug("      Controller for " + methodName.toUpperCase() + " - " + pathName + ": OK");
    }
  }
}

/**
 * Checks if exists controller for a given pair path-method.
 *@param {object} pathName - .
 *@param {object} methodName - .
 *@param {object} methodSection - .
 *@param {object} controllersLocation - .
 *@param {object} single - .
 */
function checkControllers(pathName, methodName, methodSection, controllersLocation, single) {
  logger.debug("  " + methodName.toUpperCase() + " - " + pathName);
  var controller;
  var load;
  if (methodSection[router_property] != undefined) {
    controller = methodSection[router_property];
    logger.debug("    OAS-doc has " + router_property + " property");
    try {
      load = require(pathModule.join(controllersLocation, controller));
      checkOperationId(load, pathName, methodName, methodSection, false);
    } catch (err) {
      logger.error(err);
      process.exit();
    }
  } else {
    logger.debug("    OAS-doc doesn't have " + router_property + " + property -> try generic controller name")
    controller = pathName.split("/")[1] + "Controller"; //generate name and try to load it
    try {
      var load = require(pathModule.join(controllersLocation, controller));
      checkOperationId(load, pathName, methodName, methodSection);
    } catch (err) {
      logger.debug("    Controller with generic controller name wasn't found either -> try Default one");
      try {
        controller = 'Default' //try to load default one
        var load = require(pathModule.join(controllersLocation, controller));
        checkOperationId(load, pathName, methodName, methodSection);
      } catch (err) {
        logger.error("    There is no controller for " + methodName.toUpperCase() + " - " + pathName);
        process.exit();
      }
    }
  }
}

/**
 * Check if the expressPath has parameters. If so, then the request is for a single resource.
 *@param {object} expressPath - .
 */
function checkSingle(expressPath) {
  var single = false;
  if (expressPath.split("/").length > 2) {
    single = true;
  }
  return single;
}

/**
 * Function to initialize OAS-tools middlewares.
 *@param {object} options - Parameter containing controllers location, Specification file, and others.
 *@param {function} callback - Function that initializes middlewares one by one in the index.js file.
 */
var initialize = function initialize(oasDoc, app, callback) {

  init_checks(oasDoc, callback, schemaV3);

  deref(oasDoc, function(err, fullSchema) {
    logger.info("Specification file dereferenced");
    oasDoc = fullSchema;

    //THE FOLLOWING THREE SECTIONS ARE INSIDE THE deref CALL BECAUSE OTHERWISE oasDoc WOULDN'T HAVE THE RIGHT VALUE of 'fullSchema'
    var OASRouterMid = function() {
      var OASRouter = require('./middleware/oas-router');
      return OASRouter.call(undefined, config.controllers); // ROUTER NEEDS JUST CONTROLLERS
    };
    var OASValidatorMid = function() {
      var OASValidator = require('./middleware/oas-validator');
      return OASValidator.call(undefined, oasDoc, app._router.stack); // VALIDATOR NEEDS JUST SPEC-FILE
    };

    var paths = oasDoc.paths;
    for (var path in paths) {
      for (var method in paths[path]) {
        var expressPath = transformToExpress(path);
        logger.debug("Register: " + method.toUpperCase() + " - " + expressPath);
        var single = checkSingle(expressPath);
        if (config.router == true) {
          checkControllers(path, method, paths[path][method], config.controllers, single);
        }
        switch (method) {
          case 'get':
            if (config.validator == true) {
              app.get(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.get(expressPath, OASRouterMid());
            }
            break;
          case 'post':
            if (config.validator == true) {
              app.post(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.post(expressPath, OASRouterMid());
            }
            break;
          case 'put':
            if (config.validator == true) {
              app.put(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.put(expressPath, OASRouterMid());
            }
            break;
          case 'delete':
            if (config.validator == true) {
              app.delete(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.delete(expressPath, OASRouterMid());
            }
            break;
        }
      }
    }
    callback();
  }); //end deref
};

/**
 * Function to initialize swagger-tools middlewares.
 *@param {object} specDoc - Specification file.
 *@param {function} callback - Function that initializes middlewares one by one in the index.js file.
 */
var initializeMiddleware = function initializeMiddleware(specDoc, app, callback) {

  config.swaggerTools = true;
  router_property = 'x-swagger-router-controller';

  init_checks(specDoc, callback, schemaV3);

  deref(specDoc, function(err, fullSchema) {
    logger.info("Specification file dereferenced");
    specDoc = fullSchema;

    var OASRouterMid = function() {
      var OASRouter = require('./middleware/oas-router');
      return OASRouter.call(undefined, config.controllers); // ROUTER NEEDS JUST CONTROLLERS
    };
    var OASValidatorMid = function() {
      var OASValidator = require('./middleware/oas-validator');
      return OASValidator.call(undefined, specDoc); // VALIDATOR NEEDS JUST SPEC-FILE
    };

    var paths = specDoc.paths;
    for (var path in paths) {
      for (var method in paths[path]) {
        var expressPath = transformToExpress(path);
        logger.debug("Register: " + method.toUpperCase() + " - " + expressPath);
        var single = checkSingle(expressPath);
        if (config.router == true) {
          checkControllers(path, method, paths[path][method], config.controllers, single);
        }

        switch (method) {
          case 'get':
            if (config.validator == true) {
              app.get(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.get(expressPath, OASRouterMid());
            }
            break;
          case 'post':
            if (config.validator == true) {
              app.post(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.post(expressPath, OASRouterMid());
            }
            break;
          case 'put':
            if (config.validator == true) {
              app.put(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.put(expressPath, OASRouterMid());
            }
            break;
          case 'delete':
            if (config.validator == true) {
              app.delete(expressPath, OASValidatorMid());
            }
            if (config.router == true) {
              app.delete(expressPath, OASRouterMid());
            }
            break;
        }

      }
    }
    var middleware = {
      /* swaggerValidator: function() {
        var OASValidator = require('./middleware/oas-validator');
        return OASValidator.call(undefined, specDoc); // VALIDATOR NEEDS JUST SPEC-FILE
      },
      swaggerRouter: function() {
        var OASRouter = require('./middleware/oas-router');
        return OASRouter.call(undefined, config.controllers); // ROUTER NEEDS JUST CONTROLLERS
      }, */
      swaggerValidator: require('./middleware/empty_middleware'),
      swaggerRouter: require('./middleware/empty_middleware'),
      swaggerMetadata: require('./middleware/empty_middleware'),
      swaggerUi: require('./middleware/empty_middleware'),
      swaggerSecurity: require('./middleware/empty_middleware')
    };
    callback(middleware);
  }); //end deref
};

module.exports = {
  initialize: initialize,
  initializeMiddleware: initializeMiddleware,
  configure: configure,
};
