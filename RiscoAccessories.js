'use strict';
var pjson = require('./package.json');
var waitUntil = require('wait-until');
var pollingtoevent = require('polling-to-event');

const JSONreplacer = () => {
    const visited = new WeakSet();
    return (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (visited.has(value)) {
                return;
            }
            visited.add(value);
        }
        return value;
    };
};


class RiscoCPPartitions {
    constructor(log, accConfig, api, accessory, TypeOfAcc = 'partition') {
        this.log = log;
        this.name = accConfig.context.name;
        this.RiscoSession = accConfig.RiscoSession;
        this.TypeOfAcc = TypeOfAcc;
        this.RiscoPartId = accConfig.context.Id;
        this.polling = accConfig.polling || false;
        this.pollInterval = accConfig.pollInterval || 30000;
        this.accessory = accessory;
        this.api = api;
        this.OccupancyPreventArming = accConfig.OccupancyPreventArming || true;
        
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.mainService = this.accessory.getService(this.Service.SecuritySystem, this.accessory.displayName);

        this.mainService
            .getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
            .on('get', this.getCurrentState.bind(this));

        this.mainService
            .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
            .on('get', this.getTargetState.bind(this))
            .on('set', this.setTargetState.bind(this));

        if ((this.TypeOfAcc == 'partition') && (this.OccupancyPreventArming)) {
            this.OccupancyService = this.accessory.getService(this.Service.OccupancySensor, this.accessory.displayName);
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
        this.riscoCurrentState; // Do not set default. Looks like plugin get restarted after some time. Generates false alarms.
        this.riscoTargetState = this.riscoCurrentState;

        //avoid maxlistener warning
        const MaxApiListeners = this.api.getMaxListeners();
        const ActualListeners = this.api.listenerCount('shutdown');
        this.log.debug('Api Event Shutdown : \nActual Listener :%s for Maximum :%s',this.api.listenerCount('shutdown'),MaxApiListeners);
        if (ActualListeners >= MaxApiListeners) {
            //give one more for other process
            this.api.setMaxListeners(ActualListeners + 2);
            this.log.debug('Max Listener Exceeded. Set To :%s', (ActualListeners + 2));
        }

        this.api.once('shutdown', () => {
            this.log.debug('Cleaning Before Exit.\nRemove All Listeners for %s', this.name);
            this.mainService
                .getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
                .removeListener('get', this.getCurrentState);
            this.mainService
                .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
                .removeListener('get', this.getTargetState)
                .removeListener('set', this.setTargetState);
            if ((this.TypeOfAcc == 'partition') && (this.OccupancyPreventArming)) {
                this.OccupancyService
                    .getCharacteristic(this.Characteristic.OccupancyDetected)
                    .removeListener('get', this.getCurrentOccupancyState);
            }
        });
        //initialize Security System States
        this.getRefreshState();
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
            // 4 -  Characteristic.SecuritySystemCurrentState.ALARM: => Alarm
            var emitter = new pollingtoevent( (done) => {
                self.getRefreshState( (err, result) => {
                    done(err, result);
                });
            }, {
                longpollEventName: self.long_event_name,
                longpolling: true,
                interval: 1000
            });

            emitter.on(self.long_event_name, (state) => {
                if (state) {
                    self.log.info('Partition "%s" => New state detected: (%s) -> %s. Notify!', self.name, state[0], self.translateState(state[0]));
                    self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, state[0]);
                    self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemTargetState, state[1]);
                    self.riscoCurrentState = state[0];
                    self.riscoTargetState = state[1];
                    if ((this.TypeOfAcc == 'partition') && (this.OccupancyPreventArming)) {
                        self.log.info('Partition "%s" is %sOccupied. Notify!', self.name, ((state[2] == 0) ? 'not ' : ''));
                        self.OccupancyService.updateCharacteristic(self.Characteristic.OccupancyDetected, state[2]);
                        self.OccupancyState = state[2];
                    }
                }
            });

            emitter.on('err', (err) => {
                self.log.error('Polling failed, error was %s', err);
            });

