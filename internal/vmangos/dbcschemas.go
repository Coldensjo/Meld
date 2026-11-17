package vmangos

import "Meld/internal/clientbuild"

// The layouts of the client tables Meld reads and writes (dbclayout.go, #1064). Each 1.12 layout's
// width is checked against the client's own table by TestDBCLayoutsMatchClient, and each 3.3.5a
// layout's by TestDBCLayoutsMatchWotLKClient (#1067).
//
// A 3.3.5a layout keeps the names of the 1.12 fields it still has, since the readers ask for them by
// name, and names what that client added. Its columns are the client's own (build 12340's record
// of each table, and the widths its loaders check). Three ways a table gets one:
//   - vanilla: the table has the same columns in both clients, so the one layout reads both;
//   - both: the same fields in both, but a localized string is 17 columns wide in 3.3.5a and 9 in
//     1.12, so the one spec makes two layouts;
//   - later: the 3.3.5a client added, dropped or moved columns.
//
// What a 3.3.5a layout lacks of the 1.12 one is listed in wotlkDropped (dbclayout_test.go checks the
// list), and a reader of such a field asks the layout first (dbcLayout.has).

// vanilla is a schema with only its 1.12 layout, which a 3.3.5a table of the same columns reads with too.
func vanilla(name, spec string) *dbcSchema {
	return newDBCSchema(name, map[clientbuild.Build]string{clientbuild.Vanilla: spec})
}

// both is a schema whose 1.12 and 3.3.5a layouts are the same fields.
func both(name, spec string) *dbcSchema {
	return newDBCSchema(name, map[clientbuild.Build]string{clientbuild.Vanilla: spec, clientbuild.WotLK: spec})
}

// later is a schema with a 1.12 layout and the 3.3.5a client's own.
func later(name, spec, wotlk string) *dbcSchema {
	return newDBCSchema(name, map[clientbuild.Build]string{clientbuild.Vanilla: spec, clientbuild.WotLK: wotlk})
}

// wotlkDropped are the 1.12 fields a table's 3.3.5a layout has no column for.
var wotlkDropped = map[string][]string{
	// The level range moved to the server's tables, and the player limit to the end of the record.
	"Map": {"MinLevel", "MaxLevel"},
	// A texture's slots name the doodad's row itself.
	"GroundEffectDoodad": {"DoodadID"},
	"ChrRaces":           {"MountScale", "LoginEffect", "CombatStun", "StartingTaxi"},
	"SkillLineAbility":   {"Abandonable"},
}

