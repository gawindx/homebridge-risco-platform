'use strict';
var pjson = require('./package.json');
var waitUntil = require('wait-until');
var pollingtoevent = require('polling-to-event');

class RiscoCPPartitions {
    constructor (log, accConfig, api, accessory, TypeOfAcc = 'partition') {
        this.log = log;
        this.name = accConfig.context.name;
        this.RiscoSession = accConfig.RiscoSession;
        this.TypeOfAcc = TypeOfAcc;
        this.RiscoPartId = (function(){
            if (accConfig.accessorytype == 'system'){
                return null;
            } else {
                return accConfig.context.Id;
            }
        })();
        this.polling = accConfig.polling || false;
        this.pollInterval = accConfig.pollInterval || 30000;
        this.accessory = accessory;
        
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.mainService = this.accessory.getService(this.Service.SecuritySystem, this.accessory.displayName);
        this.OccupancyService = this.accessory.getService(this.Service.OccupancySensor, this.accessory.displayName);

        this.mainService
            .getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
            .on('get', this.getCurrentState.bind(this));

        this.mainService
            .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
            .on('get', this.getTargetState.bind(this))
            .on('set', this.setTargetState.bind(this));

        if (this.TypeOfAcc == 'partition'){
            this.OccupancyService
                .getCharacteristic(this.Characteristic.OccupancyDetected)
                .on('get', this.getCurrentOccupancyState.bind(this));
            this.OccupancyState;
        }

        if (this.TypeOfAcc == 'partition') {
            this.long_event_name = `long_part_${this.RiscoPartId}_${(this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`;
        } else {
            this.long_event_name = `long_group_${this.RiscoPartId}_${((this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_'))}`;
        }
        // Default Value
        this.riscoCurrentState;// = 3; // Do not set default. Looks like plugin get restarted after some time. Generates false alarms.
        this.PollingLoop();
    }

    translateState(aState) {
        var self = this;
        var translatedSate = 'UNKNOWN';

        switch (aState) {
            case self.Characteristic.SecuritySystemTargetState.STAY_ARM:
                translatedSate = 'STAY_ARM';
                break;
            case self.Characteristic.SecuritySystemTargetState.NIGHT_ARM:
                translatedSate = 'NIGHT_ARM';
                break;
            case self.Characteristic.SecuritySystemTargetState.AWAY_ARM:
                translatedSate = 'AWAY_ARM';
                break;
            case self.Characteristic.SecuritySystemTargetState.DISARM:
                translatedSate = 'DISARM';
                break;
            case 4:
                translatedSate = 'ALARM';
                break;
        };
        return translatedSate;
    }