            self.api.once('shutdown', () => {
                self.log.debug('Remove Polling Listeners for %s', self.name);
                emitter.removeAllListeners();
            });
        }
    }

    async getTargetState(callback) {
        var self = this;
        if (self.polling) {
            callback(null, self.riscoTargetState);
        } else {
            self.log.debug('Getting target state...');
            self.getState(callback);
        }
    }

    async setTargetState(state, callback) {
        var self = this;
        self.log.debug('Setting "%s" state to (%s) -> %s', self.name, state, self.translateState(state));
        try {
            var PartId;
            var armedState;
            const ArmedValues = {
                'disarmed': 1,
                'partially': 2,
                'armed': 3
            };

            if (self.TypeOfAcc == 'group') {
                if (state != self.riscoTargetState) {
                    self.log.debug('Actual state: ' + self.riscoCurrentState);
                    self.log.debug('Futur state: ' + state);
                    if ((state == 3) && (self.riscoCurrentState != 3)) {
                        self.log.debug('The system is armed and you want to disarm. Because RiscoCloud can not afford it, it is necessary to disarm the parent(s) partition.');
                        self.log.debug('All other child groups in this partition will also be disarmed.');
                        self.log.debug('Parent Part of %s: %s', (self.RiscoPartId || 'null'), JSON.stringify((self.RiscoSession.DiscoveredAccessories.Groups[self.RiscoPartId]).parentPart, JSONreplacer(), 4));
                        armedState = ArmedValues['disarmed'];
                    } else {
                        self.log.debug('Add Cmd: "%sG%s:armed"', self.RiscoPartId);
                        armedState = ArmedValues['armed'];
                    }
                    const ArmResp = await self.RiscoSession.armDisarm(self.RiscoPartId, armedState, true);
                    if (ArmResp) {
                        if (!self.polling) {
                            self.log.info('Group "%s" => Set new state: (%s) -> %s',self.name, state, self.translateState(state));
                        }
                        self.riscoCurrentState = state;
                        self.riscoTargetState = state;
                        self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
                        callback !== null && typeof callback === 'function' && callback(null);
                        return;
                    } else {
                        //treat case when parentPart of group is already armed
                        self.log.debug('Error on armDisarm!!! Maybe a sensor is active and system cannot be armed')
                        throw new Error('Error on armDisarm!!!');
                    }
                } else {
                    self.log.debug('Identical state. No change');
                    callback !== null && typeof callback === 'function' && callback(null);
                    return;
                }
            } else {
                //if arm, away or night are customized, then pass occupancy verification
                //Disable Occupancy Test While best method are develloped
                if (!(self.RiscoSession.Custom_Cmd) && (this.OccupancyPreventArming)) {
                    switch (state) {
                        case 0:
                        case 2:
                            //If partition are not ready to partial arm, then don't change anything
                            if (!(self.RiscoSession.DiscoveredAccessories.Partitions[self.RiscoPartId].PReady)) {
                                state = ((self.riscoCurrentState == 4 ) ? self.riscoTargetState : self.riscoCurrentState);
                                self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemTargetState, self.riscoTargetState);
                                callback !== null && typeof callback === 'function' && callback(null);
                                return;
                            }
                            break;
                        case 1:
                            //If partition are not ready to full arm, then don't change anything
                            if (!(self.RiscoSession.DiscoveredAccessories.Partitions[self.RiscoPartId].Ready)) {
                                state = ((self.riscoCurrentState == 4 ) ? self.riscoTargetState : self.riscoCurrentState);
                                self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemTargetState, self.riscoTargetState);
                                callback !== null && typeof callback === 'function' && callback(null);
                                return;
                            }
                            break;
                    }
                }
                if (state != self.riscoTargetState) {
                    if (self.RiscoPartId != null ){
                        PartId = self.RiscoPartId;
                    } else {
                        PartId = 0;
                    }
                    if ((state != 3) && (self.riscoTargetState != 3)) {
                        self.log.debug('The system is already armed and you want to change the arming type. It is necessary to disarm the system beforehand.');
                        await self.setTargetState(3, null);
                    }
                    switch (state) {
                        case 0:
                            // Stay_Arm = 0
                            armedState = ArmedValues[self.RiscoSession.DiscoveredAccessories.Partitions[PartId].homeCommand];
                            break;
                        case 1:
                            // Away_Arm = 1
                            armedState = ArmedValues[self.RiscoSession.DiscoveredAccessories.Partitions[PartId].armCommand];
                            break;
                        case 2:
                            // Night_Arm = 2
                            armedState = ArmedValues[self.RiscoSession.DiscoveredAccessories.Partitions[PartId].nightCommand];
                            break;
                        case 3:
                            // Disarm = 3
                            armedState = ArmedValues[self.RiscoSession.DiscoveredAccessories.Partitions[PartId].disarmCommand];
                            break;
                    };
                    const [error, newState] = await self.GetSetArmState(self.RiscoPartId, armedState, state);
                    if (error !== null) {
                        throw new Error(error);
                    } else {
                        self.riscoCurrentState = newState;
                        self.riscoTargetState = newState;
                        self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
                        callback !== null && typeof callback === 'function' && callback(null);
                        return;
                    }
                }
                callback !== null && typeof callback === 'function' && callback(null);
                return;
            }
        } catch(err) {
            self.log.error('Error on RiscoCPPartitions/setTargetState:\n%s', err);
            callback !== null && typeof callback === 'function' && callback(err);
            return;
        }
    }

    async getCurrentState(callback) {
        var self = this;
        self.log.debug('Entering on RiscoCPPartitions/getCurrentState function');
        try {
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
                        if (self.TypeOfAcc == 'group') {
                            self.log.info('Partition "%s" => Actual state is: (%s) -> %s', self.name, self.riscoCurrentState, self.translateState(self.riscoCurrentState));
                        } else {
                            self.log.info('Group "%s" => Actual state is: (%s) -> %s',self.name, self.riscoCurrentState, self.translateState(self.riscoCurrentState));
                        }
                        self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
                        self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemTargetState, self.riscoTargetState);
                        return
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPPartitions/getCurrentState:\n%s', err);
            self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
            callback(null, self.riscoCurrentState);
            return;
        }
    }

    async getCurrentOccupancyState(callback) {
        var self = this;
        try {
            if (self.polling) {
                callback(null, self.OccupancyState);
            } else {
                self.log.info('Partition "%s" =>Getting Occupancy current state - delayed...', self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition( () => {
                        return self.OccupancyState;
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        self.log.info('Partition "%s" => Actual Occupancy state is: (%s) -> %s', self.name, self.OccupancyState, ((self.OccupancyState == 0) ? 'Not Occupied':'Occupied'));
                        self.OccupancyService.updateCharacteristic(self.Characteristic.OccupancyDetected, self.OccupancyState);
                        return;
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPPartitions/getCurrentOccupancyState:\n%s', err);
            self.OccupancyService.updateCharacteristic(self.Characteristic.OccupancyDetected, self.OccupancyState);
            callback(null, self.OccupancyState);
            return;
        }
    }

    async getState(callback) {
        var self = this;
        try {
            await self.getRefreshState(callback);
        } catch (err) {
            self.log.error('Error on RiscoCPPartitions/getState:\n%s', err);
            callback(null, self.riscoCurrentState);
            return;
        }
    }

    async GetSetArmState(partId, armedState, state) {
        var self = this;

        const [ArmResp, ArmReason] = await self.RiscoSession.armDisarm(partId, armedState);
        switch (ArmResp) {
            case 0:
                self.log.debug('Error on armDisarm!!! Maybe a sensor is active and system cannot be armed');
                return [null, self.riscoCurrentState];
                break;
            case 1:
                if (!self.polling) {
                    self.log.info('Partition "%s" => Set new state: (%s) -> %s',self.name, state, self.translateState(state));
                }
                self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, state);
                return [null, state];
                break;
            case 2:
                const ArmDelay = ArmReason;
                self.log.debug('The partition will be armed in %s milliseconds', ArmDelay);
                self.log.error('The partition will be armed in %s milliseconds', ArmDelay);
                setTimeout(() => {self.RiscoSession.UpdateCPStates}, ArmDelay);
                if (!self.polling) {
                    self.log.debug('Partition "%s" State will be refreshed in %s milliseconds', self.name, ArmDelay);
                }
                return [null, self.riscoCurrentState];
                break;
        }
    }

    async getRefreshState(callback) {
        var self = this;
        try {
            const PGsStatesRegistry = {
                armed: 1,
                partial: 2,
                disarmed: 3,
            };
            var Datas = [];
            var ItemStates;
            if (self.TypeOfAcc == 'group') {
                for (var Group in self.RiscoSession.DiscoveredAccessories.Groups) {
                    if (Group != 'type') {
                        Datas.push(self.RiscoSession.DiscoveredAccessories.Groups[Group]);
                    }
                }
                ItemStates = Datas.filter(groups => groups.Id == (self.RiscoPartId | ''));
            } else {
                for (var Parts in self.RiscoSession.DiscoveredAccessories.Partitions) {
                    if (Parts != 'type') {
                        Datas.push(self.RiscoSession.DiscoveredAccessories.Partitions[Parts]);
                    }
                }
                ItemStates = Datas.filter(parts => parts.Id == (self.RiscoPartId | ''));
            }

            if (ItemStates.length != 0) {
                self.OccupancyState = ((ItemStates[0].Ready)? 0 : 1 );
                self.riscoCurrentState = PGsStatesRegistry[ItemStates[0].actualState];
                self.riscoTargetState = self.riscoCurrentState;
                if (ItemStates[0].OnAlarm == true) {
                    self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, 4);
                    self.riscoCurrentState = 4;
                }
                self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemCurrentState, self.riscoCurrentState);
                self.mainService.updateCharacteristic(self.Characteristic.SecuritySystemTargetState, self.riscoTargetState);
                if (this.TypeOfAcc == 'partition') {
                    if (this.OccupancyPreventArming) {
                        self.OccupancyService.updateCharacteristic(self.Characteristic.OccupancyDetected, self.OccupancyState);
                    }
                    typeof callback === 'function' && callback(null, [self.riscoCurrentState, self.riscoTargetState, self.OccupancyState]);
                } else {
                    typeof callback === 'function' && callback(null, [self.riscoCurrentState, self.riscoTargetState, null]);
                }
                return;
            } else {
                throw new Error('Error on RefreshState!!!');
            }
        } catch (err) {
            self.log.error('Error on RiscoCPPartitions/getRefreshState:\n%s', err);
            if (this.TypeOfAcc == 'partition') {
                typeof callback === 'function' && callback(null, [self.riscoCurrentState, self.riscoTargetState, self.OccupancyState]);
            } else { 
                typeof callback === 'function' && callback(null, [self.riscoCurrentState, self.riscoTargetState, null]);
            }
            return;
        }
    }
}

