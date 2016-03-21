# Layer Webhooks Nexmo Service
[![npm version](http://img.shields.io/npm/v/layer-webhooks-services-nexmo.svg)](https://npmjs.org/package/layer-webhooks-services-nexmo)

This repository contains a service that SMS-notifies users of your Layer Applications
of unread messages.  This repository requires some configuration to work.  Users can reply to these SMS messages and have the messages appear in the Conversation.  Different nexmo phone numbers are used to send unread notifications so that a given thread in an SMS UI represents a single Conversation.

## Setting up Nexmo

The following actions are needed:

1. Obtain a Nexmo API key and secret (two separate values)
2. Purchase a set of Nexmo numbers that you will text from.  See below for suggestions on how many numbers you will need.

### How many Nexmo Numbers are Needed?

For a given user, each nexmo phone number represents a single Layer Conversation.  Different users will have different mappings between nexmo numbers and Layer Conversations.  A nexmo phone number's link to a Conversation will expire (default is that it expires one week after the last time it was used by this Conversation), at which time the nexmo number can be used for a different Conversation.

If all available nexmo phone numbers have been used by a given user, then additional Conversations simply won't send SMS messages for unread messages.

The quantity of nexmo phone numbers needed for a specific user is the number of Conversations you expect that user to be engaged in within a given week.  This number will presumably vary among your users, but if you set your quantity of numbers to 2 standard deviations above the average number of Conversations, the number of missed notifications should be pretty small.

## How it works

A User Record contains a mapping between Layer Conversation IDs and Nexmo Phone Numbers:
```json
{
    "conversationId1": {
        "phone": "phone1",
        "expires": "d1"
    },
    "conversationId2": {
        "phone": "phone2",
        "expires": "d2"
    },
    "conversationId3": {
        "phone": "phone3",
        "expires": "d3"
    }
}
```
Receiving Layer Messages:

1. The layer-webhooks-services `receipts` service notifies us whenever a Message has gone unread and requires notification of UserA.
2. We read in a UserA's Record as shown above.
3. We remove any expired links between Nexmo Phone Numbers and Conversations from UserA's Record, UNLESS they match our current Conversation
4. If our current Conversation is in the user record
4a. Use the phone number to text the user
4b. Update the `expires` field to be one week after now.
5. If our current Conversation is NOT in the user record
5a. Find an unused phone number to text from
5b. If all phone numbers are in use, log an error and move on.
5c. If a phone number is available, add an entry to the User Record.
6. If any changes were made, write the user Record back to redis
7. Write a reverse lookup to redis so that for that user's phone number, we can lookup that user's userId.

Receiving SMS Messages

1. Nexmo's webhook notifies us of Who the SMS is from, what Nexmo Number its sent to, and the text of the Message
2. Use the reverse lookup to get the UserID from the phone number that it was sent from
3. Use that UserID's User Record to find the Conversation ID associated with the Nexmo Number it was sent to
4. Post a Message from that UserID, to that Conversation ID with the specified text.
5. Update the `expires` field to be one week after now.

## Setting up Identity Services

Layer's Webhooks do not provide the recipient's phone number, only their userId.  In order to send them an SMS, we will need to get their phone number.  The default behavior is to automatically get the number from the Layer's Identities service; however, this only works if you've actually registered your user's phone number there.

If you are not using the Layer Identities service and putting phone numbers there, then provide a `identities` function when configuring this module. The `identities` function should return a User Object.  Your User Object should provide `name` and `phone` fields; other custom fields can be added and used from your templates.

```javascript
function myGetIdentity(userId, callback) {
    // Lookup in a database or query a web service to get details of this user
    doLookup(userId, function(err, result) {
       callback(error, {
          phone: result.cellnumber,
          name: result.first_name + ' ' + result.last_name,
          misc: result.favorite_color
       });
    });
}

require('layer-webhooks-service-nexmo')({
    identities: myGetIdentity,
    ...
});

```

## The Message Template

Templates use [Underscore JS Templates](http://underscorejs.org/#template).  The SMS Message sent to notifiy users of unread messages defaults to:

`<%= sender.name =>: <%= text %>`

But you can configure this module with a customer `template` parameter.

Templates should expect to run on a Message Object as defined by the [Layer Webhooks Docs](https://developer.layer.com/docs/webhooks/payloads#message-sent):
```json
{
    "id": "layer:///messages/940de862-3c96-11e4-baad-164230d1df67",
    "url": "https://api.layer.com/apps/082d4684-0992-11e5-a6c0-1697f925ec7b/messages/940de862-3c96-11e4-baad-164230d1df67",
    "conversation": {
        "id": "layer:///conversations/e67b5da2-95ca-40c4-bfc5-a2a8baaeb50f",
        "url": "https://api.layer.com/apps/082d4684-0992-11e5-a6c0-1697f925ec7b/conversations/e67b5da2-95ca-40c4-bfc5-a2a8baaeb50f"
    },
    "parts": [
        {
            "id": "layer:///messages/940de862-3c96-11e4-baad-164230d1df67/parts/0",
            "mime_type": "text/plain",
            "body": "This is the message."
        },
        {
            "mime_type": "image/png",
            "id": "layer:///messages/940de862-3c96-11e4-baad-164230d1df67/parts/1",
            "content": {
                "id": "layer:///content/940de862-3c96-11e4-baad-164230d1df60",
                "download_url": "http://google-testbucket.storage.googleapis.com/some/download/path",
                "expiration": "2014-09-09T04:44:47+00:00",
                "refresh_url": "https://api.layer.com/apps/082d4684-0992-11e5-a6c0-1697f925ec7b/content/7a0aefb8-3c97-11e4-baad-164230d1df60",
                "size": 172114124
            }
        }
    ],
    "sent_at": "2014-09-09T04:44:47+00:00",
    "recipient_status": {
        "12345": "read",
        "999": "sent",
        "111": "sent"
    }
}
```

In addition, the following properties will be added:

* `sender` Object: This will be the object you provide via a `identities` call on the sender of this Message.
* `recipient` Object: This will be the object you provide via a `identities` call on a single recipient
* `text` String: This will extract any text/plain parts and concatenate their body's together into an easily accessed string

A custom template might look like:

```json
{
  "template": "<%= sender.name %> says <%= text %>",
}
```

## The Full API

The following parameters are supported:

| Name                  | Required  | Description |
|-----------------------|-----------|-------------|
| layer                 | Yes       | An object for organizing all of your Layer Service configurations |
| layer.webhookServices | Yes       | An instance of [Webhook Service Client](https://www.npmjs.com/package/layer-webhooks-services) |
| layer.client          | Yes       | An instance of [Layer Platform API Client](https://www.npmjs.com/package/layer-api) |
| layer.secret          | Yes       | Any unique string that nobody outside your company knows; used to validate webhook requests |
| server                | Yes       | An object for organizing all of your web server's configurations |
| server.app            | Yes       | An express server instance, listening using https protocol. |
| server.url            | Yes       | URL that this server is on; omit paths. Used in combination with the `path` property to register your webhook. |
| server.redis          | Yes       | An instance of a [redis server](https:///npmjs.com/package/redis)   |
| server.layerPath      | No        | Path that the express server will listen on for Layer Webhooks; defaults to "nexmo-new-message" |
| server.nexmoPath      | No        | Path that the express server will listen on for Nexmo Webhooks; defaults to "nexmo-new-sms" |
| nexmo                 | Yes       | An object for organizing all of your Nexmo Service configurations |
| nexmo.key             | Yes       | Your nexmo API key |
| nexmo.secret          | Yes       | Your nexmo API Secret |
| nexmo.phoneNumbers    | Yes       | Array of phone numbers (strings) that you have purchased through Nexmo and will use to SMS your users |
| delay                 | Yes       | How long to wait before checking for unread messages and notifiying users.  Delays can be configured using a number representing miliseconds, or a string such as '10 minutes' or other strings parsable by [ms](https://github.com/rauchg/ms.js) |
| identities               | No       | Function that looks up a user's info and returns the results via callback |
| template              | No        | Template string for formatting the SMS message |
| name                  | No        | Name to assign the webhook. |
| reportOnStatus | No      | Array of user states that justify notification; `['sent']` (Message could not be delivered yet); `['sent', 'delivered']` (Message is undelivered OR simply unread); `['delivered']` (Message is delivered but not read). Default is `['sent', 'delivered']` |
| numberExpirationTime  | No        | How long to wait before inactivity causes the link between a Conversation and nexmo number for a given user to expire.  Default is 1 week. Delays can be configured using a number representing miliseconds, or a string such as '10 minutes' or other strings parsable by [ms](https://github.com/rauchg/ms.js) |
| introduceConversation | No        | Asynchronous callback for introducing a Conversation before showing Messages from that Conversation. |

### The introduceConversation method

The first time you get a text about an unread message, you may want to identify what conversation this came from.  Furthermore, the link between a Conversation and a nexmo phone number is occasionally broken, and the number reused.  In which case, it may be significant to tell the user that "The Conversation is now about X".

Lets take two scenarios:


#### All of your Conversations are one-on-one

Your Conversations don't need titles, the only thing you need to know is WHO the Conversation is with.  In this case, you may not need a template of `<%= sender.name %>: <%= text %>`, and may want the following:

```javascript
require('layer-webhooks-services-nexmo')({
  ...,
  template: '<%= text %>',
  introduceConversation: function(message, callback) {
    callback(null, message.sender.name + ' says:');
  }
});
```

Result:
* The first Unread Message that gets sent will start with "User A says:"
* Each Message will just be the text of the Message and not need to identify the user's name over and over.
* If the Nexmo number changes to report on the Conversation with User B, it will happen with an SMS saying "User B says:".

#### Your Conversations have Titles/Topics

You have multiple users in your Conversations, so you may stick with the default template of `<%= sender.name %>: <%= text %>`, but you DO want to make sure your user knows WHICH Conversation this is happening in (and therefore, which Conversation this user's replies will go to).

```javascript
require('layer-webhooks-services-nexmo')({
  ...,
  introduceConversation: function(message, callback) {
    layerClient.conversations.get(message.conversation.id, function(err, res) {
      if (err) {
        console.error('introduceConversation failed to get Conversation: ', err);
        return callback(err);
      }
      callback(null, 'You have new messages in Conversation "' + res.body.metadata.conversationName + '"');
    });
  }
});
```

## Example

```javascript
// Setup Redis and kue
var redis = require('redis').createClient(process.env.REDIS_URL);
var queue = require('kue').createQueue({
  jobEvents: false,
  redis: process.env.REDIS_URL
});

// Setup the Layer Platform API
var LayerClient = require('layer-api');
var layerClient = new LayerClient({
  token: process.env.LAYER_BEARER_TOKEN,
  appId: process.env.LAYER_APP_ID,
});

// Setup the Layer Webhooks Service
var LayerWebhooks = require('layer-webhooks-services');
var webhookServices = new LayerWebhooks({
  token: process.env.LAYER_BEARER_TOKEN,
  appId: process.env.LAYER_APP_ID,
  redis: redis
});

function introduceConversation(message, callback) {
  layerClient.conversations.get(message.conversation.id, function(err, res) {
    if (err) {
      console.error('introduceConversation failed to get Conversation: ', err);
      return callback(err);
    }

    callback(null, 'You have new messages in Conversation "' + res.body.metadata.conversationName + '"');
  });
}

secureExpressApp.listen(PORT, function() {
    require('layer-webhooks-service-nexmo')({
        introduceConversation: introduceConversation,
        layer: {
          webhookServices: webhookServices,
          client: layerClient,
          secret: 'Lord of the Mog has jammed your radar'
        },
        server: {
          url: 'https://mywebhooks.mycompany.com',
          app: app,
          redis: redis
        },
        nexmo: {
          key: process.env.NEXMO_KEY,
          secret: process.env.NEXMO_SECRET,
          phoneNumbers: process.env.NEXMO_NUMBERS.split(/\s*,\s*/)
        }
    });
});
```
