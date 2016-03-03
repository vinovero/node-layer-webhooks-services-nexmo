// Setup the express server
require('dotenv').load();
var express = require('express');
var https = require('https');
var fs = require('fs');
var app = express();

// Setup environmental variables
if (!process.env.LAYER_BEARER_TOKEN) return console.error('LAYER_BEARER_TOKEN missing in your environmental variables');
if (!process.env.LAYER_APP_ID) return console.error('LAYER_APP_ID missing in your environmental variables');
if (!process.env.NEXMO_KEY) return  console.error('NEXMO_KEY missing in your environmental variables');
if (!process.env.NEXMO_SECRET) return  console.error('NEXMO_SECRET missing in your environmental variables');
if (!process.env.NEXMO_NUMBERS) return  console.error('NEXMO_NUMBERS missing in your environmental variables');

var PORT = process.env.WEBHOOK_PORT || '443';
var HOST = process.env.HOST || 'localhost';
var URL  = ((HOST.indexOf('https://') === 0) ? HOST : 'https://' + HOST).replace(/\/$/, '') + ':' + PORT;

// Setup Redis and kue
var redis = require('redis').createClient(process.env.REDIS_URL);
var queue = require('kue').createQueue({
  prefix: 'layer-nexmo-integration-',
  jobEvents: false,
  redis: process.env.REDIS_URL
});

// Setup the Layer Webhooks Service
var LayerWebhooks = require('layer-webhooks-services');
var webhookServices = new LayerWebhooks({
  token: process.env.LAYER_BEARER_TOKEN,
  appId: process.env.LAYER_APP_ID,
  redis: redis
});

// Setup the Layer Platform API
var LayerClient = require('layer-api');
var layerClient = new LayerClient({
  token: process.env.LAYER_BEARER_TOKEN,
  appId: process.env.LAYER_APP_ID,
});

// Presumably you either have the ssl folder setup... or your running on
// heroku where its not required, and we can just use the app variable.
var key, cert, ca, secureServer;
try {
  key = fs.readFileSync('./ssl/server.key');
  cert= fs.readFileSync('./ssl/server.crt');
  ca  = fs.readFileSync('./ssl/ca.crt');
  secureServer = https.createServer({
    key: key,
    cert: cert,
    ca: ca,
    requestCert: true,
    rejectUnauthorized: false
  }, app);
} catch(e) {
  console.log('SSL folder not found; assume heroku environment');
  secureServer = app;
}


/* A given nexmo phone number may switch Conversations on occasion. Any time you get a Message from a new
 * Conversation (including the first message you ever receive from a nexmo phone number), you can
 * provide an introText using the optional introduceConversation parameter.
 */
function introduceConversation(message, callback) {
  layerClient.conversations.get(message.conversation.id, function(err, res) {
    if (err) {
      console.error('introduceConversation failed to get Conversation: ', err);
      return callback(err);
    }
    if (res.body.metadata && res.body.metadata.conversationName) {
      callback(null, 'You have new messages in Conversation "' + res.body.metadata.conversationName + '"');
    } else {
      callback(null, 'You have new messages in Conversation "Unnamed Conversation"');
    }
  });
}


var getUser = require('./my-custom-get-user');

/* Initialize the layer-nexmo webhooks server */
// Startup the server; allow for a custom heroku PORT
secureServer.listen(process.env.PORT || PORT, function() {
  console.log('Secure Express server listening on port ' + PORT);
  require('../index')({
    getUser: getUser,
    introduceConversation: introduceConversation,
    delay: '5 seconds',
    layer: {
      webhookServices: webhookServices,
      client: layerClient,
      secret: 'Lord of the Mog has jammed your radar'
    },
    server: {
      url: URL,
      app: app,
      redis: redis,
    },
    nexmo: {
      key: process.env.NEXMO_KEY,
      secret: process.env.NEXMO_SECRET,
      phoneNumbers: process.env.NEXMO_NUMBERS.split(/\s*,\s*/)
    }
  });
});