class RiscoCPGroups extends RiscoCPPartitions {
    constructor(log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory,  'group');
    }
}

class RiscoCPOutputs {
    constructor(log, accConfig, api, accessory) {
        this.log = log;
        this.name = accConfig.context.name;
        this.RiscoSession = accConfig.RiscoSession;
        this.RiscoOutputId = accConfig.context.Id;
        this.TypePulse = ( () => {
            if (accConfig.context.Type == 'pulse') {
                return true;
            } else {
                return false;
            }
        })();
        this.polling = accConfig.polling || false;
        this.pollInterval = accConfig.pollInterval || 30000;
        this.accessory = accessory;
        this.api = api;

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
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
        
        //avoid maxlistener warning
        const MaxApiListeners = this.api.getMaxListeners();
        const ActualListeners = this.api.listenerCount('shutdown');
        this.log.debug('Api Event Shutdown : \nActual Listener :%s for Maximum :%s',this.api.listenerCount('shutdown'),MaxApiListeners);
        if (ActualListeners >= MaxApiListeners) {
            //give one more for other process
            this.api.setMaxListeners(ActualListeners + 2);
            this.log.debug('Max Listener Exceeded. Set To :%s', (ActualListeners + 2));
        }

        this.api.once('shutdown', () => {
            this.log.debug('Cleaning Before Exit.\nRemove All Listeners for %s', this.name);
            this.mainService
                .getCharacteristic(this.Characteristic.On)
                .removeListener('get', this.getCurrentState)
                .removeListener('set', this.setTargetState);
        });

        this.PollingLoop();
    }

    PollingLoop() {
        var self = this;
        if (self.TypePulse !== true) {
            // set up polling if requested
            if (self.polling) {
                var emitter = new pollingtoevent( (done) => {
                    self.getRefreshState( (err, result) => {
                        done(err, result);
                    });
                }, {
                    longpollEventName: self.long_event_name,
                    longpolling: true,
                    interval: 1000
                });

                emitter.on(self.long_event_name, (state) => {
                    self.log.info('Output "%s" => New state detected: (%s). Notify!', self.name, state);
                    self.RiscoOutputState = state;
                    self.mainService.updateCharacteristic(self.Characteristic.On, self.RiscoOutputState);
                });

                emitter.on('err', (err) => {
                    self.log.error('Polling failed, error was %s', err);
                });

            self.api.once('shutdown', () => {
                self.log.debug('Remove Polling Listeners for %s', self.name);
                emitter.removeAllListeners();
            });
            }
        }
    }

    async getRefreshState(callback) {
        var self = this;
        try {
            var Datas = [];
            var ItemStates;
            for (var Output in self.RiscoSession.DiscoveredAccessories.Outputs) {
                Datas.push(self.RiscoSession.DiscoveredAccessories.Outputs[Output]);
            }
            ItemStates = Datas.filter(outputs => (outputs.Id == (self.RiscoOutputId | '')));

            if (ItemStates.length != 0) {
                self.RiscoOutputState = ((ItemStates[0].State == 0) ? false : true);
                self.mainService.updateCharacteristic(self.Characteristic.On, self.RiscoOutputState);
                callback(null, self.RiscoOutputState);
                return;
            } else {
                throw new Error('Error on Output RefreshState!!!');
            }
        } catch (err) {
            self.log.error('Error on RiscoCPOutputs/getRefreshState:\n%s', err);
            callback(null, self.RiscoOutputState);
            return;
        }
    }

    async getCurrentState(callback) {
        var self = this;
        try {
            if (self.polling) {
                self.log.debug('Output is %s', self.RiscoOutputState);
                if (self.TypePulse === false) {
                    callback(null, self.RiscoOutputState);
                    return;
                } else {
                    callback(null, false);
                    return;
                }
            } else {
                if (self.TypePulse === false) {
                    self.log.info('Output "%s" => Getting current state - delayed...', self.name);
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
                            self.mainService.updateCharacteristic(self.Characteristic.On, self.RiscoOutputState);
                            return;
                        });
                } else {
                    callback(null, false);
                }
            }
        } catch (err) {
            self.log.error('Error on RiscoCPOutputs/getCurrentState:\n%s', err);
            self.mainService.updateCharacteristic(self.Characteristic.On, self.RiscoOutputState);
            callback(null, self.RiscoOutputState);
            return;
        }
    }

    async setTargetState(state, callback) {
        var self = this;
        self.log.debug('Set Output to: ' +  state);
        self.RiscoOutputState = state;

        const deviceType = ((self.TypePulse) ? 2 : 1 );
        const lastCommand = ((self.TypePulse) ? 1 : ((state) ? 1 : 0 ));
        const deviceId = self.RiscoOutputId;
        const HACResp = await self.RiscoSession.OutputCommand(deviceType, lastCommand, deviceId);

        if (HACResp){
            if (!self.polling) {
                self.log.info('Output "%s" => Set new state: (%s)', self.name, state);
            }
            if (self.TypePulse === false) {
                self.log.debug('Not a pulse switch, update it')
                self.RiscoOutputState = state;
                typeof callback === 'function' && callback(null);
            } else {
                if (self.IsPulsed) {
                    self.log.debug('Pulse switch is already pulsed');
                    self.IsPulsed = false;
                    typeof callback === 'function' && callback(null);
                } else {
                    self.log.debug('Pulse switch is not already pulsed');
                    self.IsPulsed = true;
                    setTimeout(self.ResetPulseSwitchState, 500, self);
                    self.RiscoOutputState = false;
                    typeof callback === 'function' && callback(null);
                }
            }
            
        } else {
            self.log.error('Error on HACommand!!!');
            typeof callback === 'function' && callback(null);
        }
    }

    async ResetPulseSwitchState(self) {
        var self = self;
        self.log.debug('Reset Pulse Switch State to %s', self.RiscoOutputState);
        self.mainService.updateCharacteristic(self.Characteristic.On, self.RiscoOutputState);
    }
}

