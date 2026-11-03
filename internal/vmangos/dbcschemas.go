package vmangos

import "Meld/internal/clientbuild"

// The layouts of the client tables Meld reads and writes (dbclayout.go, #1064). Each 1.12 layout's
// width is checked against the client's own table by TestDBCLayoutsMatchClient. The 2.4.3 and
// 3.3.5a layouts are added beside the 1.12 ones (#1075, #1067).

// vanilla is a schema with only its 1.12 layout.
func vanilla(name, spec string) *dbcSchema {
	return newDBCSchema(name, map[clientbuild.Build]string{clientbuild.Vanilla: spec})
}

// The tables Meld writes into its patch.
var (
	dbcAreaTable = vanilla("AreaTable", `ID MapID ParentID AreaBit Flags SoundPref SoundPrefSwim Ambience Music IntroMusic
		Level:i Name:loc Faction Liquid MinElevation:f AmbientMul:f Light`)
	dbcAreaTrigger = vanilla("AreaTrigger", `ID MapID Pos:f[3] Radius:f BoxLength:f BoxWidth:f BoxHeight:f BoxYaw:f`)

	// A light's place and radii are in thirty-sixths of a yard; its five LightParams rows are clear,
	// clear underwater, storm, storm underwater and death.
	dbcLight          = vanilla("Light", `ID MapID Pos:f[3] Inner:f Outer:f Params[5]`)
	dbcLightParams    = vanilla("LightParams", `ID HighlightSky Skybox Cloud Glow:f WaterAlpha:f[2] OceanAlpha:f[2]`)
	dbcLightIntBand   = vanilla("LightIntBand", `ID Count Time[16] Value[16]`)
	dbcLightFloatBand = vanilla("LightFloatBand", `ID Count Time[16] Value:f[16]`)

	dbcSoundEntries  = vanilla("SoundEntries", `ID Type Name:s File:s[10] Freq[10] Dir:s Volume:f Flags MinDist:f Cutoff:f EAX`)
	dbcZoneMusic     = vanilla("ZoneMusic", `ID Name:s SilenceMin[2] SilenceMax[2] Day Night`)
	dbcZoneIntro     = vanilla("ZoneIntroMusicTable", `ID Name:s Sound Priority MinDelay`)
	dbcSoundAmbience = vanilla("SoundAmbience", `ID Day Night`)
	dbcSoundPrefs    = vanilla("SoundProviderPreferences", `ID Description:s _[22]`)

	dbcObjectDisplay = vanilla("GameObjectDisplayInfo", `ID Model:s Sound[10]`)
	dbcGroundTexture = vanilla("GroundEffectTexture", `ID Doodad[4] Density Terrain`)
	dbcGroundDoodad  = vanilla("GroundEffectDoodad", `ID DoodadID Path:s`)
	dbcTerrainType   = vanilla("TerrainType", `ID Name:s SprayRun SprayWalk Sound Flags`)
	dbcTransportAnim = vanilla("TransportAnimation", `ID Transport Time Pos:f[3] Sequence`)
	dbcLoadingScreen = vanilla("LoadingScreens", `ID Name:s Path:s`)
	// Map: 2 the instance type (0 world, 1 dungeon, 2 raid, 3 battleground), 3 the PvP flag.
	dbcMap = vanilla("Map", `ID Directory:s InstanceType PvP Name:loc MinLevel MaxLevel MaxPlayers _[3] AreaID
		Description0:loc Description1:loc LoadingScreen RaidOffset _[2]`)

	dbcSpellIcon = vanilla("SpellIcon", `ID Texture:s`)
	// SpellVisual: a kit for each stage (precast, cast, impact, state, channel), then the missile's
	// flag, model, path type, attachment and sound, the area effect's flag, model and kit, a sound
	// and flags.
	dbcSpellVisual = vanilla("SpellVisual", `ID Kit[5] Missile MissileModel MissilePath MissileAttach MissileSound
		Area AreaModel AreaSound AnimSound Flags`)
	// SpellVisualKit: its kind and animation, the effect on each of ten attachment points (head,
	// chest, base, left hand, right hand, breath, three specials, world), a sound and a shake, then the
	// character glow's procs and parameters.
	dbcVisualEffect   = vanilla("SpellVisualEffectName", `ID Name:s Path:s AreaSize:f Scale:f`)
	dbcSpellVisualKit = vanilla("SpellVisualKit", `ID Kind Anim Effect[10] Sound Shake CharProc[4] CharParam0:f[4]
		CharParam1:f[4] CharParam2:f[4] CharParam3:f[4]`)

	// ItemDisplayInfo: two models and their textures, the icon, three geoset groups, flags, a spell
	// visual, a sound group, two helmet geoset visibilities, eight body textures and the weapon visual.
	dbcItemDisplay = vanilla("ItemDisplayInfo", `ID Model:s[2] ModelTexture:s[2] Icon:s Geoset[3] Flags SpellVisual
		SoundGroup HelmVis[2] Texture:s[8] Visual`)

	dbcTaxiNodes    = vanilla("TaxiNodes", `ID MapID Pos:f[3] Name:loc HordeMount AllianceMount`)
	dbcTaxiPath     = vanilla("TaxiPath", `ID From To Cost`)
	dbcTaxiPathNode = vanilla("TaxiPathNode", `ID Path Index MapID Pos:f[3] Flags Delay`)

	dbcWorldMapArea    = vanilla("WorldMapArea", `ID MapID AreaID Name:s Left:f Right:f Top:f Bottom:f`)
	dbcWorldMapOverlay = vanilla("WorldMapOverlay", `ID MapArea Area[4] MapPointX MapPointY Name:s Width Height
		OffsetX OffsetY HitTop HitLeft HitBottom HitRight`)
	dbcWorldSafeLocs = vanilla("WorldSafeLocs", `ID MapID Pos:f[3] Name:loc`)
)

