var axios = require('axios');
var pollingtoevent = require('polling-to-event');
const iRiscoUserAgent = 'iRISCO/0002 CFNetwork/1197 Darwin/20.0.0';
const CommonNetError = {
    'EAI_AGAIN': 'DNS Lookup Error. Verify your Internet Connection!!!',
    'ETIMEDOUT': 'Request Timeout. If this persist, Verify your Internet Connection!!!',
    'ENETUNREACH': 'Network Unreachable. Verify your Internet Connection!!!',
    'ENOTFOUND': 'DNS Hostname Not Found. Verify your Internet Connection!!!'
};

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

const NetworkErrorMsg = (error) => {
    const CommonNetError = {
        'EAI_AGAIN': 'DNS Lookup Error. Verify your Internet Connection!!!',
        'ETIMEDOUT': 'Request Timeout. If this persist, Verify your Internet Connection!!!',
        'ENETUNREACH': 'Network Unreachable. Verify your Internet Connection!!!',
        'ENOTFOUND': 'DNS Hostname Not Found. Verify your Internet Connection!!!'
    };
    if (error.response) {
        if (error.response.status >= 500) {
            return 'Connection problem due to an error from the RiscoCloud servers.';
        } else {
            return `Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`;
        }
    } else if (CommonNetError[error.errno] !== undefined){
        return CommonNetError[error.errno];
    } else if (CommonNetError[error.code] !== undefined) {
        return CommonNetError[error.code];
    } else {
        return `Error on Request : ${error.errno}\n Code : ${error.code}`;
    }
}