class RiscoCPBaseDetectors {
    constructor(log, accConfig, api, accessory) {
        this.log = log;
        this.name = accConfig.context.name;
        this.RiscoSession = accConfig.RiscoSession;
        this.Type = accConfig.context.accessorytype;
        this.RiscoDetectorId = accConfig.context.Id;
        this.polling = accConfig.polling || false;
        this.pollInterval = accConfig.pollInterval || 30000;
        this.accessory = accessory;
        this.api = api;

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.secondCharac = undefined;

        this.SetServicesAccessory();
        this.SetExcludeServicesAccessory();
        this.DefineAccessoryVariable();

        this.DetectorReady = false;

        // Default Value
        this.log.debug('%s "%s" default State: %s',this.sPrefix, this.name, accConfig.context.State);
        this.RiscoDetectorState = accConfig.context.State;
        this.RiscoDetectorBypassState = accConfig.context.Bypassed;
        this.long_event_name = `long_det_${this.RiscoDetectorId}_${(this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`;

        //avoid maxlistener warning
        const MaxApiListeners = this.api.getMaxListeners();
        const ActualListeners = this.api.listenerCount('shutdown');
        this.log.debug('Api Event Shutdown : \nActual Listener :%s for Maximum :%s',this.api.listenerCount('shutdown'),MaxApiListeners);
        if (ActualListeners >= MaxApiListeners) {
            //give one more for other process
            this.api.setMaxListeners(ActualListeners + 2);
            this.log.debug('Max Listener Exceeded. Set To :%s', (ActualListeners + 2));
        }

        this.api.once('shutdown', () => {
            this.log.debug('Cleaning Before Exit.\nRemove All Listeners for %s', this.name);
            this.removemainListeners();
            this.removeExcludeListeners();
        });


        this.PollingLoop();
    }

    PollingLoop() {
        var self = this;
        // set up polling if requested
        if (self.polling) {
            var emitter = new pollingtoevent( (done) => {
                self.getRefreshState( (err, result) => {
                    done(err, result);
                });
            }, {
                longpollEventName: self.long_event_name,
                longpolling: true,
                interval: 1000
            });

            emitter.on(self.long_event_name, (state) => {
                self.log.info('%s "%s" => New state detected: (%s). Notify!', self.sPrefix, self.name, self.GetAccessoryState(state[0], false));
                self.log.info('%s "%s" => New Bypass State detected : (%s). Notify!', self.sPrefix, self.name, ((state[1]) ? 'ByPassed' : 'Not ByPassed'));
                self.ReportAccessoryState(state);
            });

            emitter.on('err', (err) => {
                self.log.error('Polling failed, error was %s', err);
            });

            self.api.once('shutdown', () => {
                self.log.debug('Remove All Listeners for %s', self.name);
                emitter.removeAllListeners();
            });
        }
    }

    SetExcludeServicesAccessory() {
        var self = this;
        self.log.debug('Adding Exclude Switch to %s', this.name);
        this.ExcludeService = this.accessory.getService(this.Service.Switch, this.accessory.displayName);
        this.ExcludeService
            .getCharacteristic(this.Characteristic.On)
            .on('get', this.getCurrentExcludeState.bind(this))
            .on('set', this.setCurrentExcludeState.bind(this));
    }

