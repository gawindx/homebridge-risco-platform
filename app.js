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
                    DiscoveredAccessories.groups = await self.RiscoPanel.DiscoverGroups();
                }
                if ((self.config['Outputs'] || 'none') != 'none') {
                    self.log.debug('Discovering Outputs');
                    DiscoveredAccessories.outputs = await self.RiscoPanel.DiscoverOutputs();
                }
                if ((self.config['Detectors'] || 'none') != 'none') {
                    self.log.debug('Discovering Detectors');
                    DiscoveredAccessories.detectors = await self.RiscoPanel.DiscoverDetectors();
                }
                if ((self.config['Cameras'] || 'none') != 'none') {
                    self.log.debug('Discovering Cameras');
                    DiscoveredAccessories.Cameras = await self.RiscoPanel.DiscoverCameras();
                }
                //fallback to system mode if no DiscoveredAccessories
                if (Object.keys(DiscoveredAccessories).length == 0 ){
                    self.log.debug('Fallback to system mode ');
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
            //accessorytype can be 'system' if DiscoveredAccessories.partitions.type == 'system'
            if ( DiscoveredAccessories.partitions.type == 'system'){
                self.log.info('Create Accessory for System : ' + DiscoveredAccessories.partitions[0].name);
                var PartConfig = {
                    config: DiscoveredAccessories.partitions[0],
                    RiscoSession: self.RiscoPanel,
                    accessorytype: 'system',
                    polling: self.config["polling"],
                    pollInterval: self.config["pollInterval"]
                };
                Devices.push(PartConfig);
            } else {
                for (var PartsId in DiscoveredAccessories.partitions) {
                    if (PartsId != 'type'){
                        if (DiscoveredAccessories.partitions[PartsId].Required == true ) {
                            self.log.info('Create Accessory for Partitions Id : ' + DiscoveredAccessories.partitions[PartsId].id + ' and labeled ' + DiscoveredAccessories.partitions[PartsId].name);
                            var PartConfig = {
                                config: DiscoveredAccessories.partitions[PartsId],
                                RiscoSession: self.RiscoPanel,
                                accessorytype: 'partition',
                                polling: self.config["polling"],
                                pollInterval: self.config["pollInterval"]
                            };
                            Devices.push(PartConfig);
                        }
                    }
                }
            }
            self.log.debug('Devices: ' + Devices);
            const foundAccessories = (function(){
                var validDevices = Devices.filter(device => device.accessorytype.toLowerCase());
                return validDevices.map(device => (function(){
                    self.log.debug('Create Accessory for device:', device);
                    return new riscoAccessory.RiscoCPPartitions(self.log, device, global.homebridge);
                })());
            })();
            self.RiscoPanel.Ready = true;
            callback(foundAccessories);
        } catch (err){
            self.log.error('Error on AddAccessory Phase : ' + err);
        }
        self.log.info('AddAccessory Phase Ended');
    }
}
