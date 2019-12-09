'use strict';
var pjson = require('./package.json');
var waitUntil = require('wait-until');
var pollingtoevent = require('polling-to-event');

module.exports = {
    RiscoCPPartitions: RiscoCPPartitions,
    RiscoCPGroups: RiscoCPGroups
}

function RiscoCPGroups(log, accConfig, homebridge) {
    return new RiscoCPPartitions(log, accConfig, homebridge, 'group');
}

function RiscoCPPartitions(log, accConfig, homebridge, TypeOfAcc ='partition') {

    this.log = log;
    this.name = accConfig.config.name;
    this.RiscoSession = accConfig.RiscoSession;
    this.TypeOfAcc = TypeOfAcc;
    this.RiscoPartId = (function(){
        if (accConfig.accessorytype == 'system'){
            return null;
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
                interval: 1000
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
        self.log.debug('Setting "%s" state to (%s) -> %s', self.name, state, self.translateState(state));
        try{
            var riscoArm;
            var cmd;

            var PartId;
            var cmd_separator;
            var CmdList = [];
            var ArmResp;

            if (self.TypeOfAcc == 'group'){
                self.log.debug('RiscoAcc Grp');
                self.log.debug('Actual state: ' + self.riscoCurrentState);
                self.log.debug('Futur state: ' + state);
                if ((state == 3) && (self.riscoCurrentState != 3)) {
                    self.log.debug('The system is armed and you want to disarm. Because RiscoCloud can not afford it, it is necessary to disarm the parent(s) partition.');
                    self.log.debug('All other child groups in this partition will also be disarmed.');
                    self.log(JSON.stringify(self.RiscoSession.DiscoveredAccessories.Groups));
                    self.log.debug('Parent Part of ' + (self.RiscoPartId || 'null') + ': '+ JSON.stringify((self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId]).parentPart));
                    for (var ParentPart in self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId].parentPart) {
                        self.log.debug('Add Cmd: ' + self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId].parentPart[ParentPart] + ':' + 'disarmed');
                        CmdList.push([false, self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId].parentPart[ParentPart] + ':' + 'disarmed']);
                    }
                } else {
                    self.log.debug('Add Cmd: ' + 'G' + self.RiscoPartId + ':' + 'armed');
                    CmdList.push([true,'G' + self.RiscoPartId + ':' + 'armed']);
                }
                for (var GrpCmd in CmdList){
                    //Todo
                    // get more data for best use
                    ArmResp = await self.RiscoSession.armDisarm(CmdList[GrpCmd][0], CmdList[GrpCmd][1], self.name);
                    if (ArmResp){
                        if (!self.polling){
                            self.log.info('Group "' + self.name + '" => Set new state: (' + state + ') -> ' + self.translateState(state));
                        }
                        self.securityService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, state);
                        self.riscoCurrentState = state;
                        typeof callback === 'function' && callback(null, self.riscoCurrentState);
                    } else {
                        //treat case when parentPart of group is already armed
                        self.log.debug('Error on armDisarm!!! Maybe a sensor is active and system cannot be armed')
                        throw new Error('Error on armDisarm!!!');
                    }
                }
            } else {
                if (self.RiscoPartId != null ){
                    PartId = self.RiscoPartId;
                    cmd_separator = ':';
                } else {
                    PartId = 0;
                    cmd_separator = '';
                }
                if ((state != 3) && (self.riscoCurrentState != 3)) {
                    self.log.debug('The system is already armed and you want to change the arming type. It is necessary to disarm the system beforehand.');
                    await self.setTargetState(3, null);
                }
                switch (state) {
                    case 0:
                        // Stay_Arm = 0
                        riscoArm = true;
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].homeCommand;
                        break;
                    case 1:
                        // Away_Arm = 1
                        riscoArm = true;
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].armCommand;
                        break;
                    case 2:
                        // Night_Arm = 2
                        riscoArm = true;
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].nightCommand;
                        break;
                    case 3:
                        // Disarm = 3
                        riscoArm = false
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.partitions[PartId].disarmCommand;
                        break;
                };
                
                const [error, newState] = await self.GetSetArmState(self, riscoArm, cmd, state);
                if (error !== null) {
                    throw new Error(error);
                }else{
                    self.riscoCurrentState = newState;
                    typeof callback === 'function' && callback(null, self.riscoCurrentState);
                }
            }
        } catch(err) {
            self.log.error(err);
            typeof callback === 'function' && callback(null, self.riscoCurrentState);
        }
    },

    async GetSetArmState(self, riscoArm, cmd, state) {
        var self = self;

        const [ArmResp, RefreshInterval] = await self.RiscoSession.armDisarm(riscoArm, cmd);
        switch (ArmResp) {
            case 0:
                self.log.debug('Error on armDisarm!!! Maybe a sensor is active and system cannot be armed');
                return [null, self.riscoCurrentState];
                break;
            case 1:
                if (!self.polling) {
                    self.log.info('Partition "' + self.name + '" => Set new state: (' + state + ') -> ' + self.translateState(state));
                }
                self.securityService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, state);
                return [null, state];
                break;
            case 2:
                self.log.debug('The partition will be armed in ' + RefreshInterval + ' milliseconds');
                setTimeout(self.GetSetArmState, RefreshInterval, self, false, 'Refresh', state);
                if (!self.polling) {
                    self.log.debug('Partition "' + self.name + '" State will be refreshed in ' + RefreshInterval + ' milliseconds');
                }
                return [null, self.riscoCurrentState];
                break;
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
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        if (self.TypeOfAcc == 'group'){
                            self.log.info('Partition "' + self.name + '" => Actual state is: (' + self.riscoCurrentState + ') -> ' + self.translateState(self.riscoCurrentState));
                        } else {
                            self.log.info('Group "' + self.name + '" => Actual state is: (' + self.riscoCurrentState + ') -> ' + self.translateState(self.riscoCurrentState));
                        }
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
            const PGsStatesRegistry = {
                armed: 1,
                partial: 2,
                disarmed: 3,
                ongoing: 4
            };

            var Datas = [];
            var ItemStates;
            if (self.TypeOfAcc == 'group'){
                for (var Group in self.RiscoSession.DiscoveredAccessories.Groups) {
                    if (Group != 'type'){
                        Datas.push(self.RiscoSession.DiscoveredAccessories.Groups[Group]);
                    }
                }
                ItemStates = Datas.filter(groups => groups.id == (self.RiscoPartId | ''));
            } else {
                for (var Parts in self.RiscoSession.DiscoveredAccessories.partitions) {
                    if (Parts != 'type'){
                        Datas.push(self.RiscoSession.DiscoveredAccessories.partitions[Parts]);
                    }
                }
                ItemStates = Datas.filter(parts => parts.id == (self.RiscoPartId | ''));
            }


            if (ItemStates.length != 0) {
                self.riscoCurrentState = PGsStatesRegistry[ItemStates[0].actualState];
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