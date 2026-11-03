package vmangos

import (
	"testing"

	"Meld/internal/clientbuild"
)

// The 1.12 column numbers the tests build their synthetic tables with. The code reads and writes the
// tables through their layouts (dbcschemas.go); TestVanillaColumns checks each number against the
// 1.12 layout, so a fixture and a layout can't drift apart.
const (
	areaFields        = 25
	areaID            = 0
	areaMap           = 1
	areaParent        = 2
	areaBit           = 3
	areaFlags         = 4
	areaAmbience      = 7
	areaMusic         = 8
	areaIntroMusic    = 9
	areaName          = 11
	areaNameMask      = 19
	areaTriggerFields = 10

	seType     = 1
	seName     = 2
	seFile     = 3
	seFreq     = 13
	seDir      = 23
	seVolume   = 24
	soundFiles = 10
	musicDay   = 6
	musicNight = 7

	lightParamsAt = 7

	objectDisplayFields = 12

	itemDisplayFields = 23
	idModel           = 1
	idTexture         = 3
	idIcon            = 5
	idVisual          = 10

	liftFields = 7
	liftEntry  = 1
	liftTime   = 2
	liftX      = 3

	safeLocFields = 14
	safeLocMask   = 13

	visualFields   = 16
	visualArea     = 11
	kitFields      = 35
	kitEffectsBase = 3

	taxiNodeFields  = 16
	taxiNodeName    = 5
	taxiNodeMask    = 13
	taxiNodeHorde   = 14
	taxiNodeAlly    = 15
	taxiPathFields  = 4
	taxiPointFields = 9

	worldOverlayFields = 17
	worldOverlayAreas  = 4
	ovMapArea          = 1
	ovArea0            = 2
	ovName             = 8
	ovWidth            = 9
	ovHeight           = 10
	ovOffsetX          = 11
	ovOffsetY          = 12
	ovHitTop           = 13
	ovHitLeft          = 14
	ovHitBottom        = 15
	ovHitRight         = 16

	spellLocales        = 8
	spellFCategory      = 2
	spellFAttributes    = 6
	spellFProcChance    = 25
	spellFDuration      = 30
	spellFStack         = 39
	spellFEffect        = 61
	spellFEffectDie     = 64
	spellFEffectDice    = 67
	spellFEffectBase    = 76
	spellFAura          = 91
	spellFAmplitude     = 94
	spellFChain         = 100
	spellFMisc          = 106
	spellFVisual        = 115
	spellFIcon          = 117
	spellFName          = 120
	spellFRank          = 129
	spellFDescription   = 138
	spellFStartCategory = 157
)

