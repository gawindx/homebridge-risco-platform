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
        //Types of Custom Detector
        this.Custom_Types = [   'Detector',
                                'Door',
                                'Window',
                                'Contact Sensor',
                                'Vibrate Sensor',
                                'Smoke Sensor'
                            ];
        //Service Associated to Custom Types
        this.Custom_Types_Services = {
            'Detector': Service.MotionSensor,
            'Door': Service.Door,
            'Window': Service.Window,
            'Contact Sensor': Service.ContactSensor,
            'Vibrate Sensor': Service.MotionSensor,
            'Smoke Sensor': Service.SmokeSensor
        };
        //Classes Associated to Custom Types
        this.Custom_Types_Classes = {
            'Detector': 'RiscoCPDetectors',
            'Door': 'RiscoCPCDoor',
            'Window': 'RiscoCPCWindow',
            'Contact Sensor': 'RiscoCPCContactSensor',
            'Vibrate Sensor': 'RiscoCPCVibrateSensor',
            'Smoke Sensor': 'RiscoCPCSmokeSensor'
        }
        //Types Of Combined Accessoies
        this.Combined_Types = [ 'Combined_GarageDoor',
                                'Combined_Door',
                                'Combined_Window'
                            ];
        //Service Associated to Combined Types
        this.Combined_Types_Services = {
            'Combined_GarageDoor': Service.GarageDoorOpener,
            'Combined_Door': Service.Door,
            'Combined_Window': Service.Window
        };
        //Classes Associated to Combined Types
        this.Combined_Types_Classes = {
            'Combined_GarageDoor': 'RiscoCPCombGarageDoor',
            'Combined_Door': 'RiscoCPCombDoor',
            'Combined_Window': 'RiscoCPCombWindows'
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

        if (!config.riscoUsername || !config.riscoPassword || !config.riscoSiteId || !config.riscoPIN) {
            this.log.error('Insufficient credentials in config.json!');
            return;
        }

        this.RiscoPanel = new risco.RiscoPanelSession(this.config, this.log, this.api);

        this.log.info('RiscoPanelPlatform finished initializing!');

        //Monitor Change on Config File (future usage)
        //MAke Accessory more dynamic without reload homebridge
        /*fs.watchFile(api.user.configPath(), (curr, prev) => {
            if (curr.mtime !== prev.mtime) {
                this.log.debug("Configuration File Modified");
            }
        });*/

        api.on('didFinishLaunching', () => {
            this.log.info('RiscoPanelPlatform Initial Discovery Phase');
            setTimeout( async () => {
                this.log.info('Accessories Init Phase Started');
                await this.DiscoverAccessoriesFromRiscoCloud();
                this.log.debug('Discovered Accessories:\n%s', JSON.stringify(this.DiscoveredAccessories, null, 4));
                this.log.info('PreConf Phase Started');
                try {
                    for (var DeviceFamily in this.DiscoveredAccessories) {
                        this.PreConfigureAccessories(DeviceFamily);
                    }
                    this.DiscoveryFinished = true;
                } catch (err) {
                    this.log.error('Error on PreConf Phase: ' + err);
                }
                this.log.debug('PreConfigured Accessories:\n%s', JSON.stringify(this.DiscoveredAccessories, null, 4));
                this.log.info('PreConf Phase Ended');
                this.log.info('Create Accessory Phase Started');
                this.log.debug('Devices:\n%s', JSON.stringify(this.Devices, null, 4));
                try {
                    if (this.hasCachedAccessory) {
                        await new Promise(r => setTimeout(r, 5000));
                    }
                    for (var DiscoveredAcc in this.Devices) {
                        this.addAccessory(this.Devices[DiscoveredAcc]);
                    }
                } catch (err) {
                    this.log.error('Error on Create Accessory Phase :\n%s' + err);
                }
                this.RiscoPanel.Ready = true;
                this.log.info('Accessories Init Phase Ended');

                //prune Unused accessories
                for (const accessory of this.accessories) {
                    if ((accessory.context.todelete !== undefined) && (accessory.context.todelete === true)) {
                        this._removeAccessory(accessory);                        
                    }
                }
            }, 5000);
        });
    }

    configureAccessory(accessory) {
        var self = this;
        this.hasCachedAccessory = true;
        accessory.on('identify', function accidentify() {
            this.log.debug('%s identified!', accessory.displayName);
            //avoid warning on maxEventListener
            accessory.removeListener('identify', accidentify);
        });
        if (this.DiscoveryFinished) {
            var KeepAccessory = false;
            this.log.info('Restoring or Set Removing accessory %s', accessory.displayName);
            this.Devices.filter(new_device => (new_device.context.longName == accessory.context.longName) && (new_device.context.Required == true))
                .map(new_device => {
                    self.log.debug('Device to reconfigure:\n%s',JSON.stringify(new_device, null, 4));
                    self._addOrConfigure(accessory, new_device, accessory.context.accessorytype, false);
                    KeepAccessory = true;
                });
            this.accessories.push(accessory);
            this.api.updatePlatformAccessories([accessory]);
            if (!(KeepAccessory)) {
                this.log.debug('Set to Remove accessory %s', accessory.displayName);
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
            this.log.debug('PreConfigured Accessories To configure:\n%s', JSON.stringify(DiscoveredAcc, null, 4));
            this.log.info('Adding new accessory with Name: %s, Id: %s, type: %s', DiscoveredAcc.context.name, DiscoveredAcc.context.Id, DiscoveredAcc.context.accessorytype);
            this._addOrConfigure(accessory, DiscoveredAcc, DiscoveredAcc.context.accessorytype, true);
            this.accessories.push(accessory);
            this.api.registerPlatformAccessories(pluginName, platformName, [accessory]);
        }
    }

    _addOrConfigure(accessory, object, type, add) {
        if (type !== object.context.accessorytype) {
            this.log.debug('Accessory: %s Modified Since Last Run', object.context.name)
            add = true;
            accessory.removeService(accessory.getService(this.Custom_Types_Services[type]));
            accessory.context.accessorytype = type = object.context.accessorytype;
        }

        if (add) {
            this.log.debug('AddOrConfigure Accessory: %s', object.context.name);
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Name, object.context.name)
                .setCharacteristic(Characteristic.Identify, object.context.name)
                .setCharacteristic(Characteristic.Manufacturer, Manufacturer)
                .setCharacteristic(Characteristic.Model, object.context.longName)
                .setCharacteristic(Characteristic.SerialNumber, pjson.version)
                .setCharacteristic(Characteristic.FirmwareRevision, pjson.version);
        }

        if ((accessory.getService(Service.AccessoryInformation).getCharacteristic(Characteristic.SerialNumber).value) != pjson.version) {
            //do some stuff on update accessory from older version of plugin
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.SerialNumber, pjson.version)
                .setCharacteristic(Characteristic.FirmwareRevision, pjson.version);
        }

        switch (type) {
            case 'System':
            case 'Partitions':
                if (add) {
                    accessory.addService(Service.SecuritySystem, accessory.context.name);
                    if (object.Occupancy) {
                        accessory.addService(Service.OccupancySensor, `Occupancy ${accessory.displayName}`, `occupancy_${accessory.context.name}`);
                    }
                } else {
                    this.log.info('Configuring accessory %s', accessory.displayName);
                    if (object.Occupancy) {
                        if (accessory.getService(Service.OccupancySensor) == undefined ){
                            this.log.debug('Occupancy Service not already defined on accessory %s', accessory.displayName);
                            accessory.addService(Service.OccupancySensor, `Occupancy ${accessory.displayName}`, `occupancy_${accessory.context.name}`);
                        }
                    } else {
                        if (accessory.getService(Service.OccupancySensor) != undefined ){
                            this.log.debug('Occupancy Service Defined but not needed on accessory %s', accessory.displayName);
                            accessory.removeService(Service.OccupancySensor);
                        }
                    }
                }
                new riscoAccessory.RiscoCPPartitions(this.log, object, this.api, accessory);
                break;
            case 'Groups':
                if (add) {
                    accessory.addService(Service.SecuritySystem, accessory.context.name);
                } else {
                    this.log.info('Configuring accessory %s_%s', accessory.displayName, type);
                }
                new riscoAccessory.RiscoCPGroups(this.log, object, this.api, accessory);
                break;
            case 'Outputs':
                if (add) {
                    accessory.addService(Service.Switch, accessory.context.name);
                } else {
                    this.log.info('Configuring accessory %s_%s', accessory.displayName, type);
                }
                new riscoAccessory.RiscoCPOutputs(this.log, object, this.api, accessory);
                break;
            default:
                if (this.Custom_Types.includes(type)) {
                    if (add) {
                        this.log.info('Add or Modifying accessory %s', accessory.displayName);
                        for (var AccTypes in this.Custom_Types_Services) {
                            if ((AccTypes != type) && (accessory.getService(this.Custom_Types_Services[AccTypes]) != undefined)) {
                                this.log.debug('Service %s already defined on accessory %s', AccTypes, accessory.displayName);
                                this.log.debug('This service is not required anymore ; remove it');
                                accessory.removeService(this.Custom_Types_Services[AccTypes]);
                            }
                        }
                        if (accessory.getService(this.Custom_Types_Services[type]) == undefined ) {
                            this.log.debug('Service %s not already defined on accessory %s', type, accessory.displayName);
                            accessory.addService(this.Custom_Types_Services[type], accessory.context.name);
                            //remove also ExcludeSwitch because he became first Service
                            if (accessory.getService(`Exclude ${accessory.displayName}`) != undefined ) {
                                this.log.debug('Service Exclude already defined on accessory %s', accessory.displayName);
                                this.log.debug('Remove it to avoid he became first Service');
                                accessory.removeService(accessory.getService(`Exclude ${accessory.displayName}`));
                            }
                        }
                        if (accessory.getService(Service.Switch) == undefined ) {
                            this.log.debug('Service Exclude not already defined on accessory %s', accessory.displayName);
                            accessory.addService(Service.Switch, `Exclude ${accessory.displayName}`, `exclude_${accessory.context.name}`);
                        }
                    } else {
                        this.log.info('Configuring accessory %s',accessory.displayName);
                        if (accessory.getService(Service.Switch) == undefined ) {
                            this.log.debug('Service Exclude not already defined on accessory %s', accessory.displayName);
                            accessory.addService(Service.Switch, `Exclude ${accessory.displayName}`, `exclude_${accessory.context.name}`);
                        }
                    }
                    new riscoAccessory[this.Custom_Types_Classes[type]](this.log, object, this.api, accessory);
                } else if (this.Combined_Types.includes(type)) {
                    if (add) {
                        this.log.info('Add or Modifying Combined accessory %s', accessory.displayName);
                        for (var AccTypes in this.Combined_Types_Services) {
                            if ((AccTypes != type) && (accessory.getService(this.Combined_Types_Services[AccTypes]) != undefined)) {
                                this.log.debug('Service %s already defined on accessory %s', this.Combined_Types_Services[AccTypes], accessory.displayName);
                                this.log.debug('This service is not required anymore ; remove it');
                                accessory.removeService(this.Combined_Types_Services[AccTypes]);
                            }
                        }
                        if (accessory.getService(this.Combined_Types_Services[type]) == undefined ) {
                            this.log.debug('Service %s not already defined on accessory %s', type, accessory.displayName);
                            accessory.addService(this.Combined_Types_Services[type], accessory.context.name);
                            //remove also ExcludeSwitch because he became first Service
                            if (accessory.getService(`Exclude ${accessory.displayName}`) != undefined ) {
                                this.log.debug('Service Exclude already defined on accessory %s', accessory.displayName);
                                this.log.debug('Remove it to avoid he became first Service');
                                accessory.removeService(accessory.getService(`Exclude ${accessory.displayName}`));
                            }
                        }
                        if (accessory.getService(Service.Switch) == undefined ) {
                            this.log.debug('Service Exclude not already defined on accessory %s', accessory.displayName);
                            accessory.addService(Service.Switch, `Exclude ${accessory.displayName}`, `exclude_${accessory.context.name}`);
                        }
                    } else {
                        this.log.info('Configuring Combined accessory %s',accessory.displayName);
                        if (accessory.getService(Service.Switch) == undefined ) {
                            this.log.debug('Service Exclude not already defined on accessory %s', accessory.displayName);
                            accessory.addService(Service.Switch, `Exclude ${accessory.displayName}`, `exclude_${accessory.context.name}`);
                        }
                    }
                    new riscoAccessory[this.Combined_Types_Classes[type]](this.log, object, this.api, accessory);
                }
                break;
        };
    }

    _removeAccessory(accessory) {
        this.log.info('Removing accessory %s', accessory.displayName);
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
            if ((this.config['Combined'] || 'none') != 'none') {
                this.log.debug('Checks if the configuration is correct and consistent for the combined accessories');
                //Check if all Combined Configuration are valid
                var CombinedConf = {};
                for (var Comb in this.config['Combined']) {
                    if (!((this.Combined_Types).includes(`Combined_${Comb}`))) {
                        continue;
                    }
                    const CombAccessories = this.config['Combined'][Comb];
                    var ValidComb = [];
                    for (var CombAcc in CombAccessories) {
                        if (!(isNaN(CombAccessories[CombAcc].In) || isNaN(CombAccessories[CombAcc].Out) || (!CombAccessories[CombAcc].In) || (!CombAccessories[CombAcc].Out))) {
                            ValidComb.push(CombAccessories[CombAcc]);
                        }
                    }
                    this.log.debug('Found %s Valid(s) Combined Definition in Combined Type: "%s"', Object.keys(ValidComb).length, Comb);
                    var self = this
                    CombinedConf[Comb] = ValidComb;
                }
                this.config['Combined'] = CombinedConf;
                //now, check if all required Input/Output are defined
                var TempOutConf = (this.config['Outputs'] || 'none');
                var TempDetConf = (this.config['Detectors'] || 'none');
                if ((TempOutConf != 'all') || (TempDetConf != 'all')) {
                    this.log.debug('The configuration may be not consistent for the combined accessories');
                    this.log.debug('Let\'s change it!');
                    var CombId = 0;
                    for (var Comb in this.config['Combined']) {
                        for (var CombAcc in this.config['Combined'][Comb]) {
                            CombId++;
                            this.log.debug('Found Valid Combined Device type: "%s". Assigned Id: %s', Comb, CombId);
                            const TempIn = this.config['Combined'][Comb][CombAcc].In;
                            const TempOut = this.config['Combined'][Comb][CombAcc].Out;
                            this.log.debug('This Combined Device require input Id: %s and Output Id: %s', TempIn, TempOut);
                            if (TempDetConf != "all") {
                                const Required_Detectors = TempDetConf.split(',').map( (item) => {
                                    return parseInt(item, 10);
                                });
                                if (Required_Detectors.includes(Number(TempIn)) !== false) {
                                    this.log.debug('Input Id: %s is already required. Do Nothing!', TempIn);
                                } else {
                                    this.log.debug('Input Id: %s is not already required. Adding Them!', TempIn);
                                    if (TempDetConf != "none") {
                                        TempDetConf = TempDetConf.concat(',', `${TempIn}`);
                                    } else {
                                        TempDetConf = `${TempIn}`;
                                    }
                                }
                            } else {
                                this.log.debug('All Inputs Id are already required. Do Nothing!');
                            }
                            if (TempOutConf != "all") {
                                const Required_Outputs = TempOutConf.split(',').map( (item) => {
                                    return parseInt(item, 10);
                                });
                                if (Required_Outputs.includes(Number(TempOut)) !== false) {
                                    this.log.debug('Output Id: %s is already required. Do Nothing!', TempOut);
                                } else {
                                    this.log.debug('Output Id: %s is not already required. Adding Them!', TempOut);
                                    if (TempOutConf != "none") {
                                        TempOutConf = TempOutConf.concat(',', `${TempOut}`);
                                    } else {
                                        TempOutConf = `${TempOut}`;
                                    }
                                }
                            } else {
                                this.log.debug('All Outputs Id are already required. Do Nothing!');
                            }
                        }
                    }
                    this.config['Detectors'] = TempDetConf;
                    this.config['Outputs'] = TempOutConf;
                    this.log.debug('New Configurations:\nDetectors: %s\nOutputs: %s', TempDetConf, TempOutConf);
                } else {
                    this.log.debug('The configuration is consistent for the combined accessories');
                }
            }
            if ((this.config['Outputs'] || 'none') != 'none') {
                this.log.debug('Discovering Outputs');
                this.DiscoveredAccessories.Outputs = await this.RiscoPanel.DiscoverOutputs();
            }
            if ((this.config['Detectors'] || 'none') != 'none') {
                this.log.debug('Discovering Detectors');
                this.DiscoveredAccessories.Detectors = await this.RiscoPanel.DiscoverDetectors();
            }
            /*if ((this.config['Cameras'] || 'none') != 'none') {
                this.log.debug('Discovering Cameras');
                this.DiscoveredAccessories.Cameras = await this.RiscoPanel.DiscoverCameras();
            }*/
            if ((this.config['Combined'] || 'none') != 'none') {
                this.log.debug('Combined accessories input/output cannot be used as simple accessories. Remove Them from required accessories');
                var Combined_Datas = {};
                var CombId = 0;
                for (var Comb in this.config['Combined']) {
                    for (var CombAcc in this.config['Combined'][Comb]) {
                        const CombInId = this.config['Combined'][Comb][CombAcc].In;
                        const CombOutId = this.config['Combined'][Comb][CombAcc].Out;
                        CombId++;
                        const Detector_Data = Object.values(JSON.parse(JSON.stringify(this.DiscoveredAccessories.Detectors))).filter(detector => (detector.Id == CombInId));
                        const Output_Data = Object.values(JSON.parse(JSON.stringify(this.DiscoveredAccessories.Outputs))).filter(output => (output.Id == CombOutId));
                        var Combined_Data = {
                                    Id: CombId,
                                    accessorytype: `Combined_${Comb}`,
                                    InId: Detector_Data[0].Id,
                                    OutId: Output_Data[0].Id,
                                    Bypassed: Detector_Data[0].Bypassed,
                                    Partition: Detector_Data[0].Partition,
                                    name: Detector_Data[0].name,
                                    longName: `comb_${CombId}_${((Detector_Data[0].name).toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                                    InState: Detector_Data[0].State,
                                    OnAlarm: Detector_Data[0].OnAlarm,
                                    OutType: Output_Data[0].Type,
                                    OutState: Output_Data[0].State,
                                    Required: true
                        };
                        this.DiscoveredAccessories.Detectors[Detector_Data[0].Id].Required = false;
                        this.DiscoveredAccessories.Outputs[Output_Data[0].Id].Required = false;
                        Combined_Datas[CombId] = Combined_Data;
                    }
                }
                this.DiscoveredAccessories.Combineds = Combined_Datas;
                this.log.info('Creation of %s Combined Accessories', Object.keys(Combined_Datas).length);
            }
            //fallback to system mode if no DiscoveredAccessories
            if (Object.keys(this.DiscoveredAccessories).length == 0 ) {
                this.log.debug('Fallback to system mode');
                this.config['Partition'] = 'system';
                this.DiscoveredAccessories.Partitions = await this.RiscoPanel.DiscoverParts();   
            }
            if ((this.config['Custom'] || 'none') != 'none') {
                this.log.info('Apply Custom Configuration');
                for (var Custom_Type in this.Custom_Types) {
                    this.log('Modify Detectors to %s', this.Custom_Types[Custom_Type]);
                    if ((this.config['Custom'][this.Custom_Types[Custom_Type]] || 'none') != 'none') {
                        if (this.config['Custom'][this.Custom_Types[Custom_Type]] == 'all') {
                            for (var Detector in this.DiscoveredAccessories.Detectors) {
                                this.DiscoveredAccessories.Detectors[Detector].accessorytype = this.Custom_Types[Custom_Type];
                            }
                        } else if (this.config['Custom'][this.Custom_Types[Custom_Type]] != (this.config['Custom'][this.Custom_Types[Custom_Type]].split(',')) || ( parseInt(this.config['Custom'][this.Custom_Types[Custom_Type]]) != NaN )) {
                            const Modified_Detectors = this.config['Custom'][this.Custom_Types[Custom_Type]].split(',').map(function(item) {
                                return parseInt(item, 10);
                            });
                            this.log.debug('Modified Detectors:\n%s', JSON.stringify(Modified_Detectors, null, 4));
                            for (var Id_Detector in Modified_Detectors) {
                                this.log.debug('Detector Name/Id: %s/%s Modified to %s', this.DiscoveredAccessories.Detectors[Modified_Detectors[Id_Detector]].name, this.DiscoveredAccessories.Detectors[Modified_Detectors[Id_Detector]].Id, this.Custom_Types[Custom_Type]);
                                this.DiscoveredAccessories.Detectors[Modified_Detectors[Id_Detector]].accessorytype = this.Custom_Types[Custom_Type];
                            }
                        }
                    }
                }
            }
            this.RiscoPanel.DiscoveredAccessories = this.DiscoveredAccessories;
            this.log.info('Discovering Phase Ended');
            return Promise.resolve();
        } catch (err) {
            this.log.error('Error on Discovery Phase:\n%s', err);
            this.RiscoPanel.DiscoveredAccessories = this.DiscoveredAccessories;
            this.log.info('Discovering Phase Ended');
            return Promise.reject();
        }
    }

    PreConfigureAccessories(DeviceFamily) {
        switch (DeviceFamily) {
            case 'Partitions':
                this.log.info('PreConf Accessory => Add Partitions');
                if (this.DiscoveredAccessories.Partitions.type == 'system') {
                    this.log.info('PreConf Accessory => Configuration for System: %s', this.DiscoveredAccessories.Partitions[0].name);
                    var PartConfig = {
                        context: this.DiscoveredAccessories.Partitions[0],
                        RiscoSession: this.RiscoPanel,
                        polling: this.config['polling'],
                        pollInterval: this.config['pollInterval'],
                        Occupancy: ((this.DiscoveredAccessories.Detectors != undefined) ? true : false)
                    };
                    this.Devices.push(PartConfig);
                } else {
                    for (var PartsId in this.DiscoveredAccessories.Partitions) {
                        if (PartsId != 'type') {
                            if (this.DiscoveredAccessories.Partitions[PartsId].Required == true) {
                                this.log.info('PreConf Accessory => Configuration for Partitions Id : %s and labeled "%s"', this.DiscoveredAccessories.Partitions[PartsId].Id, this.DiscoveredAccessories.Partitions[PartsId].name);
                                var PartConfig = {
                                    context: this.DiscoveredAccessories.Partitions[PartsId],
                                    RiscoSession: this.RiscoPanel,
                                    polling: this.config['polling'],
                                    pollInterval: this.config['pollInterval'],
                                    Occupancy: ((this.DiscoveredAccessories.Detectors != undefined) ? true : false)
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
                    if (GroupsId != 'type') {
                        if (this.DiscoveredAccessories.Groups[GroupsId].Required == true) {
                            this.log.info('PreConf Accessory => Configuration for Groups Id : %s and labeled "%s"', this.DiscoveredAccessories.Groups[GroupsId].Id, this.DiscoveredAccessories.Groups[GroupsId].name);
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
                    if (this.DiscoveredAccessories.Outputs[OutputId].Required == true) {
                        this.log.info('PreConf Accessory => Configuration for Outputs Id : %s and labeled "%s"', this.DiscoveredAccessories.Outputs[OutputId].Id, this.DiscoveredAccessories.Outputs[OutputId].name);
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
                    if (this.DiscoveredAccessories.Detectors[DetectorId].Required == true) {
                        this.log.info('PreConf Accessory => Configuration for Detectors Id : %s and labeled "%s"', this.DiscoveredAccessories.Detectors[DetectorId].Id, this.DiscoveredAccessories.Detectors[DetectorId].name);
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
            case 'Combineds':
                this.log.info('Add Accessory => Add Combined');
                for (var CombinedId in this.DiscoveredAccessories.Combineds) {
                    if (this.DiscoveredAccessories.Combineds[CombinedId].Required == true) {
                        this.log.info('PreConf Accessory => Configuration for Combined Id : %s and labeled "%s"', this.DiscoveredAccessories.Combineds[CombinedId].Id, this.DiscoveredAccessories.Combineds[CombinedId].name);
                        var CombinedConfig = {
                            context: this.DiscoveredAccessories.Combineds[CombinedId],
                            RiscoSession: this.RiscoPanel,
                            polling: this.config['polling'],
                            pollInterval: this.config['pollInterval']
                        };
                        this.Devices.push(CombinedConfig);
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

