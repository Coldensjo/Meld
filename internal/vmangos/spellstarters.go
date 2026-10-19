package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// The spell editor's starters (#360): a new spell made without copying another. Meld fills in every
// column itself, with values a spell of that kind needs: an effect and its target, a range, cast time
// and duration that are rows of the client's tables (some VMaNGOS code reads a range row without a
// check, so index 0 would crash it), a school, cost and levels, and a description whose $ tokens the
// tooltip fills in. Its icon and visual are those of a client spell of the same kind, found by name
// when the spell is made, so nothing of the client's is bundled.

// SpellStarter is a kind of spell New spell can start from, as the editor lists it.
type SpellStarter struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Text string `json:"text"`
	// Like is the client spell whose icon and visual the starter takes.
	Like string `json:"like"`
}

// spellStarter is a starter and how to fill it in.
type spellStarter struct {
	SpellStarter
	castMs, durationMs int     // a SpellCastTimes and a SpellDuration row by its time (0 instant, none)
	rangeYd, radiusYd  float64 // a SpellRange row by its most yards (0 self only), a SpellRadius row (0 none)
	values             map[string]string
}

// spellStarters are the starters, in the order the editor shows them.
var spellStarters = []spellStarter{
	{
		SpellStarter: SpellStarter{ID: "bolt", Name: "Bolt", Text: "A missile cast at an enemy: 10 to 20 Fire damage, 1.5 sec cast, 30 yards.", Like: "Fireball"},
		castMs:       1500, rangeYd: 30,
		values: map[string]string{
			"school": "2", "effect1": "2", "effectImplicitTargetA1": "6", "effectBasePoints1": "9", "effectDieSides1": "11", "effectBaseDice1": "1",
			"powerType": "0", "manaCost": "30", "speed": "20", "interruptFlags": "15", "dmgClass": "1", "preventionType": "1",
			"description": "Hurls a bolt of fire at the enemy, causing $s1 Fire damage.",
		},
	},
	{
		SpellStarter: SpellStarter{ID: "strike", Name: "Instant strike", Text: "A melee blow: 15 to 25 Physical damage, instant, 10 rage, 6 sec cooldown.", Like: "Heroic Strike"},
		rangeYd:      5,
		values: map[string]string{
			"school": "0", "effect1": "2", "effectImplicitTargetA1": "6", "effectBasePoints1": "14", "effectDieSides1": "11", "effectBaseDice1": "1",
			"attributes": "65552", "powerType": "1", "manaCost": "100", "recoveryTime": "6000", "dmgClass": "2", "preventionType": "2",
			"description": "A strike that deals $s1 damage to the enemy.",
		},
	},
	{
		SpellStarter: SpellStarter{ID: "heal", Name: "Heal", Text: "Heals a friend for 50 to 70, 2.5 sec cast, 40 yards.", Like: "Lesser Heal"},
		castMs:       2500, rangeYd: 40,
		values: map[string]string{
			"school": "1", "effect1": "10", "effectImplicitTargetA1": "21", "effectBasePoints1": "49", "effectDieSides1": "21", "effectBaseDice1": "1",
			"powerType": "0", "manaCost": "50", "interruptFlags": "15", "dmgClass": "1", "preventionType": "1",
			"description": "Heals the target for $s1.",
		},
	},
	{
		SpellStarter: SpellStarter{ID: "dot", Name: "Damage over time", Text: "A curse on an enemy: 10 Shadow damage every 3 sec for 15 sec, instant, 30 yards.", Like: "Shadow Word: Pain"},
		durationMs:   15000, rangeYd: 30,
		values: map[string]string{
			"school": "5", "effect1": "6", "effectApplyAuraName1": "3", "effectImplicitTargetA1": "6", "effectBasePoints1": "9", "effectDieSides1": "1", "effectBaseDice1": "1",
			"effectAmplitude1": "3000", "powerType": "0", "manaCost": "40", "interruptFlags": "8", "dmgClass": "1", "preventionType": "1", "dispel": "1",
			"description": "Causes $o1 Shadow damage over $d.", "auraDescription": "$s1 Shadow damage every $t1 seconds.",
		},
	},
	{
		SpellStarter: SpellStarter{ID: "buff", Name: "Buff", Text: "Raises a friend's Stamina by 10 for 30 min, instant, 30 yards.", Like: "Power Word: Fortitude"},
		durationMs:   1800000, rangeYd: 30,
		values: map[string]string{
			"school": "1", "effect1": "6", "effectApplyAuraName1": "29", "effectMiscValue1": "2", "effectImplicitTargetA1": "21", "effectBasePoints1": "9", "effectDieSides1": "1", "effectBaseDice1": "1",
			"powerType": "0", "manaCost": "60", "interruptFlags": "8", "dmgClass": "1", "preventionType": "1", "dispel": "1",
			"description": "Increases the target's Stamina by $s1 for $d.", "auraDescription": "Stamina increased by $s1.",
		},
	},
	{
		SpellStarter: SpellStarter{ID: "area", Name: "Area damage", Text: "A blast round the caster: 10 to 14 Arcane damage to every enemy within 10 yards, instant.", Like: "Arcane Explosion"},
		radiusYd:     10,
		values: map[string]string{
			"school": "6", "effect1": "2", "effectImplicitTargetA1": "22", "effectImplicitTargetB1": "15", "effectBasePoints1": "9", "effectDieSides1": "5", "effectBaseDice1": "1",
			"powerType": "0", "manaCost": "75", "interruptFlags": "8", "dmgClass": "1", "preventionType": "1",
			"description": "Sends out a blast of energy, causing $s1 Arcane damage to all enemies within $a1 yards.",
		},
	},
}

