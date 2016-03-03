/**
 * This module receives a request from nexmo any time it receives an SMS reply from a user.
 * See README for description of parameters.
 */
var request = require('request');
var debug = require('debug');
var urlencode = require('urlencode');
var ms = require('ms');
var Promise = require('bluebird');

var REDIS_USER_PREFIX = 'nexmo-layer-integration-';
var REDIS_PHONE_PREFIX = 'nexmo-layer-integration-phone-';
var DEFAULT_EXPIRATION = '1 week';
var DEFAULT_PATH = '/nexmo-new-sms';

module.exports = function(options) {
  // Setup the module
  var queue = require('kue').createQueue();
  var webhookName = options.name;
  var redis = options.server.redis;
  var EXPIRATION_TIME = ms(options.numberExpirationTime || DEFAULT_EXPIRATION);
  if (!options.server.nexmoPath) options.server.nexmoPath = DEFAULT_PATH;
  var logger = debug('layer-webhooks-nexmo:' + webhookName.replace(/\s/g,'-') + ':sms-listener');

  /**
   * Listen for webhook events and create jobs for them
   */
  options.server.app.get(options.server.nexmoPath, function(req, res) {
    if (!req.query.text) return res.sendStatus(200);

    queue.createJob(webhookName + ' new-sms', {
      from: req.query.msisdn,
      to: req.query.to,
      text: req.query.text
    }).attempts(10).backoff({
      type: 'exponential',
      delay: 1000
    }).save(function(err) {
      if (err) console.error(new Date().toLocaleString() + ': ' + webhookName + ': Unable to create Kue process', err);
    });
    res.sendStatus(200);
  });


  /**
   * Get the User ID associated with this phone.
   * Note that we write this mapping to REDIS any time we send a text message;
   * therefore the only way this value is missing is if they are texting this service
   * but not as a reply.
   *
   * @return {promise}
   */
  function getUserIdFromPhone(phone) {
    return new Promise(function (resolve, reject) {
      redis.get(REDIS_PHONE_PREFIX + phone, function(err, userId) {
        if (err) {
          console.error(new Date().toLocaleString() + ': ' + webhookName + ': Redis Phone to User Lookup Failed for ' + phone, err);
          reject(err);
        } else {
          resolve(userId);
        }
      });
    });
  }

  /**
   * Get the user config; this is the mapping between Conversation IDs
   * and the phone numbers used to text those conversations to this userID.
   *
   * @return {Promise}
   */
  function getUserConfig(userId) {
    return new Promise(function (resolve, reject) {
      redis.get(REDIS_USER_PREFIX + userId, function(err, userConfigStr) {
	      if (err) {
          console.error(new Date().toLocaleString() + ': ' + webhookName + ': Unable to find user config for ' + userId, err);
          reject(err);
	      } else if (!userConfigStr) {
          console.error(new Date().toLocaleString() + ': ' + webhookName + ': Unable to find user config for ' + userId);
          reject(null);
	      } else {
          try {
            var userConfig = JSON.parse(userConfigStr);
            resolve({
              userId: userId,
              userConfig: userConfig
            });
          } catch(err) {
            console.error(new Date().toLocaleString() + ': ' + webhookName + ': Unable to parse user config for ' + userId, err);
            reject(err);
          }
	      }
      });
    });
  }

  /**
   * Send a Message to a Conversation given the text of an SMS,
   * the userConfig mapping conversations to phone numbers,
   * and the phone number that the SMS was sent to.
   *
   * @return {Promise}
   */
  function sendMessageToConversation(userId, userConfig, to, text) {
    return new Promise(function (resolve, reject) {

      // Step 1: Extract the Conversation ID From this map
      var conversationId = Object.keys(userConfig).filter(function(conversationId) {
        return userConfig[conversationId].phone === to;
      })[0];

      if (!conversationId) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Unable to find conversationId for message to ' + to + ' in ', JSON.stringify(userConfig, null, 4));
        return resolve();
      }

      // Step 2: Update the expiration date for that Conversation => Nexmo number mapping
      userConfig[conversationId].expires = Date.now() + EXPIRATION_TIME;
      redis.set(REDIS_USER_PREFIX + userId, JSON.stringify(userConfig));

      // Step 3: Send the SMS's text to the Conversation.
      options.layer.client.messages.sendTextFromUser(conversationId, userId, text, function(err) {
        if (err) {
          console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to send a Layer Message', err);
          reject(err);
        } else {
          logger('Response posted to Conversation ', conversationId + ' for ' + userId);
          resolve();
        }
      });
    });
  }

  /**
   * Process new SMS messages, attempting to identify a Conversation and UserID that they should be posted to.
   */
  queue.process(webhookName + ' new-sms', function(job, done) {
    // Step 1: Get the UserID for this sender; this is (over)written every time we send an SMS to a user.
    getUserIdFromPhone(job.data.from)
      .then(getUserConfig)
      .then(function(result) {
        return sendMessageToConversation(result.userId, result.userConfig, job.data.to, job.data.text);
      })
      .then(function() {
        done();
      })
      .catch(function(err) {
        done(err);
      });
  });


  /**
   * Setup the Nexmo Webhooks for each of our Nexmo Phone Numbers.
   * STEP 1: Get all the numbers in the user's account
   */
  var url = 'https://rest.nexmo.com/account/numbers/' + options.nexmo.key + '/' + options.nexmo.secret;
  request(url, function(err, res, body) {
    if (typeof body === 'string') body = JSON.parse(body);
    var numbers = body.numbers;

    // STEP 2: For any of the numbers this server is configured to use, update their webhook url if it
    // does not point to this server.
    var url = options.server.url + options.server.nexmoPath;

    numbers.forEach(function(number) {
      // Ignore any phone numbers in their account that aren't for use with this service.
      if (options.nexmo.phoneNumbers.indexOf(number.msisdn) === -1) return;
      if (number.moHttpUrl !== url) {
      	request({
      	  method: 'POST',
      	  url: 'https://rest.nexmo.com/number/update/' + options.nexmo.key + '/' + options.nexmo.secret + '/' + number.country + '/' + number.msisdn + '?moHttpUrl=' + urlencode(url)
      	}, function(err, res) {
      	  logger('Registering ' + number.msisdn, !err ? ' complete' : err);
      	});
      }
    });
  });
};
