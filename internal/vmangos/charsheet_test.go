package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testCharTables are a human man's and woman's looks and a few skills, as the 1.12 tables have them.
func testCharTables() *charTables {
	c := &charTables{facial: map[[3]int]bool{}, skills: map[int]skillLineRow{}, tiers: map[int]int{}}
	for g := 0; g < 2; g++ {
		for skin := 0; skin < 3; skin++ {
			c.sections = append(c.sections, charSection{1, g, sectionSkin, 0, skin})
			for face := 0; face < 2; face++ {
				c.sections = append(c.sections, charSection{1, g, sectionFace, face, skin})
			}
		}
		for style := 0; style < 4; style++ {
			for color := 0; color < 2; color++ {
				c.sections = append(c.sections, charSection{1, g, sectionHair, style, color})
			}
		}
		for f := 0; f < 3; f++ {
			c.facial[[3]int{1, g, f}] = true
		}
	}
	// Facial hair sections for men only, in hair colour 0.
	for f := 0; f < 3; f++ {
		c.sections = append(c.sections, charSection{1, 0, sectionFacialHair, f, 0})
	}
	c.skills[98] = skillLineRow{skillCategoryLanguages, "Language: Common"}
	c.skills[43] = skillLineRow{6, "Swords"}
	c.skills[413] = skillLineRow{skillCategoryArmor, "Mail"}
	c.skills[164] = skillLineRow{11, "Blacksmithing"}
	c.skills[109] = skillLineRow{skillCategoryLanguages, "Language: Orcish"}
	c.raceClass = []skillRaceClass{{98, 1, 0, 0}, {43, 0, 1, 0}, {413, 0, 1 | 2, 0}, {164, 0, 0, 7}, {109, 2, 0, 0}}
	c.tiers[7] = 300
	return c
}

func TestCharLooksCheck(t *testing.T) {
	c := testCharTables()
	man, woman := c.looks(1, 0), c.looks(1, 1)
	if !man.CheckFacial || woman.CheckFacial {
		t.Fatalf("facial hair checked: man %v, woman %v", man.CheckFacial, woman.CheckFacial)
	}
	if len(man.Skins) != 3 || len(man.Faces) != 6 || len(man.Hair) != 8 || len(man.FacialHair) != 3 {
		t.Fatalf("man: %+v", man)
	}
	if err := man.check(2, 1, 3, 0, 2); err != nil {
		t.Fatal(err)
	}
	// A woman's facial hair has no sections to check, only its style.
	if err := woman.check(0, 0, 0, 1, 2); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		skin, face, style, color, facial int
		col                              string
	}{
		{3, 0, 0, 0, 0, "skin"},
		{0, 2, 0, 0, 0, "face"},
		{0, 0, 4, 0, 0, "hair_style"},
		{0, 0, 0, 2, 0, "hair_color"},
		{0, 0, 0, 1, 0, "facial_hair"}, // no facial hair section in hair colour 1
		{0, 0, 0, 0, 3, "facial_hair"},
	} {
		if r := Refused(man.check(c.skin, c.face, c.style, c.color, c.facial)); r == nil || r.Column != c.col {
			t.Errorf("%+v: got %v", c, r)
		}
	}
}

func TestCharacterSetLooksAndHonor(t *testing.T) {
	// A new gender with a new skin given: the rest of the look goes back to its first choice.
	set, err := characterSet(testCharacter(), map[string]string{"gender": "1", "skin": "1"}, 60)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(set, ", ")
	if got != "gender = 1, skin = 1, face = 0, hair_style = 0, hair_color = 0, facial_hair = 0" {
		t.Errorf("gender and skin: %s", got)
	}
	set, _ = characterSet(testCharacter(), map[string]string{"face": "0", "honor_rank_points": "12345.5", "honor_highest_rank": "9", "honor_stored_hk": "300"}, 60)
	if got := strings.Join(set, ", "); got != "face = 0, honor_rank_points = 12345.5, honor_highest_rank = 9, honor_stored_hk = 300" {
		t.Errorf("face and honor: %s", got)
	}
	for _, bad := range []map[string]string{{"skin": "-1"}, {"face": "256"}, {"honor_highest_rank": "19"}, {"honor_rank_points": "1e9"}, {"honor_stored_dk": "-2"}} {
		_, err := characterSet(testCharacter(), bad, 60)
		var col string
		for c := range bad {
			col = c
		}
		if r := Refused(err); r == nil || r.Column != col {
			t.Errorf("%v: got %v, want a refusal of %s", bad, err, col)
		}
	}
}