// The tables Meld only reads.
var (
	// The tables that dress a spawn's model (looks.go).
	dbcCreatureDisplay = vanilla("CreatureDisplayInfo", `ID Model Sound Extra Scale:f Alpha Skin:s[3] SizeClass Blood NPCSound`)
	dbcCreatureModel   = vanilla("CreatureModelData", `ID Flags Path:s SizeClass Scale:f Blood Footprint FootprintLength:f
		FootprintWidth:f FootprintScale:f Foley FootstepShake DeathShake Sound CollisionWidth:f CollisionHeight:f`)
	// CreatureDisplayInfoExtra: a humanoid display's race, sex, skin colour, face, hair style, hair
	// colour and facial hair, the displays of the ten items it wears and its baked body texture.
	dbcCreatureExtra = vanilla("CreatureDisplayInfoExtra", `ID Race Sex Skin Face HairStyle HairColor FacialHair Item[10] Bake:s`)
	dbcHairGeosets   = vanilla("CharHairGeosets", `ID Race Sex Variation Geoset Scalp`)
	dbcFacialHair    = vanilla("CharacterFacialHairStyles", `Race Sex Variation Geoset[6]`)
	// CharSections: section 0 is the skin, 3 the hair.
	dbcCharSections = vanilla("CharSections", `ID Race Sex Section Variation Color Texture:s[3] Flags`)
	dbcChrRaces     = vanilla("ChrRaces", `ID Flags Faction Exploration MaleDisplay FemaleDisplay Prefix:s MountScale:f Language
		CreatureType LoginEffect CombatStun ResSickness Splash StartingTaxi ClientFile:s Cinematic Name:loc
		FacialHairCustomization:s[2] HairCustomization:s`)
	// HelmetGeosetVisData: race masks for the hair, the three facial hair groups and the ears.
	dbcHelmVis = vanilla("HelmetGeosetVisData", `ID Hide[5]`)
	dbcEmotes  = vanilla("Emotes", `ID Command:s Anim Flags SpecProc SpecProcParam Sound`)

	// The tables a spell's index columns name; a duration of -1 lasts until cancelled.
	dbcSpellDuration  = vanilla("SpellDuration", `ID Duration:i PerLevel:i Max:i`)
	dbcSpellRadius    = vanilla("SpellRadius", `ID Radius:f PerLevel:f Max:f`)
	dbcSpellCastTimes = vanilla("SpellCastTimes", `ID Base:i PerLevel:i Min:i`)
	dbcSpellRange     = vanilla("SpellRange", `ID Min:f Max:f Flags Name:loc ShortName:loc`)
	// SpellItemEnchantment: three effects, each a kind, the least and the most amount and a spell or
	// stat ID.
	dbcSpellEnchant = vanilla("SpellItemEnchantment", `ID Effect[3] Min:i[3] Max:i[3] Arg[3] Name:loc ItemVisual Flags`)

	// The skill lines that sort the spell browser's spells.
	dbcSkillLine        = vanilla("SkillLine", `ID Category:i SkillCosts Name:loc Description:loc SpellIcon`)
	dbcSkillLineAbility = vanilla("SkillLineAbility", `ID SkillLine Spell RaceMask ClassMask ExcludeRace ExcludeClass MinRank
		Superceded AcquireMethod TrivialHigh TrivialLow Abandonable CharacterPoints[2]`)
	dbcSkillRaceClass = vanilla("SkillRaceClassInfo", `ID Skill RaceMask ClassMask Flags MinLevel SkillTier SkillCost`)
	dbcSkillTiers     = vanilla("SkillTiers", `ID Cost[16] Value[16]`)

	// Faction: the reputation fields (four of each), the parent, the name and the description.
	dbcFaction = vanilla("Faction", `ID ReputationIndex RaceMask[4] ClassMask[4] Base:i[4] RepFlags[4] Parent Name:loc
		Description:loc`)
	// FactionTemplate: the groups it is in, is friends with and is enemies with, then four enemy and
	// four friend factions.
	dbcFactionTemplate = vanilla("FactionTemplate", `ID Faction Flags Group FriendGroup EnemyGroup Enemy[4] Friend[4]`)

	// ItemSet: 17 member items, 8 bonus spells and the members each needs, the required skill.
	dbcItemSet = vanilla("ItemSet", `ID Name:loc Item[17] Spell[8] Threshold[8] Skill SkillRank`)
	// ItemRandomProperties: an internal name, the enchantments (the first three used) and the suffix.
	dbcRandomProps = vanilla("ItemRandomProperties", `ID Name:s Enchant[5] Suffix:loc`)
	// LiquidType: the kind is 0 water, 1 ocean, 2 magma, 3 slime.
	dbcLiquidType = vanilla("LiquidType", `ID Name:s Kind Spell`)

	// The tables a game object's data names (objecttables.go).
	dbcLock         = vanilla("Lock", `ID Type[8] Index[8] Skill[8] Action[8]`)
	dbcLockType     = vanilla("LockType", `ID Name:loc Resource:loc Verb:loc Cursor:s`)
	dbcLanguages    = vanilla("Languages", `ID Name:loc`)
	dbcPageMaterial = vanilla("PageTextMaterial", `ID Name:s`)
	dbcSpellFocus   = vanilla("SpellFocusObject", `ID Name:loc`)
	dbcCinematicSeq = vanilla("CinematicSequences", `ID Sound Camera[8]`)
	dbcCinematicCam = vanilla("CinematicCamera", `ID Model:s Sound Origin:f[3] Facing:f`)
	dbcAuctionHouse = vanilla("AuctionHouse", `ID Faction Deposit Cut Name:loc`)

	// The quest editor's tables.
	dbcQuestSort    = vanilla("QuestSort", `ID Name:loc`)
	dbcMailTemplate = vanilla("MailTemplate", `ID Body:loc`)

	dbcAnimationData = vanilla("AnimationData", `ID Name:s WeaponFlags BodyFlags _ Flags Fallback`)
)
