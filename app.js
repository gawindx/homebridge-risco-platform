'use strict';
//const fs = require('fs');

const risco = require('./Risco');
const riscoAccessory = require('./RiscoAccessories');

var pjson = require('./package.json');
let Manufacturer = 'Gawindx';
const pluginName = 'homebridge-risco-platform';
const platformName = 'RiscoAlarm';

let hap;
let Service, Characteristic, UUIDGen;

class RiscoPanelPlatform {
    constructor(log, config, api) {
        //Types of Custom
        this.Custom_Types = ['Detector', 'Door', 'Window', 'Contact Sensor'];
        //Service Associated to Custom Types
        this.Custom_Types_Services = {
            'Detector': Service.MotionSensor,
            'Door': Service.Door,
            'Window': Service.Window,
            'Contact Sensor': Service.ContactSensor
        };
        //Classes Associated to Custom Types
        this.Custom_Types_Classes = {
            'Detector': 'RiscoCPDetectors',
            'Door': 'RiscoCPCDoor',
            'Window': 'RiscoCPCWindow',
            'Contact Sensor': 'RiscoCPCContactSensor'
        }

        this.accessories = [];
        this.log = log;
        this.config = config;
        this.api = api;
        this.DiscoveredAccessories = {};
        this.Devices = [];
        this.DiscoveryFinished = false;
        this.hasCachedAccessory = false;

        if (!api || !config) return;

        if(!config.riscoUsername || !config.riscoPassword || !config.riscoSiteId || !config.riscoPIN) {
            this.log.error('Insufficient credentials in config.json!');
            return;
        }

        this.RiscoPanel = new risco.RiscoPanelSession(this.config, this.log);

        this.log.info('RiscoPanelPlatform finished initializing!');

        //Monitor Change on Config File (future usage)
        //MAke Accessory more dynamic without reload homebridge
        /*fs.watchFile(api.user.configPath(), (curr, prev) => {
            if (curr.mtime !== prev.mtime) {
                this.log.debug("Configuration File Modified");
            }
        });*/

        api.on("didFinishLaunching", () => {
            this.log.info('RiscoPanelPlatform Initial Discovery Phase');
            setTimeout( async () => {
                this.log.info('Accessories Init Phase Started');
                await this.DiscoverAccessoriesFromRiscoCloud();
                this.log.debug("Discovered Accessories : \n" + JSON.stringify(this.DiscoveredAccessories));
                this.log.info('PreConf Phase Started');
                try{
                    for (var DeviceFamily in this.DiscoveredAccessories) {
                        this.PreConfigureAccessories(DeviceFamily);
                    }
                    this.DiscoveryFinished = true;
                } catch (err){
                    this.log.error('Error on PreConf Phase : ' + err);
                }
                this.log.debug('PreConfigured Accessories : \n' + JSON.stringify(this.DiscoveredAccessories));
                this.log.info('PreConf Phase Ended');
                this.log.info('Create Accessory Phase Started');
                this.log.debug('Devices: ' + JSON.stringify(this.Devices));
                try{
                    if(this.hasCachedAccessory){
                        await new Promise(r => setTimeout(r, 5000));
                    }
                    for (var DiscoveredAcc in this.Devices) {
                        this.addAccessory(this.Devices[DiscoveredAcc]);
                    }
                } catch (err){
                    this.log.error('Error on Create Accessory Phase : ' + err);
                }
                this.RiscoPanel.Ready = true;
                this.log.info('Accessories Init Phase Ended');

                //prune Unused accessories
                for (const accessory of this.accessories) {
                    if ((accessory.context.todelete !== undefined) && (accessory.context.todelete === true)){
                        this._removeAccessory(accessory);                        
                    }
                }
            }, 5000);
        });
    }