    removeExcludeListeners() {
         this.ExcludeService
            .getCharacteristic(this.Characteristic.On)
            .removeListener('get', this.getCurrentExcludeState)
            .removeListener('set', this.setCurrentExcludeState);
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue) {
            return ((state) ? self.ActiveValue : self.InactiveValue);
        } else {
            return ((state) ? self.ActiveStr : self.InactiveStr);
        }
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (state != null) {
            self.RiscoDetectorState = state[0];
            self.RiscoDetectorBypassState = state[1];
        }
        try {
            self.mainService.updateCharacteristic(self.mainCharac, self.GetAccessoryState(self.RiscoDetectorState));
            if (self.secondCharac !== undefined) {
                self.mainService.updateCharacteristic(self.secondCharac, self.GetAccessoryState(self.RiscoDetectorState));
            }
            self.ExcludeService.updateCharacteristic(self.Characteristic.On, ((self.RiscoDetectorBypassState) ? false : true));
            return;
        } catch (err) {
            self.log.error('Error on RiscoCPCDoor/ReportAccessoryState:\n%s', err);
            return;
        }
    }

    async getRefreshState(callback) {
        var self = this;
        try {
            var Datas = [];
            var ItemStates;
            for (var Detector in self.RiscoSession.DiscoveredAccessories.Detectors) {
                Datas.push(self.RiscoSession.DiscoveredAccessories.Detectors[Detector]);
            }
            ItemStates = Datas.filter(detectors => (detectors.Id == (self.RiscoDetectorId | '')));

            if (ItemStates.length != 0) {
                self.RiscoDetectorState = ItemStates[0].State;
                self.RiscoDetectorBypassState = ItemStates[0].Bypassed;
                self.DetectorReady = true;
                self.ReportAccessoryState();
                callback(null, [self.RiscoDetectorState, self.RiscoDetectorBypassState]);
                return;
            } else {
                throw new Error(`Error on ${self.sPrefix} RefreshState!!!`);
            }
        } catch (err) {
            self.log.error('Error on RiscoCPBaseDetectors/getRefreshState:\n%s', err);
            self.DetectorReady = true;
            callback(null, [self.RiscoDetectorState, self.RiscoDetectorBypassState]);
            return;
        }
    }

    async getCurrentState(callback) {
        var self = this;
        try {
            if (self.polling) {
                self.log.debug('%s "%s" MotionDetected: %s', self.sPrefix, self.name, self.GetAccessoryState(self.RiscoDetectorState, false));
                callback(null, self.RiscoDetectorState);
                return;
            } else {
                self.log.info('%s "%s" => Getting current state - delayed...', self.sPrefix, self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition( () => {
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

    async getCurrentExcludeState(callback) {
        var self = this;
        try {
            if (self.polling) {
                self.log.debug('%s "%s" Exclude State : (%s) => %s', self.sPrefix, self.name, self.RiscoDetectorBypassState, ((self.RiscoDetectorBypassState) ? 'Bypassed': 'Not Bypassed'));
                callback(null, (self.RiscoDetectorBypassState)?false : true);
                return;
            } else {
                self.log.info('%s "%s" => Getting current state - delayed...', self.sPrefix, self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition( () => {
                        return (self.RiscoDetectorBypassState)?false : true;
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        self.log.debug('%s "%s" => Actual Exclude State is: %s', self.sPrefix, self.name, ((self.RiscoDetectorBypassState) ? 'Bypassed': 'Not Bypassed'));
                        self.DetectorReady = true;
                        return;
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPBaseDetectors/getCurrentExcludeState:\n%s', err);
            callback(err, (self.RiscoDetectorBypassState)?false : true);
            return;
        }
    }

    async setCurrentExcludeState(state, callback) {
        var self = this;
        try {
            if (self.DetectorReady) {
                const PartId = self.RiscoSession.DiscoveredAccessories.Detectors[self.RiscoDetectorId].Partition;
                const PartStatus = self.RiscoSession.DiscoveredAccessories.Partitions[PartId].actualState
                var SBpResp;
                if (PartStatus != 'disarmed') {
                    self.log.info('Cannot Modify Exclude State of Sensor from Armed Partition');
                    typeof callback === 'function' && callback('Cannot Modify Exclude State of Sensor from Armed Partition', 'Cannot Modify Exclude State of Sensor from Armed Partition');
                    self.ExcludeService.updateCharacteristic(self.Characteristic.On, (self.RiscoDetectorBypassState)?false : true);
                    return;
                }
                state = ((state) ? false : true);
                self.log.debug('Set Exclude State of %s "%s" to: %s', self.sPrefix, self.name, ((state) ? 'Bypassed': 'Not Bypassed'));
                self.log.debug('%s Actual State: %s', self.name, ((self.RiscoDetectorBypassState) ? 'Bypassed': 'Not Bypassed'));
                self.log.debug('%s New State: %s', self.name, ((state) ? 'Bypassed': 'Not Bypassed'));
                if (self.RiscoDetectorBypassState == state) {
                    SBpResp = true;
                    self.log.debug('%s Identical State', self.name);
                } else {
                    SBpResp = await self.RiscoSession.SetBypass(((state) ? 2 : 3), self.RiscoDetectorId);
                    self.log.debug('%s Different State', self.name);
                }

                if (SBpResp) {
                    if (!self.polling) {
                        self.log.info('%s "%s" => Set new Bypass state: (%s)', self.sPrefix, self.name, state);
                    }
                    typeof callback === 'function' && callback(null);
                } else {
                    self.log.error('Error on SetBypass!!!');
                    typeof callback === 'function' && callback('Error on SetBypass!!!');
                }
                return;
            }
        } catch (err) {
            self.log.error('Error on RiscoCPBaseDetectors/setCurrentExcludeState:\n%s', err);
            self.ExcludeService.updateCharacteristic(self.Characteristic.On, (self.RiscoDetectorBypassState)?false : true);
            callback(err);
            return;
        }
    }
}

class RiscoCPDetectors extends RiscoCPBaseDetectors {
    constructor(log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.MotionSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.MotionDetected)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Detector';
    }

    DefineAccessoryVariable() {
        this.mainCharac = this.Characteristic.MotionDetected;
        this.ActiveValue = true;
        this.InactiveValue = false;
        this.ActiveStr = 'Active';
        this.InactiveStr = 'Inactive';
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.MotionDetected)
            .removeListener('get', this.getCurrentState);
    }
}

class RiscoCPCDoor extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.Door, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Door Contact';
    }

    DefineAccessoryVariable() {
        this.mainCharac = this.Characteristic.CurrentPosition;
        this.secondCharac = this.Characteristic.TargetPosition;
        this.ActiveValue = 100;
        this.InactiveValue = 0;
        this.ActiveStr = 'open';
        this.InactiveStr = 'closed';
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .removeListener('get', this.getCurrentState);
    }
}

class RiscoCPCWindow extends RiscoCPBaseDetectors {
    constructor(log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.Window, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Window Contact';
    }

    DefineAccessoryVariable() {
        this.mainCharac = this.Characteristic.CurrentPosition;
        this.secondCharac = this.Characteristic.TargetPosition;
        this.ActiveValue = 100;
        this.InactiveValue = 0;
        this.ActiveStr = 'open';
        this.InactiveStr = 'closed';
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .removeListener('get', this.getCurrentState);
    }
}

class RiscoCPCContactSensor extends RiscoCPBaseDetectors {
    constructor(log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.ContactSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.ContactSensorState)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Contact Sensor';
    }

    DefineAccessoryVariable() {
        this.mainCharac = this.Characteristic.ContactSensorState;
        this.ActiveValue = true;
        this.InactiveValue = false;
        this.ActiveStr = 'Active';
        this.InactiveStr = 'Inactive';
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.ContactSensorState)
            .removeListener('get', this.getCurrentState);
    }
}

class RiscoCPCVibrateSensor extends RiscoCPBaseDetectors {
    constructor(log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.MotionSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.MotionDetected)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Vibrate Sensor';
    }

    DefineAccessoryVariable() {
        this.mainCharac = this.Characteristic.MotionDetected;
        this.ActiveValue = true;
        this.InactiveValue = false;
        this.ActiveStr = 'Active';
        this.InactiveStr = 'Inactive';
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.MotionDetected)
            .removeListener('get', this.getCurrentState);
    }
}

class RiscoCPCSmokeSensor extends RiscoCPBaseDetectors {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.SmokeSensor, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.SmokeDetected)
            .on('get', this.getCurrentState.bind(this));
        this.sPrefix = 'Smoke Sensor';
    }

    DefineAccessoryVariable() {
        this.mainCharac = this.Characteristic.SmokeDetected;
        this.ActiveValue = 1;
        this.InactiveValue = 0;
        this.ActiveStr = 'Active';
        this.InactiveStr = 'Inactive';
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.SmokeDetected)
            .removeListener('get', this.getCurrentState);
    }
}