    PollingLoop() {
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
                    self.log.info('Partition "%s" => New state detected: (%s) -> %s. Notify!', self.name, state[0], self.translateState(state[0]));
                    self.mainService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, state[0]);
                    self.riscoCurrentState = state[0];
                    if (this.TypeOfAcc == 'partition'){
                        self.log.info('Partition is %sOccupied. Notify!', self.name, ((state[1] == 0 ) ? 'not ' : ''));
                        self.OccupancyService.setCharacteristic(self.Characteristic.OccupancyDetected, state[1]);
                        self.OccupancyState = state[1];
                    }
                }
            });

            emitter.on('err', function (err) {
                self.log.error('Polling failed, error was %s', err);
            });

            emitter.on('close', function () {
                emitter.removeAllListeners();
            });
        }
    }

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
                    self.log.debug('Parent Part of %s: %s', (self.RiscoPartId || 'null'), JSON.stringify((self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId]).parentPart));
                    for (var ParentPart in self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId].parentPart) {
                        self.log.debug('Add Cmd: %s: disarmed', self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId].parentPart[ParentPart]);
                        CmdList.push([false, `${self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId].parentPart[ParentPart]}:disarmed` ]);
                    }
                } else {
                    self.log.debug('Add Cmd: %sG%s:armed', self.RiscoPartId);
                    CmdList.push([true, `G${self.RiscoPartId}:armed`]);
                }
                for (var GrpCmd in CmdList){
                    //Todo
                    // get more data for best use
                    ArmResp = await self.RiscoSession.armDisarm(CmdList[GrpCmd][0], CmdList[GrpCmd][1], self.name);
                    if (ArmResp){
                        if (!self.polling){
                            self.log.info('Group "%s" => Set new state: (%s) -> %s',self.name, state, self.translateState(state));
                        }
                        self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, state);
                        self.riscoCurrentState = state;
                        callback !== null && typeof callback === 'function' && callback(null);
                        return;
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
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.Partitions[PartId].homeCommand;
                        break;
                    case 1:
                        // Away_Arm = 1
                        riscoArm = true;
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.Partitions[PartId].armCommand;
                        break;
                    case 2:
                        // Night_Arm = 2
                        riscoArm = true;
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.Partitions[PartId].nightCommand;
                        break;
                    case 3:
                        // Disarm = 3
                        riscoArm = false
                        cmd = (self.RiscoPartId | '') + cmd_separator + self.RiscoSession.DiscoveredAccessories.Partitions[PartId].disarmCommand;
                        break;
                };
                const [error, newState] = await self.GetSetArmState(self, riscoArm, cmd, state);
                if (error !== null) {
                    throw new Error(error);
                }else{
                    self.riscoCurrentState = newState;
                    callback !== null && typeof callback === 'function' && callback(null);
                    return;
                }
            }
        } catch(err) {
            self.log.error('Error on RiscoCPPartitions/setTargetState:\n%s', err);
            callback !== null && typeof callback === 'function' && callback(null);
            return;
        }
    }

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
                    self.log.info('Partition "%s" => Set new state: (%s) -> %s',self.name, state, self.translateState(state));
                }
                self.mainService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, state);
                return [null, state];
                break;
            case 2:
                self.log.debug('The partition will be armed in %s milliseconds', RefreshInterval);
                setTimeout(self.GetSetArmState, RefreshInterval, self, false, 'Refresh', state);
                if (!self.polling) {
                    self.log.debug('Partition "%s" State will be refreshed in %s milliseconds', self.name, RefreshInterval);
                }
                return [null, self.riscoCurrentState];
                break;
        }
    }

    async getState(callback) {
        var self = this;
        try{
            await self.getRefreshState(callback);
        } catch(err) {
            self.log.error('Error on RiscoCPPartitions/getState:\n%s', err);
            callback(null, self.riscoCurrentState);
            return;
        }
    }

    async getCurrentState(callback) {
        var self = this;
        try{
            if (self.polling) {
                callback(null, self.riscoCurrentState);
            } else {
                self.log.info('Partition "%s" =>Getting current state - delayed...', self.name);
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
                            self.log.info('Partition "%s" => Actual state is: (%s) -> %s', self.name, self.riscoCurrentState, self.translateState(self.riscoCurrentState));
                        } else {
                            self.log.info('Group "%s" => Actual state is: (%s) -> %s',self.name, self.riscoCurrentState, self.translateState(self.riscoCurrentState));
                        }
                        self.mainService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
                        return
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPPartitions/getCurrentState:\n%s', err);
            self.mainService.setCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
            callback(null, self.riscoCurrentState);
            return;
        }
    }

    async getCurrentOccupancyState(callback) {
        var self = this;
        try{
            if (self.polling) {
                callback(null, self.OccupancyState);
            } else {
                self.log.info('Partition "%s" =>Getting Occupancy current state - delayed...', self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition(function () {
                        return self.OccupancyState;
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        if (self.TypeOfAcc == 'group'){
                            self.log.info('Group "%s" => Actual Occupancy state is: (%s) -> %s',self.name, self.OccupancyState, ((self.OccupancyState == 0) ? 'Not Occupied':'Occupied'));
                        } else {
                            self.log.info('Partition "%s" => Actual Occupancy state is: (%s) -> %s', self.name, self.OccupancyState, ((self.OccupancyState == 0) ? 'Not Occupied':'Occupied'));
                        }
                        self.OccupancyService.setCharacteristic(self.Characteristic.OccupancyDetected, self.OccupancyState);
                        return;
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPPartitions/getCurrentOccupancyState:\n%s', err);
            self.OccupancyService.setCharacteristic(self.Characteristic.OccupancyDetected, self.OccupancyState);
            callback(null, self.OccupancyState);
            return;
        }
    }

    async getTargetState(callback) {
        var self = this;
        if (self.polling) {
            callback(null, self.riscoCurrentState);
        } else {
            self.log.debug('Getting target state...');
            self.getState(callback);
        }
    }

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
                ItemStates = Datas.filter(groups => groups.Id == (self.RiscoPartId | ''));
            } else {
                for (var Parts in self.RiscoSession.DiscoveredAccessories.Partitions) {
                    if (Parts != 'type'){
                        Datas.push(self.RiscoSession.DiscoveredAccessories.Partitions[Parts]);
                    }
                }
                ItemStates = Datas.filter(parts => parts.Id == (self.RiscoPartId | ''));
            }
            if (ItemStates.length != 0) {
                self.OccupancyState = ((ItemStates[0].Ready)? 0 : 1 );
                self.riscoCurrentState = PGsStatesRegistry[ItemStates[0].actualState];
                if (ItemStates[0].OnAlarm == true){
                    self.riscoCurrentState = 4;
                }
                if (this.TypeOfAcc == 'partition'){
                    callback(null, [self.riscoCurrentState, self.OccupancyState]);
                } else { 
                    callback(null, [self.riscoCurrentState, null]);
                }
                return;
            } else {
                throw new Error('Error on RefreshState!!!');
            }
        } catch(err){
            self.log.error('Error on RiscoCPPartitions/getRefreshState:\n%s', err);
            if (this.TypeOfAcc == 'partition'){
                callback(null, [self.riscoCurrentState, self.OccupancyState]);
            } else { 
                callback(null, [self.riscoCurrentState, null]);
            }
            return;
        }
    }

    identify(callback) {
        self.log.info('Identify requested!');
        callback(); // success
    }

    getServices() {
        return this.services;
    }
}

