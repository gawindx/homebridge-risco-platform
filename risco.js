var axios = require('axios');
var pollingtoevent = require('polling-to-event');

module.exports.RiscoPanelSession = RiscoPanelSession;

function extractError(aBody) {
    var serverInfo_begin = aBody.indexOf("<span class=\"infoServer\">");
    var serverInfo_end = aBody.indexOf("</span>", serverInfo_begin);
    return aBody.substring(serverInfo_begin + 26, serverInfo_end - 7);
}

function RiscoPanelSession(aConfig, aLog) {
    // Do not create new object if already exist
    // Avoid multiple Session to RiscoCloud
    if (!(this instanceof RiscoPanelSession)) {
        return new RiscoPanelSession(aConfig, aLog);
    }
    this.Ready = false;
    this.DiscoveredAccessories ;
    this.risco_panel_name = aConfig['name'];
    this.risco_username = encodeURIComponent(aConfig['riscoUsername']);
    this.risco_password = encodeURIComponent(aConfig['riscoPassword']);
    this.risco_pincode = aConfig['riscoPIN'];
    this.risco_siteId = aConfig['riscoSiteId'];
    this.polling = aConfig['polling'] || false;
    this.pollInterval = aConfig['pollInterval'] || 30000;
    this.Partition = aConfig['Partition'];
    this.Groups = aConfig['Groups'];
    this.log = aLog;
    this.req_counter = 0;
    this.riscoCookies;
    this.SessionLogged = false;

    this.long_event_name = 'RPS_long_' + (this.risco_panel_name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');

    var self = this;

    // set up polling if requested
    if (self.polling) {
        self.log.info('Starting polling with an interval of %s ms', self.pollInterval);
        emitter = pollingtoevent(function (done) {
            self.getCPStates(function (err, result) {
                done(err, result);
            });
        }, {
                longpollEventName: self.long_event_name,
                longpolling: true,
                interval: self.pollInterval
            });

        emitter.on(self.long_event_name, function (state) {
            if (state) {
                // Get OnceMore time Current State:
                self.log.info('New state detected: (' + state + ') -> ' + translateState(state) + '. Notify!');
                self.securityService.setCharacteristic(Characteristic.SecuritySystemCurrentState, state);
                self.riscoCurrentState = state;
            }
        });

        emitter.on("err", function (err) {
            self.log.error("Polling failed, error was %s", err);
        });
    }
}

RiscoPanelSession.prototype = {
    IsLogged(){
        return self.SessionLogged;
    },

    async login() {
        var self = this;
        self.log.debug('Entering Login Function');
        try{
            if (!self.SessionLogged){

                const post_data = 'username=' + self.risco_username + '&password=' + self.risco_password;
                const resp_s1 = await axios({
                    url: 'https://www.riscocloud.com/ELAS/WebUI/',
                    method: 'POST',
                    headers: {
                        'Content-Length': post_data.length,
                        'Content-type': 'application/x-www-form-urlencoded'
                    },
                    data: post_data,

                    validateStatus(status) {
                        return status >= 302 && status < 400;
                    },
                    maxRedirects: 0,
                });
                
                if (resp_s1.status == 302) {
                    self.log.debug('Logged In Stage 1');
                    self.riscoCookies = JSON.stringify(resp_s1.headers['set-cookie']);
                    self.log.debug('Cookie : ' + self.riscoCookies);

                    const post_data = 'SelectedSiteId=' + self.risco_siteId + '&Pin='+ self.risco_pincode;
                    const resp_s2 = await axios({
                        url: 'https://www.riscocloud.com/ELAS/WebUI/SiteLogin',
                        method: 'POST',
                        headers: {
                            Cookie: self.riscoCookies,
                            Host: 'www.riscocloud.com',
                            Origin: 'https://www.riscocloud.com',
                            Referer: 'https://www.riscocloud.com/ELAS/WebUI/SiteLogin/Index',
                            'Content-Length': post_data.length,
                            'Content-type': 'application/x-www-form-urlencoded'
                        },
                        data: post_data,

                        validateStatus(status) {
                            return status >= 302 && status < 400;
                        },
                        maxRedirects: 0,                        
                    });

                    if (resp_s2.status == 302) {
                        self.SessionLogged = true;
                        self.log.debug('Logged In Stage 2');
                        self.log.info('Logged In Cloud');
                        await self.ValidateUserCode();
                    } else {
                        self.riscoCookies = '';
                    }
                } else {
                    throw new Error('Bad HTTP Response : ' + resp_s1.status);
                }
            }
        } catch (err) {
            self.log.error('Error on login : ' + err);
            self.SessionLogged = false;
            self.riscoCookies = '';
        }
    },

    async logout(callback) {
        var self = this;
        self.log.debug('Entering Logout Function');
        try {
            if (self.SessionLogged) {
                const resp_s1 = await axios({
                    url: 'https://www.riscocloud.com/ELAS/WebUI/UserLogin/Logout',
                    method: 'GET',
                    headers: {
                        Cookie: self.riscoCookies,
                        Host: 'www.riscocloud.com',
                        Origin: 'https://www.riscocloud.com',
                        Referer: 'https://www.riscocloud.com/ELAS/WebUI/SiteLogin/Index',
                    },
                    
                    validateStatus(status) {
                        return status >= 302 && status < 400;
                    },
                    maxRedirects: 0,
                });

                if (resp_s1.status == 302){
                    const resp_s2 = await axios({
                        url: 'https://www.riscocloud.com/ELAS/WebUI/UserLogin/LogoutUser',
                        method: 'GET',
                        headers: {
                            Cookie: self.riscoCookies,
                            Host: 'www.riscocloud.com',
                            Origin: 'https://www.riscocloud.com',
                            Referer: 'https://www.riscocloud.com/ELAS/WebUI/SiteLogin/Index',
                        },  
                    
                        validateStatus(status) {
                            return status >= 302 && status < 400;
                        },
                        maxRedirects: 0,
                    });
                    if (resp_s2.status == 302){
                        self.SessionLogged = false;
                        self.riscoCookies = '';
                        self.log.info('Logout from Cloud');
                        return Promise.resolve();
                    } else {
                        throw new Error('Bad HTTP Response : ' + resp_s2.status);
                    }
                } else {
                    throw new Error('Bad HTTP Response : ' + resp_s1.status);
                }

            } else {
                self.riscoCookies = '';
                return Promise.resolve();
            }
        } catch (err) {
            self.log.error(err);
            self.SessionLogged = false;
            self.riscoCookies = '';
            return Promise.reject(err);
        }
    },

    async IsUserCodeExpired(){
        var self = this;
        self.log.debug('Check User Code expiration');
        try {
            const response = await axios({
                url: 'https://www.riscocloud.com/ELAS/WebUI/SystemSettings/IsUserCodeExpired',
                method: 'POST',
                headers: {
                    'Referer': 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                    'Origin': 'https://www.riscocloud.com',
                    'Cookie': self.riscoCookies
                },
                data: {},

                validateStatus(status) {
                    return status >= 200 && status < 400;
                },
                maxRedirects: 0,
            });

            if (response.status == 200) {
                self.log.debug('User Code Expired ? ' + response.data.pinExpired );
                return response.data.pinExpired;
            } else {
                throw new Error('Bad HTTP Response : ' + response.status);
            }
        } catch (err) {
            self.log.error('UserCodeExpired error : ' + err );            
        }
    },

    async ValidateUserCode() {
        var self = this;
        self.log.debug('User Code Validation');
        try {
            const post_data = 'code=' + self.risco_pincode;
            const response = await axios({
                url: 'https://www.riscocloud.com/ELAS/WebUI/SystemSettings/ValidateUserCode',
                method: 'POST',
                headers: {
                    'Referer': 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                    'Origin': 'https://www.riscocloud.com',
                    'Cookie': self.riscoCookies,
                    'Content-Length': post_data.length,
                    'Content-type': 'application/x-www-form-urlencoded'
                },
                data: post_data,

                validateStatus(status) {
                    return status >= 200 && status < 400;
                },
                maxRedirects: 0,
            });

            if (response.status ==200) {
                if (response.data.error == 14) {
                    throw new Error('PinCode Error');
                } else if (response.data.error == 0) {
                    self.log.debug('User Code Validation : Ok');
                    return true;
                }                
            } else {
                throw new Error('Bad HTTP Response : ' + response.status);
            }
        } catch (err) {
            self.log.error('Error on Validate User Code' + err);
        }
    },

    async KeepAlive() {
        var self = this;
        self.log.debug('Entering KeepAlive Function');
        try{
            if (!self.SessionLogged){
                self.log.debug('Not Logged. Need to ReLogin');
                await self.login();
                return null;
            } else {
                if (await self.IsUserCodeExpired() == true) {
                    self.log.debug('Code Expired')
                    await self.ValidateUserCode();
                }
                self.req_counter++;
                if (self.req_counter > 10) {
                    self.log.debug('Reset counter and launch function KeepAlive');
                    self.req_counter = 0;
                    const response = await axios({
                        url: 'https://www.riscocloud.com/ELAS/WebUI/Security/GetCPState?userIsAlive=true',
                        method: 'POST',
                        headers: {
                            'Referer': 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                            'Origin': 'https://www.riscocloud.com',
                            'Cookie': self.riscoCookies,
                        },
                        data: {},

                        validateStatus(status) {
                            return status >= 200 && status < 400;
                        },
                        maxRedirects: 0,
                    });

                    if ( (response.headers['Location'] == '/ELAS/WebUI/UserLogin/SessionExpired') || (response.data.error == 3)) {
                        self.SessionLogged = false;
                        self.log.info('Session Expired. ReLogin');
                        await self.login();
                    } else if (response.status != 200) {
                        self.log.debug(response);
                        throw new Error('KeepAlive Bad HTTP Response : ' + response.status);
                    }
                    if (response.data.overview !== null){
                        self.log.debug('Status change since the last scan. Manual update of the values.');
                        return response.data;
                    } else {
                        self.log.debug('Status not changed since the last scan.');
                        return null;
                    }
                } else {
                    return null;
                }

            }
        } catch (err) {
            self.log.error('Error on KeepAlive: ' +err);
            return null;
        }
    },

    async DiscoverParts() {
        var self = this;
        self.log.debug('Entering DiscoverParts Function');
        try {
            await self.KeepAlive();

            var risco_Part_API_url;

            if (self.Partition == 'system'){
                self.log.debug('Partition Mode Off');
                risco_Part_API_url = 'https://www.riscocloud.com/ELAS/WebUI/Overview/Get';
            } else {
                self.log.debug('Partition Mode On');
                risco_Part_API_url = 'https://www.riscocloud.com/ELAS/WebUI/Detectors/Get'
            }

            var response;
            const post_data = {};
            response = await axios({
                url: risco_Part_API_url,
                method: 'POST',
                headers: {
                    Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                    Origin: 'https://www.riscocloud.com',
                    Cookie: self.riscoCookies
                },
                data: {},

                validateStatus(status) {
                    return status >= 200 && status < 400;
                },
                maxRedirects: 0,                        
            });

            if (response.status == 200) {

                const body = response.data;
                self.log.debug(body);

                var Parts_Datas = {};

                if (self.Partition == 'system') {
                    Parts_Datas.type = 'system';
                    var Part_Data = {
                        id: 0,
                        name: self.risco_panel_name,
                        Required: 'system',
                        previousState: null,
                        actualState: (function(){
                            var armedZones = body.overview.partInfo.armedStr.split(' ');
                            var partArmedZones = body.overview.partInfo.partarmedStr.split(' ');
                            if (parseInt(armedZones[0]) > 0) {
                                return 'armed';
                            } else if (parseInt(partArmedZones[0]) > 0) {
                                return 'partial';
                            } else {
                                return 'disarmed';
                            }    
                        })(),
                        armCommand: 'armed',
                        nightCommand: 'partially',
                        homeCommand: 'partially',
                        disarmCommand: 'disarmed'
                    };
                    Parts_Datas[0] = Part_Data;
                    Parts_Datas.type = 'system';
                } else {
                    for (var PartId in body.detectors.parts) {
                        var Part_Data = {
                            id: body.detectors.parts[PartId].id,
                            name: body.detectors.parts[PartId].name,
                            Required: null,
                            ExitDelay: 0,
                            previousState: null,
                            actualState: (body.detectors.parts[PartId].armIcon).match(/ico-(.*)\.png/)[1],
                            armCommand: 'armed',
                            nightCommand: 'partially',
                            homeCommand: 'partially',
                            disarmCommand: 'disarmed'
                        };
                        self.log.debug('Discovering Partition : ' + body.detectors.parts[PartId].name + ' with Id : ' + body.detectors.parts[PartId].id);
                        if (self.Partition == 'all') {
                            self.log.debug('All Partitions Required');
                            Part_Data.Required = true;
                        } else if (self.Partition != (self.Partition.split(',')) || ( parseInt(self.Partition) != NaN )){
                            self.log.debug('Not All Partitions Required');
                            //Automatically convert string value to integer
                            const Required_Zones = self.Partition.split(',').map(function(item) {
                                return parseInt(item, 10);
                            });
                            if (Required_Zones.includes(Part_Data.id) !== false){
                                self.log.debug('Partitions "' + body.detectors.parts[PartId].name + '" Required');
                                Part_Data.Required = true;
                            } else {
                                self.log.debug('Partitions "' + body.detectors.parts[PartId].name + '" Not Required');
                                Part_Data.Required = false;
                            }
                        } else {
                            self.log.debug('No Partitions Required');
                            Part_Data.Required = false;
                        }
                        Parts_Datas[Part_Data.id] = Part_Data;
                    }
                    Parts_Datas.type = 'partition';
                }
                self.log.info('Discovered '+ ( Object.keys(Parts_Datas).length - 1 ) + ' Partitions');
                return Parts_Datas;
            } else {
                throw new Error('Cannot Retrieve Partitions Infos');
            }
        } catch (err) {
            self.log.error('Error on Discovery Partition : ' + err);
        }
    },

    async DiscoverGroups() {
        var self = this;
        try {
            await self.KeepAlive();

            var response;
            response = await axios({
                url: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                method: 'GET',
                headers: {
                    Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                    Origin: 'https://www.riscocloud.com',
                    Cookie: self.riscoCookies
                },

                validateStatus(status) {
                    return status >= 200 && status < 400;
                },
                maxRedirects: 0,                        
            });

            if (response.status == 200){
                self.log.debug('Groups Status: ' + response.status);
                var GroupInfo = (function() { 
                    var GroupInfo_begin = response.data.indexOf('<label for="actGrpItem');
                    self.log.debug('Groups => HTML Output Info start at : ' + GroupInfo_begin);
                    var GroupInfo_end = response.data.indexOf('</section>', GroupInfo_begin);
                    self.log.debug('Groups => HTML Output Info finish at : ' + GroupInfo_end);
                    var Groups_list = response.data.substring(GroupInfo_begin , GroupInfo_end - 11).match(/<label for="actGrpItem\d">.*?<\/div>/gs);
                    self.log.info('Discovered '+ Groups_list.length + ' Groups');
                    
                    var Groups_Datas = {};
                    var ParentPartList = response.data.match(/<label data-groups=".*">.*<.*OpenPartGroups.*?\)\'/gm);

                    for (var Group in Groups_list){
                        var GroupName = Groups_list[Group].match(/<label for="actGrpItem\d">(.*?)<\/label>/s)[1];
                        var Group_Data = {
                            id: parseInt(Groups_list[Group].match(/<label for="actGrpItem(\d)">/s)[1], 10),
                            name: 'Group ' + GroupName,
                            parentPart: (function(){
                                var resultArray = [];
                                self.log('parentpart');
                                for (var ParentPart in ParentPartList) {
                                    var ParentPartId = ParentPartList[ParentPart].match(new RegExp('<label data-groups=".*?' + GroupName+ '.*?">.*<.*OpenPartGroups\\("(\\d*?)"','gm'));
                                    if (ParentPartId != null ){
                                        resultArray.push((''+ParentPartId).match(/"(\d*?)"$/s)[1]);
                                    }
                                }
                                return resultArray;
                            })(),
                            Required: null,
                            previousState: null,
                            actualState: (function() {
                                var result_State = 'Disarmed';
                                    var Group_Status = Groups_list[Group].match(/<span.*?area\s.*?">.*?input.*?"radio"\s.*?\s?name=.*?>/gs);
                                    for (var Status in Group_Status){
                                        var State = Group_Status[Status].match(/<span.*?area\s(.*?)">.*input.*"radio"\s?(checked)\s?name=.*>/s);
                                        if ((State !== null) && ( State.length > 1 ) && ( State[2] == 'checked' )){
                                            result_State = State[1];
                                        }
                                    }
                                    return result_State;
                                })(),
                        };
                        self.log.debug('Discovering Group : "' + Group_Data.name + '" with Id : ' + Group_Data.id);
                        if (self.Groups == 'all') {
                            self.log.debug('All Groups Required');
                            Group_Data.Required = true;
                        } else if (self.Groups != (self.Groups.split(',')) || ( parseInt(self.Groups) != NaN )){
                            self.log.debug('Not All Groups Required');
                            //Automatically convert string value to integer
                            const Required_Groups = self.Groups.split(',').map(function(item) {
                                return parseInt(item, 10);
                            });
                            if (Required_Groups.includes(Group_Data.id) !== false){
                                self.log.debug('Group "' + Group_Data.name + '" Required');
                                Group_Data.Required = true;
                            } else {
                                self.log.debug('Group "' + Group_Data.name + '" Not Required');
                                Group_Data.Required = false;
                            }
                        }

                        Groups_Datas[Group_Data.id] = Group_Data;
                    }
                    self.log.debug(JSON.stringify(Groups_Datas));
                    return Groups_Datas;
                })();
                return GroupInfo;
            } else {
                throw new Error('Bad HTTP Response : ' + response.status);
            }
        } catch (err) {
            self.log.error(err);
        }
    },

    async DiscoverOutputs() {
        var self = this;
      
        try {
            await self.KeepAlive();
            var response;
            response = await axios({
                url: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                method: 'GET',
                headers: {
                    Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                    Origin: 'https://www.riscocloud.com',
                    Cookie: self.riscoCookies
                },

                validateStatus(status) {
                    return status >= 200 && status < 400;
                },
                maxRedirects: 0,                        
            }); 

            if (response.status == 200){
                var OutputInfo = (function() { 
                    var OutputInfo_begin = response.data.indexOf('<ul style="list-style:none; margin:0; padding:0;">');
                    self.log.debug('HTML Output Info start at : ' + OutputInfo_begin);
                    var OutputInfo_end = response.data.indexOf('</ul>', OutputInfo_begin);
                    self.log.debug('HTML Output Info finish at : ' + OutputInfo_end);
                    var Output_list = response.data.substring(OutputInfo_begin + 50, OutputInfo_end - 5).match(/<li.*?<\/li>/gs);
                    self.log.info('Discovered '+ Output_list.length + ' Output');
                    var Outputs_Datas = {};
                    for (var list in Output_list){
                        self.log.debug(Output_list[list]);
                        var Output_Cmd = Output_list[list].match(/onclick="(.*?);/s)[1]
                        var Output_Data = {
                            Id: Output_list[list].match(/id=".*?(\d*)"/s)[1],
                            name: Output_list[list].match(/<.*[\d|e]">(.*)<\/[s|l]/)[1],
                            Command: Output_Cmd,
                            Type: (function() {
                                    if (Output_Cmd.match(/(\d)\)$/) == null) {
                                        return 'pulse';
                                    } else {
                                        return 'switch';
                                    }
                                })(),
                            Value: (function(){ 
                                    if (Output_Cmd.match(/(\d)\)$/) == null) {
                                        return 0;
                                    } else {
                                        return Math.abs(parseInt(Output_Cmd.match(/(\d)\)$/)[1]) - 1);
                                    }
                                })()
                        };

                        self.log.debug('name : ' + Output_Data.name);
                        self.log.debug('Id : ' + Output_Data.Id);
                        self.log.debug('Command : ' + Output_Data.Command);
                        self.log.debug('Type : ' + Output_Data.Type);
                        self.log.debug('Value  : ' + Output_Data.Value);
                        Outputs_Datas[Output_Data.Id] = Output_Data;
                    }
                    self.log.debug(JSON.stringify(Outputs_Datas));
                    return Outputs_Datas;
                })();
                return OutputInfo;
            } else {
                throw new Error('Bad HTTP Response : ' + response.status);
            }
        } catch (err) {
            self.log.error(err);
        }
    },

    async DiscoverDetectors() {
        var self = this;
      
        try {
            await self.KeepAlive();

            var response;
            response = await axios({
                url: 'https://www.riscocloud.com/ELAS/WebUI/Detectors/Get',
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
            }); 

            if (response.status == 200){
                self.log.debug('Detectors/Get status: ' + response.status);
                var DetectorsInfos = (function() {
                    self.log.debug(JSON.stringify(response.data));
                    var Detectors_Datas = {};
                    for (var Parts in response.data.detectors.parts){
                        for (var Detector in response.data.detectors.parts[Parts].detectors){
                            self.log.debug(JSON.stringify(response.data.detectors.parts[Parts].detectors[Detector]));
                            var Detector_Data = {
                                id: response.data.detectors.parts[Parts].detectors[Detector].id,
                                bypassed: response.data.detectors.parts[Parts].detectors[Detector].bypassed,
                                type: response.data.detectors.parts[Parts].detectors[Detector].data_icon,
                                Partition: Parts,
                                name: (function() {
                                            var tmp_name = response.data.detectors.parts[Parts].detectors[Detector].name;
                                            return tmp_name.replace(/&#(\d+);/g, function(match, dec) {
                                                return String.fromCharCode(dec);
                                            });
                                })()
                            };
                            Detectors_Datas[Detector_Data.id] = Detector_Data;
                        }
                    }
                    return Detectors_Datas;
                })();
                self.log.info('Discovered '+ Object.keys(DetectorsInfos).length + ' Detector(s)');
                return DetectorsInfos;
            } else {
                throw new Error('Bad HTTP Response : ' + response.status);
            }
        } catch (err) {
            self.log.error(err);
        }
    },

    async DiscoverCameras() {
        var self = this;
      
        try {
            await self.KeepAlive();

            var response;
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
            });            

            if (response.status == 200){
                self.log.debug('Cameras/Get status: ' + response.status);
                var CamerasInfos = (function() {
                    self.log.debug(JSON.stringify(response.data));
                    var Cameras_Datas = {};
                    for (var Camera in response.data.cameras.camInfo){
                        self.log.debug(JSON.stringify(response.data.cameras.camInfo[Camera]));
                        var Camera_Data = {
                                id: response.data.cameras.camInfo[Camera].id,
                                name: response.data.cameras.camInfo[Camera].title,
                                lastcapture: response.data.cameras.camInfo[Camera].photoSrc,
                                isNet: response.data.cameras.camInfo[Camera].isNet,
                            };
                            Cameras_Datas[Camera_Data.id] = Camera_Data;
                        }
                    return Cameras_Datas;
                })();
                self.log.info('Discovered '+ Object.keys(CamerasInfos).length + ' Camera(s)');
                return CamerasInfos;
            } else {
                throw new Error('Bad HTTP Response : ' + response.status);
            }
        } catch (err) {
            self.log.error(err);
        }
    },

    async getPartsStates(body) {
        var self = this;
        self.log.debug('Entering getPartStates function');
        try {
            if (self.DiscoveredAccessories.partitions.type == 'system'){
                self.log.debug('System Mode');
                self.DiscoveredAccessories.partitions[0].previousState = self.DiscoveredAccessories.partitions[0].actualState;
                self.DiscoveredAccessories.partitions[0].actualState = (function(){
                    var armedZones = body.overview.partInfo.armedStr.split(' ');
                    var partArmedZones = body.overview.partInfo.partarmedStr.split(' ');
                    if (parseInt(armedZones[0]) > 0) {
                        return 'armed';
                    } else if (parseInt(partArmedZones[0]) > 0) {
                        return 'partial';
                    } else {
                        return 'disarmed';
                    }    
                })();
                self.log.debug('Previous State: ' + self.DiscoveredAccessories.partitions[0].previousState);
                self.log.debug('Actual State: ' + self.DiscoveredAccessories.partitions[0].actualState);
                if (Math.max(body.ExitDelayTimeout) != 0){
                    self.DiscoveredAccessories.partitions[Id].ExitDelay = Math.max(body.ExitDelayTimeout);
                    self.log.debug('Arming Delay Left: ' + self.DiscoveredAccessories.partitions[Id].ExitDelay);
                }
            } else {
                self.log.debug('Partition Mode');
                if (Math.max(body.ExitDelayTimeout) != 0){
                    for (var PartId in body.ExitDelayTimeout){
                       if (body.ExitDelayTimeout[PartId] != 0){
                            self.DiscoveredAccessories.partitions[PartId].ExitDelay = body.ExitDelayTimeout[PartId];
                            self.log.debug('Arming Delay Left for Part "' + self.DiscoveredAccessories.partitions[PartId].name + '": ' + self.DiscoveredAccessories.partitions[PartId].ExitDelay);
                        }
                    }
                }
                if (body.detectors != null) {
                    for (var PartId in body.detectors.parts) {
                       const Id = body.detectors.parts[PartId].id;
                       self.DiscoveredAccessories.partitions[Id].previousState = self.DiscoveredAccessories.partitions[Id].actualState;
                       self.DiscoveredAccessories.partitions[Id].actualState = (body.detectors.parts[PartId].armIcon).match(/ico-(.*)\.png/)[1];
                        self.log.debug('Partition Id: ' + Id + ' Label: ' + self.DiscoveredAccessories.partitions[Id].name)
                        self.log.debug('Previous State: ' + self.DiscoveredAccessories.partitions[Id].previousState);
                        self.log.debug('Actual State: ' + self.DiscoveredAccessories.partitions[Id].actualState);
                    }
                }
            }
            self.log.debug('Leaving getPartStates function');
            return Promise.resolve();
        } catch (err) {
            self.log.error('Error on Get Partitions States : ' + err);
            return Promise.reject();
        }
    },

    async getGroupsStates(body) {
        var self = this;
        self.log.debug('Entering getGroupsStates function');
        try {
            for (var GroupId in body.allGrpState.GlobalState) {
                    const Id = body.allGrpState.GlobalState[GroupId].Id;
                    self.DiscoveredAccessories.Groups[Id].previousState = self.DiscoveredAccessories.Groups[Id].actualState;
                    self.DiscoveredAccessories.Groups[Id].actualState = (function(){
                            self.log.debug('Group Armed State? ' + body.allGrpState.GlobalState[GroupId].Armed);
                            self.log.debug(body.allGrpState.GlobalState);
                            return ((body.allGrpState.GlobalState[GroupId].Armed != false)?'armed':'disarmed');
                        })();
                    self.log.debug('Group Id: ' + Id + ' Label: ' + self.DiscoveredAccessories.Groups[Id].name)
                    self.log.debug('Previous State: ' + self.DiscoveredAccessories.Groups[Id].previousState);
                    self.log.debug('Actual State: ' + self.DiscoveredAccessories.Groups[Id].actualState);
                }
            self.log.debug('Leaving getGroupsStates function');
            return Promise.resolve();
        } catch (err) {
            self.log.error('Error on getGroupsStates : ' + err);
            return Promise.reject();
        }
    },

    async getCPStates() {
        var self = this;
        self.log.debug('Entering getCPStates function');
        try{
            var body;
            const KA_rslt = await self.KeepAlive();
            if ( (self.Ready === true ) && ( self.SessionLogged)) {
                self.log.debug('RiscoPanelSession is Ready');
                if (KA_rslt === null){
                    self.log.debug('KeepAlive does not signal a change or has not been tested.');
                    const response = await axios({
                        url: 'https://www.riscocloud.com/ELAS/WebUI/Security/GetCPState',
                        method: 'POST',
                        headers: {
                            Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                            Origin: 'https://www.riscocloud.com',
                            Cookie: self.riscoCookies
                        },
                        data: {},

                        validateStatus(status) {
                            return status >= 200 && status < 400;
                        },
                        maxRedirects: 0,                        
                    });
                    if (response.status == 200) {
                        body = response.data;
                    } else {
                        throw new Error('Cannot Retrieve Partitions States');
                    }
                } else {
                    self.log.debug('KeepAlive report a change. Using its result for status update.');
                    body = KA_rslt;
                }
                self.UpdateCPStates(body);
            } else {
                self.log.debug('RiscoPanelSession is Not Ready');
            }
            return Promise.resolve(true);
        } catch (err) {
            return Promise.reject(err);
        }
    },

    async UpdateCPStates(body) {
        var self = this;
        self.log.debug('Entering UpdateCPStates function');
        try{
            if (((this.Partition || 'none') != 'none') && ((body.detectors != null) || (Math.max(body.ExitDelayTimeout) != 0 ))) {
                await self.getPartsStates(body);
            }
            if (((this.Groups || 'none') != 'none') && (body.allGrpState != null)){
                await self.getGroupsStates(body);
            }
            return Promise.resolve(true);
        } catch (err) {
            return Promise.reject(err);
        }
    },

    async armDisarm(aState, cmd) {
        //TODO : Add capability to restore exclude State
        var self = this;
        self.log.debug('Entering armDisarm function');
        try {
            await self.KeepAlive();

            var targetType = cmd;
            var targetPasscode;
            if (aState) {
                // ARM
                self.log.debug('Arming command: ' + targetType);
                targetPasscode = "";
            } else {
                // DISARM or Refresh
                self.log.debug('Disarming or Refreshing command: ' + targetType);
                targetPasscode = "------"
            }

            const response = await axios({
                url: 'https://www.riscocloud.com/ELAS/WebUI/Security/ArmDisarm',
                method: 'POST',
                headers: {
                    Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                    Origin: 'https://www.riscocloud.com',
                    Cookie: self.riscoCookies,
                    'Content-type': 'application/x-www-form-urlencoded'
                },
                data: 'type=' + targetType + '&passcode=' + targetPasscode + '&bypassZoneId=-1',

                validateStatus(status) {
                    return status >= 200 && status < 400;
                },
                maxRedirects: 0,                        
            });

            if (response.status == 200){
                if (response.data.armFailures !== null ){
                    self.log.debug('armDisarm Not Ok. Using this result for status update');
                    self.log.debug('errType: ' + response.data.armFailures.errType +' Reason: ' + response.data.armFailures.text);
                    //Todo :
                    // return more info
                    self.UpdateCPStates(response.data);
                    return [0, NaN];
                } else {
                    if ((parseInt(response.data.ExitDelayTimeout) != 0)) {
                        self.log.debug('armDisarm Ok. Timed arming in progress');
                        return [2, (( parseInt(response.data.ExitDelayTimeout) + 2 )*1000)];
                    } else {
                        self.log.debug('armDisarm Ok. Using this result for status update');
                        self.UpdateCPStates(response.data);
                        return [1, NaN];
                    }
                }

            } else {
                throw new Error('Bad HTTP Response: ' + response.status);
            }
        }catch(err){
            self.log('Error on armDisarm function: ' + err);
            return [0, NaN];
        }
    }
}
