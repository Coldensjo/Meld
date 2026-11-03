-- The spawn tables of a CMaNGOS classic world database, as far as Meld's spawn SQL writes them
-- (#894): the columns and keys of cmangos/mangos-classic's sql/base/mangos.sql at z2836, written out
-- by hand with only what a test needs. No data. cmangos_test.go checks every statement of the export
-- against these columns; the same tables loaded into a scratch database run the export for real.
-- instance_template (at the end) is the row a dungeon published to CMaNGOS needs (#1037), checked
-- against cmangospublish.go's SQL by cmangospublish_test.go.

CREATE TABLE `creature` (
	`guid` INT UNSIGNED NOT NULL,
	`id` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`map` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`spawnMask` TINYINT UNSIGNED NOT NULL DEFAULT 1,
	`position_x` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`position_y` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`position_z` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`orientation` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`spawntimesecsmin` INT UNSIGNED NOT NULL DEFAULT 120,
	`spawntimesecsmax` INT UNSIGNED NOT NULL DEFAULT 120,
	`spawndist` FLOAT NOT NULL DEFAULT 5,
	`MovementType` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `gameobject` (
	`guid` INT UNSIGNED NOT NULL,
	`id` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`map` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`spawnMask` TINYINT UNSIGNED NOT NULL DEFAULT 1,
	`position_x` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`position_y` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`position_z` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`orientation` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`rotation0` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`rotation1` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`rotation2` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`rotation3` DECIMAL(40,20) NOT NULL DEFAULT 0,
	`spawntimesecsmin` INT NOT NULL DEFAULT 0,
	`spawntimesecsmax` INT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `creature_addon` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`mount` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`stand_state` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`sheath_state` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`emote` INT UNSIGNED NOT NULL DEFAULT 0,
	`moveflags` INT UNSIGNED NOT NULL DEFAULT 0,
	`auras` TEXT,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `creature_movement` (
	`Id` INT UNSIGNED NOT NULL,
	`Point` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`PositionX` FLOAT NOT NULL DEFAULT 0,
	`PositionY` FLOAT NOT NULL DEFAULT 0,
	`PositionZ` FLOAT NOT NULL DEFAULT 0,
	`Orientation` FLOAT NOT NULL DEFAULT 0,
	`WaitTime` INT UNSIGNED NOT NULL DEFAULT 0,
	`ScriptId` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`Comment` TEXT,
	PRIMARY KEY (`Id`, `Point`)
);

CREATE TABLE `creature_battleground` (
	`guid` INT UNSIGNED NOT NULL,
	`event1` TINYINT UNSIGNED NOT NULL,
	`event2` TINYINT UNSIGNED NOT NULL,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `creature_spawn_data` (
	`Guid` INT UNSIGNED NOT NULL,
	`Id` INT UNSIGNED NOT NULL,
	PRIMARY KEY (`Guid`)
);

CREATE TABLE `creature_spawn_data_template` (
	`Entry` INT UNSIGNED NOT NULL,
	`NpcFlags` INT NOT NULL DEFAULT -1,
	`UnitFlags` BIGINT NOT NULL DEFAULT -1,
	`Faction` INT UNSIGNED NOT NULL DEFAULT 0,
	`ModelId` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`EquipmentId` MEDIUMINT NOT NULL DEFAULT -1,
	`CurHealth` INT UNSIGNED NOT NULL DEFAULT 0,
	`CurMana` INT UNSIGNED NOT NULL DEFAULT 0,
	`SpawnFlags` INT UNSIGNED NOT NULL DEFAULT 0,
	`RelayId` INT UNSIGNED NOT NULL DEFAULT 0,
	`StringId` INT UNSIGNED NOT NULL DEFAULT 0,
	`Name` VARCHAR(200) NOT NULL,
	PRIMARY KEY (`Entry`, `UnitFlags`, `ModelId`, `EquipmentId`, `CurHealth`, `CurMana`, `SpawnFlags`)
);

CREATE TABLE `creature_equip_template` (
	`entry` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`equipentry1` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`equipentry2` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`equipentry3` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`entry`)
);

CREATE TABLE `creature_spawn_entry` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`entry` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`, `entry`)
);

CREATE TABLE `creature_linking` (
	`guid` INT UNSIGNED NOT NULL,
	`master_guid` INT UNSIGNED NOT NULL,
	`flag` MEDIUMINT UNSIGNED NOT NULL,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `game_event_creature` (
	`guid` INT UNSIGNED NOT NULL,
	`event` SMALLINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`, `event`)
);

CREATE TABLE `game_event_creature_data` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`entry_id` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`modelid` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`equipment_id` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`spell_start` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`spell_end` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`event` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`, `event`)
);

CREATE TABLE `gameobject_addon` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`animprogress` TINYINT UNSIGNED NOT NULL DEFAULT 100,
	`state` TINYINT NOT NULL DEFAULT -1,
	`StringId` INT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `gameobject_battleground` (
	`guid` INT UNSIGNED NOT NULL,
	`event1` TINYINT UNSIGNED NOT NULL,
	`event2` TINYINT UNSIGNED NOT NULL,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `gameobject_spawn_entry` (
	`guid` INT UNSIGNED NOT NULL,
	`entry` MEDIUMINT UNSIGNED NOT NULL,
	PRIMARY KEY (`guid`, `entry`)
);

CREATE TABLE `game_event_gameobject` (
	`guid` INT UNSIGNED NOT NULL,
	`event` SMALLINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guid`, `event`)
);