class RiscoCPGroups extends RiscoCPPartitions {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory,  'group');
    }
}

class RiscoCPOutputs {
    constructor (log, accConfig, api, accessory) {
        this.log = log;
        this.name = accConfig.context.name;
        this.RiscoSession = accConfig.RiscoSession;
        this.RiscoOutputId = (function(){
            return accConfig.context.Id;
        })();
        this.TypePulse = (function(){
            if (accConfig.context.Type == 'pulse') {
                return true;
            } else {
                return false;
            }
        })();
        this.polling = accConfig.polling || false;
        this.pollInterval = accConfig.pollInterval || 30000;
        this.accessory = accessory;

        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.mainService = this.accessory.getService(this.Service.Switch, this.accessory.displayName);
        
        this.mainService
            .getCharacteristic(this.Characteristic.On)
            .on('get', this.getCurrentState.bind(this))
            .on('set', this.setTargetState.bind(this));

        // Default Value
        this.log.debug('Output "%s" default State: %s', this.name, accConfig.context.State);
        this.RiscoOutputState = accConfig.context.State;
        this.IsPulsed = false;
        this.long_event_name = `long_out_${this.RiscoOutputId}_${(this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`;
        this.PollingLoop();
    }

    PollingLoop() {
        var self = this;
        if (self.TypePulse !== true) {
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
                    self.log.info('Output "%s" => New state detected: (%s). Notify!', self.name, state);
                    self.RiscoOutputState = state;
                    self.mainService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
                });

                emitter.on('err', function (err) {
                    self.log.error('Polling failed, error was %s', err);
                });

