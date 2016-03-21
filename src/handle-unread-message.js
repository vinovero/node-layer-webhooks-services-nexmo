/**
 * This module handles unread messages and emails any recipient who hasn't read the message.
 * See README for description of parameters.
 */

var _ = require('underscore');
var debug = require('debug');
var ms = require('ms');
var request = require('request');

var REDIS_USER_PREFIX = 'nexmo-layer-integration-';
var REDIS_PHONE_PREFIX = 'nexmo-layer-integration-phone-';
var DEFAULT_TEMPLATE = '<%= sender.name %>: <%= text %>';
var DEFAULT_EXPIRATION = '1 week';
var DEFAULT_PATH = '/nexmo-new-message';

module.exports = function(options) {
  // Setup the module
  var queue = require('kue').createQueue();
  var template = _.template(options.template || DEFAULT_TEMPLATE);
  var redis = options.server.redis;
  var FROM_NUMBERS = options.nexmo.phoneNumbers;
  var EXPIRATION_TIME = ms(options.numberExpirationTime || DEFAULT_EXPIRATION);
  if (!options.delay) options.delay = '1 hour';
  if (!options.server.layerPath) options.server.layerPath = DEFAULT_PATH;

  // Define the receipts webhook structure
  var hook = registerHooks();

  // Any Messages that are unread by any participants will be passed into this job
  // after the delay specified in hook has passed.
  queue.process(hook.name, 10, function(job, done) {
    processMessage(
      job.data.message,
      job.data.recipients,
      job.data.identities,
      done
    );
  });

  function simplifyIdentity(identity) {
    if (typeof options.identities !== 'function') {
      return {
      	displayName: identity.display_name,
      	avatarUrl: identity.avatar_url,
      	firstName: identity.first_name,
      	lastName: identity.last_name,
      	email: identity.email_address,
      	phone: identity.phone_number,
      	metadata: identity.metadata
      };
    } else {
      return identity;
    }
  }

  /**
   * Any Message with unread participants will call processMessage to handle it.
   * This will iterate over all unread recipients, gather the necessary info and call prepareEmail.
   */
  function processMessage(message, recipients, identities, done) {
    message.sender = simplifyIdentity(identities[message.sender.user_id] || {});
    var count = 0;
    recipients.forEach(function(recipient) {
      var user = simplifyIdentity(identities[recipient] || {});
      if (user.phone) {
        // Cache this so we can handle replies
	      redis.set(REDIS_PHONE_PREFIX + user.phone, recipient);

        // Continue to work on sending the SMS
        getPhoneNumberToSendFrom(recipient, message.conversation.id, function(err, fromNumber, isFirst) {
          if (err) return handleError(err, done);
          prepareSMS(message, message.sender, user, recipient, fromNumber, isFirst, done);
      }
    });
    done();
  }

  /**
   * Calculate all the fields needed for the template and find a phone number, then send the SMS.
   */
  function prepareSMS(message, sender, user, userId, fromNumber, isFirst, done) {

    // If we don't have a number to send from, give up.
    if (!fromNumber) {
    	logger('Out of available phone numbers; skipping unread message notification for user ' + userId,
      ' on Conversation ' + message.conversation.id);
      return done();
    }

    // Populate the message object for easy templating
    message.recipient = user;
    message.text = getText(message);

    // Ignore empty messages
    if (message.text.match(/^\s*$/)) return done();

    // If this is a new link between Conversation and fromNumber, introduce the Conversation.
    if (isFirst && options.introduceConversation) {
	    options.introduceConversation(message, function(err, introText) {
  	    if (err) return done(err);
        logMessage(fromNumber, user.phone, message.id, true);
        sendSMS(message, introText, fromNumber, user.phone, done);
    	});
    } else {
      logMessage(fromNumber, user.phone, message.id, false);
      sendSMS(message, '', fromNumber, user.phone, done);
    }
  }

  /**
   * Send the specified SMS
   */
  function sendSMS(message, introText, from, to, done) {
    var text = template(message);
    if (introText) text = introText + '\n\n' + text;

    var url = 'https://rest.nexmo.com/sms/json?' +
      'api_key=' + options.nexmo.key +
      '&api_secret=' + options.nexmo.secret +
      '&from=' + from +
      '&to=' + to +
      '&text=' +  escape(text);

    request(url, function(err, res, body) {
      if (err) return handleError(err, done);
      done();
   });
  }

  /**
   * Lookup the phone number to reuse, reallocate or to assign
   * to this user for this Conversation.
   */
  function getPhoneNumberToSendFrom(userId, conversationId, callback) {
    redis.get(REDIS_USER_PREFIX + userId, function(err, userConversationsStr) {
      var fromNumber, changes, first;
      var expires = Date.now() + EXPIRATION_TIME;
      if (err) return handleError(err, callback);

      try {
        var userConversations = !userConversationsStr ? {} : JSON.parse(userConversationsStr);

        // Purge any expired Nexmo number -> Layer Conversation links
        purgeExpiredConversations(userConversations, conversationId, userId);

        // If a link exists between the conversation and a nexmo number for this user, use it and
        // update its expiration date.
        if (userConversations[conversationId]) {
          fromNumber = userConversations[conversationId].phone;
          userConversations[conversationId].expires = expires;
          changes = true;
        }

        // If there is no link, see if there is an available number, and if so, assign it
        // to this Conversation for this user.
        else {
          fromNumber = findAvailableNumberToSendFrom(userConversations);
          if (fromNumber) {
            userConversations[conversationId] = {
              phone: fromNumber,
              expires: expires
            };
            changes = first = true;
          }
        }
      } catch (err) {
        return handleError(err, callback);
      }

      // Write the new user config back to storage
      if (changes) redis.set(REDIS_USER_PREFIX + userId, JSON.stringify(userConversations));

      // Provide the fromNumber and an indication if its a newly established link to the caller
      callback(null, fromNumber, first);
    });
  }

  /**
   * Iterate over all Conversation -> Nexmo Number links and remove those that are expired.
   * Allow an expired link to not be removed if we are processing a message for that Conversation.
   */
  function purgeExpiredConversations(userConversations, currentConversationId, userId) {
    var now = Date.now();
    Object.keys(userConversations).forEach(function(cId) {
      if (cId != currentConversationId) {
        if (userConversations[cId].expires < now) {
          logger('Conversation ' + cId + ' has expired for user ' + userId);
          delete userConversations[cId];
        }
      }
    });
  }

  /**
   * Return a nexmo number that isn't currently in use by this user.
   * Return undefined if no numbers are available.
   */
  function findAvailableNumberToSendFrom(userConversations) {
    var usedNumbers = Object.keys(userConversations).map(function(cId) {
      return userConversations[cId].phone;
    });
    for (var i = 0; i < FROM_NUMBERS.length; i++) {
      if (usedNumbers.indexOf(FROM_NUMBERS[i]) === -1) return FROM_NUMBERS[i];
    }
  }

  /**
   * Create the webhook definition object
   */
  function registerHooks() {
    var hook = {
      name: options.name,
      path: options.server.layerPath,

      // These events are needed for the register call
      events: ['message.sent', 'message.read', 'message.delivered', 'message.deleted'],

      // Wait the specified period and then check if they have read the message
      delay: options.delay,

      receipts: {
        // Any user whose recipient status is 'sent' or 'delivered' (not 'read')
        // is of interest once the delay has completed.
        // Change to 'sent' to ONLY send notifications when a message wasn't delivered.
        reportForStatus: options.recipient_status_filter || ['sent', 'delivered'],
	      identities: 'identities' in options ? options.identities : true
      }
    };

    var logger = debug('layer-webhooks-nexmo:' + hook.name.replace(/\s/g,'-') + ':sms-notifier');

    // Register the webhook with Layer's Services
    options.layer.webhookServices.register({
      secret: options.layer.secret,
      url: options.server.url,
      hooks: [hook]
    });

    // Listen for events from Layer's Services
    options.layer.webhookServices.receipts({
      expressApp: options.server.app,
      secret: options.layer.secret,
      hooks: [hook]
    });

    return hook;
  }

  /**
   * Handle an asynchronous error by logging it and calling the callback
   */
  function handleError(err, done) {
    console.error(new Date().toLocaleString() + ': ' + hook.name + ': ', err);
    done(err);
  }

  /**
   * Extract the text from a Message
   */
  function getText(message) {
    return message.parts.filter(function(part) {
      return part.mime_type === 'text/plain';
    }).map(function(part) {
      return part.body;
    }).join('\n');
  }

  /**
   * Write a log when sending an SMS
   */
  function logMessage(from, to, messageId, intro) {
    logger('Sending SMS from ' + from,
      ' to ' + to,
      intro ? ' with intro' : '');
  }
};
