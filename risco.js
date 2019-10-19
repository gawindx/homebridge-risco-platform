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
    this.DiscoveredAccessories ;
    this.risco_panel_name = aConfig['name'];
    this.risco_username = encodeURIComponent(aConfig['riscoUsername']);
    this.risco_password = encodeURIComponent(aConfig['riscoPassword']);
    this.risco_pincode = aConfig['riscoPIN'];
    this.risco_siteId = aConfig['riscoSiteId'];
    this.polling = aConfig['polling'] || false;
    this.pollInterval = aConfig['pollInterval'] || 30000;
    this.Partition = aConfig['Partition'];
    this.Partition_Mode = aConfig['Partition_Mode']||false;
    this.Partition_List = aConfig['Partition_List']||'0';
    this.log = aLog;
    this.req_counter = 0;
    this.riscoCookies;
    this.SessionLogged = false;
    this.PolledData={
        Output: {
            lastPolled: null,
            Data: null
        },
        Partitions: {
            lastPolled: null,
            Data: null
        },
        Groups: {
            lastPolled: null,
            Data: null
        },
        Detectors: {
            lastPolled: null,
            Data: null
        },
        Cameras: {
            lastPolled: null,
            Data: null
        },
        Overview: {
            lastPolled: null,
            Data: null            
        },
        CPState: {
            lastPolled: null,
            Data: null            
        },
    };

    this.long_event_name = 'RPS_long_' + (this.risco_panel_name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');

    var self = this;

    // set up polling if requested
    if (self.polling) {
        self.log.info('Starting polling with an interval of %s ms', self.pollInterval);
        var emitter = new pollingtoevent(function (done) {
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
        try{
            if (!self.SessionLogged){
                await self.login();
            } else {
                if (await self.IsUserCodeExpired() == true) {
                    self.log.debug('Code Expired')
                    await self.ValidateUserCode();
                }
                self.req_counter++;
                if (self.req_counter > 10) {
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
                        throw new Error('Bad HTTP Response : ' + response.status);
                    } else {
                        self.PolledData.CPState.lastPolled = Date.now();
                        self.PolledData.CPState.Data = response;
                    }
                }
            }
        } catch (err) {
            self.log.error(err);
        }
    },

    async DiscoverParts() {
        var self = this;
        try {
            await self.KeepAlive();

            var SelfPolledData;
            var risco_Part_API_url;

            if (self.Partition == 'system'){
                SelfPolledData = self.PolledData.Overview;
                risco_Part_API_url = 'https://www.riscocloud.com/ELAS/WebUI/Overview/Get';
            } else {
                SelfPolledData = self.PolledData.Partitions;
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
            SelfPolledData.lastPolled = Date.now();
            SelfPolledData.Data = response;

            var DiscoveredPartitions = {
                type: null,
                required: null,
                value: null
            };

            if (response.status == 200) {

                const body = response.data;
                self.log.debug(body);

                var Parts_Datas = {};

                if (self.Partition == 'system') {
                    self.log.debug('Partition Mode Off');
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
                    self.log.debug('Partition Mode On');
                    for (var PartId in body.detectors.parts) {
                        var Part_Data = {
                            id: body.detectors.parts[PartId].id,
                            name: body.detectors.parts[PartId].name,
                            Required: null,
                            previousState: null,
                            actualState: (body.detectors.parts[PartId].armIcon).match(/ico-(.*)\.png/)[1],
                            armCommand: 'armed',
                            nightCommand: 'partially',
                            homeCommand: 'partially',
                            disarmCommand: 'disarmed'
                        };
                        self.log('Partition type ' + self.Partition);
                        if (self.Partition == 'all') {
                            self.log.debug('All Partitions Required');
                            Part_Data.Required = true;
                        } else if (self.Partition != (self.Partition.split(',')) || ( parseInt(self.Partition) != NaN )){
                            //Automatically convert string value to integer
                            const Required_Zones = self.Partition.split(',').map(function(item) {
                                return parseInt(item, 10);
                            });
                            self.log('req ' + Required_Zones);
                            self.log('includes ? ' + Required_Zones.includes(Part_Data.id));
                            for (var dudu in Required_Zones){
                                self.log('dudu '+ dudu);
                            }

                            if (Required_Zones.includes(Part_Data.id) !== false){
                                Part_Data.Required = true;
                            } else {
                                Part_Data.Required = false;
                            }
                            self.log.debug('Some Partitions Required');
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

            const Now = Date.now();
            if  (!self.PolledData.Groups.lastPolled) {
                self.PolledData.Groups.lastPolled = Now - (2*self.pollInterval);
            }
            const lastPolled_Diff = Now - self.PolledData.Groups.lastPolled;
            var response;
            if ( lastPolled_Diff >= self.pollInterval ){

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
                self.PolledData.Groups.lastPolled = Date.now();
            } else {
                response = self.PolledData.Groups.Data;
            }
            
            if (response.status == 200){
                self.log.debug('Groups Status: ' + response.status);
                var GroupInfo = (function() { 
                    var GroupInfo_begin = response.data.indexOf('<label for="actGrpItem');
                    self.log.debug('Groups => HTML Output Info start at : ' + GroupInfo_begin);
                    var GroupInfo_end = response.data.indexOf('</section>', GroupInfo_begin);
                    self.log.debug('Groups => HTML Output Info finish at : ' + GroupInfo_end);
                    //var Groups_list = response.data.substring(GroupInfo_begin , GroupInfo_end - 11).match(/<label for="actGrpItem\d">.*?<\/label>/gs);
                    var Groups_list = response.data.substring(GroupInfo_begin , GroupInfo_end - 11).match(/<label for="actGrpItem\d">.*?<\/div>/gs);
                    self.log.info('Discovered '+ Groups_list.length + ' Group');
                    var Groups_Datas = {};
                    for (var Group in Groups_list){
                        var Group_Data = {
                            id: Groups_list[Group].match(/<label for="actGrpItem(\d)">/s)[1],
                            name: Groups_list[Group].match(/<label for="actGrpItem\d">(.*?)<\/label>/s)[1],
                            status: (function() {
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

                        self.log.debug('name : ' + Group_Data.name);
                        self.log.debug('Id : ' + Group_Data.id);
                        self.log.debug('status  : ' + Group_Data.status);
                        Groups_Datas[Group_Data.id] = Group_Data;
                        self.log.info(JSON.stringify(Group_Data));
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

            const Now = Date.now();
            if  (!self.PolledData.Outputs.lastPolled) {
                self.PolledData.Outputs.lastPolled = Now - (2*self.pollInterval);
            }
            const lastPolled_Diff = Now - self.PolledData.Outputs.lastPolled;
            var response;
            if ( lastPolled_Diff >= self.pollInterval ){
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
                self.PolledData.Outputs.lastPolled = Date.now();
            } else {
                response = self.PolledData.Outputs.Data;
            }

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

            const Now = Date.now();
            if  (!self.PolledData.Detectors.lastPolled) {
                self.PolledData.Detectors.lastPolled = Now - (2*self.pollInterval);
            }
            const lastPolled_Diff = Now - self.PolledData.Detectors.lastPolled;
            var response;
            if ( lastPolled_Diff >= self.pollInterval ){
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
                self.PolledData.Partitions.lastPolled = Date.now();
            } else {
                response = self.PolledData.Detectors.Data;
            }

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

            const Now = Date.now();
            if  (!self.PolledData.Cameras.lastPolled) {
                self.PolledData.Cameras.lastPolled = Now - (2*self.pollInterval);
            }
            const lastPolled_Diff = Now - self.PolledData.Cameras.lastPolled;
            var response;
            if ( lastPolled_Diff >= self.pollInterval ){
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
                self.PolledData.Cameras.lastPolled = Date.now();
            } else {
                response = self.PolledData.Cameras.Data;
            }

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

    async getOverview() {
        var self = this;
        try {
            await self.KeepAlive();

            const Now = Date.now();
            if  (!self.PolledData.Overview.lastPolled) {
                self.PolledData.Overview.lastPolled = Now - (2*self.pollInterval);
            }
            const lastPolled_Diff = Now - self.PolledData.Overview.lastPolled;
            var response;
            if ( lastPolled_Diff >= (self.pollInterval *0.8)) {
                const post_data = {};
                response = await axios({
                    url: 'https://www.riscocloud.com/ELAS/WebUI/Overview/Get',
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
                self.PolledData.Overview.lastPolled = Date.now();
                self.PolledData.Overview.Data = response;
            } else {
                response = self.PolledData.Partitions.Data;
            }

            if (response.status == 200) {
                const body = response.data;
                for (var PartId in body.detectors.parts) {
                    const Id = body.detectors.parts[PartId].id
                    self.DiscoveredAccessories.partitions[Id].previousState = self.DiscoveredAccessories.partitions[Id].actualState;
                    self.DiscoveredAccessories.partitions[Id].actualState = (body.detectors.parts[PartId].armIcon).match(/ico-(.*)\.png/)[1];
                }
            } else {
                throw new Error('Cannot Retrieve Partitions States');
            }
        } catch (err) {
            self.log.error('Error on Get Partitions States : ' + err);
        }
    },

    async getPartsStates() {
        var self = this;
        try {
            await self.KeepAlive();

            var SelfPolledData;
            var risco_Part_API_url;

            if (self.DiscoveredAccessories.partitions.type == 'system'){
                SelfPolledData = self.PolledData.Overview;
                risco_Part_API_url = 'https://www.riscocloud.com/ELAS/WebUI/Overview/Get';
            } else {
                SelfPolledData = self.PolledData.Partitions;
                risco_Part_API_url = 'https://www.riscocloud.com/ELAS/WebUI/Detectors/Get'
            }
            const Now = Date.now();
            if  (!SelfPolledData.lastPolled) {
                SelfPolledData.lastPolled = Now - (2*self.pollInterval);
            }
            const lastPolled_Diff = Now - SelfPolledData.lastPolled;
            var response;
            if ( lastPolled_Diff >= (self.pollInterval *0.8)) {
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
                SelfPolledData.lastPolled = Date.now();
                SelfPolledData.Data = response;
            } else {
                response = SelfPolledData.Data;
            }

            if (response.status == 200) {
                const body = response.data;
                if (self.DiscoveredAccessories.partitions.type == 'system'){
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
                } else {
                    for (var PartId in body.detectors.parts) {
                       const Id = body.detectors.parts[PartId].id;
                       self.DiscoveredAccessories.partitions[Id].previousState = self.DiscoveredAccessories.partitions[Id].actualState;
                       self.DiscoveredAccessories.partitions[Id].actualState = (body.detectors.parts[PartId].armIcon).match(/ico-(.*)\.png/)[1];
                    }
                }
                return Promise.resolve();
            } else {
                throw new Error('Cannot Retrieve Partitions States');
            }
        } catch (err) {
            self.log.error('Error on Get Partitions States : ' + err);
            return Promise.reject();
        }
    },

    async getCPStates() {
        var self = this;
            
        try{
            await self.KeepAlive();
            if ((this.Partition || 'none') != 'none') {
                await self.getPartsStates();
            }
            return Promise.resolve(true);
        } catch (err) {
            return Promise.reject(err);
        }
    },

    async armDisarm(aState, cmd) {
        var self = this;

        try {
            await self.KeepAlive();

            var targetType = cmd;
            var targetPasscode;
            if (aState) {
                // ARM
                targetPasscode = "";
            } else {
                // DISARM
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
                self.log.debug('armDisarm: ' + response.status);
                return true;
            } else {
                throw new Error('Bad HTTP Response : ' + response.status);
            }
        }catch(err){
            self.log('armDisarm ' + err);
            return false;
        }
    }
}