    configureAccessory(accessory) {
        var self = this;
        this.hasCachedAccessory = true;
        accessory.on("identify", () => {
            this.log.debug("%s identified!", accessory.displayName);
        });
        if(this.DiscoveryFinished) {
            var KeepAccessory = false;
            this.log.info("Restoring or Set Removing accessory %s", accessory.displayName);
            //var acc_index = this.accessories.push(accessory);
            this.Devices.filter(new_device => (new_device.context.longName == accessory.context.longName) && (new_device.context.Required == true))
                .map(new_device => (function () {
                    self.log.debug("Device to reconfigure : \n%s",JSON.stringify(new_device));
                    accessory = self._addOrConfigure(accessory, new_device, accessory.context.accessorytype, false);
                    self.api.updatePlatformAccessories([accessory]);
                    KeepAccessory = true;
                })());
            this.accessories.push(accessory);
            //set Old accessory to delete
            if (!(KeepAccessory)) {
                this.log.debug("Set to Remove accessory %s", accessory.displayName);
                accessory.context.todelete = true;
            }
        } else {
            setTimeout(this.configureAccessory.bind(this, accessory), 1000);
        }
    }

    addAccessory(DiscoveredAcc) {
        let uuid = UUIDGen.generate(DiscoveredAcc.context.longName);
        let accessory = new this.api.platformAccessory(DiscoveredAcc.context.name, uuid);
        accessory.context = DiscoveredAcc.context;

        if ((this.accessories.filter(device => (device.UUID == uuid))).length == 0) {
            this.log.debug("PreConfigured Accessories To configure : \n" + JSON.stringify(DiscoveredAcc));
            this.log.info("Adding new accessory with Name: %s, Id: %s, type: %s", DiscoveredAcc.context.name, DiscoveredAcc.context.Id, DiscoveredAcc.context.accessorytype);
            accessory = this._addOrConfigure(accessory, DiscoveredAcc, DiscoveredAcc.context.accessorytype, true);
            this.accessories.push(accessory);
            this.api.registerPlatformAccessories(pluginName, platformName, [accessory]);
        }
    }

