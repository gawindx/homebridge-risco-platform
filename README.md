This is plugin that integrate Homebridge with Risco Cloud Alarm Security System.
Integration works only when proper Ethernet module is added to your Risco Unit and you are able to arm & disarm your system via https://www.riscocloud.com/ELAS/WebUI.

For now there are only 2 working states (ARM / DISARM), where ARM is common for all HomeKit states (AWAY, NIGHT, AT HOME).
If more than 0 Partitions (Zones) are armed, Plugin reports that as system is ARMED.
HomeKit looks globally, cannot distinguish difference between multiple Zones armed / disarmed.

When Polling option is enabled, Alarm state is refreshed in background, that means when you open HomeApp - there is no delay to display RiscoAlarm status. It's retreived from cached value.

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-risco-alarm
3. Update your configuration file. See sample config.json snippet below. 

# Configuration

Configuration sample:

 ```
    "platforms": [
        {
            "platform": "RiscoAlarm",
            "name": "Home Alarm",
            "riscoUsername": "",                
            "riscoPassword": "",
            "riscoSiteId": 12345,
            "riscoPIN": "",
            "polling": true | false,
            "pollInterval": 10000,
            "Partition": "all|none|system|0,1,2,....",
            "Groups": "all|none|0,1,2,....",
        }
    ]
```

Fields: 

* "platform" => Mandatory: Must always be "RiscoAlarm" (required) 
* "name" => Mandatory: Can be anything (used in logs)
* "riscoUsername", "riscoPassword" => Mandatory: UserName and Password for you Web interface to RiscoCloud
* "riscoSiteId"=> Mandatory: This is your siteId to login.
* "riscoPIN"=> Mandatory: PIN Code used for arm/disarm
* "polling" => optional: true|false - poll for latest RiscoCloud status (Default to false)
* "pollInterval" => optional: time in ms for polling (Default to 10000)
* "Partition_Mode": false by default ("System"). Set to true if you want to manage one or more partitions independently.
* "Partition" => optional: accept the following options
    * "none": will not generate an accessory for partitions
    * "all": will generate an accessory for each partition
    * "system": will generate an accessory for global system
    * "0,1,...": will generate an accessory for each listed partition.
        Accepts a comma-separated list of strin where each member is the id of a partition
* "Groups" => optional: accept the following options
    * "none": will not generate an accessory for Groups
    * "all": will generate an accessory for each Group
    * "0,1,...": will generate an accessory for each listed Groups.
        Accepts a comma-separated list of strin where each member is the id of a Group

If no accessory is generated, the system mode operation will be set by default.

To get your riscoSiteId, login to riscocloud via ChromeBrowser (first login screen), and before providing your PIN (second login page), display source of the page and find string: `<div class="site-name"` ... it will look like:

`<div class="site-name" id="site_12345_div">`

In that case "12345" is your siteId which should be placed in new config file.


For beta testing :

Manual addition procedure axios (based on the use of the image Docker oznu / homebridge: debian) and assuming that the container is running:
* Before proceeding with the installation of axios, it is necessary to update the files 'package.json', 'app.js', 'risco.js' and 'RiscoAccessories.js'
* Connect to the container
docker exec -ti container_name sh
* go to the plugin directory
cd /homebridge/node_modules/homebridge-risco-alarm/node_modules
* install in the current directory
npm i --prefix ./ axios





TODO:
* Add the ability to set the arming / partial / night / disarm commands
* Allow the ability to monitor panels from multiple sites (only from the same RiscoCloud account) - requires modification of 'app.js' and 'risco.js'
* Edit the RiscoAccessories file to simplify the declaration of accessories using a common trunk to all accessories
* Add Detectors (Partially done)
* Add Outputs (Partially done)
* Add Cameras (Partially done but may not be usable)
* Add the ability to define custom detector types
(water / fire / gas / CO2 / temperature threshold detector) as the risco hardware supports. This information does not go back in the interface RiscoCloud, it requires a manual addition.
* Add a possibility to define a combined element
example: a detector on a garage door and an output of the panel programmed to remotely open the door that could be combined into a single accessory 'garage door' for both its control and the supervision of its state.

