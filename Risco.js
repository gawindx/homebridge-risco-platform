var axios = require('axios');
var pollingtoevent = require('polling-to-event');

function extractError(aBody) {
    var serverInfo_begin = aBody.indexOf("<span class=\"infoServer\">");
    var serverInfo_end = aBody.indexOf("</span>", serverInfo_begin);
    return aBody.substring(serverInfo_begin + 26, serverInfo_end - 7);
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
        this.risco_password = encodeURIComponent(aConfig['riscoPassword']);
        this.risco_siteId = aConfig['riscoSiteId'];
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
        this.riscoCookies;
        this.SessionLogged = false;
        this.LastEvent = null;
        this.BadResponseCounter = 0;

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
                    self.getCPStatesPoll( (err, result) => {
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

    IsLogged(){
        return self.SessionLogged;
    }

    async IsValidResponse(response, functionName, htmltest = true){
        var self = this;
        try {
            if (htmltest == true) {
                if (response.data.error != 0){
                    self.log.debug('Got Invalid RiscoCloud\'s Response from %s. Retry...', functionName);
                    self.log.debug('Bad response:\n%s', JSON.stringify(response.data));
                    ++self.BadResponseCounter;
                    if (self.BadResponseCounter >= 5) {
                        self.SessionLogged = false;
                        await self.login();
                        self.BadResponseCounter = 0;
                        throw new Error('Too many wrong consecutive answers. Possible connection problem. Consider the session to be disconnected.');   
                    }
                    return false;
                } else {
                    self.BadResponseCounter = 0;
                    self.log.debug('Got Valid RiscoCloud\'s Response from %s. Continue...', functionName);
                    self.log.debug('Valid Response:\n%s', JSON.stringify(response.data));
                    return true;
                }
            } else {
                if (response.status == 302) {
                    self.log.debug('Got Invalid RiscoCloud\'s Response from %s. Retry...', functionName);
                    self.log.debug('Bad response:\n%s', response.status);
                    ++self.BadResponseCounter;
                    if (self.BadResponseCounter >= 5){
                        self.SessionLogged = false;
                        await self.login();
                        self.BadResponseCounter = 0;
                        throw new Error('Too many wrong consecutive answers. Possible connection problem. Consider the session to be disconnected.');   
                    }
                    return false;
                } else {
                    self.BadResponseCounter = 0;
                    self.log.debug('Got Valid RiscoCloud\'s Response from %s. Continue...', functionName);
                    self.log.debug('Good Response: %s', response.status);
                    return true;
                }
            }
        } catch (err) {
            self.log.error('Error on IsInvalidResponse : %s', err);
            return false;
        }
    }

    async login() {
        var self = this;
        self.log.debug('Entering Login Function');
        try{
            if (!self.SessionLogged) {

                const post_data = `username=${self.risco_username}&password=${self.risco_password}`;
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
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
                
                if (resp_s1.status == 302) {
                    self.log.debug('Logged In Stage 1');
                    self.riscoCookies = JSON.stringify(resp_s1.headers['set-cookie']);
                    self.log.debug('Cookie :\n%s', self.riscoCookies);

                    const post_data = `SelectedSiteId=${self.risco_siteId}&Pin=${self.risco_pincode}`;
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
                    })
                    .catch( error => {
                        if (error.response) {
                            return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                        } else {
                            return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                        }
                    });

                    if (resp_s2.status == 302) {
                        self.SessionLogged = true;
                        self.log.debug('Logged In Stage 2');
                        self.log.info('Logged In Cloud');
                        await self.ValidateUserCode();
                    } else {
                        self.riscoCookies = '';
                    }
                    return Promise.resolve();
                } else {
                    throw new Error(`Bad HTTP Response: ${resp_s1.status}`);
                }
            } else {
                return Promise.resolve();
            }
        } catch (err) {
            self.log.error('Error on login:\n%s', err);
            self.SessionLogged = false;
            self.riscoCookies = '';
            return Promise.reject(err);
        }
    }

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
                })
                .catch( error => {
                    if (error.response) {
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });

                if (resp_s1.status == 302) {
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
                    })
                    .catch( error => {
                        if (error.response){
                            return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                        } else {
                            return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                        }
                    });

                    if (resp_s2.status == 302){
                        self.SessionLogged = false;
                        self.riscoCookies = '';
                        self.log.info('Logout from Cloud');
                        return Promise.resolve();
                    } else {
                        throw new Error(`Bad HTTP Response: ${resp_s2.status}`);
                    }
                } else {
                    throw new Error(`Bad HTTP Response: ${resp_s1.status}`);
                }
            } else {
                self.riscoCookies = '';
                return Promise.resolve();
            }
        } catch (err) {
            self.log.error('Error on login:\n%s', err);
            self.SessionLogged = false;
            self.riscoCookies = '';
            return Promise.reject(err);
        }
    }

    async IsUserCodeExpired() {
        var self = this;
        self.log.debug('Check User Code expiration');
        try {
            var response;
            do {
                response = await axios({
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
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        //throw new Error(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                        return Promise.reject(`Error on Request : ${error.errno}`);
                    }
                });
            } while (self.IsValidResponse(response, 'IsUserCodeExpired') == false);

            if (response.status == 200) {
                self.log.debug('User Code Expired ? %s', response.data.pinExpired);
                return response.data.pinExpired;
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('UserCodeExpired error:\n%s', err );
            return true;
        }
    }

    async ValidateUserCode() {
        var self = this;
        self.log.debug('User Code Validation');
        try {
            const post_data = `code=${self.risco_pincode}`;
            var response;
            do {
                response = await axios({
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
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`1Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, 'ValidateUserCode') == false);

            if (response.status == 200) {
                if (response.data.error == 14) {
                    throw new Error('PinCode Error');
                } else if (response.data.error == 0) {
                    self.log.debug('User Code Validation : Ok');
                    return;
                }                
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('Error on Validate User Code:\n%s', err);
            return;
        }
    }

    async KeepAlive() {
        var self = this;
        self.log.debug('Entering KeepAlive Function');
        try {
            if (!self.SessionLogged) {
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
                    var response;

                    do {
                        response = await axios({
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
                        })
                        .catch(error => {
                            if (error.response){
                                return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                            } else {
                                return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                            }
                        });
                    } while (self.IsValidResponse(response, 'KeepAlive') == false);

                    if ((response.headers['Location'] == '/ELAS/WebUI/UserLogin/SessionExpired') || (response.data.error == 3)) {
                        self.SessionLogged = false;
                        self.log.info('Session Expired. ReLogin');
                        await self.login();
                    } else if (response.status != 200) {
                        self.log.debug(response);
                        throw new Error('KeepAlive Bad HTTP Response: {response.status}');
                    }
                    if ((response.data.overview !== null) || (response.data.detectors !== null)) {
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
            self.log.error('Error on KeepAlive:\n%s', err);
            return null;
        }
    }

    async DiscoverParts() {
        var self = this;
        self.log.debug('Entering DiscoverParts Function');
        try {
            await self.KeepAlive();

            var risco_Part_API_url;
            var response;
            const post_data = {};

            if (self.Partition == 'system') {
                self.log.debug('Partition Mode Off');
                risco_Part_API_url = 'https://www.riscocloud.com/ELAS/WebUI/Overview/Get';
            } else {
                self.log.debug('Partition Mode On');
                risco_Part_API_url = 'https://www.riscocloud.com/ELAS/WebUI/Detectors/Get'
            }

            do {
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
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, 'DiscoverParts') == false);

            if (response.status == 200) {

                const body = response.data;
                var Parts_Datas = {};

                if (self.Partition == 'system') {
                    var Part_Data = {
                        Id: 0,
                        name: self.risco_panel_name,
                        longName: `part_0_${(self.risco_panel_name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                        Required: 'system',
                        accessorytype: 'System',
                        previousState: null,
                        actualState: ( () => {
                            var armedZones = body.overview.partInfo.armedStr.split(' ');
                            var partArmedZones = body.overview.partInfo.partarmedStr.split(' ');
                            if (parseInt(armedZones[0]) > 0) {
                                return 'armed';
                            } else if (parseInt(partArmedZones[0]) > 0) {
                                return 'partial';
                            } else {
                                return 'disarmed';
                            }    
                        }),
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
                    for (var PartId in body.detectors.parts) {
                        var Part_Data = {
                            Id: body.detectors.parts[PartId].id,
                            name: body.detectors.parts[PartId].name,
                            longName: `part_${body.detectors.parts[PartId].id}_${(body.detectors.parts[PartId].name.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                            Required: null,
                            accessorytype: 'Partitions',
                            ExitDelay: 0,
                            previousState: null,
                            actualState: (body.detectors.parts[PartId].armIcon).match(/ico-(.*)\.png/)[1],
                            armCommand: this.Custom_armCommand,
                            nightCommand: this.Custom_nightCommand,
                            homeCommand: this.Custom_homeCommand,
                            disarmCommand: this.Custom_disarmCommand,
                            Ready: true,
                            PReady: true, 
                            OnAlarm: false
                        };
                        self.log.debug('Discovering Partition : %s with Id: %s', body.detectors.parts[PartId].name, body.detectors.parts[PartId].id);
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
                                self.log.debug('Partitions "%s" Required', body.detectors.parts[PartId].name);
                                Part_Data.Required = true;
                            } else {
                                self.log.debug('Partitions "%s" Not Required', body.detectors.parts[PartId].name);
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
            } else {
                throw new Error('Cannot Retrieve Partitions Infos');
            }
        } catch (err) {
            self.log.error('Error on Discovery Partition: %s', err);
        }
    }

    async DiscoverGroups() {
        var self = this;
        try {
            await self.KeepAlive();

            var response;
            do {
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
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, 'DiscoverGroups', false) == false);

            if (response.status == 200) {
                self.log.debug('Groups Status: %s', response.status);
                var GroupInfo = ( () => { 
                    var GroupInfo_begin = response.data.indexOf('<label for="actGrpItem');
                    self.log.debug('Groups => HTML Output Info start at: %s', GroupInfo_begin);
                    var GroupInfo_end = response.data.indexOf('</section>', GroupInfo_begin);
                    self.log.debug('Groups => HTML Output Info finish at: %s', GroupInfo_end);
                    var Groups_list = response.data.substring(GroupInfo_begin , GroupInfo_end - 11).match(/<label for="actGrpItem\d">.*?<\/div>/gs);
                    self.log.info('Discovered %s Groups', Groups_list.length);
                    
                    var Groups_Datas = {};
                    var ParentPartList = response.data.match(/<label data-groups=".*">.*<.*OpenPartGroups.*?\)\'/gm);

                    for (var Group in Groups_list){
                        const GroupName = Groups_list[Group].match(/<label for="actGrpItem\d">(.*?)<\/label>/s)[1];
                        const GroupId = parseInt(Groups_list[Group].match(/<label for="actGrpItem(\d)">/s)[1], 10);
                        const Gname = `Group ${GroupName}`;
                        var Group_Data = {
                            Id: GroupId,
                            name: Gname,
                            longName: `group_${GroupId}_${(Gname.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                            parentPart: ( () => {
                                var resultArray = [];
                                for (var ParentPart in ParentPartList) {
                                    var ParentPartId = ParentPartList[ParentPart].match(new RegExp('<label data-groups=".*?' + GroupName + '.*?">.*<.*OpenPartGroups\\("(\\d*?)"','gm'));
                                    if (ParentPartId != null ) {
                                        resultArray.push((''+ParentPartId).match(/"(\d*?)"$/s)[1]);
                                    }
                                }
                                return resultArray;
                            }),
                            Required: null,
                            accessorytype: 'Groups',
                            previousState: null,
                            actualState: ( () => {
                                var result_State = 'Disarmed';
                                    var Group_Status = Groups_list[Group].match(/<span.*?area\s.*?">.*?input.*?"radio"\s.*?\s?name=.*?>/gs);
                                    for (var Status in Group_Status){
                                        var State = Group_Status[Status].match(/<span.*?area\s(.*?)">.*input.*"radio"\s?(checked)\s?name=.*>/s);
                                        if ((State !== null) && ( State.length > 1 ) && ( State[2] == 'checked' )){
                                            result_State = State[1];
                                        }
                                    }
                                    return result_State;
                                }),
                            OnAlarm: false
                        };
                        self.log.debug('Discovering Group : "%s" with Id: %s', Group_Data.name, Group_Data.Id);
                        if (self.Groups == 'all') {
                            self.log.debug('All Groups Required');
                            Group_Data.Required = true;
                        } else if (self.Groups != (self.Groups.split(',')) || (parseInt(self.Groups) != NaN)){
                            self.log.debug('Not All Groups Required');
                            //Automatically convert string value to integer
                            const Required_Groups = self.Groups.split(',').map( (item) => {
                                return parseInt(item, 10);
                            });
                            if (Required_Groups.includes(Group_Data.Id) !== false) {
                                self.log.debug('Group "%s" Required', Group_Data.name);
                                Group_Data.Required = true;
                            } else {
                                self.log.debug('Group "%s" Not Required', Group_Data.name);
                                Group_Data.Required = false;
                            }
                        }
                        Groups_Datas[Group_Data.Id] = Group_Data;
                    }
                    self.log.debug(JSON.stringify(Groups_Datas));
                    return Groups_Datas;
                })();
                return GroupInfo;
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('Error on Discovery Group: %s', err);
        }
    }

    async DiscoverOutputs() {
        var self = this;
      
        try {
            await self.KeepAlive();
            var response;
            do {
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
                })
                .catch( error => {
                    if (error.response) {
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                }); 
            } while (self.IsValidResponse(response, 'DiscoverOutputs', false) == false);

            if (response.status == 200) {
                var OutputInfo = ( () => {
                    var OutputInfo_begin = response.data.indexOf('<ul style="list-style:none; margin:0; padding:0;">');
                    self.log.debug('HTML Output Info start at: %s', OutputInfo_begin);
                    var OutputInfo_end = response.data.indexOf('</ul>', OutputInfo_begin);
                    self.log.debug('HTML Output Info finish at: %s', OutputInfo_end);
                    var Output_list = response.data.substring(OutputInfo_begin + 50, OutputInfo_end - 5).match(/<li.*?<\/li>/gs);
                    self.log.info('Discovered %s Output', Output_list.length);
                    var Outputs_Datas = {};
                    for (var list in Output_list){
                        self.log.debug(Output_list[list]);
                        const Output_Cmd = Output_list[list].match(/onclick="(.*?);/s)[1]
                        const OutputId = Output_list[list].match(/id=".*?(\d*)"/s)[1];
                        const OutputName = Output_list[list].match(/<.*[\d|e]">(.*)<\/[s|l]/)[1];
                        var Output_Data = {
                            Id: OutputId,
                            name: OutputName,
                            longName: `out_${OutputId}_${(OutputName.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                            Required: null,
                            accessorytype: 'Outputs',
                            Type: ( () => {
                                    if (Output_Cmd.match(/(\d)\)$/) == null) {
                                        return 'pulse';
                                    } else {
                                        return 'switch';
                                    }
                                }),
                            State: ( () => {
                                    if (Output_Cmd.match(/(\d)\)$/) == null) {
                                        return false;
                                    } else {
                                       return ((Math.abs(parseInt(Output_Cmd.match(/(\d)\)$/)[1]) - 1)) ? true : false);
                                    }
                                })
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
                    self.log.debug(JSON.stringify(Outputs_Datas));
                    return Outputs_Datas;
                })();
                return OutputInfo;
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('Error on Discovery Output:\n%s', err);
        }
    }

    async DiscoverDetectors() {
        var self = this;
      
        try {
            await self.KeepAlive();

            var response;
            do {
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
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, 'DiscoverDetectors') == false);

            if (response.status == 200) {
                self.log.debug('Detectors/Get status:\n%s', response.status);
                var DetectorsInfos = ( () => {
                    self.log.debug(JSON.stringify(response.data));
                    var Detectors_Datas = {};
                    for (var Parts in response.data.detectors.parts) {
                        for (var Detector in response.data.detectors.parts[Parts].detectors) {
                            self.log.debug(JSON.stringify(response.data.detectors.parts[Parts].detectors[Detector]));
                            const DetectorName = ( () => {
                                            var tmp_name = response.data.detectors.parts[Parts].detectors[Detector].name;
                                            return tmp_name.replace(/&#(\d+);/g, function(match, dec) {
                                                return String.fromCharCode(dec);
                                            });
                                })();
                            const DetectorId = response.data.detectors.parts[Parts].detectors[Detector].id;
                            var Detector_Data = {
                                Id: DetectorId,
                                Bypassed: response.data.detectors.parts[Parts].detectors[Detector].bypassed,
                                Partition: Parts,
                                Required: null,
                                accessorytype: 'Detector',
                                name: DetectorName,
                                longName: `det_${DetectorId}_${(DetectorName.toLowerCase()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_')}`,
                                State: ( () => {
                                            //'detector' for inactive
                                            //'detector2' for active
                                            //'detector5' for bypassed
                                            //'detector??' for tampered
                                            if (response.data.detectors.parts[Parts].detectors[Detector].data_icon == 'detector') {
                                                return false;
                                            } else {
                                                if (response.data.detectors.parts[Parts].detectors[Detector].data_icon == 'detector5') {
                                                    return false;
                                                } else {
                                                    return true;
                                                }
                                            }
                                })(),
                                OnAlarm: false
                            };
                            self.log.debug('Detector %s icon %s', Detector_Data.name, response.data.detectors.parts[Parts].detectors[Detector].data_icon);
                            if (self.Detectors == 'all') {
                                self.log.debug('All Detectors Required');
                                Detector_Data.Required = true;
                            } else if (self.Detectors != (self.Detectors.split(',')) || (parseInt(self.Detectors) != NaN)) {
                                self.log.debug('Not All Detectors Required');
                                //Automatically convert string value to integer
                                const Required_Detectors = self.Detectors.split(',').map( (item) => {
                                    return parseInt(item, 10);
                                });
                                if (Required_Detectors.includes(Detector_Data.Id) !== false) {
                                    self.log.debug('Detectors "%s" Required', Detector_Data.name);
                                    Detector_Data.Required = true;
                                } else {
                                    self.log.debug('Detectors "%s" Not Required', Detector_Data.name);
                                    Detector_Data.Required = false;
                                }
                            } else {
                                self.log.debug('No Detectors Required');
                                Detector_Data.Required = false;
                            }
                            Detectors_Datas[Detector_Data.Id] = Detector_Data;
                        }
                    }
                    return Detectors_Datas;
                })();
                self.log.info('Discovered %s Detector(s)', Object.keys(DetectorsInfos).length);
                return DetectorsInfos;
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('Error on Discovery Detector:\n%s', err);
            return {};
        }
    }

    async DiscoverCameras() {
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
                    self.log.debug(JSON.stringify(response.data));
                    var Cameras_Datas = {};
                    for (var Camera in response.data.cameras.camInfo){
                        self.log.debug(JSON.stringify(response.data.cameras.camInfo[Camera]));
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
    }

    async getAlarmState(body) {
        var self = this;
        self.log.debug('Entering VerifyAlarmState function');
        try {
            if (body.OngoingAlarm == true) {
                if (self.DiscoveredAccessories.Partitions.type == 'system'){
                    self.DiscoveredAccessories.Partitions[0].OnAlarm = true;
                } else {
                    var ZIdAlarm = [];
                    var PIdAlarm = [];
                    //ajout verification evenement utilisables
                    if ((self.LastEvent != null) && (self.LastEvent.LogRecords != null)) {
                        var LogRecords = self.LastEvent.LogRecords.sort(function (a, b) {
                            return b.YTime.localeCompare(a.YTime);
                        });
                        for (var LogRecord in LogRecords){
                            self.log.debug('Record Id: %s', JSON.stringify(LogRecord));
                            self.log.debug('Record value: %s', JSON.stringify(LogRecords[LogRecord]));
                            if (LogRecords[LogRecord].Priority == 'alarm') {
                                self.log.debug('Event is an Alarm');
                                ZIdAlarm.push(LogRecords[LogRecord].ZoneId);
                            } else {
                                self.log.debug('Event is not an Alarm');
                                break;
                            }
                        }
                    } else {
                        /*
                            it sometimes happens that the events are not repatriated early enough to be treated
                            at the same time as the alarm state (generally in the case of a homebridge initialization
                            while the alarm is already in progress).
                            In this case, we try an alternative approach, but less reliable, to determine the active
                            detector(s) and deduce the partitions or group in alarm.
                        */
                        self.log.debug('No usable events. Use of the alternative method.')
                        var Detectors = JSON.parse(JSON.stringify(self.DiscoveredAccessories.Detectors));
                        Object.values(Detectors).filter(detector => (detector.State == true))
                            .forEach(detector => (function(){
                                self.log.debug('Detector %s(%s) is active', detector.name, detector.Id);
                                self.log.debug('Detector is in partition %s', detector.Partition);
                                PIdAlarm.push(parseInt(detector.Partition));
                                ZIdAlarm.push(detector.Id);
                        })());
                    }

                    if (ZIdAlarm.length >= 1) {
                        if ((this.Detectors || 'none') != 'none') {
                            var Detectors = JSON.parse(JSON.stringify(self.DiscoveredAccessories.Detectors));
                            Object.values(Detectors).filter(detector => ZIdAlarm.includes(detector.Id))
                                .forEach(detector => (function(){
                                    self.log.debug('Detector %s (%s) is active', detector.name, detector.Id);
                                    self.log.debug('Detector is in partition %s', detector.Partition);
                                    PIdAlarm.push(parseInt(detector.Partition));
                            })());
                        }
                        if ((this.Partition || 'none') != 'none') {
                            var Partitions = JSON.parse(JSON.stringify(self.DiscoveredAccessories.Partitions));
                            Object.values(Partitions).filter(partition => PIdAlarm.includes(partition.Id))
                                .forEach(partition => (function(){
                                    self.log.debug('Partition %s State: %s', partition.name, partition.actualState);
                                    if (partition.actualState != 'disarmed' ){
                                        self.log.debug('Partition %s is Armed and under Alarm', partition.name) 
                                        self.DiscoveredAccessories.Partitions[partition.Id].OnAlarm = true;
                                    } else {
                                        self.log.debug('Partition %s is not Armed', partition.name)
                                        self.DiscoveredAccessories.Partitions[partition.Id].OnAlarm = false;
                                    }
                            })());
                        }
                        if ((this.Groups || 'none') != 'none') {
                            var Groups = JSON.parse(JSON.stringify(self.DiscoveredAccessories.Groups));
                            Object.values(Groups).filter(group => group.parentPart.filter(GroupID => PIdAlarm.includes(parseInt(GroupID))))
                                .forEach(group => (function(){
                                    self.log.debug('Group State %s State: %s', group.name, group.actualState);
                                    if (group.actualState != 'disarmed' ){
                                        self.log.debug('Group %s is Armed and under Alarm', group.name) 
                                        self.DiscoveredAccessories.Groups[group.Id].OnAlarm =  true;
                                    } else {
                                        self.log.debug('Group %s is not Armed', group.name)
                                        self.DiscoveredAccessories.Groups[group.Id].OnAlarm =  false;
                                    }
                            })());
                        }
                    }
                }
            }
            self.log.debug('Leaving VerifyAlarmState function');
            return Promise.resolve();
        } catch (err) {
            self.log.error('Error on VerifyAlarmState:\n%s', err);
            return Promise.reject();
        }
    }

    async getPartsStates(body) {
        var self = this;
        self.log.debug('Entering getPartStates function');
        try {
            if (self.DiscoveredAccessories.Partitions.type == 'system') {
                self.log.debug('System Mode');
                self.DiscoveredAccessories.Partitions[0].previousState = self.DiscoveredAccessories.Partitions[0].actualState;
                self.DiscoveredAccessories.Partitions[0].actualState = (function() {
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
                self.log.debug('Previous State: %s', self.DiscoveredAccessories.Partitions[0].previousState);
                self.log.debug('Actual State: %s', self.DiscoveredAccessories.Partitions[0].actualState);
                if (Math.max(body.ExitDelayTimeout) != 0) {
                    self.DiscoveredAccessories.Partitions[0].ExitDelay = Math.max(body.ExitDelayTimeout);
                    self.log.debug('Arming Delay Left: %s', self.DiscoveredAccessories.Partitions[0].ExitDelay);
                }
                if ((self.DiscoveredAccessories.Partitions[0].OnAlarm == true) && (self.DiscoveredAccessories.Partitions[0].actualState == 'disarmed')) {
                    self.DiscoveredAccessories.Partitions[0].OnAlarm = false;
                }
                //Determine Occupancy State
                if (body.detectors != null) {
                    var ReadyState = true;
                    var PReadyState = true;
                    if (self.DiscoveredAccessories.Detectors != undefined) {
                        for (var PartId in body.detectors.parts) {
                            const Detectors = JSON.parse(JSON.stringify(body.detectors.parts[PartId].detectors));
                            Object.values(Detectors).filter(detector => {
                                return ((detector.data_icon == 'detector2') ? true : false )
                            })
                            .forEach(detector => {
                                if (detector.bypassed == false) {
                                    if (self.DiscoveredAccessories.Detectors[detector.id].accessorytype != 'Detector' ){
                                        PReadyState = false;
                                    }
                                    ReadyState = false;
                                }
                            });
                        }
                    }
                    self.DiscoveredAccessories.Partitions[0].Ready = ReadyState;
                    self.DiscoveredAccessories.Partitions[0].PReady = PReadyState;
                    if (ReadyState === false) {
                        self.log.debug('Motion Is Detected, set System to Occupied');
                    }
                    if (PReadyState === false) {
                        self.log.debug('System is Occupied inside home');
                    }
                }
            } else {
                self.log.debug('Partition Mode');
                if (Math.max(body.ExitDelayTimeout) != 0) {
                    for (var PartId in body.ExitDelayTimeout) {
                       if (body.ExitDelayTimeout[PartId] != 0) {
                            self.DiscoveredAccessories.Partitions[PartId].ExitDelay = body.ExitDelayTimeout[PartId];
                            self.log.debug('Arming Delay Left for Part "%s": %s', self.DiscoveredAccessories.Partitions[PartId].name, self.DiscoveredAccessories.Partitions[PartId].ExitDelay);
                        }
                    }
                }
                if (body.detectors != null) {
                    for (var PartId in body.detectors.parts) {
                        const Id = body.detectors.parts[PartId].id;
                        const Detectors = JSON.parse(JSON.stringify(body.detectors.parts[PartId].detectors));
                        var ReadyState = true;
                        var PReadyState = true;
                        if (self.DiscoveredAccessories.Detectors != undefined) {
                            self.DiscoveredAccessories.Partitions[Id].previousState = self.DiscoveredAccessories.Partitions[Id].actualState;
                            self.DiscoveredAccessories.Partitions[Id].actualState = (body.detectors.parts[PartId].armIcon).match(/ico-(.*)\.png/)[1];
                            self.log.debug('Partition Id: %s Label: %s',Id, self.DiscoveredAccessories.Partitions[Id].name)
                            self.log.debug('Previous State: %s', self.DiscoveredAccessories.Partitions[Id].previousState);
                            self.log.debug('Actual State: %s', self.DiscoveredAccessories.Partitions[Id].actualState);
                            //Determine Occupancy State
                            Object.values(Detectors).filter(detector => {
                                return ((detector.data_icon == 'detector2') ? true : false )
                            })
                            .forEach(detector => {
                                if (detector.bypassed == false) {
                                    if (self.DiscoveredAccessories.Detectors[detector.id].accessorytype != 'Detector' ){
                                        PReadyState = false;
                                    }
                                    ReadyState = false;
                                }
                            });
                        }
                        self.DiscoveredAccessories.Partitions[Id].Ready = ReadyState;
                        self.DiscoveredAccessories.Partitions[Id].PReady = PReadyState;
                        if (ReadyState === false) {
                            self.log.debug('Motion Is Detected, set Partitions "%s" to Occupied', self.DiscoveredAccessories.Partitions[Id].name);
                        }
                        if (PReadyState === false) {
                            self.log.debug('Partitions "%s" is Occupied inside home', self.DiscoveredAccessories.Partitions[Id].name);
                        }
                    }
                }
                var Partitions = JSON.parse(JSON.stringify(self.DiscoveredAccessories.Partitions));
                Object.values(Partitions).filter(partition => ((partition.OnAlarm == true) && (partition.actualState == "disarmed")))
                    .forEach(partition => (function() {
                        self.log.debug('Partition %s Reset OnAlarm State', partition.name);
                        self.DiscoveredAccessories.Partitions[partition.Id].OnAlarm = false;
                })());
            }
            self.log.debug('Leaving getPartStates function');
            return Promise.resolve(true);
        } catch (err) {
            self.log.debug('Leaving getPartStates function');
            self.log.error('Error on Get Partitions States: %s', err);
            return Promise.reject(err);
        }
    }

    async getGroupsStates(body) {
        var self = this;
        self.log.debug('Entering getGroupsStates function');
        try {
            for (var GroupId in body.allGrpState.GlobalState) {
                const Id = body.allGrpState.GlobalState[GroupId].Id;
                self.DiscoveredAccessories.Groups[Id].previousState = self.DiscoveredAccessories.Groups[Id].actualState;
                self.DiscoveredAccessories.Groups[Id].actualState = (function() {
                        self.log.debug('Group Armed State? ' + body.allGrpState.GlobalState[GroupId].Armed);
                        return ((body.allGrpState.GlobalState[GroupId].Armed != false)?'armed':'disarmed');
                    })();
                self.log.debug('Group Id: %s Label: %s', Id, self.DiscoveredAccessories.Groups[Id].name)
                self.log.debug('Previous State: %s', self.DiscoveredAccessories.Groups[Id].previousState);
                self.log.debug('Actual State: %s', self.DiscoveredAccessories.Groups[Id].actualState);
            }
            const Groups = JSON.parse(JSON.stringify(self.DiscoveredAccessories.Groups));
            Object.values(Groups).filter(group => ((group.OnAlarm == true) && (group.actualState == 'disarmed')))
                .forEach(group => {
                    self.log.debug('Groups %s Reset OnAlarm State', group.name);
                    self.DiscoveredAccessories.Groups[group.Id].OnAlarm = false;
            });
            self.log.debug('Leaving getGroupsStates function');
            return Promise.resolve();
        } catch (err) {
            self.log.error('Error on getGroupsStates: %s', err);
            return Promise.reject();
        }
    }

    async getOutputsStates(body) {
        var self = this;
        self.log.debug('Entering getOutputsStates function');
        try {
            for (var OutputId in body.haSwitch) {
                    const Id = body.haSwitch[OutputId].ID;
                    self.DiscoveredAccessories.Outputs[Id].State = body.haSwitch[OutputId].State;
                    self.log.debug('Output Id: %s Label: %s', Id, self.DiscoveredAccessories.Outputs[Id].name)
            }
            self.log.debug('Leaving getOutputsStates function');
            return Promise.resolve();
        } catch (err) {
            self.log.error('Error on getOutputsStates: %s', err);
            return Promise.reject();
        }
    }

    async getDetectorsStates(body) {
        var self = this;
        self.log.debug('Entering getDetectorsStates function');
        try {
            for (var Parts in body.detectors.parts) {
                for (var DetectorId in body.detectors.parts[Parts].detectors) {
                    const Id = body.detectors.parts[Parts].detectors[DetectorId].id;
                    self.DiscoveredAccessories.Detectors[Id].Bypassed = body.detectors.parts[Parts].detectors[DetectorId].bypassed;
                    self.DiscoveredAccessories.Detectors[Id].State = (function() {
                        if (body.detectors.parts[Parts].detectors[DetectorId].data_icon == 'detector2') {
                            return true;
                        } else {
                            return false;
                        }
                    })();
                    self.log.debug('Detector Id: %s Label: %s State:', Id, self.DiscoveredAccessories.Detectors[Id].name, ((self.DiscoveredAccessories.Detectors[Id].State)? 'Motion Detected' : 'Motion not Detected'));
                }
            }
            self.log.debug('Leaving getDetectorsStates function');
            return Promise.resolve();
        } catch (err) {
            self.log.error('Error on getDetectorsStates: %s', err);
            return Promise.reject();
        }
    }

    async getCPStatesPoll() {
        return await this.getCPStates();
    }

    async getCPStates() {
        var self = this;
        self.log.debug('Entering getCPStates function');
        try {
            var body;
            const KA_rslt = await self.KeepAlive();
            if ( (self.Ready === true) && (self.SessionLogged)) {
                self.log.debug('RiscoPanelSession is Ready');
                if (KA_rslt === null) {
                    self.log.debug('KeepAlive does not signal a change or has not been tested.');
                    var response;
                    do {
                        response = await axios({
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
                        })
                        .catch( error => {
                            if (error.response){
                                return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                            } else {
                                return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                            }
                        });
                    } while (self.IsValidResponse(response, 'getCPStates') == false);

                    if (response.status == 200) {
                        body = response.data;
                        if (response.data.eh != null) {
                            self.log.debug('Last Events Updated');
                            self.LastEvent = response.data.eh[0];
                            self.log.debug('Last Events New Value:\n%s', JSON.stringify(self.LastEvent));
                        }
                        if (response.data.OngoingAlarm == true) {
                            self.log.debug('CPanel is under Alarm');
                        }
                    } else {
                        throw new Error('Cannot Retrieve Panel States');
                    }
                } else {
                    self.log.debug('KeepAlive report a change. Using its result for status update.');
                    body = KA_rslt;
                }
                await self.UpdateCPStates(body);
                self.log.debug('Leaving getCPStates function');
            } else {
                self.log.debug('RiscoPanelSession is Not Ready');
                self.log.debug('Leaving getCPStates function');
            }
            return Promise.resolve(true);
        } catch (err) {
            self.log.error('Error on getCPStates: %s', err);
            self.log.debug('Leaving getCPStates function');
            return Promise.reject(err);
        }
    }

    async UpdateCPStates(body) {
        var self = this;
        self.log.debug('Entering UpdateCPStates function');
        try {
            if (((self.Partition || 'none') != 'none') && ((body.detectors != null) || (Math.max(body.ExitDelayTimeout) != 0 ))) {
                await self.getPartsStates(body);
            }
            if (((self.Groups || 'none') != 'none') && (body.allGrpState != null)) {
                await self.getGroupsStates(body);
            }
            if (((self.Outputs || 'none') != 'none') && (body.haSwitch != null)) {
                await self.getOutputsStates(body);
            }
            if (((self.Detectors || 'none') != 'none') && (body.detectors != null)) {
                await self.getDetectorsStates(body);
            }
            await self.getAlarmState(body);
            /*
            if ((this.config['Cameras'] || 'none') != 'none') {
                await self.getPartsStates();
            }*/
            self.log.debug('Leaving UpdateCPStates function');
            return Promise.resolve(true);
        } catch (err) {
            self.log.error('Error on UpdateCPStates: %s', err);
            self.log.debug('Leaving UpdateCPStates function');
            return Promise.reject(err);
        }
    }

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
                self.log.debug('Arming command: %s', targetType);
                targetPasscode = '';
            } else {
                // DISARM or Refresh
                self.log.debug('Disarming or Refreshing command: %s', targetType);
                targetPasscode = '------';
            }

            var response;
            do {
                response = await axios({
                    url: 'https://www.riscocloud.com/ELAS/WebUI/Security/ArmDisarm',
                    method: 'POST',
                    headers: {
                        Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                        Origin: 'https://www.riscocloud.com',
                        Cookie: self.riscoCookies,
                        'Content-type': 'application/x-www-form-urlencoded'
                    },
                    data: `type=${targetType}&passcode=${targetPasscode}&bypassZoneId=-1`,

                    validateStatus(status) {
                        return status >= 200 && status < 400;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, "armDisarm") == false);

            if (response.status == 200) {
                if (response.data.armFailures !== null ) {
                    self.log.debug('armDisarm Not Ok. Using this result for status update');
                    self.log.debug('errType: %s Reason: %s', response.data.armFailures.errType, response.data.armFailures.text);
                    //Todo :
                    // return more info
                    self.UpdateCPStates(response.data);
                    return [0, [response.data.armFailures.errType, response.data.armFailures.text]];
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
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('Error on armDisarm function:\n%s', err);
            return [0, NaN];
        }
    }

    async HACommand(type, devId) {
        var self = this;
        self.log.debug('Entering HACommand function');
        try {
            await self.KeepAlive();

            var targetType = type;
            var targetdevId;

            var response;
            do {
                response = await axios({
                    url: 'https://www.riscocloud.com/ELAS/WebUI/Automation/HACommand',
                    method: 'POST',
                    headers: {
                        Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                        Origin: 'https://www.riscocloud.com',
                        Cookie: self.riscoCookies,
                        'Content-type': 'application/x-www-form-urlencoded'
                    },
                    data: `type=${targetType}&devId=${devId}`,

                    validateStatus(status) {
                        return status >= 200 && status < 400;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, 'HACommand') == false);

            if (response.status == 200) {
                //response for pulse switch ok : {error: 0, haSwitch: [], devId: 2}
                if (response.data.error != 0) {
                    self.log.debug('HACommand Not Ok. Using this result for status update');
                    self.log.debug('errType:\n%s', JSON.stringify(response.data));
                    self.UpdateCPStates(response.data);
                    return false;
                } else {
                    self.log.debug('HACommand Ok. Using this result for status update');
                    self.UpdateCPStates(response.data);
                    return true;
                }
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        } catch (err) {
            self.log.error('Error on HACommand function:\n%s', err);
            return false;
        }
    }

    async SetBypass(state, devId) {
        var self = this;
        self.log.debug('Entering SetBypass function');
        try {
            await self.KeepAlive();

            var response;
            do {
                response = await axios({
                    url: 'https://www.riscocloud.com/ELAS/WebUI/Detectors/SetBypass',
                    method: 'POST',
                    headers: {
                        Referer: 'https://www.riscocloud.com/ELAS/WebUI/MainPage/MainPage',
                        Origin: 'https://www.riscocloud.com',
                        Cookie: self.riscoCookies,
                        'Content-type': 'application/x-www-form-urlencoded'
                    },
                    data: `id=${devId}&bypass=${state}`,

                    validateStatus(status) {
                        return status >= 200 && status < 400;
                    },
                    maxRedirects: 0,
                })
                .catch( error => {
                    if (error.response){
                        return Promise.reject(`Bad HTTP Response: ${error.response.status}\nData: ${error.response.data}`);
                    } else {
                        return Promise.reject(`Error on Request : ${error.errno}\n Code : ${error.code}`);
                    }
                });
            } while (self.IsValidResponse(response, 'HACommand') == false);

            if (response.status == 200) {
                if (response.data.error != 0) {
                    self.log.debug('SetBypass Not Ok. Using this result for status update');
                    self.log.debug('errType:\n%s', JSON.stringify(response.data));
                    self.UpdateCPStates(response.data);
                    return false;
                } else {
                    self.log.debug('SetBypass Ok. Using this result for status update');
                    self.UpdateCPStates(response.data);
                    return true;
                }
            } else {
                throw new Error(`Bad HTTP Response: ${response.status}`);
            }
        }catch(err){
            self.log.error('Error on SetBypass function:\n%s', err);
            return false;
        }
    }
}

module.exports.RiscoPanelSession = RiscoPanelSession;