// The tables Meld writes into its patch.
var (
	// AreaTable: in 3.3.5a an area names a liquid type for each kind of liquid (water, ocean, magma,
	// slime) instead of one for its water; Liquid is the water's in both.
	dbcAreaTable = later("AreaTable", `ID MapID ParentID AreaBit Flags SoundPref SoundPrefSwim Ambience Music IntroMusic
		Level:i Name:loc Faction Liquid MinElevation:f AmbientMul:f Light`,
		`ID MapID ParentID AreaBit Flags SoundPref SoundPrefSwim Ambience Music IntroMusic
		Level:i Name:loc Faction Liquid LiquidOcean LiquidMagma LiquidSlime MinElevation:f AmbientMul:f Light`)
	dbcAreaTrigger = vanilla("AreaTrigger", `ID MapID Pos:f[3] Radius:f BoxLength:f BoxWidth:f BoxHeight:f BoxYaw:f`)

	// A light's place and radii are in thirty-sixths of a yard; its five LightParams rows are clear,
	// clear underwater, storm, storm underwater and death, and 3.3.5a has three more after them.
	dbcLight          = later("Light", `ID MapID Pos:f[3] Inner:f Outer:f Params[5]`, `ID MapID Pos:f[3] Inner:f Outer:f Params[8]`)
	dbcLightParams    = vanilla("LightParams", `ID HighlightSky Skybox Cloud Glow:f WaterAlpha:f[2] OceanAlpha:f[2]`)
	dbcLightIntBand   = vanilla("LightIntBand", `ID Count Time[16] Value[16]`)
	dbcLightFloatBand = vanilla("LightFloatBand", `ID Count Time[16] Value:f[16]`)

	dbcSoundEntries = later("SoundEntries", `ID Type Name:s File:s[10] Freq[10] Dir:s Volume:f Flags MinDist:f Cutoff:f EAX`,
		`ID Type Name:s File:s[10] Freq[10] Dir:s Volume:f Flags MinDist:f Cutoff:f EAX Advanced`)
	dbcZoneMusic     = vanilla("ZoneMusic", `ID Name:s SilenceMin[2] SilenceMax[2] Day Night`)
	dbcZoneIntro     = vanilla("ZoneIntroMusicTable", `ID Name:s Sound Priority MinDelay`)
	dbcSoundAmbience = vanilla("SoundAmbience", `ID Day Night`)
	dbcSoundPrefs    = vanilla("SoundProviderPreferences", `ID Description:s _[22]`)

	dbcObjectDisplay = later("GameObjectDisplayInfo", `ID Model:s Sound[10]`, `ID Model:s Sound[10] BoxMin:f[3] BoxMax:f[3] EffectPackage`)
	dbcGroundTexture = later("GroundEffectTexture", `ID Doodad[4] Density Terrain`, `ID Doodad[4] Weight[4] Density Terrain`)
	// GroundEffectDoodad is three columns in both clients, but not the same three: a reader passes the
	// client's build (parseTableFor). In 1.12 a texture's slots name DoodadID; in 3.3.5a the row's ID.
	dbcGroundDoodad  = later("GroundEffectDoodad", `ID DoodadID Path:s`, `ID Path:s Flags`)
	dbcTerrainType   = vanilla("TerrainType", `ID Name:s SprayRun SprayWalk Sound Flags`)
	dbcTransportAnim = vanilla("TransportAnimation", `ID Transport Time Pos:f[3] Sequence`)
	dbcLoadingScreen = later("LoadingScreens", `ID Name:s Path:s`, `ID Name:s Path:s WideScreen`)
	// Map: the instance type is 0 world, 1 dungeon, 2 raid, 3 battleground (4 arena in 3.3.5a), then the
	// PvP flag. 3.3.5a adds the map's flags before it, the corpse's map and place, and the expansion.
	dbcMap = later("Map", `ID Directory:s InstanceType PvP Name:loc MinLevel MaxLevel MaxPlayers _[3] AreaID
		Description0:loc Description1:loc LoadingScreen RaidOffset _[2]`,
		`ID Directory:s InstanceType Flags PvP Name:loc AreaID Description0:loc Description1:loc LoadingScreen
		MinimapIconScale:f CorpseMap Corpse:f[2] TimeOfDay Expansion RaidOffset MaxPlayers`)

	dbcSpellIcon = vanilla("SpellIcon", `ID Texture:s`)
	// SpellVisual: a kit for each stage (precast, cast, impact, state, channel), then the missile's
	// flag, model, path type, attachment and sound, the area effect's flag, model and kit, a sound
	// and flags.
	dbcSpellVisual = vanilla("SpellVisual", `ID Kit[5] Missile MissileModel MissilePath MissileAttach MissileSound
		Area AreaModel AreaSound AnimSound Flags`)
	// SpellVisualKit: its kind and animation, the effect on each of ten attachment points (head,
	// chest, base, left hand, right hand, breath, three specials, world), a sound and a shake, then the
	// character glow's procs and parameters.
	dbcVisualEffect = later("SpellVisualEffectName", `ID Name:s Path:s AreaSize:f Scale:f`,
		`ID Name:s Path:s AreaSize:f Scale:f MinScale:f MaxScale:f`)
	dbcSpellVisualKit = vanilla("SpellVisualKit", `ID Kind Anim Effect[10] Sound Shake CharProc[4] CharParam0:f[4]
		CharParam1:f[4] CharParam2:f[4] CharParam3:f[4]`)

	// ItemDisplayInfo: two models and their textures, the icon, three geoset groups, flags, a spell
	// visual, a sound group, two helmet geoset visibilities, eight body textures and the weapon visual.
	dbcItemDisplay = later("ItemDisplayInfo", `ID Model:s[2] ModelTexture:s[2] Icon:s Geoset[3] Flags SpellVisual
		SoundGroup HelmVis[2] Texture:s[8] Visual`,
		`ID Model:s[2] ModelTexture:s[2] Icon:s Icon2:s Geoset[3] Flags SpellVisual
		SoundGroup HelmVis[2] Texture:s[8] Visual ParticleColor`)

	dbcTaxiNodes    = both("TaxiNodes", `ID MapID Pos:f[3] Name:loc HordeMount AllianceMount`)
	dbcTaxiPath     = vanilla("TaxiPath", `ID From To Cost`)
	dbcTaxiPathNode = later("TaxiPathNode", `ID Path Index MapID Pos:f[3] Flags Delay`, `ID Path Index MapID Pos:f[3] Flags Delay ArrivalEvent DepartureEvent`)

	// WorldMapArea: 3.3.5a adds the map a zone's world map is shown for, a dungeon's first floor and
	// the world map it belongs to.
	dbcWorldMapArea = later("WorldMapArea", `ID MapID AreaID Name:s Left:f Right:f Top:f Bottom:f`,
		`ID MapID AreaID Name:s Left:f Right:f Top:f Bottom:f DisplayMap DefaultFloor ParentMap`)
	dbcWorldMapOverlay = vanilla("WorldMapOverlay", `ID MapArea Area[4] MapPointX MapPointY Name:s Width Height
		OffsetX OffsetY HitTop HitLeft HitBottom HitRight`)
	dbcWorldSafeLocs = both("WorldSafeLocs", `ID MapID Pos:f[3] Name:loc`)
)

