# homebridge-risco-platform

[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/donate?hosted_button_id=FAFJ3ZKMENGCU)

This is plugin that integrate Homebridge with Risco Cloud Alarm Security System.

Integration works only when proper Ethernet module is added to your Risco Unit and you are able to arm & disarm your system via https://www.riscocloud.com/ELAS/WebUI.

When Polling option is enabled, Alarm state is refreshed in background, that means when you open HomeApp - there is no delay to display RiscoAlarm status. It's retreived from cached value.

Note:

*From version 1.1.0, homebridge-risco-platform is a dynamic platform.*

*This change means that:*

*- The accessories created are cached to be reused after each restart of Homebridge*

*- A recharged accessory retains all its characteristics and remains associated with its scene or automation, so it is no longer necessary to reconfigure its automation as it was before*

*- When modifying the platform configuration, the accessories are modified accordingly (modification of type or deletion if no longer used)*

*- A deleted accessory must therefore be re-associated with its automations because it will have been deleted from the Homebridge accessories cache*

Note:

*Since version 1.1.3, you can Exclude (or bypass) a detector directly from HomeKit.*

*It can happen that the request takes a little too long to execute and, in this case, you may see an information appear in the Homebridge logs indicating that the accessory is taking too long to respond. Example:*

`
The write handler for the characteristic 'On' on the accessory 'X' was slow to respond!*
`

*This is not an issue but quite normal behavior.*

# Installation

1. Install homebridge using: 
   `npm install -g homebridge`
2. Install this plugin using:
   `npm install -g homebridge-risco-platform`
3. Update your configuration file. See sample config.json snippet below. 

# Configuration

Configuration sample:

 ```
    "platforms": [
        {
            "platform": "RiscoAlarm",
            "name": "Home Alarm",
            "polling": true|false,
            "pollInterval": 10000,
            "riscoCloudDomainURL": "",
            "riscoUsername": "",                
            "riscoPassword": "",
            "riscoSiteId": 12345,
            "riscoPIN": "",
            "logRCResponse": true|false,
            "OccupancyPreventArming": true|false,
            "armCommand": "armed|partially|disarmed",
            "partialCommand": "armed|partially|disarmed",
            "homeCommand": "armed|partially|disarmed",
            "disarmCommand": "armed|partially|disarmed",
            "Partition": "all|none|system|0,1,2,....",
            "Groups": "all|none|0,1,2,....",
            "Outputs": "all|none|0,1,2,....",
            "Detectors": "all|none|0,1,2,....",
            "Custom": {
                "Door": "all|0,1,2,....",
                "Window": "all|0,1,2,....",
                "Contact Sensor": "all|0,1,2,...."
            },
            "Combined": {
                "Door": [
                    {"In": "X", "Out": "Y"}
                ],
                "Window": [
                    {"In": "X", "Out": "Y"}
                ],
                "GarageDoor": [
                    {"In": "X", "Out": "Y"}
                ]
            }
        }
    ]
```

Fields: 

