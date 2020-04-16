'use strict';
var pollingtoevent = require('polling-to-event');

var risco = require('./risco');
var riscoAccessory = require('./RiscoAccessories');

var Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
    global.homebridge = homebridge;
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    homebridge.registerPlatform('homebridge-risco-alarm', 'RiscoAlarm', RiscoPanelPlatform);
}

function RiscoPanelPlatform(log, config, api) {
    this.log = log;
    var self = this;
    this.config = config;

    this.RiscoPanel = new risco.RiscoPanelSession(this.config, this.log);
}

RiscoPanelPlatform.prototype = {
    async accessories(callback) {
        var self = this;
        self.log.info('Accessories Init Phase Started');
        try{
            self.log.info('Discovering Phase Started');
            var DiscoveredAccessories = {};
            try{
                if ((self.config['Partition'] || 'none') != 'none') {
                    self.log.debug('Discovering Partitions');
                    DiscoveredAccessories.partitions = await self.RiscoPanel.DiscoverParts();
                }
                if ((self.config['Groups'] || 'none') != 'none') {
                    self.log.debug('Discovering Groups');
                    DiscoveredAccessories.Groups = await self.RiscoPanel.DiscoverGroups();
                }
                if ((self.config['Outputs'] || 'none') != 'none') {
                    self.log.debug('Discovering Outputs');
                    DiscoveredAccessories.Outputs = await self.RiscoPanel.DiscoverOutputs();
                }
                if ((self.config['Detectors'] || 'none') != 'none') {
                    self.log.debug('Discovering Detectors');
                    DiscoveredAccessories.Detectors = await self.RiscoPanel.DiscoverDetectors();
                }
                if ((self.config['Cameras'] || 'none') != 'none') {
                    self.log.debug('Discovering Cameras');
                    DiscoveredAccessories.Cameras = await self.RiscoPanel.DiscoverCameras();
                }
                //fallback to system mode if no DiscoveredAccessories
                if (Object.keys(DiscoveredAccessories).length == 0 ){
                    self.log.debug('Fallback to system mode');
                    this.config['Partition'] = 'system';
                    DiscoveredAccessories.partitions = await self.RiscoPanel.DiscoverParts();   
                }
                self.log.debug(DiscoveredAccessories);
            } catch (err){
                self.log.error('Error on Discovery Phase : ' + err);
            }

            self.log.info('Discovering Phase Ended');
            self.RiscoPanel.DiscoveredAccessories = DiscoveredAccessories;
            self.log.info('AddAccessory Phase Started');
            var Devices = [];
            for (var DeviceFamily in DiscoveredAccessories){
                switch (DeviceFamily){
                    case 'partitions':
                        if ( DiscoveredAccessories.partitions.type == 'system'){
                            self.log.info('Add Accessory => Configuration for System : ' + DiscoveredAccessories.partitions[0].name);
                            var PartConfig = {
                                config: DiscoveredAccessories.partitions[0],
                                RiscoSession: self.RiscoPanel,
                                accessorytype: 'system',
                                polling: self.config['polling'],
                                pollInterval: self.config['pollInterval']
                            };
                            Devices.push(PartConfig);
                        } else {
                            for (var PartsId in DiscoveredAccessories.partitions) {
                                if (PartsId != 'type'){
                                    if (DiscoveredAccessories.partitions[PartsId].Required == true ) {
                                        self.log.info('Add Accessory => Configuration for Partitions Id : ' + DiscoveredAccessories.partitions[PartsId].id + ' and labeled "' + DiscoveredAccessories.partitions[PartsId].name +'"');
                                        var PartConfig = {
                                            config: DiscoveredAccessories.partitions[PartsId],
                                            RiscoSession: self.RiscoPanel,
                                            accessorytype: 'partition',
                                            polling: self.config['polling'],
                                            pollInterval: self.config['pollInterval']
                                        };
                                        Devices.push(PartConfig);
                                    }
                                }
                            }
                        }
                        break;
                    case 'Groups':
                        for (var GroupsId in DiscoveredAccessories.Groups) {
                            if (GroupsId != 'type'){
                                if (DiscoveredAccessories.Groups[GroupsId].Required == true ) {
                                    self.log.info('Add Accessory => Configuration for Groups Id : ' + DiscoveredAccessories.Groups[GroupsId].id + ' and labeled "' + DiscoveredAccessories.Groups[GroupsId].name + '"');
                                    var GroupConfig = {
                                        config: DiscoveredAccessories.Groups[GroupsId],
                                        RiscoSession: self.RiscoPanel,
                                        accessorytype: 'group',
                                        polling: self.config['polling'],
                                        pollInterval: self.config['pollInterval']
                                    };
                                    Devices.push(GroupConfig);
                                }
                            }
                        }
                        break;
                    case 'Outputs':
                        for (var OutputId in DiscoveredAccessories.Outputs) {
                            if (DiscoveredAccessories.Outputs[OutputId].Required == true ) {
                                self.log.info('Add Accessory => Configuration for Outputs Id : ' + DiscoveredAccessories.Outputs[OutputId].Id + ' and labeled "' + DiscoveredAccessories.Outputs[OutputId].name + '"');
                                var OutputConfig = {
                                    config: DiscoveredAccessories.Outputs[OutputId],
                                    RiscoSession: self.RiscoPanel,
                                    accessorytype: 'output',
                                    polling: self.config['polling'],
                                    pollInterval: self.config['pollInterval']
                                };
                                Devices.push(OutputConfig);
                            }
                        }
                        break;
                    case 'Detectors':
                        for (var DetectorId in DiscoveredAccessories.Detectors) {
                            if (DiscoveredAccessories.Detectors[DetectorId].Required == true ) {
                                self.log.info('Add Accessory => Configuration for Detectors Id : ' + DiscoveredAccessories.Detectors[DetectorId].Id + ' and labeled "' + DiscoveredAccessories.Detectors[DetectorId].name + '"');
                                var DetectorConfig = {
                                    config: DiscoveredAccessories.Detectors[DetectorId],
                                    RiscoSession: self.RiscoPanel,
                                    accessorytype: 'detector',
                                    polling: self.config['polling'],
                                    pollInterval: self.config['pollInterval']
                                };
                                Devices.push(DetectorConfig);
                            }
                        }
                        break;
                };
            }
        } catch (err){
            self.log.error('Error on AddAccessory Phase : ' + err);
        }            
        self.log.info('AddAccessory Phase Ended');
        self.log.info('Create Accessory Phase Started');
        self.log.debug('Devices: ' + JSON.stringify(Devices));
        try{
            const foundAccessories = (function(){
                var AllAccessories = [];
                Array.prototype.push.apply(AllAccessories, Devices.filter(device => device.accessorytype.toLowerCase() == 'partition')
                    .map(device => (function(){
                    self.log.debug('Create Accessory for device:', device);
                    return new riscoAccessory.RiscoCPPartitions(self.log, device, global.homebridge);
                })()));
                Array.prototype.push.apply(AllAccessories, Devices.filter(device => device.accessorytype.toLowerCase() == 'group')
                    .map(device => (function(){
                    self.log.debug('Create Accessory for device:', device);
                    return new riscoAccessory.RiscoCPGroups(self.log, device, global.homebridge);
                })()));
                Array.prototype.push.apply(AllAccessories, Devices.filter(device => device.accessorytype.toLowerCase() == 'output')
                    .map(device => (function(){
                    self.log.debug('Create Accessory for device:', device);
                    return new riscoAccessory.RiscoCPOutputs(self.log, device, global.homebridge);
                })()));
                Array.prototype.push.apply(AllAccessories, Devices.filter(device => device.accessorytype.toLowerCase() == 'detector')
                    .map(device => (function(){
                    self.log.debug('Create Accessory for device:', device);
                    return new riscoAccessory.RiscoCPDetectors(self.log, device, global.homebridge);
                })()));
                return AllAccessories;
            })();
            self.log.info('Create Accessory Phase Ended');
            self.RiscoPanel.Ready = true;
            callback(foundAccessories);
        } catch (err){
            self.log.error('Error on Create Accessory Phase : ' + err);
        }            
        self.log.info('Accessories Init Phase Started');
    }
}
