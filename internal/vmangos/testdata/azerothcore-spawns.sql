-- The spawn tables of an AzerothCore world database, as far as Meld's spawn SQL writes them (#1073):
-- the columns and keys of azerothcore/azerothcore-wotlk's data/sql/base/db_world (read 2026-11),
-- written out by hand with only what a test needs (smart_scripts keeps its key and comment only).
-- No data. azerothcore_test.go checks every statement of the export against these columns; the same
-- tables loaded into a scratch database run the export for real (docs/tests/spawns.md).

CREATE TABLE `creature` (
	`guid` INT UNSIGNED NOT NULL AUTO_INCREMENT,
	`id1` INT UNSIGNED NOT NULL DEFAULT 0,
	`id2` INT UNSIGNED NOT NULL DEFAULT 0,
	`id3` INT UNSIGNED NOT NULL DEFAULT 0,
	`map` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`zoneId` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`areaId` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`spawnMask` TINYINT UNSIGNED NOT NULL DEFAULT 1,
	`phaseMask` INT UNSIGNED NOT NULL DEFAULT 1,
	`equipment_id` TINYINT NOT NULL DEFAULT 0,
	`position_x` FLOAT NOT NULL DEFAULT 0,
	`position_y` FLOAT NOT NULL DEFAULT 0,
	`position_z` FLOAT NOT NULL DEFAULT 0,
	`orientation` FLOAT NOT NULL DEFAULT 0,
	`spawntimesecs` INT UNSIGNED NOT NULL DEFAULT 120,
	`wander_distance` FLOAT NOT NULL DEFAULT 0,
	`currentwaypoint` INT UNSIGNED NOT NULL DEFAULT 0,
	`curhealth` INT UNSIGNED NOT NULL DEFAULT 1,
	`curmana` INT UNSIGNED NOT NULL DEFAULT 0,
	`MovementType` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`npcflag` INT UNSIGNED NOT NULL DEFAULT 0,
	`unit_flags` INT UNSIGNED NOT NULL DEFAULT 0,
	`dynamicflags` INT UNSIGNED NOT NULL DEFAULT 0,
	`ScriptName` CHAR(64) DEFAULT '',
	`VerifiedBuild` INT DEFAULT NULL,
	`CreateObject` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`Comment` TEXT,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `gameobject` (
	`guid` INT UNSIGNED NOT NULL AUTO_INCREMENT,
	`id` INT UNSIGNED NOT NULL DEFAULT 0,
	`map` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`zoneId` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`areaId` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`spawnMask` TINYINT UNSIGNED NOT NULL DEFAULT 1,
	`phaseMask` INT UNSIGNED NOT NULL DEFAULT 1,
	`position_x` FLOAT NOT NULL DEFAULT 0,
	`position_y` FLOAT NOT NULL DEFAULT 0,
	`position_z` FLOAT NOT NULL DEFAULT 0,
	`orientation` FLOAT NOT NULL DEFAULT 0,
	`rotation0` FLOAT NOT NULL DEFAULT 0,
	`rotation1` FLOAT NOT NULL DEFAULT 0,
	`rotation2` FLOAT NOT NULL DEFAULT 0,
	`rotation3` FLOAT NOT NULL DEFAULT 0,
	`spawntimesecs` INT NOT NULL DEFAULT 0,
	`animprogress` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`state` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`ScriptName` CHAR(64) DEFAULT '',
	`VerifiedBuild` INT DEFAULT NULL,
	`Comment` TEXT,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `creature_addon` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`path_id` INT UNSIGNED NOT NULL DEFAULT 0,
	`mount` INT UNSIGNED NOT NULL DEFAULT 0,
	`bytes1` INT UNSIGNED NOT NULL DEFAULT 0,
	`bytes2` INT UNSIGNED NOT NULL DEFAULT 0,
	`emote` INT UNSIGNED NOT NULL DEFAULT 0,
	`visibilityDistanceType` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`auras` TEXT,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `creature_template_addon` (
	`entry` INT UNSIGNED NOT NULL DEFAULT 0,
	`path_id` INT UNSIGNED NOT NULL DEFAULT 0,
	`mount` INT UNSIGNED NOT NULL DEFAULT 0,
	`bytes1` INT UNSIGNED NOT NULL DEFAULT 0,
	`bytes2` INT UNSIGNED NOT NULL DEFAULT 0,
	`emote` INT UNSIGNED NOT NULL DEFAULT 0,
	`visibilityDistanceType` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`auras` TEXT,
	PRIMARY KEY (`entry`)
);

CREATE TABLE `creature_equip_template` (
	`CreatureID` INT UNSIGNED NOT NULL DEFAULT 0,
	`ID` TINYINT UNSIGNED NOT NULL DEFAULT 1,
	`ItemID1` INT UNSIGNED NOT NULL DEFAULT 0,
	`ItemID2` INT UNSIGNED NOT NULL DEFAULT 0,
	`ItemID3` INT UNSIGNED NOT NULL DEFAULT 0,
	`VerifiedBuild` INT DEFAULT NULL,
	PRIMARY KEY (`CreatureID`, `ID`)
);

CREATE TABLE `creature_formations` (
	`leaderGUID` INT UNSIGNED NOT NULL DEFAULT 0,
	`memberGUID` INT UNSIGNED NOT NULL DEFAULT 0,
	`dist` FLOAT NOT NULL DEFAULT 0,
	`angle` FLOAT NOT NULL DEFAULT 0,
	`groupAI` INT UNSIGNED NOT NULL DEFAULT 0,
	`point_1` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`point_2` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`memberGUID`),
	CHECK (`dist` >= 0 AND `angle` >= 0)
);

CREATE TABLE `creature_movement_override` (
	`SpawnId` INT UNSIGNED NOT NULL DEFAULT 0,
	`Ground` TINYINT UNSIGNED DEFAULT NULL,
	`Swim` TINYINT UNSIGNED DEFAULT NULL,
	`Flight` TINYINT UNSIGNED DEFAULT NULL,
	`Rooted` TINYINT UNSIGNED DEFAULT NULL,
	`Chase` TINYINT UNSIGNED DEFAULT NULL,
	`Random` TINYINT UNSIGNED DEFAULT NULL,
	`InteractionPauseTimer` INT UNSIGNED DEFAULT NULL,
	PRIMARY KEY (`SpawnId`)
);

CREATE TABLE `creature_sparring` (
	`GUID` INT UNSIGNED NOT NULL,
	`SparringPCT` FLOAT NOT NULL,
	PRIMARY KEY (`GUID`),
	FOREIGN KEY (`GUID`) REFERENCES `creature` (`guid`)
);

CREATE TABLE `game_event_creature` (
	`eventEntry` SMALLINT NOT NULL,
	`guid` INT UNSIGNED NOT NULL,
	PRIMARY KEY (`guid`, `eventEntry`)
);

CREATE TABLE `game_event_model_equip` (
	`eventEntry` TINYINT UNSIGNED NOT NULL,
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`modelid` INT UNSIGNED NOT NULL DEFAULT 0,
	`equipment_id` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `game_event_npcflag` (
	`eventEntry` TINYINT UNSIGNED NOT NULL,
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`npcflag` INT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`, `eventEntry`)
);

CREATE TABLE `game_event_gameobject` (
	`eventEntry` SMALLINT NOT NULL,
	`guid` INT UNSIGNED NOT NULL,
	PRIMARY KEY (`guid`, `eventEntry`)
);

CREATE TABLE `gameobject_addon` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`parent_rotation0` FLOAT NOT NULL DEFAULT 0,
	`parent_rotation1` FLOAT NOT NULL DEFAULT 0,
	`parent_rotation2` FLOAT NOT NULL DEFAULT 0,
	`parent_rotation3` FLOAT NOT NULL DEFAULT 1,
	`invisibilityType` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`invisibilityValue` INT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `linked_respawn` (
	`guid` INT UNSIGNED NOT NULL,
	`linkedGuid` INT UNSIGNED NOT NULL,
	`linkType` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`, `linkType`)
);

CREATE TABLE `pool_template` (
	`entry` INT UNSIGNED NOT NULL DEFAULT 0,
	`max_limit` INT UNSIGNED NOT NULL DEFAULT 0,
	`description` VARCHAR(255) DEFAULT NULL,
	PRIMARY KEY (`entry`)
);

CREATE TABLE `pool_creature` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`pool_entry` INT UNSIGNED NOT NULL DEFAULT 0,
	`chance` FLOAT NOT NULL DEFAULT 0,
	`description` VARCHAR(255) DEFAULT NULL,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `pool_gameobject` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`pool_entry` INT UNSIGNED NOT NULL DEFAULT 0,
	`chance` FLOAT NOT NULL DEFAULT 0,
	`description` VARCHAR(255) DEFAULT NULL,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `pool_pool` (
	`pool_id` INT UNSIGNED NOT NULL DEFAULT 0,
	`mother_pool` INT UNSIGNED NOT NULL DEFAULT 0,
	`chance` FLOAT NOT NULL DEFAULT 0,
	`description` VARCHAR(255) DEFAULT NULL,
	PRIMARY KEY (`pool_id`)
);

CREATE TABLE `smart_scripts` (
	`entryorguid` INT NOT NULL,
	`source_type` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`id` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`link` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`comment` TEXT NOT NULL,
	PRIMARY KEY (`entryorguid`, `source_type`, `id`, `link`)
);

CREATE TABLE `spawn_group` (
	`groupId` INT UNSIGNED NOT NULL,
	`spawnType` TINYINT UNSIGNED NOT NULL,
	`spawnId` INT UNSIGNED NOT NULL,
	PRIMARY KEY (`groupId`, `spawnType`, `spawnId`)
);

CREATE TABLE `waypoint_data` (
	`id` INT UNSIGNED NOT NULL DEFAULT 0,
	`point` INT UNSIGNED NOT NULL DEFAULT 0,
	`position_x` FLOAT NOT NULL DEFAULT 0,
	`position_y` FLOAT NOT NULL DEFAULT 0,
	`position_z` FLOAT NOT NULL DEFAULT 0,
	`orientation` FLOAT DEFAULT NULL,
	`velocity` FLOAT NOT NULL DEFAULT 0,
	`delay` INT UNSIGNED NOT NULL DEFAULT 0,
	`smoothTransition` TINYINT NOT NULL DEFAULT 0,
	`move_type` INT NOT NULL DEFAULT 0,
	`action` INT NOT NULL DEFAULT 0,
	`action_chance` SMALLINT NOT NULL DEFAULT 100,
	`wpguid` INT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`id`, `point`)
);