CREATE TABLE `pool_template` (
	`entry` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`max_limit` INT UNSIGNED NOT NULL DEFAULT 0,
	`description` VARCHAR(255) NOT NULL,
	PRIMARY KEY (`entry`)
);

CREATE TABLE `pool_creature` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`pool_entry` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`chance` FLOAT UNSIGNED NOT NULL DEFAULT 0,
	`description` VARCHAR(255) NOT NULL,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `pool_gameobject` (
	`guid` INT UNSIGNED NOT NULL DEFAULT 0,
	`pool_entry` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`chance` FLOAT UNSIGNED NOT NULL DEFAULT 0,
	`description` VARCHAR(255) NOT NULL,
	PRIMARY KEY (`guid`)
);

CREATE TABLE `pool_pool` (
	`pool_id` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`mother_pool` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`chance` FLOAT NOT NULL DEFAULT 0,
	`description` VARCHAR(255) NOT NULL,
	PRIMARY KEY (`pool_id`)
);

CREATE TABLE `spawn_group` (
	`Id` INT NOT NULL,
	`Name` VARCHAR(200) NOT NULL,
	`Type` INT NOT NULL,
	`MaxCount` INT NOT NULL DEFAULT 0,
	`WorldState` INT NOT NULL DEFAULT 0,
	`WorldStateExpression` INT NOT NULL DEFAULT 0,
	`Flags` INT UNSIGNED NOT NULL DEFAULT 0,
	`StringId` INT UNSIGNED NOT NULL DEFAULT 0,
	`RespawnOverrideMin` INT UNSIGNED DEFAULT NULL,
	`RespawnOverrideMax` INT UNSIGNED DEFAULT NULL,
	PRIMARY KEY (`Id`)
);

CREATE TABLE `spawn_group_spawn` (
	`Id` INT NOT NULL,
	`Guid` INT NOT NULL,
	`SlotId` TINYINT NOT NULL DEFAULT -1,
	`Chance` INT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`Id`, `Guid`)
);

CREATE TABLE `spawn_group_formation` (
	`Id` INT NOT NULL,
	`FormationType` TINYINT NOT NULL DEFAULT 0,
	`FormationSpread` FLOAT(11,0) NOT NULL DEFAULT 0,
	`FormationOptions` INT NOT NULL DEFAULT 0,
	`PathId` INT NOT NULL DEFAULT 0,
	`MovementType` TINYINT NOT NULL,
	`Comment` VARCHAR(255) NULL DEFAULT NULL,
	PRIMARY KEY (`Id`)
);

CREATE TABLE `waypoint_path` (
	`PathId` INT UNSIGNED NOT NULL DEFAULT 0,
	`Point` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`PositionX` FLOAT NOT NULL DEFAULT 0,
	`PositionY` FLOAT NOT NULL DEFAULT 0,
	`PositionZ` FLOAT NOT NULL DEFAULT 0,
	`Orientation` FLOAT NOT NULL DEFAULT 0,
	`WaitTime` INT UNSIGNED NOT NULL DEFAULT 0,
	`ScriptId` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
	`Comment` TEXT,
	PRIMARY KEY (`PathId`, `Point`)
);

CREATE TABLE `instance_template` (
	`map` SMALLINT UNSIGNED NOT NULL,
	`parent` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`levelMin` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`levelMax` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`maxPlayers` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`reset_delay` INT UNSIGNED NOT NULL DEFAULT 0,
	`ghostEntranceMap` SMALLINT UNSIGNED NOT NULL,
	`ghostEntranceX` FLOAT NOT NULL,
	`ghostEntranceY` FLOAT NOT NULL,
	`ScriptName` VARCHAR(128) NOT NULL DEFAULT '',
	`mountAllowed` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`map`)
);
