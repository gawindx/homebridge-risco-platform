'use strict';
var pjson = require('./package.json');
var Manufacturer = "Gawindx";
var waitUntil = require('wait-until');
var pollingtoevent = require('polling-to-event');

module.exports = {
    RiscoCPPartitions: RiscoCPPartitions,
    RiscoCPGroups: RiscoCPGroups,
    RiscoCPOutputs: RiscoCPOutputs,
    RiscoCPDetectors: RiscoCPDetectors
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
    if (this.TypeOfAcc == 'partition') {
        this.longName = 'part_' + this.RiscoPartId + '_' + (this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');
    } else {
        this.longName = 'group_' + this.RiscoPartId + '_' + (this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');
    }
    this.uuid_base = homebridge.hap.uuid.generate(this.longName);
    this.polling = accConfig.polling || false;
    this.pollInterval = accConfig.pollInterval || 30000;
    this.services = [];
    this.Service = homebridge.hap.Service;
    this.Characteristic = homebridge.hap.Characteristic;
    
    this.infoService = new this.Service.AccessoryInformation();
    this.infoService
        .setCharacteristic(this.Characteristic.Manufacturer, Manufacturer)
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
    this.long_event_name = 'long_'+ this.longName;
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
        // 4 -  Characteristic.SecuritySystemTargetState.ALARM: => Alarm
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

function RiscoCPGroups(log, accConfig, homebridge) {
    return new RiscoCPPartitions(log, accConfig, homebridge, 'group');
}

function RiscoCPOutputs(log, accConfig, homebridge) {

    this.log = log;
    this.name = accConfig.config.name;
    this.RiscoSession = accConfig.RiscoSession;
    this.RiscoOutputId = (function(){
            return accConfig.config.Id;
        })();
    this.longName = 'out_' + this.RiscoOutputId + '_' + (this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');
    this.uuid_base = homebridge.hap.uuid.generate(this.longName);
    this.TypePulse = (function(){
            if (accConfig.config.Type == 'pulse') {
                return true;
            } else {
                return false;
            }
        })();
    this.polling = accConfig.polling || false;
    this.pollInterval = accConfig.pollInterval || 30000;
    this.services = [];
    this.Service = homebridge.hap.Service;
    this.Characteristic = homebridge.hap.Characteristic;
    
    this.infoService = new this.Service.AccessoryInformation();
    this.infoService
        .setCharacteristic(this.Characteristic.Manufacturer, Manufacturer)
        .setCharacteristic(this.Characteristic.Model, this.name)
        .setCharacteristic(this.Characteristic.SerialNumber, pjson.version);

    this.services.push(this.infoService);
    
    this.outputService = new this.Service.Switch(this.name);

    this.outputService
        .getCharacteristic(this.Characteristic.On)
        .on('get', this.getCurrentState.bind(this))
        .on('set', this.setTargetState.bind(this));

    this.services.push(this.outputService);

    // Default Value
    this.log.debug('Output "' + this.name + ' default State: ' + accConfig.config.State);
    this.RiscoOutputState = accConfig.config.State;
    this.IsPulsed = false;
    this.long_event_name = 'long_Out_' + this.longName;
    
    if (this.TypePulse !== true) {
        var self = this;
        // set up polling if requested
        if (self.polling) {
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
                self.log.info('Output "' + self.name + '" => New state detected: (' + state + '). Notify!');
                self.RiscoOutputState = state;
                self.outputService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
            });

            emitter.on("err", function (err) {
                self.log.error("Polling failed, error was %s", err);
            });
        }       
    }

}

function RiscoCPDetectors(log, accConfig, homebridge) {

    this.log = log;
    this.name = accConfig.config.name;
    this.RiscoSession = accConfig.RiscoSession;
    this.Type = accConfig.config.Type;
    this.RiscoDetectorId = (function(){
            return accConfig.config.Id;
        })();
    this.longName = 'det_' + this.RiscoDetectorId + '_' + (this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');
    this.uuid_base = homebridge.hap.uuid.generate(this.longName);
    this.polling = accConfig.polling || false;
    this.pollInterval = accConfig.pollInterval || 30000;
    this.services = [];
    this.Service = homebridge.hap.Service;
    this.Characteristic = homebridge.hap.Characteristic;

    this.infoService = new this.Service.AccessoryInformation();
    this.infoService
        .setCharacteristic(this.Characteristic.Manufacturer, Manufacturer)
        .setCharacteristic(this.Characteristic.Model, this.name)
        .setCharacteristic(this.Characteristic.SerialNumber, pjson.version);

    this.services.push(this.infoService);
    switch (this.Type){
        case 'Detector':
            this.detectorService = new this.Service.MotionSensor(this.name);
            this.detectorService
                .getCharacteristic(this.Characteristic.MotionDetected)
                .on('get', this.getCurrentState.bind(this));

            this.detectorService
                .getCharacteristic(this.Characteristic.StatusActive)
                .on('set', this.setCurrentState.bind(this));
            this.sPrefix = 'Detector';
            this.log.debug('Create MotionDetected Detector case loop');
            break;
        case 'Door':
            this.detectorService = new this.Service.Door(this.name);
            this.detectorService
                .getCharacteristic(this.Characteristic.CurrentPosition)
                .on('get', this.getCurrentState.bind(this));
            /*
            The following seems incompatible with the 'home Apple' application and generates warnings from Homekit 
            this.detectorService
                .getCharacteristic(this.Characteristic.StatusActive)
                .on('set', this.setCurrentState.bind(this));*/
            this.sPrefix = 'Door Contact';
            this.log.debug('Create Door Contact Detector case loop');
            break;
        case 'Window':
            this.detectorService = new this.Service.Window(this.name);
            this.detectorService
                .getCharacteristic(this.Characteristic.CurrentPosition)
                .on('get', this.getCurrentState.bind(this));
            /*
            The following seems incompatible with the 'home Apple' application and generates warnings from Homekit 
            this.detectorService
                .getCharacteristic(this.Characteristic.StatusActive)
                .on('set', this.setCurrentState.bind(this));*/
            this.sPrefix = 'Window Contact';
            this.log.debug('Create Window Contact Detector case loop');
            break;
        default:
            this.detectorService = new this.Service.MotionSensor(this.name);
            this.detectorService
                .getCharacteristic(this.Characteristic.MotionDetected)
                .on('get', this.getCurrentState.bind(this));

            this.detectorService
                .getCharacteristic(this.Characteristic.StatusActive)
                .on('set', this.setCurrentState.bind(this));
            this.sPrefix = 'Detector';
            this.log.debug('Create MotionDetected Detector Default loop');
            break;
    }

    this.services.push(this.detectorService);

    this.DetectorReady = false;

    // Default Value
    this.log.debug('Detector "' + this.name + ' default State: ' + accConfig.config.State);
    this.RiscoDetectorState = accConfig.config.State;
    this.RiscoDetectorBypassState = accConfig.config.StatusActive;
    this.long_event_name = 'long_Det_' + this.longName;
    
    var self = this;
    // set up polling if requested
    if (self.polling) {
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

            self.log.info(self.sPrefix +' "' + self.name + '" => New state detected: (' + self.GetAccessoryState(state[0], false) + '). Notify!');
            if (self.Type == 'Detector'){
                self.log.info(self.sPrefix +' "' + self.name + '" => New Active state detected (Not Bypassed=true) : (' + state[1] + '). Notify!');
            }
            self.ReportAccessoryState(state);
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
        return translatedSate;
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
            const PGsStatesRegistry = {
                armed: 1,
                partial: 2,
                disarmed: 3,
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
                if (ItemStates[0].OnAlarm == true){
                    self.riscoCurrentState = 4;
                }
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

RiscoCPOutputs.prototype = {
    async getRefreshState(callback) {
        var self = this;
        try{
            var Datas = [];
            var ItemStates;
            for (var Output in self.RiscoSession.DiscoveredAccessories.Outputs) {
                Datas.push(self.RiscoSession.DiscoveredAccessories.Outputs[Output]);
            }
            ItemStates = Datas.filter(outputs => outputs.Id == (self.RiscoOutputId | ''));

            if (ItemStates.length != 0) {
                self.RiscoOutputState = (function(){ 
                                    if (ItemStates[0].State == 0) {
                                        return false;
                                    } else {
                                       return  true;
                                    }
                                })();
                callback(null, self.RiscoOutputState);
                return
            } else {
                throw new Error('Error on Output RefreshState!!!');
            }
        } catch(err){
            self.log.error(err);
            callback(null, self.RiscoOutputState);
            return
        }
    },

    async getCurrentState(callback) {
        var self = this;
        try{
            if (self.polling){
                self.log.debug('Output is '+ self.RiscoOutputState);
                if (self.TypePulse === false) {
                    callback(null, self.RiscoOutputState);
                } else {
                    callback(null, false);
                }
            } else {
                if (self.TypePulse === false) {
                    self.log.info('Output "' + self.name + '" =>Getting current state - delayed...');
                    waitUntil()
                        .interval(500)
                        .times(15)
                        .condition(function () {
                            return (self.RiscoOutputState ? true : false);
                        })
                        .done(async function (result) {
                            await self.RiscoSession.getCPStates();
                            await self.getRefreshState(callback);
                            self.log.debug('Output "' + self.name + '" => Actual state is: (' + self.RiscoOutputState + ')');
                            self.outputService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
                            return
                        });
                } else {
                    callback(null, false);
                }
            }
        } catch (err) {
            self.log.error(err);
            self.outputService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
            callback(null, self.RiscoOutputState);
            return
        }
    },

    async setTargetState(state, callback) {
        var self = this;
        self.log.debug('Set Output to: ' +  state);
        self.RiscoOutputState = state;
        var HACResp;
        //convert state to 1/0

        if (self.IsPulsed){
            HACResp = true;
        } else {
            if (self.TypePulse) {
                HACResp = await self.RiscoSession.HACommand('1', self.RiscoOutputId);
            } else {
                var newstate;
                if (state) {
                    newstate = 1;
                } else {
                    newstate = 0;
                }
                HACResp = await self.RiscoSession.HACommand(newstate, self.RiscoOutputId);          
            }
        }
        if (HACResp){
            if (!self.polling){
                self.log.info('Output "' + self.name + '" => Set new state: (' + state + ')');
            }
            if (self.TypePulse === false) {
                self.log.debug('Not a pulse switch, update it')
                self.RiscoOutputState = state;
                typeof callback === 'function' && callback(null, self.RiscoOutputState);
            } else {
                if (self.IsPulsed) {
                    self.log.debug('Pulse switch is already pulsed');
                    self.IsPulsed = false;
                    typeof callback === 'function' && callback(null, self.RiscoOutputState);
                } else {
                    self.log.debug('Pulse switch is not already pulsed');
                    self.IsPulsed = true;
                    setTimeout(self.ResetPulseSwitchState, 500, self);
                    self.RiscoOutputState = false;
                    typeof callback === 'function' && callback(null, self.RiscoOutputState);
                }
            }
            
        } else {
            self.log.error('Error on HACommand!!!');
            typeof callback === 'function' && callback(null, self.RiscoOutputState);
        }
    },

    async ResetPulseSwitchState(self) {
        var self = self;
        self.log.debug('Reset Pulse Switch State to ' + self.RiscoOutputState);
        self.outputService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
    },

    identify: function (callback) {
        self.log.info('Identify requested!');
        callback(); // success
    },

    getServices: function () {
        return this.services;
    }
};

RiscoCPDetectors.prototype = {
    ReportAccessoryState(state = null){
        var self = this;
        if (!state){
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorActiveState = state[1];
        }
        try{
            switch (self.Type){
                case 'Detector':
                    self.detectorService.setCharacteristic(self.Characteristic.MotionDetected, self.GetAccessoryState(self.RiscoDetectorState));
                    self.detectorService.setCharacteristic(self.Characteristic.StatusActive, self.RiscoDetectorActiveState);
                    return
                case 'Door':
                    self.detectorService.setCharacteristic(self.Characteristic.CurrentPosition, self.GetAccessoryState(self.RiscoDetectorState));
                    self.detectorService.setCharacteristic(self.Characteristic.TargetPosition, self.GetAccessoryState(self.RiscoDetectorState));
                    return
                case 'Window':
                    self.detectorService.setCharacteristic(self.Characteristic.CurrentPosition, self.GetAccessoryState(self.RiscoDetectorState));
                    self.detectorService.setCharacteristic(self.Characteristic.TargetPosition, self.GetAccessoryState(self.RiscoDetectorState));
                    return
                default:
                    self.detectorService.setCharacteristic(self.Characteristic.MotionDetected, self.GetAccessoryState(self.RiscoDetectorState));
                    self.detectorService.setCharacteristic(self.Characteristic.StatusActive, self.RiscoDetectorActiveState);
                    return
            }
        } catch(err){
            self.log.error(err);
            return
        }
    },

    GetAccessoryState(state, AsHomeKitValue = true){
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        switch (self.Type){
            case 'Detector':
                if (AsHomeKitValue){
                    return ((state) ? true : false);
                } else {
                    return ((state) ? 'Active' : 'Inactive');
                }
                break;
            case 'Door':
                if (AsHomeKitValue){
                    return ((state) ? 100 : 0);
                } else {
                    return ((state) ? 'open' : 'closed');
                }
                break;
            case 'Window':
                if (AsHomeKitValue){
                    return ((state) ? 100 : 0);
                } else {
                    newstate = ((state) ? 'open' : 'closed');
                }
                break;
            default:
                if (AsHomeKitValue){
                    return ((state) ? true : false);
                } else {
                    return ((state) ? 'Active' : 'Inactive');
                }
                break;
        }
    },

    async getRefreshState(callback) {
        var self = this;
        try{
            var Datas = [];
            var ItemStates;
            for (var Detector in self.RiscoSession.DiscoveredAccessories.Detectors) {
                Datas.push(self.RiscoSession.DiscoveredAccessories.Detectors[Detector]);
            }
            ItemStates = Datas.filter(detectors => detectors.Id == (self.RiscoDetectorId | ''));

            if (ItemStates.length != 0) {
                self.RiscoDetectorState = ItemStates[0].State;
                self.RiscoDetectorActiveState = ItemStates[0].StatusActive;
                self.DetectorReady = true;
                callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
                return
            } else {
                throw new Error('Error on ' + self.sPrefix +' RefreshState!!!');
            }
        } catch(err){
            self.log.error(err);
            callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
            self.DetectorReady = true;
            return
        }
    },

    async getCurrentState(callback) {
        var self = this;
        try{
            if (self.polling){
                self.log.debug(self.sPrefix +' "' + self.name + '" MotionDetected : '+ self.GetAccessoryState(self.RiscoDetectorState, false));
                self.log.debug(self.sPrefix +' "' + self.name + '" is Active (Not Bypassed=true) :'+ self.RiscoDetectorActiveState);
                callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
            } else {
                self.log.info(self.sPrefix +' "' + self.name + '" =>Getting current state - delayed...');
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition(function () {
                        return ( (self.RiscoDetectorState ? true : false) || (self.RiscoDetectorActiveState ? true : false));
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        self.log.debug(self.sPrefix +' "' + self.name + '" => Actual Motion state is : (' + self.GetAccessoryState(self.RiscoDetectorState, false) + ')');
                        self.log.debug(self.sPrefix +' "' + self.name + '" => Actual Active (Not Bypassed=true) is : (' + self.RiscoDetectorActiveState + ')');
                        self.DetectorReady = true;
                        self.ReportAccessoryState();
                        return
                    });
            }
        } catch (err) {
            self.log.error(err);
            self.ReportAccessoryState();
            callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
            return
        }
    },

    async setCurrentState(state, callback) {
        var self = this;
        if ((self.DetectorReady) && (self.Type == 'Detector')){
            state = (state) ? false : true;
            self.log.debug('Set Active ' + self.sPrefix +' "' + self.name +'" to: ' + state);
            var SBpResp;
            self.log.info(self.name + ' Actual State: ' + self.RiscoDetectorActiveState);
            if (self.Type == 'Detector'){
                self.log.info(self.name + ' New State: ' + state);
            }
            if (self.RiscoDetectorActiveState != state) {
                SBpResp = true;
                self.log.info(self.name + ' Identical State');
            } else {
                SBpResp = await self.RiscoSession.SetBypass(((state) ? 1 : 0 ), self.RiscoDetectorId);
                self.log.info(self.name + ' Different State');
            }
            if (SBpResp){
                if (!self.polling){
                    self.log.info(self.sPrefix +' "' + self.name + '" => Set new Bypass state: (' + state + ')');
                }
                typeof callback === 'function' && callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
            } else {
                self.log.error('Error on SetBypass!!!');
                typeof callback === 'function' && callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
            }
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