                emitter.on('close', function () {
                    emitter.removeAllListeners();
                });
            }
        }
    }

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
            self.log.error('Error on RiscoCPOutputs/getRefreshState:\n%s', err);
            callback(null, self.RiscoOutputState);
            return;
        }
    }

    async getCurrentState(callback) {
        var self = this;
        try{
            if (self.polling){
                self.log.debug('Output is %s', self.RiscoOutputState);
                if (self.TypePulse === false) {
                    callback(null, self.RiscoOutputState);
                } else {
                    callback(null, false);
                }
            } else {
                if (self.TypePulse === false) {
                    self.log.info('Output "%s" =>Getting current state - delayed...', self.name);
                    waitUntil()
                        .interval(500)
                        .times(15)
                        .condition(function () {
                            return (self.RiscoOutputState ? true : false);
                        })
                        .done(async function (result) {
                            await self.RiscoSession.getCPStates();
                            await self.getRefreshState(callback);
                            self.log.debug('Output "%s" => Actual state is: (%s)', self.name, self.RiscoOutputState);
                            self.mainService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
                            return
                        });
                } else {
                    callback(null, false);
                }
            }
        } catch (err) {
            self.log.error('Error on RiscoCPOutputs/getCurrentState:\n%s', err);
            self.mainService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
            callback(null, self.RiscoOutputState);
            return;
        }
    }

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
                self.log.info('Output "%s" => Set new state: (%s)', self.name, state);
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
    }

    async ResetPulseSwitchState(self) {
        var self = self;
        self.log.debug('Reset Pulse Switch State to %s', self.RiscoOutputState);
        self.mainService.setCharacteristic(self.Characteristic.On, self.RiscoOutputState);
    }

    identify(callback) {
        self.log.info('Identify requested!');
        callback(); // success
    }

    getServices() {
        return this.services;
    }
}

class RiscoCPBaseDetectors {
    constructor(log, accConfig, api, accessory) {
        this.log = log;
        this.name = accConfig.context.name;
        this.RiscoSession = accConfig.RiscoSession;
        this.Type = accConfig.context.accessorytype;
        this.RiscoDetectorId = (function(){
            return accConfig.context.Id;
        })();
        this.polling = accConfig.polling || false;
        this.pollInterval = accConfig.pollInterval || 30000;
        this.accessory = accessory;

        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;

        this.SetServicesAccessory();
        this.SetExcludeServicesAccessory();

        this.DetectorReady = false;

        // Default Value
        this.log.debug('%s "%s" default State: %s',this.sPrefix, this.name, accConfig.context.State);
        this.RiscoDetectorState = accConfig.context.State;
        this.RiscoDetectorBypassState = accConfig.context.Bypassed;
        this.long_event_name = `long_det_${this.RiscoDetectorId}_${(this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`;
        this.PollingLoop();
    }