class RiscoPanelSession {
    constructor(aConfig, aLog, api) {
        // Do not create new object if already exist
        // Avoid multiple Session to RiscoCloud
        if (!(this instanceof RiscoPanelSession)) {
            return new RiscoPanelSession(aConfig, aLog);
        }
        this.Ready = false;
        this.DiscoveredAccessories ;
        this.risco_panel_name = aConfig['name'];
        this.polling = aConfig['polling'] || false;
        this.pollInterval = aConfig['pollInterval'] || 30000;
        this.risco_username = encodeURIComponent(aConfig['riscoUsername']);
        this.risco_username = aConfig['riscoUsername'];
        this.risco_password = encodeURIComponent(aConfig['riscoPassword']);
        this.risco_password = aConfig['riscoPassword'];
        this.risco_siteId = aConfig['riscoSiteId'];
        this.risco_Language = `${aConfig['languageID'] || 'en'}-${aConfig['languageID']|| 'en'}`;
        this.risco_pincode = aConfig['riscoPIN'];
        this.Custom_Cmd = false;
        this.api = api;
        var self = this;
        this.Custom_armCommand = ( () => {
                                    const regtest = RegExp('\\d:.*');
                                    if (regtest.test(aConfig['armCommand'])) {
                                        return 'armed';
                                    } else {
                                        self.Custom_Cmd = true;
                                        return aConfig['armCommand'];
                                    }
                                })() || 'armed';
        this.Custom_nightCommand = ( () => {
                                    const regtest = RegExp('\\d:.*');
                                    if (regtest.test(aConfig['nightCommand'])) {
                                        return 'partially';
                                    } else {
                                        self.Custom_Cmd = true;
                                        return aConfig['nightCommand'];
                                    }
                                })() || 'partially';
        this.Custom_homeCommand = ( () => {
                                    const regtest = RegExp('\\d:.*');
                                    if (regtest.test(aConfig['homeCommand'])) {
                                        return 'partially';
                                    } else {
                                        self.Custom_Cmd = true;
                                        return aConfig['homeCommand'];
                                    }
                                })() || 'partially';
        this.Custom_disarmCommand = ( () => {
                                    const regtest = RegExp('\\d:.*');
                                    if (regtest.test(aConfig['disarmCommand'])) {
                                        return 'partially';
                                    } else {
                                        self.Custom_Cmd = true;
                                        return aConfig['disarmCommand'];
                                    }
                                })() || 'disarmed';
        this.Partition = aConfig['Partition'];
        this.Groups = aConfig['Groups'];
        this.Outputs = aConfig['Outputs'];
        this.Detectors = aConfig['Detectors'];
        this.log = aLog;
        this.req_counter = 0;
        this.accessToken;
        this.refreshToken;
        this.renewToken;
        this.SessionId;
        this.SessionRenew;
        this.SessionLogged = false;
        this.LastEvent = null;
        this.BadResponseCounter = 0;
        this.PanelDatas;

        this.long_event_name = ('RPS_long_%s', (this.risco_panel_name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_'));
        this.PollingLoop();
    }

    PollingLoop() {
        var self = this;
        // set up polling if requested
        if (self.polling) {
            self.log.info('Starting polling with an interval of %s ms', self.pollInterval);
            var emitter = new pollingtoevent( (done) => {
                if ((self.Ready === true) && (self.SessionLogged)) {
                    /*self.getCPStatesPoll( (err, result) => {
                        done(err, result);
                    });*/
                    self.UpdateCPStates( (err, result) => {
                        done(err, result);
                    });
                } else {
                    done(null, null);
                }
            }, {
                longpollEventName: self.long_event_name,
                longpolling: true,
                interval: self.pollInterval
            });

            emitter.on(self.long_event_name, (state) => {
                if (state) {
                    // Get OnceMore time Current State:
                    self.log.info('New state detected: (%s) -> %s. Notify!', state, translateState(state));
                    self.securityService.setCharacteristic(Characteristic.SecuritySystemCurrentState, state);
                    self.riscoCurrentState = state;
                }
            });

            emitter.on('err', (err) => {
                self.log.error('Polling failed, error was %s', err);
            });

            self.api.on('shutdown', () => {
                self.log.info('Shutdown detected, cleaning unused ressources');
                self.log.debug('Remove All Listeners for %s', self.risco_panel_name);
                emitter.removeAllListeners();
            });
        }
    }

    async Login() {
        var self = this;
        self.log.debug('Entering Login Function');
        try{
            if (!self.SessionLogged) {
                const response = await axios({
                    url: 'https://www.riscocloud.com/webapi/api/auth/login',
                    method: 'POST',
                    json: true,
                    headers: {
                        'User-Agent': `${iRiscoUserAgent}`
                    },
                    data: {
                        "userName": `${self.risco_username}`,
                        "password": `${self.risco_password}`
                    },

                    validateStatus(status) {
                        return status == 200;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    self.log.error(NetworkErrorMsg(error));
                    setTimeout( () => { self.SessionValidity(); }, 5000);
                    return false;
                });
                if ((response.status !== undefined) && (response.status == 200) && (response.statusText == 'OK')) {
                    if (response.data.status > 400) {
                        self.log.error(`Error ${response.data.status}\n${response.data.errorText}`);
                        return false;
                    }
                    self.log.info('Cloud Authentication Successfull');
                    self.accessToken = response.data.response.accessToken;
                    self.refreshToken = response.data.response.refreshToken;
                    self.renewToken = Date.parse(response.data.response.expiresAt);
                    self.log.debug('Cloud accessToken :\n%s', self.accessToken);
                    await self.GetSessionId();
                    return true;
                } else {
                    throw new Error(`Bad HTTP Response on Cloud Auhtentication: ${response.status}`);
                }
            } else {
                return true;
            }
        } catch (err) {
            self.log.error('Error on Cloud Authentication:\n%s', err);
            self.SessionLogged = false;
            self.SessionId = '';
            self.accessToken = '';
            self.refreshToken = '';
            self.renewToken = '';
            self.SessionRenew = '';
            setTimeout( () => { self.SessionValidity(); }, 5000);
            return false;
        }
    }

    async GetSessionId() {
        var self = this;
        self.log.debug('Get SessionId');
        try {
            var response;
            response = await axios({
                url: `https://www.riscocloud.com/webapi/api/wuws/site/${self.risco_siteId}/Login`,
                method: 'POST',
                json: true,
                headers: {
                    'User-Agent': `${iRiscoUserAgent}`,
                    'Authorization': `Bearer ${self.accessToken}`
                },
                data: {
                    'languageId': `${self.risco_Language}`,
                    'pinCode': `${self.risco_pincode}`
                },

                validateStatus(status) {
                    return status == 200;
                },
                maxRedirects: 0,
            })
            .catch( error => {
                self.log.error(NetworkErrorMsg(error));
                setTimeout( () => { self.SessionValidity(); }, 5000);
                return false;
            });
            if ((response.status !== undefined) && (response.status == 200) && (response.statusText == 'OK')) {
                if (response.data.status > 400) {
                    if (response.data.status == 401) {
                        return await self.Login();
                    } else if (response.data.status == 422) {
                        self.log.error('Invalid Site ID code. Check your entry !!!');
                        return false;
                    } else {
                        self.log.error(`Error ${response.data.status}\n${response.data.errorText}`);
                        return false;
                    }
                }
                self.SessionLogged = true;
                self.log.debug('Cloud Session OK');
                self.log.info('Retrieving Cloud Session: Ok');
                self.SessionId = response.data.response.sessionId;
                self.SessionRenew = Date.parse(response.data.response.expiresAt);
                self.log.debug('Cloud SessionId :\n%s', self.SessionId);
                return true;
            } else {
                throw new Error(`Bad HTTP Response Get SessionId : ${response.status}`);
            }
        } catch (err) {
            self.log.error('Get SessionId error:\n%s', err );
            self.SessionLogged = false;
            self.SessionId = '';
            self.accessToken = '';
            self.refreshToken = '';
            self.renewToken = '';
            self.SessionRenew = '';
            setTimeout( () => { self.SessionValidity(); }, 5000);
            return false;
        }
    }

    async SessionValidity() {
        var self = this;
        self.log.debug('Entering SessionValidity Function');
        try {
            if (!self.SessionLogged) {
                self.log.debug('Not Logged. Need to ReLogin');
                return await self.Login();
            } else {
                if (Date.now() >= self.renewToken) {
                    self.SessionLogged = false;
                    await self.Login();
                }
                if (Date.now() >= self.SessionRenew) {
                    await self.GetSessionId();
                }
                return self.SessionLogged;
            }
        } catch (err) {
            self.log.error('Error on SessionValidity:\n%s', err);
            return false;
        }
    }

    async DiscoverParts(PartitionsDatas) {
        var self = this;
        self.log.debug('Entering DiscoverParts Function');
        try {
            var Parts_Datas = {};
            const ArmedStates = {
                1: 'disarmed',
                2: 'partial',
                3: 'armed'
            };
            self.log.info('Partinfo : %s', self.Partition)
            if (self.Partition == 'system') {
                    var Part_Data = {
                        Id: 0,
                        name: self.risco_panel_name,
                        longName: `part_0_${(self.risco_panel_name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                        Required: true,
                        childPart: ( () => {
                            var listPart = [];
                            Object.values(PartitionsDatas)
                                .forEach( part => {
                                    listPart.push(part.id)
                                });
                            return listPart;
                        })(),
                        accessorytype: 'System',
                        previousState: null,
                        actualState: ( () => {
                            const countParts = Object.keys(PartitionsDatas).length;
                            const DisarmedParts = Object.values(PartitionsDatas)
                                .filter( part => (part.armedState == 1));
                            const ArmedParts = Object.values(PartitionsDatas)
                                .filter( part => (part.armedState == 3));
                            if (Object.keys(DisarmedParts).length == countParts) {
                                return 'disarmed';
                            } else if (Object.keys(ArmedParts).length == countParts) {
                                return 'armed';
                            } else {
                                return 'partial';
                            }
                        })(),
                        armCommand: this.Custom_armCommand,
                        nightCommand: this.Custom_nightCommand,
                        homeCommand: this.Custom_homeCommand,
                        disarmCommand: this.Custom_disarmCommand,
                        Ready: true,
                        PReady: true,
                        OnAlarm: false
                    };
                    Parts_Datas[0] = Part_Data;
                    Parts_Datas.type = 'system';
            } else {
                for (var PartId in PartitionsDatas) {
                    var Part_Data = {
                        Id: PartitionsDatas[PartId].id,
                        name: PartitionsDatas[PartId].name,
                        longName: `part_${PartitionsDatas[PartId].id}_${(PartitionsDatas[PartId].name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                        Required: null,
                        accessorytype: 'Partitions',
                        ExitDelay: 0,
                        previousState: null,
                        actualState: ArmedStates[PartitionsDatas[PartId].armedState],
                        armCommand: this.Custom_armCommand,
                        nightCommand: this.Custom_nightCommand,
                        homeCommand: this.Custom_homeCommand,
                        disarmCommand: this.Custom_disarmCommand,
                        Ready: true,
                        PReady: true, 
                        OnAlarm: false
                    };
                    self.log.debug('Discovering Partition : %s with Id: %s', PartitionsDatas[PartId].name, PartitionsDatas[PartId].id);
                    if (self.Partition == 'all') {
                        self.log.debug('All Partitions Required');
                        Part_Data.Required = true;
                    } else if (self.Partition != (self.Partition.split(',')) || (parseInt(self.Partition) != NaN)){
                        self.log.debug('Not All Partitions Required');
                        //Automatically convert string value to integer
                        const Required_Zones = self.Partition.split(',').map( (item) => {
                            return parseInt(item, 10);
                        });
                        if (Required_Zones.includes(Part_Data.Id) !== false){
                            self.log.debug('Partitions "%s" Required', PartitionsDatas[PartId].name);
                            Part_Data.Required = true;
                        } else {
                            self.log.debug('Partitions "%s" Not Required', PartitionsDatas[PartId].name);
                            Part_Data.Required = false;
                        }
                    } else {
                        self.log.debug('No Partitions Required');
                        Part_Data.Required = false;
                    }
                    Parts_Datas[Part_Data.Id] = Part_Data;
                }
                Parts_Datas.type = 'partition';
            }
            self.log.info('Discovered %s Partitions', (Object.keys(Parts_Datas).length - 1 ));
            return Parts_Datas;
        } catch (err) {
            self.log.error('Error on Discovery Partition: %s', err);
        }
    }

    async DiscoverGroups(PartitionsDatas) {
        var self = this;
        try {
            const GroupsNames = {
                0: 'Group A',
                1: 'Group B',
                2: 'Group C',
                3: 'Group D'
            };
            var GroupInfos = ( () => { 
                var Groups_Datas = {};
                Object.values(PartitionsDatas)
                    .filter( partition => (partition.groups != null))
                    .map( partition => {
                        Object.values(partition.groups)
                            .forEach( groups => {
                                if (Groups_Datas[groups.id] == undefined) {
                                    Groups_Datas[groups.id] = {
                                        Id: groups.id,
                                        name: GroupsNames[groups.id],
                                        longName: `group_${groups.id}_${(GroupsNames[groups.id].toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                                        parentPart: ( () => {
                                            return [partition.id];
                                        })(),
                                        Required: false,
                                        accessorytype: 'Groups',
                                        previousState: null,
                                        actualState: ((groups.state == 2) ? 'disarmed' : 'armed'),
                                        OnAlarm: false
                                    }
                                } else {
                                    if (Groups_Datas[groups.id].parentPart.indexOf(partition.id)) {
                                        Groups_Datas[groups.id].parentPart.push(partition.id);
                                    }
                                }
                            });
                    });
                Object.values(Groups_Datas)
                    .forEach( groups => {
                        self.log.debug('Discovering Group : "%s" with Id: %s', groups.name, groups.Id);
                    });
                if (self.Groups == 'all') {
                    self.log.debug('All Groups Required');
                    Object.values(Groups_Datas)
                        .forEach( groups => {
                            Groups_Datas[groups.Id].Required = true;
                        });
                } else if (self.Groups != (self.Groups.split(',')) || (parseInt(self.Groups) != NaN)) {
                    self.log.debug('Not All Groups Required');
                    //Automatically convert string value to integer
                    const Required_Groups = self.Groups.split(',').map( (item) => {
                        return parseInt(item, 10);
                    });
                    Object.values(Groups_Datas)
                        .filter( groups => (Required_Groups.includes(groups.Id) !== false))
                        .map(groups => {
                            Groups_Datas[groups.Id].Required = true;
                            self.log.debug('Group "%s" Required', Group_Data.name);
                        });
                }
                self.log.info('Discovered %s Groups', (Object.keys(Groups_Datas).length));
                self.log.debug(JSON.stringify(Groups_Datas, JSONreplacer(), 4));
                return Groups_Datas;
            })();
            return GroupInfos;
        } catch (err) {
            self.log.error('Error on Discovery Group: %s', err);
        }
    }

    async DiscoverOutputs(OutputsDatas) {
        var self = this;
        self.log.debug('Entering DiscoverOutputs Function');
        try {
            var OutputInfo = ( () => {
                var Outputs_Datas = {};
                for (var OutId in OutputsDatas) {
                    const OutputId = OutputsDatas[OutId].deviceID;
                    const OutputName = OutputsDatas[OutId].deviceName;
                    var Output_Data = {
                        Id: OutputId,
                        name: OutputName,
                        longName: `out_${OutputId}_${(OutputName.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                        Required: null,
                        accessorytype: 'Outputs',
                        Type: ( () => {
                                if (OutputsDatas[OutId].deviceType == 2) {
                                    return 'pulse';
                                } else {
                                    return 'switch';
                                }
                            })(),
                        State: ( () => {
                                if (OutputsDatas[OutId].deviceType == 2) {
                                    return false;
                                } else {
                                   return ((OutputsDatas[OutId].lastCommand == 1) ? true : false);
                                }
                            })()
                    };
                    self.log.debug('Discovering Outputs : %s with Id : %s', Output_Data.name, Output_Data.Id);
                    if (self.Outputs == 'all') {
                        self.log.debug('All Outputs Required');
                        Output_Data.Required = true;
                    } else if (self.Outputs != (self.Outputs.split(',')) || (parseInt(self.Outputs) != NaN)){
                        self.log.debug('Not All Outputs Required');
                        //Automatically convert string value to integer
                        const Required_Outputs = self.Outputs.split(',').map( (item) => {
                            return parseInt(item, 10);
                        });
                        if (Required_Outputs.includes(Output_Data.Id) !== false) {
                            self.log.debug('Outputs "%s" Required', Output_Data.name);
                            Output_Data.Required = true;
                        } else {
                            self.log.debug('Outputs "%s" Not Required', Output_Data.name);
                            Output_Data.Required = false;
                        }
                    } else {
                        self.log.debug('No Outputs Required');
                        Output_Data.Required = false;
                    }
                    self.log.debug('name : %s', Output_Data.name);
                    self.log.debug('Id: %s', Output_Data.Id);
                    self.log.debug('Command: %s', Output_Data.Command);
                    self.log.debug('Type: %s', Output_Data.Type);
                    self.log.debug('State: %s', Output_Data.State);
                    Outputs_Datas[Output_Data.Id] = Output_Data;
                }
                self.log.info('Discovered %s Outputs', (Object.keys(Outputs_Datas).length));
                self.log.debug(JSON.stringify(Outputs_Datas, JSONreplacer(), 4));
                return Outputs_Datas;
            })();
            return OutputInfo;
        } catch (err) {
            self.log.error('Error on Discovery Output:\n%s', err);
        }
    }

    async DiscoverDetectors(DetectorsDatas) {
        var self = this;
        try {
            var Detectors_Datas = {};
            const PartEquiv = {
                0: 4,
                1: 1,
                2: 2,
                4: 3
            };
            var DetectorsInfos = ( () => {
                Object.values(DetectorsDatas)
                    .forEach( detector => {
                        const DetectorName = detector.zoneName;
                        var Detector_Data = {
                            Id: detector.zoneID,
                            Bypassed: ((detector.status == 2) ? true : false),
                            Partition: ( () => {
                                const AssocMask = detector.partAssocMask
                                    .replace('A', '')
                                    .replace(/=/g, '');
                                var DPart = [];
                                for (let charMask of AssocMask) {
                                    switch (charMask) {
                                        case 'Q':
                                            //Partition 1 id:0
                                            DPart.push(0);
                                            break;
                                        case 'g':
                                            //Partition 2 id:1
                                            DPart.push(1);
                                            break;
                                        case 'B':
                                            //Partition 3 id:2
                                            DPart.push(2);
                                            break;
                                        case 'C':
                                            //Partition 4 id:3
                                            DPart.push(3);
                                            break;
                                        case 'w':
                                            //Partition 1 and 2 id:0 and id:1
                                            DPart.push.apply(DPart, [0,1]);
                                            break;
                                        case 'D':
                                            //Partition 3 and 4 id:2 and id:3
                                            DPart.push.apply(DPart, [2,3]);
                                            break;
                                    }
                                }
                                return DPart.sort(function(a, b) {
                                    return a - b;
                                });
                            })(),
                            Required: false,
                            accessorytype: 'Detector',
                            name: DetectorName,
                            longName: `det_${detector.zoneID}_${(DetectorName.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                            State: ( () => {
                                //0 for inactive
                                //1 for active
                                //2 for bypassed
                                switch (detector.status) {
                                    case 0:
                                    case 2:
                                        return false;
                                        break;
                                    case 1:
                                        return true;
                                        break;
                                    default:
                                        return false;
                                        break;
                                }
                            })(),
                            OnAlarm: false
                            };
                            Detectors_Datas[detector.zoneID] = Detector_Data;
                    });
                    Object.values(Detectors_Datas)
                        .forEach( detector => {
                            self.log.debug('Discovering Detector : "%s" with Id: %s', detector.name, detector.Id);
                        });
                    if (self.Detectors == 'all') {
                        self.log.debug('All Detectors Required');
                        Object.values(Detectors_Datas)
                            .forEach( detector => {
                                Detectors_Datas[detector.Id].Required = true;
                            });
                    } else if (self.Detectors != (self.Detectors.split(',')) || (parseInt(self.Detectors) != NaN)) {
                        self.log.debug('Not All Detectors Required');
                        //Automatically convert string value to integer
                        const Required_Detectors = self.Detectors.split(',').map( (item) => {
                            return parseInt(item, 10);
                        });
                        Object.values(Detectors_Datas)
                            .filter( detector => (Required_Detectors.includes(detector.Id) !== false))
                            .map( detector => {
                                Detectors_Datas[detector.Id].Required = true;
                                self.log.debug('Detector "%s" Required', detector.name);
                            });
                    } else {
                        self.log.debug('No Detectors Required');
                    }
                    return Detectors_Datas;
                })();
                self.log.info('Discovered %s Detector(s)', Object.keys(DetectorsInfos).length);
                return DetectorsInfos;
        } catch (err) {
            self.log.error('Error on Discovery Detector:\n%s', err);
            return {};
        }
    }

    /*async DiscoverCameras() {
        var self = this;
      
        try {
            await self.KeepAlive();

            var response;
            do {
                response = await axios({
                    url: 'https://www.riscocloud.com/ELAS/WebUI/Cameras/Get',
                    method: 'POST',
                    headers: {
                        Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                        Origin: 'https://www.riscocloud.com',
                        Cookie: self.riscoCookies
                    },

                    validateStatus(status) {
                        return status >= 200 && status < 400;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    if (error.response) {
                       return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, 'DiscoverCameras') == false);

            if (response.status == 200) {
                self.log.debug('Cameras/Get status:\n%s',response.status);
                var CamerasInfos = (function() {
                    self.log.debug(JSON.stringify(response.data, null, 4));
                    var Cameras_Datas = {};
                    for (var Camera in response.data.cameras.camInfo){
                        self.log.debug(JSON.stringify(response.data.cameras.camInfo[Camera], null, 4));
                        var Camera_Data = {
                                Id: response.data.cameras.camInfo[Camera].id,
                                name: response.data.cameras.camInfo[Camera].title,
                                lastcapture: response.data.cameras.camInfo[Camera].photoSrc,
                                isNet: response.data.cameras.camInfo[Camera].isNet,
                            };
                            Cameras_Datas[Camera_Data.Id] = Camera_Data;
                        }
                    return Cameras_Datas;
                })();
                self.log.info('Discovered %s Camera(s)', Object.keys(CamerasInfos).length);
                return CamerasInfos;
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('Error on Discovery Camera:\n%s', err);
        }
    }*/

    async getAlarmState(PanelDatas) {
        var self = this;
        self.log.debug('Entering getAlarmState function');
        try {
            Object.values(PanelDatas.Partitions)
                .filter( partition => (partition.alarmState == 1))
                .map( OnAlarmPart => {
                    if (self.DiscoveredAccessories.Partitions.type == 'system'){
                        self.DiscoveredAccessories.Partitions[0].OnAlarm = true;
                    } else {
                        if (((this.Partition || 'none') != 'none') && (!(self.DiscoveredAccessories.Partitions[OnAlarmPart.id].OnAlarm))) {
                            self.log.debug('Partition %s is Armed and under Alarm', self.DiscoveredAccessories.Partitions[OnAlarmPart.id].name);
                            self.DiscoveredAccessories.Partitions[OnAlarmPart.id].OnAlarm = true;
                        }
                        if (((this.Groups || 'none') != 'none') && (OnAlarmPart.groups !== undefined)) {
                            Object.values(OnAlarmPart.groups)
                                .filter( group => (group.state == 3))
                                .map( group => {
                                    if ((self.DiscoveredAccessories.Groups[group.id].actualState != 'disarmed') && (!(self.DiscoveredAccessories.Groups[group.Id].OnAlarm))) {
                                        self.log.debug('Group %s is Armed and under Alarm', group.name);
                                        self.DiscoveredAccessories.Groups[group.Id].OnAlarm =  true;
                                    }
                                });
                        }
                    }
                });
            self.log.debug('Leaving getAlarmState function');
            return Promise.resolve();
        } catch (err) {
            self.log.error('Error on getAlarmState:\n%s', err);
            return Promise.reject();
        }
    }

    async getPartsStates(PartitionsDatas) {
        var self = this;
        self.log.debug('Entering getPartStates function');
        try {
            const ArmedStates = {
                1: 'disarmed',
                2: 'partial',
                3: 'armed'
            };
            if (self.DiscoveredAccessories.Partitions.type == 'system') {
                self.log.debug('System Mode');
                self.DiscoveredAccessories.Partitions[0].previousState = self.DiscoveredAccessories.Partitions[0].actualState;
                self.DiscoveredAccessories.Partitions[0].actualState = ( () => {
                    const countParts = Object.keys(PartitionsDatas.Partitions).length;
                    const DisarmedParts = Object.values(PartitionsDatas.Partitions)
                        .filter( part => (part.armedState == 1));
                    const ArmedParts = Object.values(PartitionsDatas.Partitions)
                        .filter( part => (part.armedState == 3));
                    if (Object.keys(DisarmedParts).length == countParts) {
                        return 'disarmed';
                    } else if (Object.keys(ArmedParts).length == countParts) {
                        return 'armed';
                    } else {
                        return 'partial';
                    }
                })(),
                self.log.debug('Previous State: %s', self.DiscoveredAccessories.Partitions[0].previousState);
                self.log.debug('Actual State: %s', self.DiscoveredAccessories.Partitions[0].actualState);
                var ExitDelay = 0;
                Object.values(self.DiscoveredAccessories.Partitions[0].childPart)
                    .forEach( idpart => {
                        const part_datas = Object.values(PartitionsDatas.Partitions)
                            .filter( partition => (partition.id == idpart));
                        if (ExitDelay < Math.max(part_datas.exitDelayTO)) {
                            ExitDelay = Math.max(part_datas.exitDelayTO);
                        }

                    });
                if (ExitDelay != 0) {
                    self.DiscoveredAccessories.Partitions[0].ExitDelay = ExitDelay;
                    self.log.debug('Arming Delay Left: %s', self.DiscoveredAccessories.Partitions[0].ExitDelay);
                }
                if ((self.DiscoveredAccessories.Partitions[0].OnAlarm == true) && (self.DiscoveredAccessories.Partitions[0].actualState == 'disarmed')) {
                    self.DiscoveredAccessories.Partitions[0].OnAlarm = false;
                }
                //Determine Occupancy State
                //Init Occupancy State Before Processing
                self.DiscoveredAccessories.Partitions[0].Ready = true;
                self.DiscoveredAccessories.Partitions[0].PReady = true;
                if (self.DiscoveredAccessories.Detectors !== undefined) {
                    const OpenedSensor = Object.values(self.DiscoveredAccessories.Detectors)
                        .filter( detector => ((detector.State === true) && (detector.Bypassed === false)));
                    if (Object.keys(OpenedSensor).length > 0) {
                        self.DiscoveredAccessories.Partitions[0].Ready = false;
                        self.log.debug('Motion Is Detected, set System to Occupied');
                        if (Object.keys(Object.values(OpenedSensor)
                            .filter(detector => detector.accessorytype != 'Detector')).length > 0) {
                            self.DiscoveredAccessories.Partitions[0].PReady = false;
                        } else {
                            self.DiscoveredAccessories.Partitions[0].PReady = ((self.DiscoveredAccessories.Partitions[0].PReady) ? true : false );
                        }
                    } else {
                        self.DiscoveredAccessories.Partitions[0].Ready = ((self.DiscoveredAccessories.Partitions[0].Ready) ? true : false );
                        self.DiscoveredAccessories.Partitions[0].PReady = ((self.DiscoveredAccessories.Partitions[0].PReady) ? true : false );
                        self.log.debug('Motion Is Not Detected, set System to Not Occupied');
                    }
                }
            } else {
                self.log.debug('Partition Mode');
                Object.values(PartitionsDatas.Partitions)
                    .forEach( partition => {
                        const PartId = partition.id;
                        if ((Math.max(partition.exitDelayTO) != 0) && (self.DiscoveredAccessories.Partitions[PartId] !== undefined)) {
                            self.DiscoveredAccessories.Partitions[PartId].ExitDelay = Math.max(partition.exitDelayTO);
                            self.log.debug('Arming Delay Left for Part "%s": %s', self.DiscoveredAccessories.Partitions[PartId].name, self.DiscoveredAccessories.Partitions[PartId].ExitDelay);
                        }
                    });
                if (PartitionsDatas.Partitions != null) {
                    Object.values(self.DiscoveredAccessories.Partitions)
                        .forEach( partition => {
                            if (partition.Id !== undefined) {
                                //Init Occupancy State Before Processing
                                self.DiscoveredAccessories.Partitions[partition.Id].Ready = true;
                                self.DiscoveredAccessories.Partitions[partition.Id].PReady = true;
                                if (self.DiscoveredAccessories.Detectors !== undefined) {
                                    const OpenedSensor = Object.values(self.DiscoveredAccessories.Detectors)
                                        .filter( detector => ( 
                                            (Object.values(detector.Partition)
                                                .some(parentpart => (parentpart == partition.Id))
                                            && (detector.State === true)
                                            && (detector.Bypassed === false)))
                                        );
                                    if (Object.keys(OpenedSensor).length > 0) {
                                        self.DiscoveredAccessories.Partitions[partition.Id].Ready = false;
                                        self.log.debug('Motion Is Detected, set System to Occupied');
                                        if (Object.keys(Object.values(OpenedSensor)
                                            .filter( detector => (detector.accessorytype != 'Detector'))).length > 0) {
                                                self.DiscoveredAccessories.Partitions[partition.Id].PReady = false;
                                        } else {
                                            self.DiscoveredAccessories.Partitions[partition.Id].PReady = ((self.DiscoveredAccessories.Partitions[partition.Id].PReady) ? true : false );
                                        }
                                    } else {
                                        self.DiscoveredAccessories.Partitions[partition.Id].Ready = ((self.DiscoveredAccessories.Partitions[partition.Id].Ready) ? true : false );
                                        self.DiscoveredAccessories.Partitions[partition.Id].PReady = ((self.DiscoveredAccessories.Partitions[partition.Id].PReady) ? true : false );
                                        self.log.debug('Motion Is Not Detected, set System to Not Occupied');
                                    }
                                }
                            }
                        });
                }
                Object.values(PartitionsDatas.Partitions)
                    .forEach( partition => {
                        const Id = partition.id;
                        if (self.DiscoveredAccessories.Partitions[Id] !== undefined) {
                            self.DiscoveredAccessories.Partitions[Id].previousState = self.DiscoveredAccessories.Partitions[Id].actualState;
                            self.DiscoveredAccessories.Partitions[Id].actualState = ArmedStates[partition.armedState]
                            self.log.debug('Partition Id: %s Label: %s',Id, self.DiscoveredAccessories.Partitions[Id].name)
                            self.log.debug('Previous State: %s', self.DiscoveredAccessories.Partitions[Id].previousState);
                            self.log.debug('Actual State: %s', self.DiscoveredAccessories.Partitions[Id].actualState);
                        }
                    });
                Object.values(self.DiscoveredAccessories.Partitions)
                    .filter( partition => ((partition.OnAlarm == true) && (partition.actualState == 'disarmed')))
                    .forEach( partition => {
                        self.log.debug('Partition %s Reset OnAlarm State', partition.name);
                        self.DiscoveredAccessories.Partitions[partition.Id].OnAlarm = false;
                });
            }
            self.log.debug('Leaving getPartStates function');
            return true;
        } catch (err) {
            self.log.debug('Leaving getPartStates function');
            self.log.error('Error on Get Partitions States: %s', err);
            return err;
        }
    }

    async getGroupsStates(PartitionsDatas) {
        var self = this;
        self.log.debug('Entering getGroupsStates function');
        try {
            Object.values(PartitionsDatas)
                .filter( partition => (partition.groups !== null))
                .map( partition => {
                    Object.values(partition.groups)
                        .forEach( groups => {
                            if (self.DiscoveredAccessories.Groups[groups.id] !== undefined) {
                                self.DiscoveredAccessories.Groups[groups.id].previousState = self.DiscoveredAccessories.Groups[groups.id].actualState;
                            }
                        });
                });
            Object.values(PartitionsDatas)
                .filter( partition => (partition.groups !== null))
                .map( partition => {
                    Object.values(partition.groups)
                        .forEach( groups => {
                            if (self.DiscoveredAccessories.Groups[groups.id] !== undefined) {
                                self.DiscoveredAccessories.Groups[groups.id].actualState = ((groups.state == 2) ? 'disarmed' : 'armed');
                            }
                        });
                });
            Object.values(self.DiscoveredAccessories.Groups)
                .forEach( groups => {
                    self.log.debug('Group Id: %s Label: %s', groups.Id, groups.name)
                    self.log.debug('Previous State: %s', groups.previousState);
                    self.log.debug('Actual State: %s', groups.actualState);
                });
            Object.values(self.DiscoveredAccessories.Groups)
                .filter( groups => ((groups.OnAlarm == true) && (groups.actualState == 'disarmed')))
                .forEach( groups => {
                    self.log.debug('Groups %s Reset OnAlarm State', groups.name);
                    self.DiscoveredAccessories.Groups[groups.Id].OnAlarm = false;
            });
            self.log.debug('Leaving getGroupsStates function');
            return true;
        } catch (err) {
            self.log.error('Error on getGroupsStates: %s', err);
            return Promise.reject();
        }
    }

    async getOutputsStates(OutputsDatas) {
        var self = this;
        self.log.debug('Entering getOutputsStates function');
        try {
            Object.values(OutputsDatas)
                .forEach( output => {
                    const Id = output.deviceID;
                    if (self.DiscoveredAccessories.Outputs[Id] !== undefined) {
                        if (output.deviceType == 2) {
                            self.DiscoveredAccessories.Outputs[Id].State = false;
                        } else {
                            self.DiscoveredAccessories.Outputs[Id].State = ((output.lastCommand == 1) ? true : false);
                        }
                        self.log.debug('Output Id: %s Label: %s', Id, self.DiscoveredAccessories.Outputs[Id].name)
                    }
                });
            self.log.debug('Leaving getOutputsStates function');
            return true;
        } catch (err) {
            self.log.error('Error on getOutputsStates: %s', err);
            return false;
        }
    }

    async getDetectorsStates(DetectorsDatas) {
        var self = this;
        self.log.debug('Entering getDetectorsStates function');
        try {
            Object.values(DetectorsDatas)
                .forEach( detector => {
                    const Id = detector.zoneID;
                    if (self.DiscoveredAccessories.Detectors[Id] !== undefined) {
                        switch (detector.status) {
                            case 0:
                                self.DiscoveredAccessories.Detectors[Id].Bypassed = false;
                                self.DiscoveredAccessories.Detectors[Id].State = false;
                                break;
                            case 1:
                                self.DiscoveredAccessories.Detectors[Id].Bypassed = false;
                                self.DiscoveredAccessories.Detectors[Id].State = true;
                                break;
                            case 2:
                                self.DiscoveredAccessories.Detectors[Id].Bypassed = true;
                                self.DiscoveredAccessories.Detectors[Id].State = false;
                                break;
                            default:
                                self.DiscoveredAccessories.Detectors[Id].Bypassed = false;
                                self.DiscoveredAccessories.Detectors[Id].State = false;
                                break;
                        }
                        self.log.debug('Detector Id: %s Label: %s State:', Id, self.DiscoveredAccessories.Detectors[Id].name, ((self.DiscoveredAccessories.Detectors[Id].State)? 'Motion Detected' : 'Motion not Detected'));
                    }
                });
            self.log.debug('Leaving getDetectorsStates function');
            return true;
        } catch (err) {
            self.log.error('Error on getDetectorsStates: %s', err);
            return err;
        }
    }

    async getCPStates() {
        var self = this;
        self.log.debug('Entering getCPStates function');
        try {
            var PanelDatas = {};
            if (!(await self.SessionValidity())) { return PanelDatas; }
            if (self.SessionLogged) {
                self.log.debug('RiscoPanelSession is Ready');
                const responsePanel = await axios({
                    url: `https://www.riscocloud.com/webapi/api/wuws/site/${self.risco_siteId}/ControlPanel/GetState`,
                    method: 'POST',
                    headers: {
                        'User-Agent': `${iRiscoUserAgent}`,
                        'Authorization': `Bearer ${self.accessToken}`
                    },
                    data: {
                        'sessionToken': `${self.SessionId}`,
                        'fromControlPanel': false
                    },

                    validateStatus(status) {
                        return status == 200;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    self.log.error(NetworkErrorMsg(error));
                    return PanelDatas;
                });

                const responseCameras = await axios({
                    url: `https://www.riscocloud.com/webapi/api/wuws/site/${self.risco_siteId}/camera/GetAll`,
                    method: 'POST',
                    headers: {
                        'User-Agent': `${iRiscoUserAgent}`,
                        'Authorization': `Bearer ${self.accessToken}`
                    },
                    data: {
                        "sessionToken": `${self.SessionId}`
                    },

                    validateStatus(status) {
                        return status == 200;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    self.log.error(NetworkErrorMsg(error));
                    return PanelDatas;
                });
                if ((responsePanel.status == 200) && (responsePanel.statusText == 'OK') 
                    && (responsePanel.data.response !== null)) {
                    const RPStatus = responsePanel.data.response.state.status;
                    PanelDatas.Partitions = RPStatus.partitions;
                    PanelDatas.Detectors = RPStatus.zones;
                    PanelDatas.Outputs = RPStatus.haDevices;

                    for (var Parts in PanelDatas.Partitions) {
                        const PartId = PanelDatas.Partitions[Parts].id;
                        Object.values(RPStatus.devCollection)
                            .filter( devColl => (devColl.devType == 21))
                            .map( Collection => {
                                Object.values(Collection.devList)
                                    .filter( PartValues => (PartValues.num == PartId))
                                    .map( PartValue => {
                                        PanelDatas.Partitions[Parts].name = PartValue.desc;
                                    });
                            });
                    }
                }
                if ((responseCameras.status == 200 ) && (responseCameras.statusText == 'OK') 
                    && (responseCameras.data.response !== null)) {
                    PanelDatas.Cameras = responseCameras.data.response;
                }
                self.log.debug('Leaving getCPStates function');
                return PanelDatas;
            } else {
                self.log.debug('RiscoPanelSession is Not Ready');
                self.log.debug('Leaving getCPStates function');
                return PanelDatas;
            }
        } catch (err) {
            self.log.debug('Leaving getCPStates function');
            return Promise.reject(err);
        }
    }

    async UpdateCPStates() {
        var self = this;
        this.log.debug('Entering UpdateCPStates function');
        try {
            if (self.Ready === true) {
                await self.SessionValidity();
                if (self.SessionLogged) {
                    const PanelsDatas = await self.getCPStates();
                    if (((self.Partition || 'none') != 'none') && (PanelsDatas.Partitions != null)) {
                        await self.getPartsStates(PanelsDatas);
                    }
                    if (((self.Groups || 'none') != 'none') && (PanelsDatas.Partitions != null)) {
                        await self.getGroupsStates(PanelsDatas.Partitions);
                    }
                    if (((self.Outputs || 'none') != 'none') && (PanelsDatas.Outputs != null)) {
                        await self.getOutputsStates(PanelsDatas.Outputs);
                    }
                    if (((self.Detectors || 'none') != 'none') && (PanelsDatas.Detectors != null)) {
                        await self.getDetectorsStates(PanelsDatas.Detectors);
                    }
                    /*
                    if ((this.config['Cameras'] || 'none') != 'none') {
                        await self.getPartsStates();
                    }*/
                    if (PanelsDatas.Partitions != null) { await self.getAlarmState(PanelsDatas); }
                }
                self.log.debug('Leaving UpdateCPStates function');
            }
            return true;
        } catch (err) {

            self.log.error('Error on UpdateCPStates: %s', err);
            self.log.debug('Leaving UpdateCPStates function');
            return false;
        }
    }

    async armDisarm(partId, armedState, typeGroup = false) {
        //TODO : Add capability to restore exclude State
        var self = this;
        self.log.debug('Entering armDisarm function');
        try {
            if (!(await self.SessionValidity())) { return [0, NaN]; }
            if (self.SessionLogged) {
                var post_data = {
                        'sessionToken': `${self.SessionId}`,
                        'partitions' : []
                        };
                if (typeGroup) {
                    const group_data = [{
                        'id': partId,
                        'state': armedState
                    }];
                    Object.values(self.DiscoveredAccessories.Groups[partId].parentPart)
                        .forEach( parentPart => {
                            post_data.partitions.push({
                                'armedState': 1,
                                'id': parentPart,
                                'groups': group_data
                                });
                            });
                } else if (self.DiscoveredAccessories.Partitions.type == 'system') {
                    Object.values(self.DiscoveredAccessories.Partitions[0].childPart)
                        .forEach( child => {
                            post_data.partitions.push({
                                'armedState': armedState,
                                'id': child
                                });
                        });
                } else {
                    post_data.partitions.push({
                            'armedState': armedState,
                            'id': partId
                            });
                }
                const response = await axios({
                    url: `https://www.riscocloud.com/webapi/api/wuws/site/${self.risco_siteId}/ControlPanel/PartArm`,
                    method: 'POST',
                    json: true,
                    headers: {
                        'User-Agent': `${iRiscoUserAgent}`,
                        'Authorization': `Bearer ${self.accessToken}`
                    },
                    data: post_data,

                    validateStatus(status) {
                        return status == 200;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    self.log.error(NetworkErrorMsg(error));
                    return [0, NaN];
                });
                if (response.data.status == 200) {
                    //self.log.error('response arm: %s', JSON.Stringify(response.data))
                    var PanelDatas = {};
                    PanelDatas.Partitions = response.data.response.partitions;
                    if (!typeGroup) {
                        if (self.DiscoveredAccessories.Partitions.type == 'system') {
                            var ExitDelay = 0;
                            Object.values(self.DiscoveredAccessories.Partitions[0].childPart)
                                .forEach( idpart => {
                                    const part_datas = Object.values(PanelDatas.Partitions)
                                        .filter( partition => (partition.id == idpart));
                                    if (ExitDelay < Math.max(part_datas[0].exitDelayTO)) {
                                        ExitDelay = Math.max(part_datas[0].exitDelayTO);
                                    }
                                });
                            if (ExitDelay != 0) {
                                self.DiscoveredAccessories.Partitions[0].ExitDelay = ExitDelay;
                                self.log.debug('armDisarm System Ok. Timed arming in progress');
                                await self.getPartsStates(PanelDatas);
                                return [2, Math.max((ExitDelay) * 1000)];
                            } else {
                                self.log.debug('armDisarm Ok. Using this result for status update');
                                await self.getPartsStates(PanelDatas);
                                return [1, NaN];
                            }
                        } else {
                            const CurrentPart = Object.values(PanelDatas.Partitions)
                                .filter( partition => (partition.id == partId));
                            if ((CurrentPart[0].exitDelayTO) != 0) {
                                self.log.debug('armDisarm Ok. Timed arming in progress');
                                await self.getPartsStates(PanelDatas);
                                return [2, Math.max((CurrentPart[0].exitDelayTO) * 1000)];
                            } else {
                                self.log.debug('armDisarm Ok. Using this result for status update');
                                await self.getPartsStates(PanelDatas);
                                return [1, NaN];
                            }
                        }
                    } else {
                        self.log.debug('armDisarm Ok. Using this result for status update');
                        await self.getGroupsStates(PanelDatas);
                        return [1, NaN];
                    }
                } else {
                    throw new Error(`Bad HTTP Response: ${response.status}`);
                }
            } else {
                setTimeout( () => { this.armDisarm(partId, armedState, typeGroup); }, 500);
            }
        } catch (err) {
            self.log.error('Error on armDisarm function:\n%s', err);
            return [0, NaN];
        }
    }

    async OutputCommand(deviceType, lastCommand, deviceId) {
        var self = this;
        self.log.debug('Entering OutputCommand function');
        try {
            if (!(await self.SessionValidity())) { return false; }
            if (self.SessionLogged) {
                const response = await axios({
                    url: `https://www.riscocloud.com/webapi/api/wuws/site/${self.risco_siteId}/ControlPanel/SetOutputStatus`,
                    method: 'POST',
                    json: true,
                    headers: {
                        'User-Agent': `${iRiscoUserAgent}`,
                        'Authorization': `Bearer ${self.accessToken}`
                    },
                    data: {
                        'sessionToken': `${self.SessionId}`,
                        'devices': [{
                            'deviceType': deviceType,
                            'lastCommand': lastCommand,
                            'deviceID': deviceId
                        }]
                    },

                    validateStatus(status) {
                        return status == 200;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    self.log.error(NetworkErrorMsg(error));
                    return false;
                });
                if ( (response.data.status == 200) && (response.data.response !== null)){
                    self.log.debug('OutputCommand Ok. Using this result for status update');
                    await self.getOutputsStates(response.data.response.haDevices);
                    return true;
                } else {
                    throw new Error(`Bad HTTP Response: ${response.status}`);
                }
            } else {
                setTimeout( () => { this.OutputCommand(deviceType, lastCommand, deviceId); }, 500);
            }
        } catch (err) {
            self.log.error('Error on OutputCommand function:\n%s', err);
            return false;
        }
    }

    async SetBypass(status, zoneId) {
        var self = this;
        self.log.debug('Entering SetBypass function');
        try {
            if (!(await self.SessionValidity())) { return false; }
            if (self.SessionLogged) {
                const response = await axios({
                    url: `https://www.riscocloud.com/webapi/api/wuws/site/${self.risco_siteId}/ControlPanel/SetZoneBypassStatus`,
                    method: 'POST',
                    json: true,
                    headers: {
                        'User-Agent': `${iRiscoUserAgent}`,
                        'Authorization': `Bearer ${self.accessToken}`
                    },
                    data: {
                        'sessionToken': `${self.SessionId}`,
                        'zones': [{
                            'zoneID': zoneId,
                            'Status': status
                        }]
                    },

                    validateStatus(status) {
                        return status == 200;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    self.log.error(NetworkErrorMsg(error));
                    return false;
                });
                if (response.data.status == 200) {
                    self.log.debug('SetBypass Ok. Using this result for status update');
                    await self.getDetectorsStates(response.data.response.zones);
                    return true;
                } else {
                    throw new Error(`Bad HTTP Response: ${response.status}`);
                }
            } else {
                setTimeout( () => { this.SetBypass(status, zoneId); }, 500);
            }
        }catch(err){
            self.log.error('Error on SetBypass function:\n%s', err);
            return false;
        }
    }
}

module.exports.RiscoPanelSession = RiscoPanelSession;