func TestLookAfter(t *testing.T) {
	cur := testCharacter().Values
	if _, changed := lookAfter(cur, map[string]string{"level": "9", "skin": "2"}); changed {
		t.Error("an unchanged look counts as a change")
	}
	got, changed := lookAfter(cur, map[string]string{"race": "3", "hair_color": "1"})
	if !changed || got != [7]int{3, 0, 0, 0, 0, 1, 0} {
		t.Errorf("new race: %v, %v", got, changed)
	}
	got, _ = lookAfter(cur, map[string]string{"face": "0"})
	if got != [7]int{1, 0, 2, 0, 3, 4, 1} {
		t.Errorf("new face: %v", got)
	}
}

func TestCheckSkills(t *testing.T) {
	c := testCharTables()
	got, err := c.checkSkills([]CharacterSkill{{98, 1, 1}, {43, 12, 300}, {413, 5, 5}, {164, 120, 150}}, nil, 1, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	want := []CharacterSkill{{98, 300, 300}, {43, 12, 50}, {413, 1, 1}, {164, 120, 150}}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("skill %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
	// Orcish is not a human's: kept when it was stored as it is, refused when added.
	stored := map[int]CharacterSkill{109: {109, 300, 300}}
	if _, err := c.checkSkills([]CharacterSkill{{109, 300, 300}}, stored, 1, 1, 10); err != nil {
		t.Errorf("stored Orcish: %v", err)
	}
	for _, bad := range [][]CharacterSkill{
		{{109, 300, 300}},
		{{43, 0, 50}},
		{{43, 51, 50}},
		{{164, 10, 301}},
		{{77, 1, 1}},
		{{43, 1, 50}, {43, 2, 50}},
	} {
		_, err := c.checkSkills(bad, nil, 1, 1, 10)
		if r := Refused(err); r == nil || r.Column == "" {
			t.Errorf("%v: got %v", bad, err)
		}
	}
	if s := skillsScript(4, want[:2]); s != "DELETE FROM character_skills WHERE guid = 4;\nINSERT INTO character_skills (guid, skill, value, max) VALUES (4, 98, 300, 300), (4, 43, 12, 50);" {
		t.Errorf("script: %s", s)
	}
}

func TestSkillChoices(t *testing.T) {
	c := testCharTables()
	var names []string
	for _, ch := range c.skillChoices(1, 1) {
		names = append(names, ch.Name+":"+ch.Range)
	}
	if got := strings.Join(names, ", "); got != "Blacksmithing:rank, Language: Common:language, Mail:mono, Swords:level" {
		t.Errorf("a human warrior's: %s", got)
	}
}

func TestSpellProblem(t *testing.T) {
	checks := map[int]spellCheck{
		1:  {},
		2:  {effects: [3]int{effectCreateItem}, items: [3]int{100}, reagents: [8]int{200}},
		3:  {effects: [3]int{effectCreateItem}, items: [3]int{101}},
		4:  {effects: [3]int{0, effectLearnSpell}, learns: [3]int{0, 2}},
		5:  {effects: [3]int{effectLearnSpell}, learns: [3]int{9}},
		10: {effects: [3]int{effectCreateItem}, items: [3]int{100}},
	}
	items := map[int]bool{100: true}
	for id, want := range map[int]string{1: "", 10: "", 2: "takes item 200", 3: "makes item 101", 4: "teaches spell 2", 5: "no spell 9", 6: "no spell 6"} {
		p := spellProblem(id, checks, items, 0)
		if want == "" && p != "" || want != "" && !strings.Contains(p, want) {
			t.Errorf("spell %d: %q, want %q", id, p, want)
		}
	}
	if s := spellsScript(4, []CharacterSpell{{Spell: 78, Active: true}, {Spell: 2457, Disabled: true}}); s != "DELETE FROM character_spell WHERE guid = 4;\nINSERT INTO character_spell (guid, spell, active, disabled) VALUES (4, 78, 1, 0), (4, 2457, 0, 1);" {
		t.Errorf("script: %s", s)
	}
}

func TestReputationScript(t *testing.T) {
	stormwind := factionRow{id: 72, name: "Stormwind", team: 469}
	stormwind.raceMask = [4]int{1 | 4 | 8 | 64, 2 | 16 | 32 | 128}
	stormwind.base = [4]int{3000, -42000}
	stormwind.flag = [4]int{0x10, 0x0c}
	darnassus := factionRow{id: 69, name: "Darnassus", team: 469}
	darnassus.base = [4]int{400}
	darnassus.flag = [4]int{0x10}
	factions := []factionRow{stormwind, darnassus}
	if b, f := stormwind.baseFor(2, 1); b != -42000 || f != 0x0c {
		t.Errorf("an orc's start with Stormwind: %d, %#x", b, f)
	}
	list := reputationList(factions, map[int]string{469: "Alliance"}, map[int][2]int{72: {55, 0x11}}, 1, 1)
	if len(list) != 2 || list[0].Name != "Darnassus" || list[1].Standing != 3055 || !list[1].Stored || list[0].Stored || list[0].Group != "Alliance" {
		t.Fatalf("list: %+v", list)
	}
	// Stormwind raised to Honored; Darnassus as it starts, so it gets no row; Ironforge's stored row kept.
	stored := map[int][2]int{72: {55, 0x11}, 47: {100, 0x01}}
	reps := []CharacterReputation{{Faction: 72, Standing: 9000, Flags: 0x11 | 0x02}, {Faction: 69, Standing: 400, Flags: 0x10}}
	s, err := reputationScript(4, reps, factions, stored, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if s != "DELETE FROM character_reputation WHERE guid = 4;\nINSERT INTO character_reputation (guid, faction, standing, flags) VALUES (4, 47, 100, 1), (4, 72, 6000, 19);" {
		t.Errorf("script: %s", s)
	}
	// Only the flags a player sets are taken: the forced ones are the faction's.
	s, _ = reputationScript(4, []CharacterReputation{{Faction: 69, Standing: 400, Flags: 0x01 | 0x08}}, factions, nil, 1, 1)
	if !strings.Contains(s, "(4, 69, 0, 17)") {
		t.Errorf("visible Darnassus: %s", s)
	}
	for _, bad := range []CharacterReputation{{Faction: 72, Standing: 43000}, {Faction: 72, Standing: -42001}, {Faction: 5, Standing: 0}} {
		if _, err := reputationScript(4, []CharacterReputation{bad}, factions, nil, 1, 1); Refused(err) == nil {
			t.Errorf("%+v: got %v", bad, err)
		}
	}
}

func TestHomeSQL(t *testing.T) {
	root := t.TempDir()
	conf := "WorldDatabase.Info = \"127.0.0.1;1;mangos;mangos;mangos\"\n"
	if err := os.MkdirAll(filepath.Join(root, "run"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "run", "mangosd.conf"), []byte(conf), 0o644); err != nil {
		t.Fatal(err)
	}
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case strings.Contains(sql, "entry = 0 "), strings.Contains(sql, "entry = 1 "):
			return []byte("0\n"), nil
		case strings.Contains(sql, "entry = 36 "):
			return []byte("1\n"), nil
		}
		return nil, nil
	}
	cur := testCharacter().Values
	if s, err := homeSQL(root, 4, cur, map[string]string{"level": "5", "home_map": "0"}); s != "" || err != nil {
		t.Errorf("unchanged: %q, %v", s, err)
	}
	s, err := homeSQL(root, 4, cur, map[string]string{"home_map": "1", "home_zone": "1637", "home_x": "1630.5", "home_y": "-4420", "home_z": "15.6"})
	if err != nil || s != "REPLACE INTO character_homebind (guid, map, zone, position_x, position_y, position_z) VALUES (4, 1, 1637, 1630.5, -4420, 15.6)" {
		t.Errorf("Orgrimmar: %q, %v", s, err)
	}
	// A character without a home yet needs all of it.
	none := map[string]string{"home_map": "", "home_zone": "", "home_x": "", "home_y": "", "home_z": ""}
	for _, bad := range []struct {
		cur    map[string]string
		values map[string]string
		col    string
	}{
		{cur, map[string]string{"home_map": "36"}, "home_map"},
		{cur, map[string]string{"home_map": "2"}, "home_map"},
		{cur, map[string]string{"home_x": "20000"}, "home_x"},
		{none, map[string]string{"home_map": "0"}, "home_zone"},
	} {
		if _, err := homeSQL(root, 4, bad.cur, bad.values); Refused(err) == nil || Refused(err).Column != bad.col {
			t.Errorf("%v: got %v, want a refusal of %s", bad.values, err, bad.col)
		}
	}
}
