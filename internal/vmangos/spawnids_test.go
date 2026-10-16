package vmangos

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestSpawnIDQueries(t *testing.T) {
	if got := guidRowsSQL("creature", []int{5, 0, 3, 5}); got != "SELECT `guid`, `id`, `map` FROM `creature` WHERE `guid` IN (5,3) ORDER BY `guid`" {
		t.Errorf("guid rows SQL: %s", got)
	}
	if guidRowsSQL("creature", []int{0, -1}) != "" || knownEntriesSQL("creature_template", nil) != "" {
		t.Error("no ids should ask nothing")
	}
	rows := parseGUIDRows([]byte("3\t299\t0\r\n5\t6\t1\nbad line\n"))
	if want := []GUIDRow{{3, 299, 0}, {5, 6, 1}}; !reflect.DeepEqual(rows, want) {
		t.Errorf("rows %v, want %v", rows, want)
	}
	if got := missingEntries([]int{1, 2, 3, 2, 0}, []byte("1\r\n3\n")); !reflect.DeepEqual(got, []int{2}) {
		t.Errorf("missing %v, want [2]", got)
	}
}

func TestGUIDCollisions(t *testing.T) {
	edit := func(guid, entry int, created bool, kind string) SpawnEdit {
		return SpawnEdit{Spawn: WorldSpawn{GUID: guid, Entry: entry, Kind: kind, Name: "S"}, Created: created}
	}
	r := SpawnIDReport{Creatures: []GUIDRow{{1, 2843, 0}, {2, 6, 0}}, Objects: []GUIDRow{{1, 9, 0}}}
	got := guidCollisions([]SpawnEdit{
		edit(1, 299, true, KindMonster),  // another creature has it
		edit(2, 6, true, KindMonster),    // its own earlier export
		edit(1, 299, false, KindMonster), // not created
		edit(1, 9, true, KindObject),     // the object's own
	}, r)
	if len(got) != 1 || got[0] != "S (guid 1, now creature 2843's)" {
		t.Errorf("collisions %q", got)
	}
}

// TestCreatedGUIDLive saves a created creature on guid 1, which the world database holds for another
// entry: the pre-check must refuse it, and the SQL alone must fail on the key and leave the row as it
// was. It needs VMANGOS_DIR with the database running.
func TestCreatedGUIDLive(t *testing.T) {
	dir := os.Getenv("VMANGOS_DIR")
	if dir == "" {
		t.Skip("VMANGOS_DIR not set")
	}
	db, err := worldDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	entryOf := func() string {
		raw, err := runSQL(db, "SELECT `id` FROM `creature` WHERE `guid` = 1")
		if err != nil {
			t.Fatal(err)
		}
		return strings.TrimSpace(string(raw))
	}
	before := entryOf()
	if before == "" || before == "299" {
		t.Skipf("guid 1 holds %q, not another entry", before)
	}
	edits := []SpawnEdit{{Spawn: WorldSpawn{GUID: 1, Entry: 299, Kind: KindMonster, Name: "Test wolf"}, Created: true}}
	if err := CheckCreatedGUIDs(dir, edits); err == nil || !strings.Contains(err.Error(), "guid 1") {
		t.Errorf("pre-check: %v", err)
	}
	res := ExportSQL([]Edit{{Spawn: Spawn{Kind: Creature, GUID: 1, Entry: 299, Name: "Test wolf", Map: 0, Scale: 1}, Created: true}}, fixedTime)
	if err := runScript(db, res.SQL); err == nil {
		t.Error("the SQL inserted over another spawn's guid")
	}
	if after := entryOf(); after != before {
		t.Fatalf("guid 1 went from entry %s to %q", before, after)
	}
}