class RiscoCPCombDevices {
    constructor(log, accConfig, api, accessory) {
        this.log = log;
        this.name = accConfig.context.name;
        this.RiscoSession = accConfig.RiscoSession;
        this.Type = accConfig.context.accessorytype;
        this.RiscoCombinedId = accConfig.context.Id;
        this.RiscoInId = accConfig.context.InId;
        this.RiscoOutId = accConfig.context.OutId;
        this.OpeningMode = 'startstopstart';
        this.Moving = false;
        this.MovingDelai = 20000;
        this.MovingTimeStep = 1000;
        this.MovingTimePosition = 0;
        this.TypePulse = ( () => {
            if (accConfig.context.OutType == 'pulse') {
                return true;
            } else {
                return false;
            }
        })();
        this.polling = accConfig.polling || false;
        this.pollInterval = accConfig.pollInterval || 30000;
        this.accessory = accessory;
        this.api = api;

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        this.SetServicesAccessory();
        this.SetExcludeServicesAccessory();
        this.DefineAccessoryVariable();

        this.CombinedReady = false;
        this.IsPulsed = false;

        // Default Value
        this.log.debug('%s "%s" default State: %s',this.sPrefix, this.name, accConfig.context.State);
        
        this.RiscoCurrentOutState;
        this.RiscoTargetOutState;

        this.RiscoInputState = accConfig.context.State;
        this.RiscoInputBypassState = accConfig.context.Bypassed;
        this.long_event_name = `long_comb_${this.RiscoCombinedId}_${(this.name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`;

        this.PollingLoop();
    }

    PollingLoop() {
        var self = this;
        // set up polling if requested
        if (self.polling) {
            var emitter = new pollingtoevent( (done) => {
                self.getRefreshState( (err, result) => {
                    done(err, result);
                });
            }, {
                longpollEventName: self.long_event_name,
                longpolling: true,
                interval: 1000
            });

            emitter.on(self.long_event_name, (state) => {
                self.log.info('%s "%s" => New state detected: (%s). Notify!', self.sPrefix, self.name, self.GetAccessoryState(state[0], false));
                self.log.info('%s "%s" => New Bypass State detected : (%s). Notify!', self.sPrefix, self.name, ((state[1]) ? 'ByPassed' : 'Not ByPassed'));
                self.ReportAccessoryState(state);
            });

            emitter.on('err', (err) => {
                self.log.error('Polling failed, error was %s', err);
            });

            self.api.once('shutdown', () => {
                self.log.debug('Remove All Listeners for %s', self.name);
                emitter.removeAllListeners();
            });
        }
    }

    SetExcludeServicesAccessory() {
        var self = this;
        self.log.debug('Adding Exclude Switch to %s', this.name);
        this.ExcludeService = this.accessory.getService(this.Service.Switch, this.accessory.displayName);
        this.ExcludeService
            .getCharacteristic(this.Characteristic.On)
            .on('get', this.getCurrentExcludeState.bind(this))
            .on('set', this.setCurrentExcludeState.bind(this));
    }

    removeExcludeListeners() {
         this.ExcludeService
            .getCharacteristic(this.Characteristic.On)
            .removeListener('get', this.getCurrentExcludeState)
            .removeListener('set', this.setCurrentExcludeState);
    }

    async getRefreshState(callback) {
        var self = this;
        try {
            var Datas = [];
            var ItemStates;
            if (!(self.Moving)) {
                if (self.RiscoCurrentOutState != self.RiscoTargetOutState) {
                    if ((self.RiscoCurrentOutState == self.ClosingValue) && (!(self.RiscoInputState))) {
                        self.RiscoCurrentOutState = self.ClosedStateValue;
                    } else if ((self.RiscoCurrentOutState == self.OpeningValue) && (self.RiscoInputState)) {
                        self.RiscoCurrentOutState = self.OpenStateValue;
                    } else {
                        self.RiscoCurrentOutState = self.StoppedValue;
                    }
                }
            }
            for (var Detector in self.RiscoSession.DiscoveredAccessories.Detectors) {
                Datas.push(self.RiscoSession.DiscoveredAccessories.Detectors[Detector]);
            }
            ItemStates = Datas.filter(detectors => (detectors.Id == (self.RiscoInId | '')));

            if (ItemStates.length != 0) {
                self.RiscoInputState = ItemStates[0].State;
                self.RiscoInputBypassState = ItemStates[0].Bypassed;
                self.ReportAccessoryState();
                self.CombinedReady = true;
                callback(null, [self.RiscoInputState, self.RiscoInputBypassState]);
                return;
            } else {
                throw new Error(`Error on ${self.sPrefix} RefreshState!!!`);
            }
        } catch (err) {
            self.log.error('Error on RiscoCPCombDevices/getRefreshState:\n%s', err);
            self.DetectorReady = true;
            callback(null, [self.RiscoInputState, self.RiscoInputBypassState]);
            return;
        }
    }