// SpellStarters lists the starters for the editor.
func SpellStarters() []SpellStarter {
	out := make([]SpellStarter, len(spellStarters))
	for i, s := range spellStarters {
		out[i] = s.SpellStarter
	}
	return out
}

// pickOption is the first row of a table (by ID) whose value is want and that doesn't grow with level.
func pickOption(rows []SpellOption, want float64, what string) (int, error) {
	for _, r := range rows {
		if r.Value == want && !r.Scaled {
			return r.ID, nil
		}
	}
	return 0, fmt.Errorf("the client has no %s of %g", what, want)
}

// starterValues fills in every column for a spell made from starter id: the columns' defaults (0, ”,
// -1 for the server's spell power coefficients: work it out), the parts every spell shares (no item
// needed, the global cooldown, a level 1 spell, damage at full on every chain target), the starter's
// own values and the client's table rows it needs. like is the visual and icon to use.
func starterValues(cols []TemplateColumn, id string, tables SpellTables, visual, icon int) (map[string]string, error) {
	var s *spellStarter
	for i := range spellStarters {
		if spellStarters[i].ID == id {
			s = &spellStarters[i]
		}
	}
	if s == nil {
		return nil, fmt.Errorf("no spell starter %q", id)
	}
	v := make(map[string]string, len(cols))
	for _, c := range cols {
		switch {
		case c.Kind == "text":
			v[c.Name] = ""
		case strings.HasPrefix(c.Name, "effectBonusCoefficient"):
			v[c.Name] = "-1"
		default:
			v[c.Name] = "0"
		}
	}
	for k, x := range map[string]string{
		"equippedItemClass": "-1", "attributes": "65536", "procChance": "101", "spellLevel": "1", "baseLevel": "1",
		"startRecoveryCategory": "133", "startRecoveryTime": "1500", "dmgMultiplier1": "1", "dmgMultiplier2": "1", "dmgMultiplier3": "1",
	} {
		v[k] = x
	}
	for k, x := range s.values {
		v[k] = x
	}
	cast, err := pickOption(tables.CastTimes, float64(s.castMs), "cast time")
	if err != nil {
		return nil, err
	}
	rng, err := pickOption(tables.Ranges, s.rangeYd, "range")
	if err != nil {
		return nil, err
	}
	v["castingTimeIndex"], v["rangeIndex"] = strconv.Itoa(cast), strconv.Itoa(rng)
	if s.durationMs != 0 {
		d, err := pickOption(tables.Durations, float64(s.durationMs), "duration")
		if err != nil {
			return nil, err
		}
		v["durationIndex"] = strconv.Itoa(d)
	}
	if s.radiusYd != 0 {
		r, err := pickOption(tables.Radii, s.radiusYd, "radius")
		if err != nil {
			return nil, err
		}
		v["effectRadiusIndex1"] = strconv.Itoa(r)
	}
	v["spellVisual1"], v["spellIconId"] = strconv.Itoa(visual), strconv.Itoa(icon)
	// Only the table's columns: a server without one of them doesn't get it.
	have := make(map[string]bool, len(cols))
	for _, c := range cols {
		have[c.Name] = true
	}
	for k := range v {
		if !have[k] {
			delete(v, k)
		}
	}
	return v, nil
}

// spellLook is the visual and icon of the client spell named name (its lowest ID with both), or
// zeros (no visual, the Temp icon) when the client has none of that name.
func spellLook(dataDir, name string) (int, int, error) {
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return 0, 1, err
	}
	t := spellData.spells
	best := -1
	for r := 0; r < t.records; r++ {
		// The lowest with a visual and a real icon (1 is Temp, a question mark).
		if t.u32(r, spellFVisual) == 0 || t.u32(r, spellFIcon) <= 1 || !strings.EqualFold(t.str(r, spellFName), name) {
			continue
		}
		if best < 0 || t.u32(r, 0) < t.u32(best, 0) {
			best = r
		}
	}
	if best < 0 {
		return 0, 1, nil
	}
	return int(t.u32(best, spellFVisual)), int(t.u32(best, spellFIcon)), nil
}
