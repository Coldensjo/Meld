package vmangos

import (
	"fmt"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

func TestQuestsScript(t *testing.T) {
	// Stored: 7 in progress with a kill counted, 783 done, 9 unknown to quest_template.
	stored := map[int]questRow{
		7:   {status: 3, rest: [12]string{"0", "0", "1792365317", "4", "0", "0", "0", "0", "0", "0", "0", "0"}},
		783: {status: 1, rest: [12]string{"1", "0", "1792365317", "0", "0", "0", "0", "0", "0", "0", "0", "2"}},
		9:   {status: 3, rest: [12]string{"0", "0", "5", "0", "0", "0", "0", "0", "0", "0", "0", "0"}},
	}
	info := map[int]questInfo{
		7:   {title: "Kobold Camp Cleanup", known: true},
		783: {title: "A Threat Within", known: true},
		100: {title: "Timed", limit: 900, known: true},
		200: {title: "Repeatable", repeatable: true, known: true},
	}
	quests := []CharacterQuest{
		{Quest: 783, Status: 1, Rewarded: true},
		{Quest: 7, Status: 1},
		{Quest: 9, Status: 3},
		{Quest: 100, Status: 3},
		{Quest: 200, Status: 1, Rewarded: true},
	}
	s, err := questsScript(4, quests, stored, info, 1000)
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM character_queststatus WHERE guid = 4;\nINSERT INTO character_queststatus (guid, " + questRowColumns + ") VALUES " +
		// 783 as stored; 7 complete now, its count and the explored flag kept, a new timer;
		"(4, 783, 1, 1, 0, 1792365317, 0, 0, 0, 0, 0, 0, 0, 0, 2), (4, 7, 1, 0, 0, 1000, 4, 0, 0, 0, 0, 0, 0, 0, 0), " +
		// 9 kept though quest_template lacks it; 100 timed from now; 200 done, so none as RewardQuest leaves a repeatable quest.
		"(4, 9, 3, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0), (4, 100, 3, 0, 0, 1900, 0, 0, 0, 0, 0, 0, 0, 0, 0), (4, 200, 0, 1, 0, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0);"
	if s != want {
		t.Errorf("script:\n%s\nwant:\n%s", s, want)
	}
	if s, _ := questsScript(4, nil, stored, info, 1000); s != "DELETE FROM character_queststatus WHERE guid = 4;" {
		t.Errorf("none: %s", s)
	}
	for _, c := range []struct {
		quests []CharacterQuest
		col    string
	}{
		{[]CharacterQuest{{Quest: 7, Status: 3}, {Quest: 7, Status: 3}}, "7"},
		{[]CharacterQuest{{Quest: 55, Status: 3}}, "55"},
		{[]CharacterQuest{{Quest: 9, Status: 1}}, "9"},
		{[]CharacterQuest{{Quest: 100, Status: 2}}, "100"},
	} {
		if _, err := questsScript(4, c.quests, stored, info, 1000); Refused(err) == nil || Refused(err).Column != c.col {
			t.Errorf("%+v: got %v, want a refusal of %s", c.quests, err, c.col)
		}
	}
	// The quest log holds 20: the 21st in it is refused, a done one past it is not.
	var full []CharacterQuest
	for id := 1000; id < 1021; id++ {
		info[id] = questInfo{known: true}
		full = append(full, CharacterQuest{Quest: id, Status: 3})
	}
	if _, err := questsScript(4, full, nil, info, 1000); Refused(err) == nil || Refused(err).Column != "1020" {
		t.Errorf("21 in the log: %v", err)
	}
	full[20].Rewarded, full[20].Status = true, 1
	if _, err := questsScript(4, full, nil, info, 1000); err != nil {
		t.Errorf("20 in the log and one done: %v", err)
	}
}

func TestMasks(t *testing.T) {
	// Sizzan's explored_zones as the server wrote it.
	s := "0 0 33554432 536870912 128" + strings.Repeat(" 0", 59) + " "
	bits := maskBits(s, exploredFields, true)
	if len(bits) != 3 || bits[0] != 64+25 || bits[1] != 96+29 || bits[2] != 128+7 {
		t.Fatalf("bits: %v", bits)
	}
	back, err := maskText(bits, exploredFields, "Exploration bit")
	if err != nil || back != s {
		t.Errorf("back: %q, %v", back, err)
	}
	// The server reads explored_zones only when it has all 64 numbers, known_taxi_mask as far as it goes.
	if b := maskBits("1 2 ", exploredFields, true); len(b) != 0 {
		t.Errorf("short explored: %v", b)
	}
	if b := maskBits("2 0 4 ", taxiFields, false); len(b) != 2 || b[0] != 1 || b[1] != 66 {
		t.Errorf("taxi: %v", b)
	}
	if b := maskBits("", taxiFields, false); len(b) != 0 {
		t.Errorf("empty: %v", b)
	}
	if text, _ := maskText([]int{1, 31}, taxiFields, "Stop bit"); text != "2147483650 0 0 0 0 0 0 0 " {
		t.Errorf("taxi text: %q", text)
	}
	if _, err := maskText([]int{256}, taxiFields, "Stop bit"); Refused(err) == nil || Refused(err).Column != "256" {
		t.Errorf("bit 256: %v", err)
	}
}

func TestExploreZones(t *testing.T) {
	// ID, map, parent, bit and the name in field 11, as AreaTable.dbc has them.
	strs := []byte("\x00Elwynn Forest\x00Goldshire\x00Durotar\x00Lost\x00Deadmines\x00")
	off := func(name string) uint32 { return uint32(strings.Index(string(strs), "\x00"+name+"\x00") + 1) }
	var rec []byte
	row := func(id, mapID, parent, bit uint32, name string) {
		f := make([]uint32, areaFields)
		f[areaID], f[areaMap], f[areaParent], f[areaBit], f[areaName] = id, mapID, parent, bit, off(name)
		rec = appendFields(rec, f...)
	}
	row(1519, 36, 0, 300, "Deadmines")
	row(87, 0, 12, 40, "Goldshire")
	row(12, 0, 0, 41, "Elwynn Forest")
	row(14, 1, 0, 42, "Durotar")
	row(99, 1, 500, 43, "Lost")
	row(98, 1, 0, MaxAreaBit, "Lost")
	zones, err := exploreZones(dbcFile(areaFields, 6, rec, strs), map[int]string{0: "Eastern Kingdoms", 1: "Kalimdor"})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, z := range zones {
		names := []string{z.Name}
		for _, s := range z.Subzones {
			names = append(names, s.Name)
		}
		got = append(got, z.MapName+":"+strings.Join(names, "+"))
	}
	if s := strings.Join(got, ", "); s != "Eastern Kingdoms:Elwynn Forest+Goldshire, Kalimdor:Durotar, Kalimdor:Lost, :Deadmines" {
		t.Errorf("zones: %s", s)
	}
}

// TestCharacterQuestsLive writes a character's quests, explored areas and flight paths into a scratch
// copy of the character tables (needs the server's database) and reads them back as the editor does,
// so no real character is written.
func TestCharacterQuestsLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	chars, err := confDatabase(dir, "CharacterDatabase.Info")
	if err != nil {
		t.Fatal(err)
	}
	const scratch = "test_meld_charquests"
	if _, err := runSQL(chars, "DROP DATABASE IF EXISTS "+scratch+"; CREATE DATABASE "+scratch); err != nil {
		t.Skip("no scratch database: " + err.Error())
	}
	defer func() { _, _ = runSQL(chars, "DROP DATABASE IF EXISTS "+scratch) }()
	db := chars
	db.name = scratch
	var setup strings.Builder
	setup.WriteString("SET SESSION sql_mode = '';\n")
	for _, tb := range []string{"characters", "character_queststatus"} {
		fmt.Fprintf(&setup, "CREATE TABLE `%s` LIKE `%s`.`%s`;\n", tb, chars.name, tb)
	}
	// Kek's rows as the server wrote them.
	explored := "0 0 0 536870912 2147483776" + strings.Repeat(" 0", 59) + " "
	fmt.Fprintf(&setup, "INSERT INTO characters (guid, account, name, explored_zones, known_taxi_mask) VALUES (7, 900, 'Quester', '%s', '2 0 0 0 0 0 0 0 ');\n", explored)
	setup.WriteString("INSERT INTO character_queststatus (guid, quest, status, rewarded, explored, timer, mob_count1, reward_choice) VALUES (7, 7, 3, 0, 0, 1792365317, 4, 0), (7, 783, 1, 1, 0, 1792365317, 0, 2);\n")
	if err := runScript(db, setup.String()); err != nil {
		t.Fatal(err)
	}
	stored, order, err := storedQuests(db, 7)
	if err != nil || len(order) != 2 || stored[7].rest[3] != "4" || stored[783].rest[11] != "2" {
		t.Fatalf("stored %v %v, %v", stored, order, err)
	}
	info := map[int]questInfo{7: {known: true}, 783: {known: true}, 33: {known: true, limit: 600}}
	script, err := questsScript(7, []CharacterQuest{{Quest: 783, Status: 1, Rewarded: true}, {Quest: 7, Status: 1}, {Quest: 33, Status: 3}}, stored, info, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if err := runScript(db, script); err != nil {
		t.Fatal(err)
	}
	out, err := runSQL(db, "SELECT "+questRowColumns+" FROM character_queststatus WHERE guid = 7 ORDER BY quest")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.ReplaceAll(strings.TrimSpace(string(out)), "\t", " "); got != "7 1 0 0 1000 4 0 0 0 0 0 0 0 0\n33 3 0 0 1600 0 0 0 0 0 0 0 0 0\n783 1 1 0 1792365317 0 0 0 0 0 0 0 0 2" {
		t.Errorf("quests:\n%s", got)
	}
	// The masks written unchanged come back as the server wrote them; a stop added sets its bit.
	s, err := readMaskColumn(db, 7, "explored_zones")
	if err != nil {
		t.Fatal(err)
	}
	script, _ = maskScript(7, "explored_zones", maskBits(s, exploredFields, true), exploredFields, "Exploration bit")
	if err := runScript(db, script); err != nil {
		t.Fatal(err)
	}
	if s, _ := readMaskColumn(db, 7, "explored_zones"); s != explored {
		t.Errorf("explored: %q", s)
	}
	script, _ = maskScript(7, "known_taxi_mask", []int{1, 2}, taxiFields, "Stop bit")
	if err := runScript(db, script); err != nil {
		t.Fatal(err)
	}
	if s, _ := readMaskColumn(db, 7, "known_taxi_mask"); s != "6 0 0 0 0 0 0 0 " {
		t.Errorf("taxi: %q", s)
	}
}