* "platform" => Mandatory: Must always be "RiscoAlarm" (required)
* "name" => Mandatory: Can be anything (used in logs)
* "riscoUsername", "riscoPassword" => Mandatory: UserName and Password for you Web interface to RiscoCloud
* "riscoSiteId" => Mandatory: This is your siteId to login.
* "riscoPIN" => Mandatory: PIN Code used for arm/disarm
* "OccupancyPreventArming" => Optional: true|false - if set to true, Full or Partial Arming cannot be done if Occupancy is detected (default to true),
* "polling" => Optional: true|false - poll for latest RiscoCloud status (Default to false)
* "pollInterval" => Optional: time in ms for polling (Default to 10000)

    *The cumulative communication times between Homekit/RiscoCloud/Panel can go up to several seconds and a too short polling time can cause the appearance of spurious notifications during an arming / disarming request (phenomena not observed for other actions ).*
    *Therefore, it is not recommended to use a delay of less than 5 seconds.*
    *[See issue relating to this phenomenon](https://github.com/gawindx/homebridge-risco-platform/issues/42)*

* "riscoCloudDomainURL" => Optional : (experimental) URL of the RiscoCloud used to connect. In some countries, this url is not www.riscolcoud.com (eg in China).

* "logRCResponse"=> optional: true|false - This option adds the responses from RiscoCloud to the Homebridge logs.
    In the event of a processing error, activating this option provides more information for understanding the malfunction.

* "armCommand": Override default value for arming (default to "armed"). 
    Accept any of this value :
    * "armed" : set Partition/System to "armed"
    * "partially" : set Partition/System to "partially armed" (for example when you stay at home)
    * "disarmed" : set Partition/System to "disarmed"
    *See Notes 1 and 2 below*

* "partialCommand": Override default value for arming (default to "armed").
    Accepts the same values as for "armCommand".

* "homeCommand": Override default value for arming (default to "armed").
    Accepts the same values as for "armCommand".

* "disarmCommand": Override default value for arming (default to "armed").
    Accepts the same values as for "armCommand"

* "Partition" => optional: accept the following options
    * "none": will not generate an accessory for partitions
    * "all": will generate an accessory for each partition
    * "system": will generate an accessory for global system
    * "0,1,...": will generate an accessory for each listed partition.
        Accepts a comma-separated list of string where each member is the id of a partition

* "Groups" => optional: accept the following options
    * "none": will not generate an accessory for Groups
    * "all": will generate an accessory for each Group
    * "0,1,...": will generate an accessory for each listed Groups.
        Accepts a comma-separated list of string where each member is the id of a Group

* "Outputs" => optional: accept the following options
    * "none": will not generate an accessory for Outputs
    * "all": will generate an accessory for each Output
    * "0,1,...": will generate an accessory for each listed Outputs.
        Accepts a comma-separated list of string where each member is the id of a Output

* "Detectors" => optional: accept the following options
    * "none": will not generate an accessory for Detectors
    * "all": will generate an accessory for each Detector
    * "0,1,...": will generate an accessory for each listed Detectors.
        Accepts a comma-separated list of string where each member is the id of a Detector

* "Custom" => optional: Addition of Custom function. accept the following options
    Allows you to modify the type of detector (no distinction between motion detector and another type of detector at the RiscoCloud interface)
    * "Door"=> optional: accept the following options
        * "all": will modify all Detector to Door Contact
        * "0,1,...": will modify a list of Detector to Door Contact.
        Accepts a comma-separated list of string where each member is the id of a Detector
    * "Window"=> optional: accept the following options
        * "all": will modify all Detector to Windows
        * "0,1,...": will modify a list of Detector to Windows.
        Accepts a comma-separated list of string where each member is the id of a Detector
    * "Contact Sensor"=> optional: accept the following options
        * "all": will modify all Detector to Contact Sensors.
        * "0,1,...": will modify a list of Detector to Contact Sensors.
        Accepts a comma-separated list of string where each member is the id of a Detector
    * "Vibrate Sensor"=> optional: accept the following options
        * "all": will modify all Detector to Vibrate Sensors.
        * "0,1,...": will modify a list of Detector to Vibrate Sensors.
        Accepts a comma-separated list of string where each member is the id of a Detector

* "Combined" => optional: Addition of Combined Accessory.
    A combined accessory combines both an input and an output (for example, a magnetic contact on a garage door which can be opened / closed via an output of the Control Panel).

    It is important to note that if an input or an output is defined to be part of a Combined Accessory, they will be automatically removed from any other configuration and their old accessories will no longer be usable alone.
    For reasons of consistency, a bad configuration on a combined element will prevent it from being created.
    
    A Combined accessory  accept the following options
    * "Door"=> Accepts an object list separated by commas chacuns containing an inlet and an outlet
    * "Window"=> Accepts an object list separated by commas chacuns containing an inlet and an outlet
    * "GarageDoor"=> Accepts an object list separated by commas chacuns containing an inlet and an outlet
    
    For each type of Combined Accessory, it is possible to define several accessories to be created. Exemple :
    "Door": [
        {"In": "X1", "Out": "Y1"},
        {"In": "X2", "Out": "Y2"},
        {"In": "X3", "Out": "Y3"}
    ]
    Where X1, X2 and X3 are each different detector ID numbers and Y1, Y2 and Y3 are each different output ID numbers

*Notes 1 :*

*Since groups can only have 2 states, whether armed or disarmed, the options "armCommand", "nightCommand" ,"homeCommand" and "disarmCommand" only apply to Partitions and system mode.*

*Notes 2 : *

*Given that the platform allows you to choose the partition(s) managed by HomeKit, the possibility of managing arming/night/home/disarming commands linked to a specific partition has not been implemented because this would be nonsense (specific command of the type: "1:armed "or" 1:disarmed ")*

For the moment (v1.1.5), it is only possible to indicate if the real type of the detector is:
- Door contact
- Window contact
- Contact Sensor
- Vibrate Sensor *(The Risco equipment only reports the alarm state of the vibration contact, the sensor is therefore managed as a movement sensor and its integration does not allow the recovery of additional information such as an accelerometer.)*

If no accessory is generated, the system mode operation will be set by default.


## How to Identify the ID of a Detector

### Method 1 : You know the configuration of your system
In this case it is very simple.
Just take the zone number and remove 1.

Example:

```
Zone 1 at Id 0
Zone 10 Id 9
Zone 32 at Id 31
etc ...
```

### Method 2 : You do not know the configuration of your system.

In this case, you just have to restart homebridge and you will have access to this information.
When the plugin is launched, the information is disseminated and can be read directly in the logs (in real time or via the web interface).

Locate the lines resembling these to directly obtain the Id to use in the config.json file:
```
Add Accessory => Add Detectors
Add Accessory => Configuration for Detectors Id : 0 and labeled "Batiment"
Add Accessory => Configuration for Detectors Id : 1 and labeled "Pte Garage"
```

## How to get your riscoSiteId

To get your riscoSiteId, login to riscocloud via ChromeBrowser (first login screen), and before providing your PIN (second login page), display source of the page and find string: `<div class="site-name"` ... it will look like:

`<div class="site-name" id="site_12345_div">`

In that case "12345" is your siteId which should be placed in new config file.



## TODO:
* Add Cameras (Partially done but may not be usable)
* Add the ability to define custom detector types - Partially made with the support of "Custom" detectors
(water / fire / gas / CO2 / temperature threshold detector) as the risco hardware supports. This information does not go back in the REST API iRisco, it requires a manual addition (Also requires that the hardware configuration of the entry be considered as a detection area, otherwise the entry will not be accessible via the Risco APIs)


## Donation
If you want to support this project or reward the work done, you can do so here:

[![paypal](https://www.paypalobjects.com/en_US/FR/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/donate?hosted_button_id=FAFJ3ZKMENGCU)