    _addOrConfigure(accessory, object, type, add) {
        if (type !== object.context.accessorytype) {
            var self = this;
            this.log.debug('Accessory : %s Modified Since Last Run', object.context.name)
            //this.log.debug('old type: ', type);
            //this.log.debug('new type: ', object.context.accessorytype);
            add = true;
            //Delete all service for this accessory also for accery in cache
            this.log.debug('nb services before :' + accessory.services.length);
            accessory.removeService(this.Custom_Types_Services[type]);
            this.log.debug('nb services after :' + accessory.services.length);
            accessory.services = [];
            var self = this;
            this.accessories.filter(mod_acc => mod_acc.UUID === accessory.UUID).map( mod_acc => (function () {
                //self.log.debug('reconf nb services before: ' + mod_acc.services.length);
                mod_acc.services = [];
                //self.log.debug('reconf nb services after: ' + mod_acc.services.length);
            })());
            //this.log.debug('update');
            this.api.updatePlatformAccessories([accessory]);
            accessory.context.accessorytype = type = object.context.accessorytype;
        }
        if(add) {
            this.log.debug('AddOrConfigure Accessory : %s', object.context.name);
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Name, object.context.name)
                .setCharacteristic(Characteristic.Identify, object.context.name)
                .setCharacteristic(Characteristic.Manufacturer, Manufacturer)
                .setCharacteristic(Characteristic.Model, object.context.longName)
                .setCharacteristic(Characteristic.SerialNumber, pjson.version)
                .setCharacteristic(Characteristic.FirmwareRevision, pjson.version);
        }
        switch(type) {
            case 'System':
            case 'Partitions':
                if(add) {
                    accessory.addService(Service.SecuritySystem, accessory.context.name);
                }else{
                    this.log.info('Configuring accessory ' + accessory.displayName);
                }
                new riscoAccessory.RiscoCPPartitions(this.log, object, this.api, accessory);
                break;
            case 'Groups':
                if(add) {
                    accessory.addService(Service.SecuritySystem, accessory.context.name);
                }else{
                    this.log.info('Configuring accessory ' + accessory.context.longName + '_' + type);
                }
                new riscoAccessory.RiscoCPGroups(this.log, object, this.api, accessory);
                break;
            case 'Outputs':
                if(add) {
                    accessory.addService(Service.Switch, accessory.context.name);
                }else{
                    this.log.info('Configuring accessory ' + accessory.context.longName + '_' + type);
                }
                new riscoAccessory.RiscoCPOutputs(this.log, object, this.api, accessory);
                break;
            default:
                if (this.Custom_Types.includes(type)) {
                    if(add) {
                        this.log.info('Add or Modifying accessory ' + accessory.displayName);
                        //if (!(accessory.services.includes(this.Custom_Types_Services[type]))) {
                            this.log.info("Add Service" + this.Custom_Types_Services[type]);
                            accessory.addService(this.Custom_Types_Services[type], accessory.context.name);
                        //}
                    }else{
                        this.log.info('Configuring accessory ' + accessory.displayName);
                    }
                    this.log.debug('Type of accessory : %s', type);
                    new riscoAccessory[this.Custom_Types_Classes[type]](this.log, object, this.api, accessory);
                }
                break;
        }
        return accessory;
    }

    _removeAccessory(accessory) {
        this.log.info("Removing accessory %s", accessory.displayName);
        this.api.unregisterPlatformAccessories(pluginName, platformName, [accessory]);
    }

    async DiscoverAccessoriesFromRiscoCloud() {
        this.log.info('Discovering Phase Started');
        try{
            if ((this.config['Partition'] || 'none') != 'none') {
                this.log.debug('Discovering Partitions');
                this.DiscoveredAccessories.Partitions = await this.RiscoPanel.DiscoverParts();
            }
            if ((this.config['Groups'] || 'none') != 'none') {
                this.log.debug('Discovering Groups');
                this.DiscoveredAccessories.Groups = await this.RiscoPanel.DiscoverGroups();
            }
            if ((this.config['Outputs'] || 'none') != 'none') {
                this.log.debug('Discovering Outputs');
                this.DiscoveredAccessories.Outputs = await this.RiscoPanel.DiscoverOutputs();
            }
            if ((this.config['Detectors'] || 'none') != 'none') {
                this.log.debug('Discovering Detectors');
                this.DiscoveredAccessories.Detectors = await this.RiscoPanel.DiscoverDetectors();
            }
            if ((this.config['Cameras'] || 'none') != 'none') {
                this.log.debug('Discovering Cameras');
                this.DiscoveredAccessories.Cameras = await this.RiscoPanel.DiscoverCameras();
            }
            //fallback to system mode if no DiscoveredAccessories
            if (Object.keys(this.DiscoveredAccessories).length == 0 ){
                this.log.debug('Fallback to system mode');
                this.config['Partition'] = 'system';
                this.DiscoveredAccessories.partitions = await this.RiscoPanel.DiscoverParts();   
            }
            if ((this.config['Custom'] || 'none') != 'none') {
                this.log.info('Apply Custom Configuration');
                for (var Custom_Type in this.Custom_Types){
                    this.log('Modify Detectors to ' + this.Custom_Types[Custom_Type]);
                    if ((this.config['Custom'][this.Custom_Types[Custom_Type]] || 'none') != 'none') {
                        if (this.config['Custom'][this.Custom_Types[Custom_Type]] == 'all'){
                            for (var Detector in this.DiscoveredAccessories.Detectors){
                                this.DiscoveredAccessories.Detectors[Detector].accessorytype = this.Custom_Types[Custom_Type];
                            }
                        } else if (this.config['Custom'][this.Custom_Types[Custom_Type]] != (this.config['Custom'][this.Custom_Types[Custom_Type]].split(',')) || ( parseInt(this.config['Custom'][this.Custom_Types[Custom_Type]]) != NaN )){
                            const Modified_Detectors = this.config['Custom'][this.Custom_Types[Custom_Type]].split(',').map(function(item) {
                                return parseInt(item, 10);
                            });
                            this.log.debug('Modified Detectors' + JSON.stringify(Modified_Detectors));
                            for (var Id_Detector in Modified_Detectors){
                                this.log.debug('Detector Name/Id: ' + this.DiscoveredAccessories.Detectors[Modified_Detectors[Id_Detector]].name + '/' + this.DiscoveredAccessories.Detectors[Modified_Detectors[Id_Detector]].Id + ' Modified to ' + this.Custom_Types[Custom_Type]);
                                this.DiscoveredAccessories.Detectors[Modified_Detectors[Id_Detector]].accessorytype = this.Custom_Types[Custom_Type];
                            }
                        }
                    }
                }
            }
            this.RiscoPanel.DiscoveredAccessories = this.DiscoveredAccessories;
            this.log.info('Discovering Phase Ended');
            return Promise.resolve();
        } catch (err){
            this.log.error('Error on Discovery Phase : ' + err);
            this.RiscoPanel.DiscoveredAccessories = this.DiscoveredAccessories;
            this.log.info('Discovering Phase Ended');
            return Promise.reject();
        }
    }

    PreConfigureAccessories(DeviceFamily) {
        switch (DeviceFamily) {
            case 'Partitions':
                this.log.info('PreConf Accessory => Add Partitions');
                if ( this.DiscoveredAccessories.Partitions.type == 'system') {
                    this.log.info('PreConf Accessory => Configuration for System : ' + this.DiscoveredAccessories.Partitions[0].name);
                    var PartConfig = {
                        context: this.DiscoveredAccessories.Partitions[0],
                        RiscoSession: this.RiscoPanel,
                        polling: this.config['polling'],
                        pollInterval: this.config['pollInterval']
                    };
                    this.Devices.push(PartConfig);
                } else {
                    for (var PartsId in this.DiscoveredAccessories.Partitions) {
                        if (PartsId != 'type'){
                            if (this.DiscoveredAccessories.Partitions[PartsId].Required == true ) {
                                this.log.info('PreConf Accessory => Configuration for Partitions Id : ' + this.DiscoveredAccessories.Partitions[PartsId].Id + ' and labeled "' + this.DiscoveredAccessories.Partitions[PartsId].name +'"');
                                var PartConfig = {
                                    context: this.DiscoveredAccessories.Partitions[PartsId],
                                    RiscoSession: this.RiscoPanel,
                                    polling: this.config['polling'],
                                    pollInterval: this.config['pollInterval']
                                };
                                this.Devices.push(PartConfig);
                            }
                        }
                    }
                }
                break;
            case 'Groups':
                this.log.info('Add Accessory => Add Groups');
                for (var GroupsId in this.DiscoveredAccessories.Groups) {
                    if (GroupsId != 'type'){
                        if (this.DiscoveredAccessories.Groups[GroupsId].Required == true ) {
                            this.log.info('PreConf Accessory => Configuration for Groups Id : ' + this.DiscoveredAccessories.Groups[GroupsId].Id + ' and labeled "' + this.DiscoveredAccessories.Groups[GroupsId].name + '"');
                            var GroupConfig = {
                                context: this.DiscoveredAccessories.Groups[GroupsId],
                                RiscoSession: this.RiscoPanel,
                                polling: this.config['polling'],
                                pollInterval: this.config['pollInterval']
                            };
                            this.Devices.push(GroupConfig);
                        }
                    }
                }
                break;
            case 'Outputs':
                this.log.info('Add Accessory => Add Outputs');
                for (var OutputId in this.DiscoveredAccessories.Outputs) {
                    if (this.DiscoveredAccessories.Outputs[OutputId].Required == true ) {
                        this.log.info('PreConf Accessory => Configuration for Outputs Id : ' + this.DiscoveredAccessories.Outputs[OutputId].Id + ' and labeled "' + this.DiscoveredAccessories.Outputs[OutputId].name + '"');
                        var OutputConfig = {
                            context: this.DiscoveredAccessories.Outputs[OutputId],
                            RiscoSession: this.RiscoPanel,
                            polling: this.config['polling'],
                            pollInterval: this.config['pollInterval']
                        };
                        this.Devices.push(OutputConfig);
                    }
                }
                break;
            case 'Detectors':
                this.log.info('Add Accessory => Add Detectors');
                for (var DetectorId in this.DiscoveredAccessories.Detectors) {
                    if (this.DiscoveredAccessories.Detectors[DetectorId].Required == true ) {
                        this.log.info('PreConf Accessory => Configuration for Detectors Id : ' + this.DiscoveredAccessories.Detectors[DetectorId].Id + ' and labeled "' + this.DiscoveredAccessories.Detectors[DetectorId].name + '"');
                        var DetectorConfig = {
                            context: this.DiscoveredAccessories.Detectors[DetectorId],
                            RiscoSession: this.RiscoPanel,
                            polling: this.config['polling'],
                            pollInterval: this.config['pollInterval']
                        };
                        this.Devices.push(DetectorConfig);
                    }
                }
                break;
        };
    }
}

module.exports = (api) => {
    hap = api.hap;
    Service = api.hap.Service;
    Characteristic = api.hap.Characteristic;
    UUIDGen = api.hap.uuid;
    api.registerPlatform(pluginName, platformName, RiscoPanelPlatform);
};

