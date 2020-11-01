# Change Log

All notable changes to this project will be documented in this file.

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