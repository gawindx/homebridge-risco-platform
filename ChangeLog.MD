# Change Log

All notable changes to this project will be documented in this file.

## 1.2.4 (2021-14-03)
* Fix axios version depedency (CVE-2020-28168)
* Inversion of the state of the exclude switch to report only the state of exclusion and no longer the reverse (suggested by andyblac #38)
* Fixed a bug preventing switching to 'system' mode when no accessory information is defined
* Addition of specific information in the case of error 422 (bad site ID - related to issue #35)

## 1.2.3 (2020-06-12)
* Fix an error on the occupancy sensor which generates an initialization error when no Detector is defined (#30 and #31)
* Added a function to prevent Circular JSON definition error (#31). This error seems to be present when using a version of Homebridge = 1.1.6
* Code improvement for handling network errors
* Changed minimum values for homebridge and node.js in the npm definition

## 1.2.2 (2020-02-12)
* Modifying *_addOrConfigure* function to avoid issue #30
* Improvement of the Risco Cloud connection procedure in the event of a persistent network error

## 1.2.1 (2020-29-11)

* Fix an error occured when no Detectors was configured

## 1.2.0 (2020-28-11)

* **Abandonment of the RiscoCloud web interface in favor of the iRisco REST API for the connection and recovery of system information.
  Benefits brought by this change:**
  * Faster data processing.
  * Less data consumption.
  * Faster system status update (not always true for detector status).
  * The information necessary for future camera support is provided by the iRisco REST API
* The code concerning the functionalities linked to the occupancy sensor has been revised and it is also possible to deactivate its operation via a new 
  configuration option (OccupancyPreventArming). This option is enabled by default.
* Additional information in the case of missing credentials preventing the initialization of the connection to RiscoCloud.
* Additional information in the event of a connection error caused by the wrong identifier for connecting to RiscoCloud.
* Correction of an error causing the appearance / disappearance of the 'Security System' accessory in System Partitions mode from one boot to another
* Added functionality for combined elements (Door, Window and Garage Door are supported)
* Improved management and error detection during http requests to RiscoCloud and the appearance of a 500 error.

* **Known issues:**
  * The state of an accessory can sometimes take a second or two to set its final state (for example, in the case of arming a partition, the state can revert to 'deactivate' for a second or two before to take the final armed state.
  This problem does not prevent operation and will be corrected in a future version.
  * When you change the type of a combined accessory, it can sometimes happen that the icon becomes that of a switch.
  This problem is due to the fact that the exclusion function becomes the main Service.
  This problem does not affect the correct operation and a solution will be provided on a future update.



## 1.1.11 (2020-11-01)

* Correction of an error during an alarm, the state of the system was sometimes incorrectly reported (system seen as disarmed) and could require an arming before being able to disarm (#1)
* The json type debugs are now logged with an easily readable formatting (implementation of an indentation)
* **Following improved ES6 syntax support, correction of syntax error causing:**
  * impossible to use outputs


## 1.1.10 (2020-10-31)

* **Following improved ES6 syntax support, correction of syntax error causing:**
  * non-detection of groups
  * non-detection of outputs
  * the inability to arm or disarm the Partitions / Groups

## 1.1.9 (2020-10-30)

* Correction of a problem related to the occupancy sensor in the case of not defining the detectors

## 1.1.8 (2020-10-30)

* code cleaning
* code improvements to ES6
* Correction of a possible error when not defining a partition, groups, outputs or detector

## 1.1.7 (2020-10-24)

* improvements and bugfixes
* Fix Error in getPartsStates (#20 and #21)

## 1.1.6 (2020-10-20)

* Fixed an error when restoring accessory (this error is caused by adding services to existing props created with an earlier version that did not include these features).

## 1.1.5 (2020-10-19)

* Add smoke Sensor type
* Add Vibrate Sensor
* better management of adding / restoring accessories

## 1.1.4 (2020-10-18)

**Not published**

* Addition of an occupancy sensor linked to the partitions / system to see at a glance if all the sensors are at rest.
* Fixed an error when arming groups
* Fixed an error when disarming a group.

## 1.1.3 (2020-10-16)

**Not published**

* Improves error handling with Axios
* Added the possibility to define custom commands for "home", "night", "absent" and "deactivated" mode.
* Fixed incompatibility with Homebridge 1.3

## 1.1.0 (2020-08-14)

* Migration of the plugin from a static platform to a dynamic platform.
* **Known errors:**
  * when changing the type of detector (eg: movement sensor to door contact), the old service is not deleted but added.
  * the next time you load homebridge, it causes an error
  * some development log outputs will have to be deleted

## 1.0.8 (2020-06-28)

## 1.0.7 (2020-06-27)

## 1.0.6 (2020-06-26)

## 1.0.5 (2020-06-26)

## 1.0.4 (2020-06-25)

## 1.0.3 (2020-06-25)

## 1.0.2 (2020-06-24)

## 1.0.1 (2020-06-03)

## 1.0.0 (2020-06-03)

**First Release**