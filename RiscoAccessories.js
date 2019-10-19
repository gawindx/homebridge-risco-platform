'use strict';
var pjson = require('./package.json');
var waitUntil = require('wait-until');
var pollingtoevent = require('polling-to-event');

module.exports.RiscoCPPartitions = RiscoCPPartitions;

function RiscoCPPartitions(log, accConfig, homebridge) {

    this.log = log;
    this.name = accConfig.config.name;
    this.RiscoSession = accConfig.RiscoSession;
    this.RiscoPartId = (function(){
        if (accConfig.accessorytype == 'system'){
            return '';
        } else {
            return accConfig.config.id;
        }
        })();
    this.polling = accConfig.polling || false;
    this.pollInterval = accConfig.pollInterval || 30000;
    this.services = [];
    this.Service = homebridge.hap.Service;
    this.Characteristic = homebridge.hap.Characteristic;
    
    this.infoService = new this.Service.AccessoryInformation();
    this.infoService
        .setCharacteristic(this.Characteristic.Manufacturer, "Daniel S")
        .setCharacteristic(this.Characteristic.Model, this.name)
        .setCharacteristic(this.Characteristic.SerialNumber, pjson.version);

    this.services.push(this.infoService);

    this.securityService = new this.Service.SecuritySystem(this.name);

    this.securityService
        .getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
        .on('get', this.getCurrentState.bind(this));

    this.securityService
        .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
        .on('get', this.getTargetState.bind(this))
        .on('set', this.setTargetState.bind(this));

    this.services.push(this.securityService);

    this.long_event_name = 'long_' + (this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');
    // Default Value
    this.riscoCurrentState;// = 3; // Do not set default. Looks like plugin get restarted after some time. Generates false alarms.

    var self = this;
    // set up polling if requested
    if (self.polling) {
        self.log.debug('Starting polling with an interval of %s ms', self.pollInterval);
        // 0 -  Characteristic.SecuritySystemTargetState.STAY_ARM: => Partial Mode
        // 1 -  Characteristic.SecuritySystemTargetState.AWAY_ARM: => Full Armed Mode
        // 2 -  Characteristic.SecuritySystemTargetState.NIGHT_ARM: => Partial Mode
        // 3 -  Characteristic.SecuritySystemTargetState.DISARM: => Really ?? Disarmed
        var emitter = new pollingtoevent(function (done) {
            self.getRefreshState(function (err, result) {
                done(err, result);
            });
        }, {
                longpollEventName: self.long_event_name,
                longpolling: true,
                interval: self.pollInterval
            });

        emitter.on(self.long_event_name, function (state) {
            if (state) {
                self.log.info('Partition "' + self.name + '" => New state detected: (' + state + ') -> ' + self.translateState(state) + '. Notify!');
                self.securityService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, state);
                self.riscoCurrentState = state;
            }
        });

        emitter.on("err", function (err) {
            self.log.error("Polling failed, error was %s", err);
        });
    }

}

RiscoCPPartitions.prototype = {

    translateState(aState) {
        var self = this;
        var translatedSate = "UNKNOWN";

        switch (aState) {
            case self.Characteristic.SecuritySystemTargetState.STAY_ARM:
                translatedSate = "STAY_ARM";
                break;
            case self.Characteristic.SecuritySystemTargetState.NIGHT_ARM:
                translatedSate = "NIGHT_ARM";
                break;
            case self.Characteristic.SecuritySystemTargetState.AWAY_ARM:
                translatedSate = "AWAY_ARM";
                break;
            case self.Characteristic.SecuritySystemTargetState.DISARM:
                translatedSate = "DISARM"
                break;
            case 4:
                translatedSate = "ALARM"
                break;
        };
        return translatedSate
    },

    async setTargetState(state, callback) {
        var self = this;

        self.log.debug('Setting state to %s', state);
        try{
            var riscoArm;
            var cmd;
            var cmd_separator = (function(){
                if (self.RiscoPartId == ''){
                    return '';
                }else{
                    return ':';
                }
            })();
            const PartId = (self.RiscoPartId != '')?self.RiscoPartId:0;
            switch (state) {
                case 0:
                    // stayArm = 0
                    riscoArm = true;
                    cmd = self.RiscoPartId + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].homeCommand;
                    break;
                case 1:
                    // stayArm = 1
                    riscoArm = true;
                    cmd = self.RiscoPartId + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].armCommand;
                    break;
                case 2:
                    // stayArm = 2
                    riscoArm = true;
                    cmd = self.RiscoPartId + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].nightCommand;
                    break;
                case 3:
                    // stayArm = 3
                    riscoArm = false
                    cmd = self.RiscoPartId + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].disarmCommand;
                    break;
            };
            const ArmResp = await self.RiscoSession.armDisarm(riscoArm, cmd);
            if (ArmResp){
                if (!self.polling){
                    self.log.info('Partition "' + self.name + '" => Set new state: (' + state + ') -> ' + self.translateState(state));
                }
                self.securityService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, state);
                self.riscoCurrentState = state;
                callback(null, self.riscoCurrentState);
            } else {
                throw new Error('Error on armDisarm!!!');
            }
        } catch(err) {
            self.log.error(err);
            callback(null, self.riscoCurrentState);
        }
    },

    async getState(callback) {
        var self = this;
        try{
            await self.getRefreshState(callback);
        } catch(err) {
            self.log.error(err);
            callback(null, self.riscoCurrentState);
            return
        }
    },

    async getCurrentState(callback) {
        var self = this;
        try{
            if (self.polling) {
                callback(null, self.riscoCurrentState);
            } else {
                self.log.info('Partition "' + self.name + '" =>Getting current state - delayed...');
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition(function () {
                        return (self.riscoCurrentState ? true : false);
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getPartsStates();
                        await self.getRefreshState(callback);
                        self.log.info('Partition "' + self.name + '" => Actual state is: (' + self.riscoCurrentState + ') -> ' + self.translateState(self.riscoCurrentState));
                        self.securityService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
                        return
                    });
            }
        } catch (err) {
            self.log.error(err);
            self.securityService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);            
            callback(null, self.riscoCurrentState);
            return
        }
    },

    async getTargetState(callback) {
        var self = this;
        if (self.polling) {
            callback(null, self.riscoCurrentState);
        } else {
            self.log.debug("Getting target state...");
            self.getState(callback);
        }
    },

    async getRefreshState(callback) {
        var self = this;
        try{
            var self = this;
            const PartStatesRegistry = {
                armed: 1,
                partial: 2,
                disarmed: 3,
                ongoing: 4
            };

            var Datas = [];
            for (var Parts in self.RiscoSession.DiscoveredAccessories.partitions) {
                if (Parts != 'type'){
                    Datas.push(self.RiscoSession.DiscoveredAccessories.partitions[Parts]);
                }
            }
            const PartStates = Datas.filter(parts => parts.id == self.RiscoPartId);
            if (PartStates.length != 0) {
                self.riscoCurrentState = PartStatesRegistry[PartStates[0].actualState];
                callback(null, self.riscoCurrentState);
                return
            } else {
                throw new Error('Error on RefreshState!!!');
            }
        } catch(err){
            self.log.error(err);
            callback(null, self.riscoCurrentState);
            return
        }
    },

    identify: function (callback) {
        self.log.info('Identify requested!');
        callback(); // success
    },

    getServices: function () {
        return this.services;
    }
};