#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');
var Steam = require('steam-webapi');
var request = require('request');
var _ = require('underscore');
var mongojs = require('mongojs');
var Q = require('q');
var CronJob = require('cron').CronJob;
var cheerio = require('cheerio');
var elasticsearch = require('elasticsearch');
var experience = require('./assets/js/experience.js');


/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;

    //DB Setup
    var dbName = "/steamslack";
    var connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ":" +  process.env.OPENSHIFT_MONGODB_DB_PASSWORD + "@" + process.env.OPENSHIFT_MONGODB_DB_HOST + dbName;
    var db = mongojs(connection_string, ['users', 'meet', 'poeTrade', 'exileTools']);

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

        self.hargan = {
            sassLevel: 40, //start at 40 to avoid never talking after new upload -- should be in DB...
            quotes: [
                'Don\'t drop the soap, exile.',
                'Stay away from the shadows exile, unless you\'re doing a crit build...',
                'Two Chisels is my favorite artist, TRUUU.',
                'Make sure you\'re on permanent allocation, wouldn\'t want to get Dom\'d.',
                'Sometimes you just need to gag the cat.',
                'How long you spend in Act 3?',
                'Did you hear how great Dom\'s new build is this league?',
                'Did you know divines can sometimes do nothing?',
                'Apparently you can hold shift to hold your breath!',
                'That\'s a nice five link chest you have there, I\'ll give you three alt shards for it.',
                'That\'ll be one transmutation... Woah nice colors on that item, I\'ll give you a chrome for that!',
                'Maybe one day one of you will kill Uber Atziri...',
                'I heard Warbands is the best league yet.',
                'Legend has it that one guy\'s build was so defensively effective that he got angry at the game and quit.',
                'Who needs defence when you kill everything in two seconds?',
                'If your Glorious Leader is so glorious, why hasn\'t he killed Uber Atziri?',
                'A wise man once said: More bikes less cars on road.  I\'m not quite sure what it means, but I like it.',
                'Yes, I\'ll gladly give you some alchemy shards for that Carcass Jack... moron.',
                'Act 4 is fun, right?',
                'Krillson showed me the best fishing spot yesterday.',
                'Have you ever been so bored at work that you just started making up random stuff to say?',
                'Huh? Oh sorry I was busy looking for items within your unrealistic price ranges...',
                'Hey this guy is selling his item way below market value!  Just kidding, copy paste can be a bitch.',
                'PSA: Marsh is paying anyone who can find him another build where he doesn\'t have to do anything.',
                'Is that a right build?',
                'Wow a 6 T1 chest?  Too bad it\'s not Lightning Coil',
                'How \'bout them Shavronne\'s Wrappings, so many cool builds, like uh, uhhh...',
                'Soccer with cars?  Yeah that\'s great and all, but Wrealclast isn\'t gonna cleanse itself.',
                'Tell that douche Gruest to "Travel far"..., up Silk\'s ass!  Ahaha, aha, ha...',
                'Some people don\'t like to pick up rares, some people have Orbs of Alchemy.',
                'I think Dialla just wants a little cockroach if you know what I\'m sayin\'.'
            ]
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

        self.routes['/testing'] = function(req, res) {
            self.testing(req, res)
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

        //Start the poe trade cron job
        //var poeTradeJob = new CronJob('00 */10 * * * *', function(){
        //    getTradeChecks();
        //}, null, true);
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

                //Manually add people not in the DB
                allPromises.push(getPoEAccountInfo('hemmar'));
                allPromises.push(getPoEAccountInfo('Thorthethunder2013'));

                Q.all(allPromises).done(handleData);
            });

            function handleData(accounts){
                var levelEXP = experience.xp;
                var fields = [];
                _.forEach(accounts, function(account){
                    if(!_.isEmpty(account) && _.isObject(account)){
                        var value = '';
                        var accountName = '';
                        _.chain(account)
                            .sortBy(function(char){
                                return -char.level;
                            })
                            .forEach(function(char){
                                accountName = char.accountName;
                                value += ' - ' + char.charName;

                                if(char.level >= 50){
                                    var xp = Math.round((char.experience - levelEXP[char.level])/(levelEXP[parseInt(char.level, 10) + 1] - levelEXP[char.level])*100)/100;
                                    value += ' (' + (parseInt(char.level, 10) + xp) + ')';
                                }else{
                                    value += ' (' + char.level + ')';
                                }

                                value += (char.online === '1' ? ' -- Online' : '') + '\n\n';
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
                    "fields": _.sortBy(fields, function(field){
                        var match = field.value.match(/\(([^)]+)\)/);
                        return -match[1];
                    })
                };
                self.sendWebHookCall(message, self.webhookURLs.POE_STATUS);
            }

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

    self.testing = function(req, res){
        res.setHeader('Content-Type', 'text/html');
        res.send("<h2>Testing</h2>");
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

        //Get the ladder stats for this account
        request({
            url: 'http://api.exiletools.com/ladder?league=flashback2&short=1&accountName='+accountName,
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

    function getTradeChecks(){
        var allPromises = [];

        db.exileTools.find(function(err, poeTradeChecks){
            _.forEach(poeTradeChecks, function(check){
                allPromises.push(getTradeData(check));
            });
            Q.all(allPromises).done(buildTradeOutput);
        });
    }

    function getTradeData(check){
        var deferred = Q.defer();

        var source = makeSearch(check.searchRules);

        request({
            url: 'http://api.exiletools.com/item/_search?source=' + JSON.stringify(source),
            method: 'GET'
        }, function(error, resp, body){
            if(!error){
                var items = [];

                var hits = (JSON.parse(body)).hits.hits;

                _.forEach(hits, function(hit){
                    var item = {};
                    item.name = hit._source.info.fullName;
                    item.buyout = hit._source.shop.amount + ' ' + hit._source.shop.currency;
                    item.seller = hit._source.shop.sellerAccount;
                    item.thread = hit._source.shop.threadid;
                    item.priceInChaos = hit._source.shop.chaosEquiv;
                    item.priceDrop = null;
                    items.push(item);
                });

                var newItems = [];

                //if there are previous results, need to only save new items that hadn't been found before
                if(!_.isEmpty(check.previousResults)){
                    var oldItems = [];
                    //If any new items have matching names and sellers, don't save them -- unless they've dropped in price
                    _.forEach(items, function(item){
                        var isNew = true;
                        _.forEach(check.previousResults, function(prevResult){
                           if(_.isEqual(prevResult, item)) {
                               if(prevResult.priceInChaos > item.priceInChaos){
                                   item.priceDrop = prevResult.buyout;
                               }else{
                                   //Save all old items that are matched, and overwrite previousItems so that no-longer-existing items aren't maintained
                                   oldItems.push(prevResult);
                                   isNew = false;
                               }
                           }
                        });

                        if(isNew){
                            //Add the item to oldItems to keep track of it, and newItems to send to the client
                            oldItems.push(item);
                            newItems.push(item);
                        }
                    });

                    check.previousResults = oldItems;

                }else{
                    //If previousResults doesn't exist or is empty, keep all new items and store them all in previous items
                    newItems = items;
                    check.previousResults = newItems;
                }

                check.newItems = newItems;

                //Update the DB with the new check
                db.exileTools.update(
                    {searchTitle: check.searchTitle},
                    {
                        $set: {
                            previousResults: check.previousResults
                        }
                    }
                );

                deferred.resolve(check);
            }
        });
        return deferred.promise;
    }

    function buildTradeOutput(results){
        var attachments = [];
        //Loop through each poe trade query and make an attachmet for it
        _.forEach(results, function(tradeCheck){
            if(!_.isEmpty(tradeCheck.newItems)){
                var fields = [];
                var text = '<@' + tradeCheck.requester + '>, Hargan has found you some new stuff!\n\n';
                //Loop through each new item in that query and make a field for it
                _.forEach(tradeCheck.newItems, function(newItem){
                    var value = "Price: " + newItem.buyout + (newItem.priceDrop ? ' (Down from ' + newItem.priceDrop + ')' : '') +'\n';
                    value += 'From ' + newItem.seller + ' in thread <https://www.pathofexile.com/forum/view-thread/' + newItem.thread + '| ' + newItem.thread + '>\n\n';
                    var itemField = {
                        "title": newItem.name,
                        "value": value,
                        "short": false
                    };
                    fields.push(itemField);
                });

                var checkAttachment = {
                    "fallback": text,
                    "title": tradeCheck.searchTitle,
                    "title_link": 'http://poe.trade/search/' + tradeCheck.searchUrl,
                    "text": text,
                    "color": "#00CD00",
                    "fields": fields
                };

                attachments.push(checkAttachment);
            }
        });

        //If there is data to send, send it, otherwise, run hargan
        if(!_.isEmpty(attachments)){
            var message = {
                "attachments": attachments
            };

            self.sendWebHookCall(message, self.webhookURLs.HARGANS_TRADE_WATCH);
        }else{
            var date = new Date();
            var hours = date.getHours();
            if(hours >= 9 || hours < 3){
                hargan();
            }
        }
    }

    function hargan(){
        //Checks if Hargan should talk
        if(self.hargan.sassLevel > _.random(120, 280)){
            var quote = self.hargan.quotes[_.random(0, self.hargan.quotes.length - 1)];
            var message = {
                "attachments": [
                    {
                        "fallback": quote,
                        "title": 'Hargan',
                        "text": quote,
                        "color": "#FF9653"
                    }
                ]
            };
            self.sendWebHookCall(message, self.webhookURLs.HARGANS_TRADE_WATCH);
            self.hargan.sassLevel = 0;
        }else{
            self.hargan.sassLevel += _.random(1, 3);
        }
    }

    function makeSearch(params){
        var baseBody = {
            "query": {
                "filtered" : {
                    "filter" : {
                        "bool" : {
                            "must" : [
                                { "term" : { "league" : "Warbands" } },
                                { "term" : { "verified" : "yes" } }
                            ],
                            "must_not" : [
                                { "term" : { "currency" : "NONE"}},
                                { "term" : { "currency" : "Unknown"}}
                            ]
                        }
                    }
                }
            },
            "size": 100
        };

        _.forEach(params, function(rule, type){
            var tempObj = {};
            tempObj[type] = rule;
            baseBody.query.filtered.filter.bool.must.push(tempObj);
        });

        return baseBody;
    }

};   /*  Sample Application.  */


/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();