    async getCurrentState(callback) {
        var self = this;
        try {
            if (self.polling) {
                self.log.debug('%s "%s" MotionDetected: %s', self.sPrefix, self.name, self.GetAccessoryState(self.RiscoInputState, false));
                callback(null, self.RiscoInputState);
                return;
            } else {
                self.log.info('%s "%s" => Getting current state - delayed...', self.sPrefix, self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition( () => {
                        return (self.RiscoInputState ? true : false);
                    })
                    .done(async (result) => {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        self.log.debug('%s "%s" => Actual Motion state is: (%s)', self.sPrefix, self.name, self.GetAccessoryState(self.RiscoInputState, false));
                        self.CombinedReady = true;
                        self.ReportAccessoryState();
                        return
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPCombDevices/getCurrentState:\n%s', err);
            self.ReportAccessoryState();
            callback(null, self.RiscoInputState);
            return;
        }
    }

    async setTargetState(state, callback) {
        var self = this;
        try {
            if (self.ServiceMain != self.Service.GarageDoorOpener) {
                if (state <= self.TargetOpenStateValue) {
                    state = self.ClosedStateValue;
                } else {
                    state = self.OpenStateValue;
                }
            } else {
                if (state <= self.TargetOpenStateValue) {
                    state = self.OpenStateValue;
                } else {
                    state = self.ClosedStateValue;
                }
            }
            self.log.debug('Set %s to: %s with value: %s', self.sPrefix, ((state == self.ClosedStateValue) ? 'closed' : 'opened'), state);
            self.RiscoTargetOutState = state;

            const deviceType = ((self.TypePulse) ? 2 : 1 );
            const lastCommand = ((self.TypePulse) ? 1 : ((state) ? 1 : 0 ));
            const deviceId = self.RiscoOutId;
            const HACResp = await self.RiscoSession.OutputCommand(deviceType, lastCommand, deviceId);
            if (HACResp) {
                if (!self.polling) {
                    self.log.info('%s "%s" => Set new state: (%s)', self.sPrefix, self.name, state);
                }
                if (self.TypePulse === false) {
                    self.RiscoTargetOutState = state;
                    self.log.debug('Not Pulsed. %s "%s" => Set new state: (%s)', self.sPrefix, self.name, state);
                } else {
                    if (self.IsPulsed) {
                        self.log.debug('Pulse switch is already pulsed');
                        self.IsPulsed = false;
                    } else {
                        self.log.debug('Pulse switch is not already pulsed');
                        self.IsPulsed = true;
                        setTimeout(self.ResetPulseSwitchState, 500, self);
                        if (self.Moving) {
                            self.Moving = false;
                        } else {
                            self.Moving = true;
                        }
                    }
                }
                setTimeout(self.setCurrentPosition, self.MovingTimeStep, self);
            } else {
                throw new Error('Error on OutputCommand!!!');
            }
            typeof callback === 'function' && callback(null);
            return;
        } catch (err) {
            self.log.error('Error on RiscoCPCombDevices/setTargetState:\n%s', err);
            typeof callback === 'function' && callback(null);
            return;
        }
    }

    setCurrentPosition(self) {
        //Set a fake position
        var self = self;
        const Step = Math.floor(100 / (self.MovingDelai / self.MovingTimeStep));
        if (self.Moving) {
            if (self.ServiceMain != self.Service.GarageDoorOpener) {
                if (self.RiscoTargetOutState == self.ClosedStateValue) {
                    self.RiscoCurrentOutState = self.RiscoCurrentOutState - Step;
                    self.RiscoCurrentOutState = (self.RiscoCurrentOutState <= 0) ? 0 : self.RiscoCurrentOutState;
                } else {
                    self.RiscoCurrentOutState = self.RiscoCurrentOutState + Step;
                    self.RiscoCurrentOutState = (self.RiscoCurrentOutState >= 100) ? 100 : self.RiscoCurrentOutState;
                }
            } else {
                if (self.RiscoTargetOutState == self.ClosedStateValue) {
                    //Closing
                    self.RiscoCurrentOutState = 3;
                } else {
                    //Opening
                    self.RiscoCurrentOutState = 2;
                }
            }
            self.MovingTimePosition = self.MovingTimePosition + self.MovingTimeStep;
            if (self.MovingTimePosition >= self.MovingDelai) {
                self.Moving = false;
                self.MovingTimePosition = 0;
            }
            setTimeout(self.setCurrentPosition, self.MovingTimeStep, self);
        }
        self.mainService.updateCharacteristic(self.CharacCurrentPos, self.RiscoCurrentOutState);
        return;
    }

    GetAccessoryState(state, AsHomeKitValue = true) {
        /*
        Adapt the status of the accessory according to the response expected by Homekit according to the type of accessory
        */
        var self = this;
        if (AsHomeKitValue) {
            return ((state) ? self.ClosedStateValue : self.OpenStateValue);
        } else {
            return ((state) ? self.OpenStateStr : self.ClosedStateStr);
        }
    }

    async getTargetState(callback) {
        var self = this;
        callback(null, self.RiscoTargetOutState);
    }

    async getCurrentExcludeState(callback) {
        var self = this;
        try {
            if (self.polling) {
                self.log.debug('%s "%s" Exclude State : (%s) => %s', self.sPrefix, self.name, self.RiscoInputBypassState, ((self.RiscoInputBypassState) ? 'Bypassed': 'Not Bypassed'));
                callback(null, (self.RiscoInputBypassState)?false : true);
                return;
            } else {
                self.log.info('%s "%s" => Getting current state - delayed...', self.sPrefix, self.name);
                waitUntil()
                    .interval(500)
                    .times(15)
                    .condition( () => {
                        return (self.RiscoInputBypassState)?false : true;
                    })
                    .done(async function (result) {
                        await self.RiscoSession.getCPStates();
                        await self.getRefreshState(callback);
                        self.log.debug('%s "%s" => Actual Exclude State is: %s', self.sPrefix, self.name, ((self.RiscoInputBypassState) ? 'Bypassed': 'Not Bypassed'));
                        self.CombinedReady = true;
                        return;
                    });
            }
        } catch (err) {
            self.log.error('Error on RiscoCPBaseDetectors/getCurrentExcludeState:\n%s', err);
            callback(err, (self.RiscoInputBypassState)?false : true);
            return;
        }
    }

    async setCurrentExcludeState(state, callback) {
        var self = this;
        try {
            if (self.DetectorReady) {
                const PartId = self.RiscoSession.DiscoveredAccessories.Combineds[self.RiscoCombinedId].Partition;
                const PartStatus = self.RiscoSession.DiscoveredAccessories.Partitions[PartId].actualState
                var SBpResp;
                if (PartStatus != 'disarmed') {
                    self.log.info('Cannot Modify Exclude State of Sensor from Armed Partition');
                    typeof callback === 'function' && callback('Cannot Modify Exclude State of Sensor from Armed Partition', 'Cannot Modify Exclude State of Sensor from Armed Partition');
                    self.ExcludeService.updateCharacteristic(self.Characteristic.On, (self.RiscoInputBypassState)?false : true);
                    return;
                }
                state = ((state) ? false : true);
                self.log.debug('Set Exclude State of %s "%s" to: %s', self.sPrefix, self.name, ((state) ? 'Bypassed': 'Not Bypassed'));
                self.log.debug('%s Actual State: %s', self.name, ((self.RiscoInputBypassState) ? 'Bypassed': 'Not Bypassed'));
                self.log.debug('%s New State: %s', self.name, ((state) ? 'Bypassed': 'Not Bypassed'));
                if (self.RiscoInputBypassState == state) {
                    SBpResp = true;
                    self.log.debug('%s Identical State', self.name);
                } else {
                    SBpResp = await self.RiscoSession.SetBypass(state, self.RiscoInId);
                    self.log.debug('%s Different State', self.name);
                }

                if (SBpResp) {
                    if (!self.polling) {
                        self.log.info('%s "%s" => Set new Bypass state: (%s)', self.sPrefix, self.name, state);
                    }
                    typeof callback === 'function' && callback(null);
                } else {
                    self.log.error('Error on SetBypass!!!');
                    typeof callback === 'function' && callback('Error on SetBypass!!!');
                }
                return;
            }
        } catch (err) {
            self.log.error('Error on RiscoCPBaseDetectors/setCurrentExcludeState:\n%s', err);
            self.ExcludeService.updateCharacteristic(self.Characteristic.On, (self.RiscoInputBypassState)?false : true);
            callback(err);
            return;
        }
    }

    async ResetPulseSwitchState(self) {
        var self = self;
        self.log.debug('Reset Pulse Switch State to %s', self.RiscoOutState);
        self.IsPulsed = false;
    }

    ReportAccessoryState(state = null) {
        var self = this;
        if (state != null) {
            self.RiscoInputState = state[0];
            self.RiscoInputBypassState = state[1];
        }
        try {
            if ((self.RiscoInputState) && (!(self.Moving))) {
                self.RiscoCurrentOutState = self.OpenStateValue;
            } else {
                self.RiscoCurrentOutState = self.ClosedStateValue;
            }
            if (!(self.CombinedReady)){
                self.RiscoTargetOutState = self.RiscoCurrentOutState;
            }
            self.mainService.updateCharacteristic(self.CharacCurrentPos, self.RiscoCurrentOutState);
            self.mainService.updateCharacteristic(self.CharacTargetPos, self.RiscoTargetOutState);
            self.ExcludeService.updateCharacteristic(self.Characteristic.On, (self.RiscoInputBypassState) ? false : true);
            return;
        } catch (err) {
            self.log.error('Error on RiscoCPCDoor/ReportAccessoryState:\n%s', err);
            return;
        }
    }
}

class RiscoCPCombDoor extends RiscoCPCombDevices {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.Door, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .on('get', this.getCurrentState.bind(this));
        this.mainService
            .getCharacteristic(this.Characteristic.TargetPosition)
            .on('get', this.getTargetState.bind(this))
            .on('set', this.setTargetState.bind(this));
        this.sPrefix = 'Door Opener';
    }

    DefineAccessoryVariable() {
        this.TargetOpenStateValue = 30;
        this.OpenStateValue = 100;
        this.ClosedStateValue = 0;
        this.OpenStateStr = 'open';
        this.ClosedStateStr = 'closed';
        this.ServiceMain = this.Service.Door;
        this.CharacCurrentPos = this.Characteristic.CurrentPosition;
        this.CharacTargetPos = this.Characteristic.TargetPosition;
        this.OpeningValue = 60;
        this.ClosingValue = 40;
        this.StoppedValue = 50;
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .removeListener('get', this.getCurrentState);
        this.mainService
            .getCharacteristic(this.Characteristic.TargetPosition)
            .removeListener('get', this.getTargetState)
            .removeListener('set', this.setTargetState);
    }
}

class RiscoCPCombWindow extends RiscoCPCombDevices {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.Window, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .on('get', this.getCurrentState.bind(this));
        this.mainService
            .getCharacteristic(this.Characteristic.TargetPosition)
            .on('get', this.getTargetState.bind(this))
            .on('set', this.setTargetState.bind(this));
        this.sPrefix = 'Window Opener';
    }

    DefineAccessoryVariable() {
        this.TargetOpenStateValue = 30;
        this.OpenStateValue = 100;
        this.ClosedStateValue = 0;
        this.OpenStateStr = 'open';
        this.ClosedStateStr = 'closed';
        this.ServiceMain = this.Service.Window;
        this.CharacCurrentPos = this.Characteristic.CurrentPosition;
        this.CharacTargetPos = this.Characteristic.TargetPosition;
        this.OpeningValue = 60;
        this.ClosingValue = 40;
        this.StoppedValue = 50;
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .removeListener('get', this.getCurrentState);
        this.mainService
            .getCharacteristic(this.Characteristic.TargetPosition)
            .removeListener('get', this.getTargetState)
            .removeListener('set', this.setTargetState);
    }
}

class RiscoCPCombGarageDoor extends RiscoCPCombDevices {
    constructor (log, accConfig, api, accessory) {
        super(log, accConfig, api, accessory);
    }

    SetServicesAccessory() {
        this.mainService = this.accessory.getService(this.Service.GarageDoorOpener, this.accessory.displayName);
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentDoorState)
            .on('get', this.getCurrentState.bind(this));
        this.mainService
            .getCharacteristic(this.Characteristic.TargetDoorState)
            .on('get', this.getTargetState.bind(this))
            .on('set', this.setTargetState.bind(this));
        this.sPrefix = 'Garage Door Opener';
    }

    DefineAccessoryVariable() {
        this.TargetOpenStateValue = 0;
        this.OpenStateValue = 0;
        this.ClosedStateValue = 1;
        this.OpenStateStr = 'open';
        this.ClosedStateStr = 'closed';
        this.ServiceMain = this.Service.GarageDoorOpener;
        this.CharacCurrentPos = this.Characteristic.CurrentDoorState;
        this.CharacTargetPos = this.Characteristic.TargetDoorState;
        this.OpeningValue = 2;
        this.ClosingValue = 3;
        this.StoppedValue = 4;
    }

    removemainListeners() {
        this.mainService
            .getCharacteristic(this.Characteristic.CurrentDoorState)
            .removeListener('get', this.getCurrentState);
        this.mainService(this.Characteristic.TargetDoorState)
            .removeListener('get', this.getTargetState)
            .removeListener('set', this.setTargetState);
    }
}

module.exports = {
    RiscoCPPartitions: RiscoCPPartitions,
    RiscoCPGroups: RiscoCPGroups,
    RiscoCPOutputs: RiscoCPOutputs,
    RiscoCPDetectors: RiscoCPDetectors,
    RiscoCPCombDevices: RiscoCPCombDevices,
    RiscoCPCDoor: RiscoCPCDoor,
    RiscoCPCWindow: RiscoCPCWindow,
    RiscoCPCContactSensor: RiscoCPCContactSensor,
    RiscoCPCVibrateSensor: RiscoCPCVibrateSensor,
    RiscoCPCSmokeSensor: RiscoCPCSmokeSensor,
    RiscoCPCombDoor: RiscoCPCombDoor,
    RiscoCPCombWindow: RiscoCPCombWindow,
    RiscoCPCombGarageDoor: RiscoCPCombGarageDoor
}