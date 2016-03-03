/**
 * Nexmo Module.  See README.md for API details
 */


// Default parameter values
var DEFAULT_NAME = 'Nexmo Integration';

/**
 * Define the module with options.  Initializes our unread-message handler, and our reply handler.
 * See README.md for details on options.
 */
module.exports = function(options) {
  if (!options.name) options.name = DEFAULT_NAME;
  require('./src/handle-unread-message')(options);
  require('./src/handle-reply')(options);
};