// The tables Meld only reads.
var (
	// The tables that dress a spawn's model (looks.go).
	dbcCreatureDisplay = later("CreatureDisplayInfo", `ID Model Sound Extra Scale:f Alpha Skin:s[3] SizeClass Blood NPCSound`,
		`ID Model Sound Extra Scale:f Alpha Skin:s[3] Portrait:s SizeClass Blood NPCSound ParticleColor GeosetData EffectPackage`)
	dbcCreatureModel = later("CreatureModelData", `ID Flags Path:s SizeClass Scale:f Blood Footprint FootprintLength:f
		FootprintWidth:f FootprintScale:f Foley FootstepShake DeathShake Sound CollisionWidth:f CollisionHeight:f`,
		`ID Flags Path:s SizeClass Scale:f Blood Footprint FootprintLength:f
		FootprintWidth:f FootprintScale:f Foley FootstepShake DeathShake Sound CollisionWidth:f CollisionHeight:f
		MountHeight:f BoxMin:f[3] BoxMax:f[3] WorldEffectScale:f AttachedEffectScale:f MissileRadius:f MissilePush:f MissileRaise:f`)
	// CreatureDisplayInfoExtra: a humanoid display's race, sex, skin colour, face, hair style, hair
	// colour and facial hair, the displays of the ten items it wears (eleven in 3.3.5a, the cape last)
	// and its baked body texture.
	dbcCreatureExtra = later("CreatureDisplayInfoExtra", `ID Race Sex Skin Face HairStyle HairColor FacialHair Item[10] Bake:s`,
		`ID Race Sex Skin Face HairStyle HairColor FacialHair Item[11] Flags Bake:s`)
	dbcHairGeosets = vanilla("CharHairGeosets", `ID Race Sex Variation Geoset Scalp`)
	// CharacterFacialHairStyles has no ID column. Geoset is the variants of geoset groups 1, 3 and 2:
	// the last three of 1.12's six geoset columns, and the first three of 3.3.5a's five.
	dbcFacialHair = later("CharacterFacialHairStyles", `Race Sex Variation _[3] Geoset[3]`, `Race Sex Variation Geoset[3] _[2]`)
	// CharSections: section 0 is the skin, 3 the hair. It is ten columns in both clients, in another
	// order: a reader passes the client's build (parseTableFor).
	dbcCharSections = later("CharSections", `ID Race Sex Section Variation Color Texture:s[3] Flags`,
		`ID Race Sex Section Texture:s[3] Flags Variation Color`)
	dbcChrRaces = later("ChrRaces", `ID Flags Faction Exploration MaleDisplay FemaleDisplay Prefix:s MountScale:f Language
		CreatureType LoginEffect CombatStun ResSickness Splash StartingTaxi ClientFile:s Cinematic Name:loc
		FacialHairCustomization:s[2] HairCustomization:s`,
		`ID Flags Faction Exploration MaleDisplay FemaleDisplay Prefix:s Language CreatureType ResSickness Splash
		ClientFile:s Cinematic Alliance Name:loc NameFemale:loc NameMale:loc
		FacialHairCustomization:s[2] HairCustomization:s Expansion`)
	// HelmetGeosetVisData: race masks for the hair, the three facial hair groups and the ears, and in
	// 3.3.5a two more groups after them.
	dbcHelmVis = later("HelmetGeosetVisData", `ID Hide[5]`, `ID Hide[7]`)
	dbcEmotes  = vanilla("Emotes", `ID Command:s Anim Flags SpecProc SpecProcParam Sound`)

	// The tables a spell's index columns name; a duration of -1 lasts until cancelled.
	dbcSpellDuration  = vanilla("SpellDuration", `ID Duration:i PerLevel:i Max:i`)
	dbcSpellRadius    = vanilla("SpellRadius", `ID Radius:f PerLevel:f Max:f`)
	dbcSpellCastTimes = vanilla("SpellCastTimes", `ID Base:i PerLevel:i Min:i`)
	// SpellRange: 3.3.5a has a range against enemies (Min, Max) and one for friends.
	dbcSpellRange = later("SpellRange", `ID Min:f Max:f Flags Name:loc ShortName:loc`,
		`ID Min:f MinFriend:f Max:f MaxFriend:f Flags Name:loc ShortName:loc`)
	// SpellItemEnchantment: three effects, each a kind, the least and the most amount and a spell or
	// stat ID.
	dbcSpellEnchant = later("SpellItemEnchantment", `ID Effect[3] Min:i[3] Max:i[3] Arg[3] Name:loc ItemVisual Flags`,
		`ID Charges Effect[3] Min:i[3] Max:i[3] Arg[3] Name:loc ItemVisual Flags SrcItem Condition Skill SkillRank MinLevel`)

	// The skill lines that sort the spell browser's spells.
	dbcSkillLine = later("SkillLine", `ID Category:i SkillCosts Name:loc Description:loc SpellIcon`,
		`ID Category:i SkillCosts Name:loc Description:loc SpellIcon Verb:loc CanLink`)
	dbcSkillLineAbility = later("SkillLineAbility", `ID SkillLine Spell RaceMask ClassMask ExcludeRace ExcludeClass MinRank
		Superceded AcquireMethod TrivialHigh TrivialLow Abandonable CharacterPoints[2]`,
		`ID SkillLine Spell RaceMask ClassMask ExcludeRace ExcludeClass MinRank
		Superceded AcquireMethod TrivialHigh TrivialLow CharacterPoints[2]`)
	dbcSkillRaceClass = vanilla("SkillRaceClassInfo", `ID Skill RaceMask ClassMask Flags MinLevel SkillTier SkillCost`)
	dbcSkillTiers     = vanilla("SkillTiers", `ID Cost[16] Value[16]`)

	// Faction: the reputation fields (four of each), the parent, the name and the description.
	dbcFaction = later("Faction", `ID ReputationIndex RaceMask[4] ClassMask[4] Base:i[4] RepFlags[4] Parent Name:loc
		Description:loc`,
		`ID ReputationIndex RaceMask[4] ClassMask[4] Base:i[4] RepFlags[4] Parent ParentMod:f[2] ParentCap[2] Name:loc
		Description:loc`)
	// FactionTemplate: the groups it is in, is friends with and is enemies with, then four enemy and
	// four friend factions.
	dbcFactionTemplate = vanilla("FactionTemplate", `ID Faction Flags Group FriendGroup EnemyGroup Enemy[4] Friend[4]`)

	// ItemSet: 17 member items, 8 bonus spells and the members each needs, the required skill.
	dbcItemSet = both("ItemSet", `ID Name:loc Item[17] Spell[8] Threshold[8] Skill SkillRank`)
	// ItemRandomProperties: an internal name, the enchantments (the first three used) and the suffix.
	dbcRandomProps = both("ItemRandomProperties", `ID Name:s Enchant[5] Suffix:loc`)
	// LiquidType: the kind is 0 water, 1 ocean, 2 magma, 3 slime. In 3.3.5a a row is a liquid's whole
	// look, which a tile's MH2O names by its ID (#1068): its flags, sound, the fog and light under it,
	// its particles, a material, six textures (the first the animated surface, with %d for the frame),
	// two colours and the material's numbers.
	dbcLiquidType = later("LiquidType", `ID Name:s Kind Spell`,
		`ID Name:s Flags Kind Sound Spell MaxDarkenDepth:f FogDarken:f AmbDarken:f DirDarken:f Light ParticleScale:f
		ParticleMovement ParticleTexSlots Material Texture:s[6] Color[2] Float:f[18] Int[4]`)

	// The tables a game object's data names (objecttables.go).
	dbcLock         = vanilla("Lock", `ID Type[8] Index[8] Skill[8] Action[8]`)
	dbcLockType     = both("LockType", `ID Name:loc Resource:loc Verb:loc Cursor:s`)
	dbcLanguages    = both("Languages", `ID Name:loc`)
	dbcPageMaterial = vanilla("PageTextMaterial", `ID Name:s`)
	dbcSpellFocus   = both("SpellFocusObject", `ID Name:loc`)
	dbcCinematicSeq = vanilla("CinematicSequences", `ID Sound Camera[8]`)
	dbcCinematicCam = vanilla("CinematicCamera", `ID Model:s Sound Origin:f[3] Facing:f`)
	dbcAuctionHouse = both("AuctionHouse", `ID Faction Deposit Cut Name:loc`)

	// The quest editor's tables.
	dbcQuestSort    = both("QuestSort", `ID Name:loc`)
	dbcMailTemplate = later("MailTemplate", `ID Body:loc`, `ID Subject:loc Body:loc`)

	dbcAnimationData = later("AnimationData", `ID Name:s WeaponFlags BodyFlags _ Flags Fallback`,
		`ID Name:s WeaponFlags BodyFlags Flags Fallback Behavior BehaviorTier`)
)
