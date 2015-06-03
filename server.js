#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');
var Steam = require('steam-webapi');
var request = require('request');
var _ = require('underscore');
var mongojs = require('mongojs');

/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;

    //DB Setup
    var dbName = "/steamslack";
    var connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ":" +  process.env.OPENSHIFT_MONGODB_DB_PASSWORD + "@" + process.env.OPENSHIFT_MONGODB_DB_HOST + dbName;
    var db = mongojs(connection_string, ['users']);

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
            self.getSteamStatus(req, res)
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

        if(token == "H881BlB0P9inb5staqKemTON"){

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

                        var states = {
                            "0": "Offline",
                            "1": "Online",
                            "2": "Busy",
                            "3": "Away",
                            "4": "Snooze"
                        };

                        var fields = [];

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
                            "fallback": "Shit's broke",
                            "color": "#cccccc",
                            "fields": fields
                        };

                        request({
                            url: 'https://hooks.slack.com/services/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',
                            method: 'POST',
                            form: {payload: JSON.stringify(message)}
                        }, function(error, resp, body){
                            if(error){
                                console.log(error);
                            }else{
                                console.log(resp.statusCode + " --- " + body);
                            }
                        });
                    });
                });
            });
        }else{
            res.setHeader('Content-Type', 'text/html');
            res.send("<h2>Bad Token</h2>");
        }
    };

    self.lift = function(req, res){
        //Data
        /*[
            { "steamId": "76561197982429034", "slackName": "boomdog83", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561197962840405", "slackName": "kosherbaked", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198097867159", "slackName": "mrpoopa", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198011446886", "slackName": "khan", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198008899629", "slackName": "sarahfitz", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561197972790147", "slackName": "rob", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561197979980572", "slackName": "davefish", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } },
            { "steamId": "76561198080732494", "slackName": "marshall", "lifting": { "bench": 100, "squat": 150, "deadlift": 200, "health": 100 } }
        ]*/

        db.users.find(function(err, docs){
            res.setHeader('Content-Type', 'text/html');
            res.send("WOWOWOWOW: " + docs);
        });



    };

};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();