func TestVanillaColumns(t *testing.T) {
	type col struct {
		s     *dbcSchema
		field string
		at    int // the element of an array, -1 for a single field, -2 for a localized string's mask
		want  int
	}
	cols := []col{
		{dbcAreaTable, "ID", -1, areaID}, {dbcAreaTable, "MapID", -1, areaMap}, {dbcAreaTable, "ParentID", -1, areaParent},
		{dbcAreaTable, "AreaBit", -1, areaBit}, {dbcAreaTable, "Flags", -1, areaFlags}, {dbcAreaTable, "Ambience", -1, areaAmbience},
		{dbcAreaTable, "Music", -1, areaMusic}, {dbcAreaTable, "IntroMusic", -1, areaIntroMusic}, {dbcAreaTable, "Name", -1, areaName},
		{dbcAreaTable, "Name", -2, areaNameMask}, {dbcAreaTable, "SoundPref", -1, 5}, {dbcAreaTable, "SoundPrefSwim", -1, 6},
		{dbcAreaTable, "Level", -1, 10}, {dbcAreaTable, "Faction", -1, 20}, {dbcAreaTable, "Liquid", -1, 21},
		{dbcAreaTable, "MinElevation", -1, 22}, {dbcAreaTable, "AmbientMul", -1, 23}, {dbcAreaTable, "Light", -1, 24},
		{dbcAreaTrigger, "BoxYaw", -1, areaTriggerFields - 1},
		{dbcSoundEntries, "Type", -1, seType}, {dbcSoundEntries, "Name", -1, seName}, {dbcSoundEntries, "File", 0, seFile},
		{dbcSoundEntries, "Freq", 0, seFreq}, {dbcSoundEntries, "Dir", -1, seDir}, {dbcSoundEntries, "Volume", -1, seVolume},
		{dbcSoundEntries, "Flags", -1, 25}, {dbcSoundEntries, "MinDist", -1, 26}, {dbcSoundEntries, "Cutoff", -1, 27},
		{dbcSoundEntries, "EAX", -1, 28}, {dbcZoneMusic, "Day", -1, musicDay}, {dbcZoneMusic, "Night", -1, musicNight},
		{dbcZoneIntro, "Sound", -1, 2}, {dbcSoundAmbience, "Night", -1, 2}, {dbcLight, "Params", 0, lightParamsAt},
		{dbcObjectDisplay, "Sound", 0, 2},
		{dbcItemDisplay, "Model", 0, idModel}, {dbcItemDisplay, "ModelTexture", 0, idTexture}, {dbcItemDisplay, "Icon", -1, idIcon},
		{dbcItemDisplay, "SpellVisual", -1, idVisual}, {dbcItemDisplay, "HelmVis", 0, 12}, {dbcItemDisplay, "Texture", 0, 14},
		{dbcTransportAnim, "Transport", -1, liftEntry}, {dbcTransportAnim, "Time", -1, liftTime}, {dbcTransportAnim, "Pos", 0, liftX},
		{dbcTransportAnim, "Sequence", -1, 6}, {dbcWorldSafeLocs, "Name", -1, 5}, {dbcWorldSafeLocs, "Name", -2, safeLocMask},
		{dbcSpellVisual, "Kit", 0, 1}, {dbcSpellVisual, "Missile", -1, 6}, {dbcSpellVisual, "Area", -1, visualArea},
		{dbcSpellVisualKit, "Effect", 0, kitEffectsBase}, {dbcSpellVisualKit, "CharProc", 0, 15},
		{dbcTaxiNodes, "Name", -1, taxiNodeName}, {dbcTaxiNodes, "Name", -2, taxiNodeMask}, {dbcTaxiNodes, "HordeMount", -1, taxiNodeHorde},
		{dbcTaxiNodes, "AllianceMount", -1, taxiNodeAlly}, {dbcTaxiPathNode, "Delay", -1, taxiPointFields - 1},
		{dbcWorldMapOverlay, "MapArea", -1, ovMapArea}, {dbcWorldMapOverlay, "Area", 0, ovArea0}, {dbcWorldMapOverlay, "Name", -1, ovName},
		{dbcWorldMapOverlay, "Width", -1, ovWidth}, {dbcWorldMapOverlay, "Height", -1, ovHeight}, {dbcWorldMapOverlay, "OffsetX", -1, ovOffsetX},
		{dbcWorldMapOverlay, "OffsetY", -1, ovOffsetY}, {dbcWorldMapOverlay, "HitTop", -1, ovHitTop}, {dbcWorldMapOverlay, "HitLeft", -1, ovHitLeft},
		{dbcWorldMapOverlay, "HitBottom", -1, ovHitBottom}, {dbcWorldMapOverlay, "HitRight", -1, ovHitRight},
		{dbcMap, "InstanceType", -1, 2}, {dbcMap, "PvP", -1, 3}, {dbcMap, "Name", -1, 4}, {dbcMap, "AreaID", -1, 19},
		{dbcMap, "LoadingScreen", -1, 38},
		{dbcSpell, "category", -1, spellFCategory}, {dbcSpell, "attributes", -1, spellFAttributes},
		{dbcSpell, "procChance", -1, spellFProcChance}, {dbcSpell, "procCharges", -1, 26}, {dbcSpell, "durationIndex", -1, spellFDuration},
		{dbcSpell, "stackAmount", -1, spellFStack}, {dbcSpell, "effect", 0, spellFEffect}, {dbcSpell, "effectDieSides", 0, spellFEffectDie},
		{dbcSpell, "effectBaseDice", 0, spellFEffectDice}, {dbcSpell, "effectBasePoints", 0, spellFEffectBase},
		{dbcSpell, "effectRadiusIndex", 0, 88}, {dbcSpell, "effectApplyAuraName", 0, spellFAura}, {dbcSpell, "effectAmplitude", 0, spellFAmplitude},
		{dbcSpell, "effectChainTarget", 0, spellFChain}, {dbcSpell, "effectMiscValue", 0, spellFMisc}, {dbcSpell, "spellVisual", 0, spellFVisual},
		{dbcSpell, "spellIconId", -1, spellFIcon}, {dbcSpell, "name", -1, spellFName}, {dbcSpell, "nameSubtext", -1, spellFRank},
		{dbcSpell, "description", -1, spellFDescription}, {dbcSpell, "startRecoveryCategory", -1, spellFStartCategory},
		{dbcSpellEnchant, "Name", -1, 13}, {dbcRandomProps, "Suffix", -1, 7}, {dbcFaction, "Name", -1, 19},
		{dbcItemSet, "Item", 0, 10}, {dbcItemSet, "Spell", 0, 27}, {dbcItemSet, "Threshold", 0, 35}, {dbcItemSet, "SkillRank", -1, 44},
		{dbcLock, "Index", 0, 9}, {dbcLock, "Skill", 0, 17}, {dbcSkillLine, "Name", -1, 3}, {dbcSkillRaceClass, "SkillTier", -1, 6},
		{dbcSkillTiers, "Value", 0, 17}, {dbcAuctionHouse, "Name", -1, 4}, {dbcCharSections, "Flags", -1, 9},
		{dbcCreatureDisplay, "Skin", 0, 6}, {dbcCreatureExtra, "Item", 0, 8}, {dbcCreatureExtra, "Bake", -1, 18},
		{dbcFacialHair, "Geoset", 3, 6}, {dbcChrRaces, "Prefix", -1, 6}, {dbcCreatureModel, "Path", -1, 2},
	}
	for _, c := range cols {
		l := c.s.forBuild(clientbuild.Vanilla)
		var got int
		switch c.at {
		case -1:
			got = l.col(c.field)
		case -2:
			got = l.mask(c.field)
		default:
			got = l.at(c.field, c.at)
		}
		if got != c.want {
			t.Errorf("%s.dbc %s (%d): column %d, the tests' fixtures say %d", c.s.name, c.field, c.at, got, c.want)
		}
	}
	widths := map[*dbcSchema]int{
		dbcAreaTable: areaFields, dbcAreaTrigger: areaTriggerFields, dbcSoundEntries: 29, dbcObjectDisplay: objectDisplayFields,
		dbcItemDisplay: itemDisplayFields, dbcTransportAnim: liftFields, dbcWorldSafeLocs: safeLocFields, dbcSpellVisual: visualFields,
		dbcSpellVisualKit: kitFields, dbcTaxiNodes: taxiNodeFields, dbcTaxiPath: taxiPathFields, dbcTaxiPathNode: taxiPointFields,
		dbcWorldMapOverlay: worldOverlayFields, dbcSpell: 173, dbcMap: 42, dbcWorldMapArea: 8, dbcLight: 12, dbcLightParams: 9,
		dbcLightIntBand: 34, dbcLightFloatBand: 34, dbcZoneMusic: 8, dbcZoneIntro: 5, dbcSoundAmbience: 3, dbcLoadingScreen: 3,
	}
	for s, want := range widths {
		if got := s.forBuild(clientbuild.Vanilla).columns; got != want {
			t.Errorf("%s.dbc's 1.12 layout is %d columns wide, the tests' fixtures %d", s.name, got, want)
		}
	}
	if n := dbcWorldMapOverlay.forBuild(clientbuild.Vanilla).count("Area"); n != worldOverlayAreas {
		t.Errorf("WorldMapOverlay.dbc has %d areas, the fixtures %d", n, worldOverlayAreas)
	}
	if n := dbcSoundEntries.forBuild(clientbuild.Vanilla).count("File"); n != soundFiles {
		t.Errorf("SoundEntries.dbc has %d files, the fixtures %d", n, soundFiles)
	}
}

// as gives a synthetic table its schema's layout, as parseTable does.
func as(tb *dbcTable, s *dbcSchema) *dbcTable {
	tb.l = s.layout(tb.fields)
	return tb
}

// testTable is testDBC at the 1.12 width of a schema, with its layout.
func testTable(t *testing.T, s *dbcSchema, rows ...[]any) *dbcTable {
	t.Helper()
	return as(testDBC(t, s.layouts[0].columns, rows...), s)
}