    PollingLoop() {
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

                self.log.info('%s "%s" => New state detected: (%s). Notify!', self.sPrefix, self.name, self.GetAccessoryState(state[0], false));
                self.log.info('%s "%s" => New Bypass State detected : (%s). Notify!', self.sPrefix, self.name, ((state[1]) ? 'ByPassed' : 'Not ByPassed')) ;
                self.ReportAccessoryState(state);
            });

            emitter.on('err', function (err) {
                self.log.error('Polling failed, error was %s', err);
            });

            emitter.on('close', function () {
                emitter.removeAllListeners();
            });
        }
    }

    SetExcludeServicesAccessory(){
        var self = this;
        self.log.debug('Adding Exclude Switch to %s', this.name);
        this.ExcludeService = this.accessory.getService(this.Service.Switch, this.accessory.displayName);
        this.ExcludeService
            .getCharacteristic(this.Characteristic.On)
            .on('get', this.getCurrentExcludeState.bind(this))
            .on('set', this.setCurrentExcludeState.bind(this));
    }

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
                self.RiscoDetectorActiveState = ItemStates[0].Bypassed;
                self.DetectorReady = true;
                callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
                return
            } else {
                throw new Error(`Error on ${self.sPrefix} RefreshState!!!`);
            }
        } catch(err){
            self.log.error('Error on RiscoCPBaseDetectors/getRefreshState:\n%s', err);
            self.DetectorReady = true;
            callback(null, [self.RiscoDetectorState, self.RiscoDetectorActiveState]);
            return;
        }
    }

    async getCurrentState(callback) {
        var self = this;
        try{
            if (self.polling){
                self.log.debug('%s "%s" MotionDetected: %s', self.sPrefix, self.name, self.GetAccessoryState(self.RiscoDetectorState, false));
                callback(null, self.RiscoDetectorState);
            } else {
                self.log.info('%s "%s" =>Getting current state - delayed...', self.sPrefix, self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition(function () {
                        return (self.RiscoDetectorState ? true : false);
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        self.log.debug('%s "%s" => Actual Motion state is: (%s)', self.sPrefix, self.name, self.GetAccessoryState(self.RiscoDetectorState, false));
                        self.DetectorReady = true;
                        self.ReportAccessoryState();
                        return
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPBaseDetectors/getCurrentState:\n%s', err);
            self.ReportAccessoryState();
            callback(null, self.RiscoDetectorState);
            return;
        }
    }

    async setCurrentState(state, callback) {
        var self = this;
        if ((self.DetectorReady) && (self.Type == 'Detector')){
            state = (state) ? false : true;
            self.log.debug('Set Active %s "%s" to: %s', self.sPrefix, self.name, state);
            var SBpResp;
            self.log.debug('%s Actual State: %s', self.name, self.RiscoDetectorActiveState);
            if (self.Type == 'Detector'){
                self.log.debug('%s New State: %s', self.name, state);
            }
            if (self.RiscoDetectorActiveState != state) {
                SBpResp = true;
                self.log.debug('%s Identical State', self.name);
            } else {
                SBpResp = await self.RiscoSession.SetBypass(((state) ? 1 : 0 ), self.RiscoDetectorId);
                self.log.debug('%s Different State', self.name);
            }
            if (SBpResp){
                if (!self.polling){
                    self.log.info('%s "%s" => Set new Bypass state: (%s)', self.sPrefix, self.name, state);
                }
                typeof callback === 'function' && callback(null, self.RiscoDetectorState);
            } else {
                self.log.error('Error on SetBypass!!!');
                typeof callback === 'function' && callback(null, self.RiscoDetectorState);
            }
        }
    }

    async getCurrentExcludeState(callback) {
        var self = this;
        try{
            if (self.polling){
                self.log.debug('%s "%s" Exclude State : %s', self.sPrefix, self.name, ((self.RiscoDetectorActiveState) ? 'Bypassed': 'Not Bypassed'));
                callback(null, ((self.RiscoDetectorActiveState) ? false: true));
            } else {
                self.log.info('%s "%s" =>Getting current state - delayed...', self.sPrefix, self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition(function () {
                        return ((self.RiscoDetectorActiveState) ? false: true);
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        self.log.debug('%s "%s" => Actual Exclude State is: %s', self.sPrefix, self.name, ((self.RiscoDetectorActiveState) ? 'Bypassed': 'Not Bypassed'));
                        self.DetectorReady = true;
                        return
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPBaseDetectors/getCurrentState:\n%s', err);
            callback(null, ((self.RiscoDetectorActiveState) ? false: true));
            return;
        }
    }

    async setCurrentExcludeState(state, callback) {
        var self = this;
        if (self.DetectorReady){
            state = (state) ? false : true;
            self.log.debug('Set Exclude State of %s "%s" to: %s', self.sPrefix, self.name, ((state) ? 'Bypassed': 'Not Bypassed'));
            var SBpResp;
            self.log.debug('%s Actual State: %s', self.name, ((self.RiscoDetectorActiveState) ? 'Bypassed': 'Not Bypassed'));
            self.log.debug('%s New State: %s', self.name, ((state) ? 'Bypassed': 'Not Bypassed'));
            if (self.RiscoDetectorActiveState == state) {
                SBpResp = true;
                self.log.debug('%s Identical State', self.name);
            } else {
                SBpResp = await self.RiscoSession.SetBypass(state, self.RiscoDetectorId);
                self.log.debug('%s Different State', self.name);
            }

            if (SBpResp){
                if (!self.polling){
                    self.log.info('%s "%s" => Set new Bypass state: (%s)', self.sPrefix, self.name, state);
                }
                typeof callback === 'function' && callback(null);
            } else {
                self.log.error('Error on SetBypass!!!');
                typeof callback === 'function' && callback(null);
            }
        }
    }

    identify(callback) {
        self.log.info('Identify requested!');
        callback(); // success
    }

    getServices() {
        return this.services;
    }

}

class RiscoCPDetectors extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory(){
        this.mainService = this.accessory.getService(this.Service.MotionSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.MotionDetected)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Detector';
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (!state){
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorActiveState = state[1];
        }
        try{
            self.mainService.setCharacteristic(self.Characteristic.MotionDetected, self.GetAccessoryState(self.RiscoDetectorState));
            return;
        } catch(err){
            self.log.error('Error on RiscoCPDetectors/ReportAccessoryState:\n%s', err);;
            return;
        }
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue){
            return ((state) ? true : false);
        } else {
            return ((state) ? 'Active' : 'Inactive');
        }
    }
}

class RiscoCPCDoor extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory(){
        this.mainService = this.accessory.getService(this.Service.Door, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Door Contact';
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (!state){
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorActiveState = state[1];
        }
        try{
            self.mainService.setCharacteristic(self.Characteristic.CurrentPosition, self.GetAccessoryState(self.RiscoDetectorState));
            self.mainService.setCharacteristic(self.Characteristic.TargetPosition, self.GetAccessoryState(self.RiscoDetectorState));
            return;
        } catch(err){
            self.log.error('Error on RiscoCPCDoor/ReportAccessoryState:\n%s', err);
            return;
        }
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue){
            return ((state) ? 100 : 0);
        } else {
            return ((state) ? 'open' : 'closed');
        }
    }
}

class RiscoCPCWindow extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory, TypeOfAcc = 'group') {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory(){
        this.mainService = this.accessory.getService(this.Service.Window, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Window Contact';
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (!state){
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorActiveState = state[1];
        }
        try{
            self.mainService.setCharacteristic(self.Characteristic.CurrentPosition, self.GetAccessoryState(self.RiscoDetectorState));
            self.mainService.setCharacteristic(self.Characteristic.TargetPosition, self.GetAccessoryState(self.RiscoDetectorState));
            return;
        } catch(err){
            self.log.error('Error on RiscoCPCWindow/ReportAccessoryState:\n%s', err);;
            return;
        }
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue){
            return ((state) ? 100 : 0);
        } else {
            return ((state) ? 'open' : 'closed');
        }
    }
}

class RiscoCPCContactSensor extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory, TypeOfAcc = 'group') {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory(){
        this.mainService = this.accessory.getService(this.Service.ContactSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.ContactSensorState)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Contact Sensor';
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (!state){
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorActiveState = state[1];
        }
        try{
            self.mainService.setCharacteristic(self.Characteristic.ContactSensorState, self.GetAccessoryState(self.RiscoDetectorState));
            return;
        } catch(err){
            self.log.error('Error on RiscoCPCContactSensor/ReportAccessoryState:\n%s', err);
            return;
        }
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue){
            return ((state) ? true : false);
        } else {
            return ((state) ? 'Active' : 'Inactive');
        }
    }
}

class RiscoCPCVibrateSensor extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory(){
        this.mainService = this.accessory.getService(this.Service.MotionSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.MotionDetected)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Vibrate Sensor';
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (!state){
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorActiveState = state[1];
        }
        try{
            self.mainService.setCharacteristic(self.Characteristic.MotionDetected, self.GetAccessoryState(self.RiscoDetectorState));
            return;
        } catch(err){
            self.log.error('Error on RiscoCPDetectors/ReportAccessoryState:\n%s', err);;
            return;
        }
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue){
            return ((state) ? true : false);
        } else {
            return ((state) ? 'Active' : 'Inactive');
        }
    }
}

class RiscoCPCSmokeSensor extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory(){
        this.mainService = this.accessory.getService(this.Service.SmokeSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.SmokeDetected)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Smoke Sensor';
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (!state){
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorActiveState = state[1];
        }
        try{
            self.mainService.setCharacteristic(self.Characteristic.SmokeDetected, self.GetAccessoryState(self.RiscoDetectorState));
            return;
        } catch(err){
            self.log.error('Error on RiscoCPDetectors/ReportAccessoryState:\n%s', err);;
            return;
        }
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue){
            return ((state) ? 1 : 0);
        } else {
            return ((state) ? 'Active' : 'Inactive');
        }
    }
}

module.exports = {
    RiscoCPPartitions: RiscoCPPartitions,
    RiscoCPGroups: RiscoCPGroups,
    RiscoCPOutputs: RiscoCPOutputs,
    RiscoCPDetectors: RiscoCPDetectors,
    RiscoCPCDoor: RiscoCPCDoor,
    RiscoCPCWindow: RiscoCPCWindow,
    RiscoCPCContactSensor: RiscoCPCContactSensor,
    RiscoCPCVibrateSensor: RiscoCPCVibrateSensor,
    RiscoCPCSmokeSensor: RiscoCPCSmokeSensor
}