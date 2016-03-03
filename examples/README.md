# Examples

You can run this standalone server with your app, doing all the configuration needed right here.

Before running, you'll need to open `server.js` and replace
```javascript
var getUser = require('./my-custom-get-user');
```
with a suitable `getUser` function described in the [README](../README.md).


## Running in Heroku

1. Get the repo: `git clone git@github.com:layerhq/node-layer-webhooks-services-nexmo.git`
2. CD into folder: `cd node-layer-webhooks-services-nexmo`
3. Create Heroku App: `heroku create`
4. Deploy to Heroku: `git push heroku master`
5. Configure your:
  *  Layer App ID: `heroku config:set LAYER_APP_ID=YOUR_APP_ID`
  *  Layer Authentication Token: `heroku config:set LAYER_BEARER_TOKEN=YOUR_TOKEN`
  *  Nexmo API Key: `heroku config:set NEXMO_KEY=YOUR_KEY`
  *  Nexmo Secret: `heroku config:set NEXMO_SECRET=YOUR_SECRET`
  *  Nexmo phone numbers: `heroku config:set  NEXMO_NUMBERS=COMMA_SEPARATED_PHONE_NUMBER_LIST`
  * Logger: `heroku config:set 'DEBUG=*,-body-parser:json, -express:*'`
  * Hostname: `heroku config:set HOST=$(heroku apps:info -s  | grep web-url | cut -d= -f2)`
6. Install `heroku-redis`: Instructions at https://devcenter.heroku.com/articles/heroku-redis#installing-the-cli-plugin

You should now be able to send messages, change conversation titles, and see the webhook examples respond.


## Running on Your Server

1. Get the repo: `git clone git@github.com:layerhq/node-layer-webhooks-services-nexmo.git`
2. CD into folder: `cd node-layer-webhooks-services-nexmo`
3. Install root dependencies: `npm install`
4. CD into the examples folder: `cd examples`
5. Install example dependencies `npm install`
6. Setup an `ssl` folder with your certificate; your ssl folder should have:
  * server.key
  * server.crt
  * ca.crt
7. Setup your .env file to have the following values:
  * `NEXMO_KEY`: Your Nexmo API Key
  * `NEXMO_SECRET`: Your Nexmo API Secret
  * `NEXMO_NUMBERS`: Your Nexmo phone numbers comma separated
  * `HOST`: Your server host name or IP
  * `WEBHOOK_PORT`: The port your server will receive requests on (defaults to 443 if unset)
  * `LAYER_BEARER_TOKEN`: You can find your Bearer Token on Layer's Developer Dashboard, in the `keys` section.
  * `LAYER_APP_ID`: Your layer app id; you can find this on the same page as your bearer token
  * `REDIS_URL`: Only needed if your not running redis locally.
8. Run the server: `npm start`
