#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');
var Steam = require('steam-webapi');
var request = require('request');
var _ = require('underscore');
var mongojs = require('mongojs');
var Q = require('q');

/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;

    //DB Setup
    var dbName = "/steamslack";
    var connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ":" +  process.env.OPENSHIFT_MONGODB_DB_PASSWORD + "@" + process.env.OPENSHIFT_MONGODB_DB_HOST + dbName;
    var db = mongojs(connection_string, ['users', 'meet']);

    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        }

        self.webhookURLs = {
          STEAM_STATUS: 'https://hooks.slack.com/services/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',
          LIFT: 'https://hooks.slack.com/services/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',
          POE_STATUS: 'https://hooks.slack.com/services/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'
        };

        self.webhookTokens = {
            STEAM_STATUS: 'H881BlB0P9inb5staqKemTON',
            LIFT: 'tBtgwXX3wHGiMyxENbRe8SAp',
            POE_STATUS: 'lqKyHvF8tUfgmQKH0jmUUiwF'
        };
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === "undefined") {
            self.zcache = {
                'index.html': '',
                'slack.html': ''
            };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
        self.zcache['slack.html'] = fs.readFileSync('./slack.html');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) { return self.zcache[key]; };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = { };

        self.routes['/asciimo'] = function(req, res) {
            var link = "http://i.imgur.com/kmbjB.png";
            res.send("<html><body><img src='" + link + "'></body></html>");
        };

        self.routes['/'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.cache_get('index.html') );
        };

        self.routes['/slack/steam'] = function(req, res) {
            self.getSteamStatus(req, res);
        };

        self.routes['/slack/poe-status'] = function(req, res) {
            self.getPoEStatus(req, res);
        };

        self.routes['/slack/lift'] = function(req, res) {
            self.lift(req, res)
        };
    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.createRoutes();
        self.app = express.createServer();

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            self.app.get(r, self.routes[r]);
        }
        self.app.use('/js', express.static(__dirname + '/js'));
    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

    self.getSteamStatus = function(req, res){
        var token = req.param('token');
        var channel = req.param('channel_name');

        if(token === self.webhookTokens.STEAM_STATUS){

            var steamIDs = [];

            db.users.find(function(err, users){

                for(var i = 0; i < users.length; i++){
                    steamIDs.push(users[i].steamId);
                }

                Steam.key = '3CABF6B2D8C98BAF8E6BC64D107D38FF';
                Steam.ready(function(err){
                    if(err) return console.log(err);

                    var steam = new Steam();

                    steam.getPlayerSummaries({steamids: steamIDs.join()}, function(err, data){

                        var states = ["Offline", "Online", "Busy", "Away", "Snooze", "Looking to Trade", "Looking to Play"];

                        var fields = [];

                        data.players = _.reject(data.players, function(player){
                            return player.personastate === 0  && player.communityvisibilitystate !== 1;
                        });

                        for(var i = 0; i < data.players.length; i++){
                            var curPerson = data.players[i];

                            //Save state value, overwrite if playing game
                            var value = states[curPerson.personastate];
                            if(curPerson.gameextrainfo){
                                value = "Playing " + curPerson.gameextrainfo;
                            }else if(curPerson.communityvisibilitystate == 1){
                                value = "Paranoid - We'll never know!";
                            }

                            //Build field for person
                            var person = {
                                "title": curPerson.personaname,
                                "value": value,
                                "short": false
                            };

                            fields.push(person);
                        }

                        fields = _.sortBy(fields, function(obj){ return (obj.title).toLowerCase(); });

                        var message = {
                            "channel": "#" + channel,
                            "fallback": "Steam Status",
                            "color": "#cccccc",
                            "fields": fields
                        };

                        self.sendWebHookCall(message, self.webhookURLs.STEAM_STATUS);
                    });
                });
            });
        }else{
            res.setHeader('Content-Type', 'text/html');
            res.send("<h2>Bad Token</h2>");
        }
    };

    self.getPoEStatus = function(req, res){
        var token = req.param('token');
        var channel = req.param('channel_name');


        if(token === self.webhookTokens.POE_STATUS){
            var allPromises = [];

            db.users.find({poe: {$exists: true}}, function(err, users){

                _.forEach(users, function(user){
                    allPromises.push(getPoEAccountInfo(user.poe.poeAccountName));
                });

                Q.all(allPromises).done(handleData);
            });

            var handleData = function(accounts){
                var fields = [];
                _.forEach(accounts, function(account){
                    if(!_.isEmpty(account) && _.isObject(account)){
                        var value = '';
                        var accountName;
                        _.chain(account)
                            .sortBy(function(char){
                                return char.level;
                            })
                            .forEach(function(char){
                                accountName = char.accountName;
                                value += ' - ' + char.charName;
                                value += ' (' + char.level + ')';
                                value += (char.online ? ' -- Online' : '') + '\n\n';
                            });
                        var person = {
                            "title": accountName,
                            "value": value,
                            "short": false
                        };

                        fields.push(person);
                    }
                });

                var message = {
                    "channel": "#" + channel,
                    "fallback": "PoE Status",
                    "color": "#AE2C1A",
                    "fields": fields
                };
                self.sendWebHookCall(message, self.webhookURLs.POE_STATUS);
            };

        }else{
            res.setHeader('Content-Type', 'text/html');
            res.send("<h2>Bad Token</h2>");
        }

    };

    self.lift = function(req, res){
        //Data -- OUTDATED, EXAMPLE ONLY
        /*[
            { "steamId": "76561197982429034", "slackName": "boomdog83", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561197962840405", "slackName": "kosherbaked", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198097867159", "slackName": "mrpoopa", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198011446886", "slackName": "khan", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198008899629", "slackName": "sarahfitz", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561197972790147", "slackName": "rob", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561197979980572", "slackName": "davefish", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198080732494", "slackName": "marshall", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198019962370", "slackName": "nick", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198047692130", "slackName": "christian", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198160566620", "slackName": "shelby", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561197999806429", "slackName": "buttons", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } }
            //db.users.update({slackName: "boomdog83"}, {$set: {poe: {poeAccountName: "Boomdog83"}}})
        ]*/

        var token = req.param('token');

        if(token === self.webhookTokens.LIFT) {

            //Possible lifts entered by user
            var lifts = [
                "bench",
                "squat",
                "deadlift"
            ];

            var actions = [
                "lift",
                "injure"
            ];

            res.setHeader('Content-Type', 'text/html');

            //Get the params entered by the user
            var params = (req.param('text')).split(" ");
            var sender = req.param('user_name');

            if (params.length == 1) {
                if (params[0] != "meet") {
                    res.send("Bad command, please follow the pattern '/lift PERSON_NAME ACTION OR [meet]'.");
                } else {

                    db.meet.find(function(err, meet){
                        if(err) {
                            res.send("An error has occurred!");
                        }else if(meet[0].lastMeet >= (Date.now() - 3600000)){
                            var timeDiff = 3600000 - (Date.now() - meet[0].lastMeet);
                            var mins = (timeDiff/1000/60) << 0;
                            var secs = Math.ceil((timeDiff/1000) % 60);
                            res.send("The next meet cannot be called for another " + mins + " minutes and " + secs + " seconds.");
                        }else{
                            db.users.find(function(err, users){
                                users = _.sortBy(users, function(user){
                                    var total = self.getTotal(user);
                                    return -total;
                                });

                                var output = sender + " has called a meet! The winners are:\n";
                                output += "1st: " + users[0].slackName + " with a total of " + self.getTotal(users[0]) + "lbs!\n";
                                output += "2nd: " + users[1].slackName + " with a total of " + self.getTotal(users[1]) + "lbs!\n";
                                output += "3rd: " + users[2].slackName + " with a total of " + self.getTotal(users[2]) + "lbs!\n";

                                var message = {
                                    "channel": "#" + req.param('channel_name'),
                                    "fallback": "A meet has occurred!",
                                    "color": "#cccccc",
                                    "text": output
                                };

                                db.meet.update({}, {$set: {lastMeet: Date.now()}});

                                self.sendWebHookCall(message, self.webhookURLs.LIFT);
                            });
                        }
                    });
                }

            //If the user entered anything other than 2 params
            }else if(params.length != 2) {
                res.send("Bad command, please follow the pattern '/lift [PERSON_NAME ACTION] OR [meet]'.");

            //Make sure they entered a valid action
            }else if(!_.some(actions, function(action){ return action === params[1].toLowerCase(); })) {
                res.send("Invalid action, options are: lift or injure.");
            }else if(sender.toLowerCase() == params[0].toLowerCase()){
                res.send("You cannot 'Lift' yourself.");
            }else{
                var slackName = params[0].toLowerCase();
                var action = params[1].toLowerCase();

                //Get the user info based on the slack name entered
                db.users.findOne({slackName: slackName}, function(err, user){
                    if(err || !user) {
                        res.send(slackName + " does not exist.");
                    }else if(user.lifting.lastLift && user.lifting.lastLift >= (Date.now() - 300000)){
                        var timeDiff = 300000 - (Date.now() - user.lifting.lastLift);
                        var mins = (timeDiff/1000/60) << 0;
                        var secs = Math.ceil((timeDiff/1000) % 60);
                        res.send(slackName + " needs to rest for " + mins + " minutes and " + secs + " seconds.");
                    }else{

                        var output = sender;

                        //This hack allows for the dynamic updating of MongoDB
                        var setLift = {};

                        if(action == "lift"){
                            var lift = lifts[Math.floor(Math.random() * lifts.length)];
                            var oldPR = user.lifting[lift];
                            var newPR = oldPR + Math.floor(Math.random() * 10) + 1;

                            output += " boosted " + slackName + "'s " + lift + " by " + (newPR - oldPR) + "lbs. It is now at " + newPR + "lbs!";
                            setLift['lifting.' + lift] = newPR;
                        }else{
                            var oldHealth = user.lifting.health;
                            var newHealth = oldHealth - (Math.floor(Math.random() * 5) + 1);

                            output += " lowered " + slackName + "'s health by " + Math.abs(newHealth - oldHealth) + ". It is now at " + newHealth + ".";
                            setLift['lifting.health'] = newHealth;
                        }

                        setLift['lifting.lastLift'] = Date.now();
                        db.users.update({slackName: slackName}, {$set: setLift});

                        var message = {
                            "channel": "#" + req.param('channel_name'),
                            "fallback": "A lift has occurred!",
                            "color": "#cccccc",
                            "text": output
                        };

                        self.sendWebHookCall(message, self.webhookURLs.LIFT);
                    }
                });
            }
        }else{
            res.setHeader('Content-Type', 'text/html');
            res.send("<h2>Bad Token</h2>");
        }
    };

    //Helper function to get the current time
    self.now = function(){
        var date = new Date();
        return date.getTime();
    };

    self.getTotal = function(user){
        var total = user.lifting.bench + user.lifting.squat + user.lifting.deadlift;
        return Math.floor(total * (user.lifting.health/100));
    };

    self.sendWebHookCall = function(message, url){
        //Send data back to slack
        request({
            url: url,
            method: 'POST',
            form: {payload: JSON.stringify(message)}
        }, function(error, resp, body){
            if(error){
                console.log(error);
            }else{
                console.log(resp.statusCode + " --- " + body);
            }
        });
    };

    //Private functions
    function getPoEAccountInfo(accountName){
        var deferred = Q.defer();

        //do stuff
        request({
            url: 'http://api.exiletools.com/ladder?league=warbands&short=1&accountName='+accountName,
            method: 'GET',
            json: true
        }, function(error, resp, body){
            if(error){
                console.log(error);
                deferred.resolve(null);
            }else{
                console.log(resp.statusCode + " --- " + body);
                deferred.resolve(body);
            }
        });
        return deferred.promise;
    }


};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();

