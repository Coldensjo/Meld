package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// A waypoint's VMaNGOS script becomes a dbscripts_on_creature_movement script of the spawn's own
// (#1041): its commands translated, a script two points name written once, a script the VMaNGOS
// database lacks and the commands CMaNGOS can't run reported.
func TestCMaNGOSWaypointScripts(t *testing.T) {
	walker := Spawn{Kind: Creature, GUID: 70, Entry: 3, Name: "Patrol", Scale: 1, MovementType: 2, Equipment: -1, SheathState: 1,
		Path: []PathPoint{{X: 1, ScriptID: 9}, {X: 2, ScriptID: 11}, {X: 3, ScriptID: 9}, {X: 4, ScriptID: 12}, {X: 5}},
		PathScripts: map[int][]ScriptStep{
			9: {
				// Said as a yell, but the text's own type is say.
				{Delay: 0, Command: 0, Data: [4]int{1}, DataInt: [4]int{55, 56}, TextChatType: 0, Comments: "it's 100% Meld"},
				{Delay: 3, Command: 1, Data: [4]int{5, 6}},
				// Cast at the nearest creature 1234 within 20 yards, triggered.
				{Delay: 4, Priority: 1, Command: 15, Data: [4]int{133, 0x2}, TargetType: 10, TargetParam1: 1234, TargetParam2: 20},
				{Delay: 5, Command: 39, Data: [4]int{77}},
				{Delay: 6, Command: 25, Data: [4]int{1}, ConditionID: 8},
			},
			// Nothing of it translates: its point gets no script.
			12: {{Command: 11, Data: [4]int{4000}}},
		}}
	res := ExportSQLFor(CMaNGOSClassic, []Edit{{Spawn: walker, Created: true}}, fixedTime)
	for _, want := range []string{
		"DELETE `d` FROM `dbscripts_on_creature_movement` `d` JOIN `creature_movement` `m` ON `m`.`ScriptId` = `d`.`id` WHERE `m`.`Id` = 70",
		"SET @meld_script = (SELECT GREATEST(COALESCE(MAX(`id`), 0) + 1, 16000000) FROM `dbscripts_on_creature_movement`);",
		"VALUES (@meld_script + 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 55, 56, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Meld: guid 70, VMaNGOS waypoint script 9: it\\'s 100% Meld'), " +
			"(@meld_script + 0, 3000, 0, 1, 5, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Meld: guid 70, VMaNGOS waypoint script 9'), " +
			"(@meld_script + 0, 4000, 1, 15, 133, 1, 0, 1234, 20, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Meld: guid 70, VMaNGOS waypoint script 9');",
		"(70, 1, 1, 0, 0, 0, 0, @meld_script + 0), (70, 2, 2, 0, 0, 0, 0, 0), (70, 3, 3, 0, 0, 0, 0, @meld_script + 0), (70, 4, 4, 0, 0, 0, 0, 0), (70, 5, 5, 0, 0, 0, 0, 0);",
	} {
		if !strings.Contains(res.SQL, want) {
			t.Errorf("SQL lacks %q\n%s", want, res.SQL)
		}
	}
	if n := strings.Count(res.SQL, "INSERT INTO `dbscripts_on_creature_movement`"); n != 1 {
		t.Errorf("%d script INSERTs, want 1:\n%s", n, res.SQL)
	}
	skipped := strings.Join(res.Skipped, "\n")
	for _, want := range []string{
		"Patrol (guid 70, entry 3): its waypoints' script 9, in part (command 0 at 0s: its chat type 1 (CMaNGOS uses the text's own, 0); " +
			"command 39 at 5s, as CMaNGOS has no like command; command 25 at 6s, as it has condition 8, and condition ids differ between the databases)",
		"its waypoints' script 11; the VMaNGOS world database has no such script",
		"its waypoints' script 12, in part (command 11 at 0s, as CMaNGOS has no like command)",
	} {
		if !strings.Contains(skipped, want) {
			t.Errorf("Skipped lacks %q:\n%s", want, skipped)
		}
	}

	// Scripts that couldn't be read leave the points without scripts, reported once.
	walker.PathScripts = nil
	res = ExportSQLFor(CMaNGOSClassic, []Edit{{Spawn: walker, Created: true}}, fixedTime)
	if strings.Contains(res.SQL, "@meld_script") || len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "couldn't be read from the VMaNGOS world database") {
		t.Errorf("unread scripts: %v\n%s", res.Skipped, res.SQL)
	}
}

// VMaNGOS's target (the creature, or the nearest creature of an entry, and its swap and target-self
// flags) becomes CMaNGOS's buddy and data_flags for the same source and target.
func TestCMaNGOSScriptTargets(t *testing.T) {
	for _, c := range []struct {
		target, flags int
		onTarget      bool
		want          int
		why           string
	}{
		{0, 0, false, 0, ""},
		{0, 0x06, false, 0, ""}, // the creature is source and target whatever the swaps
		{10, 0, false, 0x01, ""},
		{10, 0x01, false, 0x01, ""}, // swapping the initial two swaps the creature with itself
		{10, 0x02, false, 0x03, ""},
		{10, 0x04, false, 0x05, ""},
		{10, 0x06, false, 0x07, ""},
		{10, 0x02, true, 0x07, ""}, // a command on its target acts on VMaNGOS's source, the buddy
		{10, 0, true, 0x05, ""},
		{11, 0, false, 0, "guid"},
		{25, 0, false, 0, "target type 25"},
	} {
		buddy, radius, flags, why := cmangosScriptTargets(ScriptStep{TargetType: c.target, TargetParam1: 9, TargetParam2: 15, DataFlags: c.flags}, c.onTarget)
		if c.why != "" {
			if !strings.Contains(why, c.why) {
				t.Errorf("target %d: why %q, want %q", c.target, why, c.why)
			}
			continue
		}
		wantBuddy, wantRadius := 0, 0
		if c.target == 10 {
			wantBuddy, wantRadius = 9, 15
		}
		if why != "" || flags != c.want || buddy != wantBuddy || radius != wantRadius {
			t.Errorf("target %d flags %#x on target %v: buddy %d radius %d flags %#x (%s), want %d %d %#x", c.target, c.flags, c.onTarget, buddy, radius, flags, why, wantBuddy, wantRadius, c.want)
		}
	}
}

// The commands whose meaning moved: renumbered, split, or their options remapped.
func TestCMaNGOSScriptCommands(t *testing.T) {
	for _, c := range []struct {
		name string
		in   ScriptStep
		want cmangosStep
		lost string
		why  string
	}{
		{"flags set", ScriptStep{Command: 4, Data: [4]int{46, 0x100, 1}}, cmangosStep{Command: 4, Data: [3]int{46, 0x100}}, "", ""},
		{"flags removed", ScriptStep{Command: 4, Data: [4]int{46, 0x100, 2}}, cmangosStep{Command: 5, Data: [3]int{46, 0x100}}, "", ""},
		{"flags toggled", ScriptStep{Command: 4, Data: [4]int{46, 0x100, 0}}, cmangosStep{}, "", "toggles"},
		{"move to, running", ScriptStep{Command: 3, Data: [4]int{0, 1500, 0x45, 0x2}, X: 1, Y: 2, Z: 3, O: 4}, cmangosStep{Command: 3, Data: [3]int{0, 0x2, 2}, X: 1, Y: 2, Z: 3, O: 4}, "travel time (1500 ms)", ""},
		{"move relative", ScriptStep{Command: 3, Data: [4]int{1}}, cmangosStep{}, "", "relative"},
		{"turn to a facing", ScriptStep{Command: 35, Data: [4]int{1}, O: 2.5}, cmangosStep{Command: 3, O: 2.5}, "", ""},
		{"turn to the target", ScriptStep{Command: 35, TargetType: 10, TargetParam1: 7}, cmangosStep{Command: 36, Buddy: 7, Flags: 0x01}, "", ""},
		{"despawn the buddy", ScriptStep{Command: 18, Data: [4]int{1000, 60}, TargetType: 10, TargetParam1: 7, DataFlags: 0x02}, cmangosStep{Command: 18, Data: [3]int{1000}, Buddy: 7, Flags: 0x07}, "respawn delay", ""},
		{"equipment", ScriptStep{Command: 19, DataInt: [4]int{1899, 0, 2550}}, cmangosStep{Command: 42, DataInt: [4]int{1899, 0, 2550}}, "", ""},
		{"wander around here", ScriptStep{Command: 20, Data: [4]int{1, 1, 0, 1}, X: 5.4}, cmangosStep{Command: 20, Data: [3]int{1, 5}, Flags: 0x08, DataInt: [4]int{0, 1}}, "", ""},
		{"follow", ScriptStep{Command: 20, Data: [4]int{15}}, cmangosStep{}, "", "movement type 15"},
		{"sheath", ScriptStep{Command: 51, Data: [4]int{1}}, cmangosStep{Command: 54, Data: [3]int{1}}, "", ""},
		{"morph to a display", ScriptStep{Command: 23, Data: [4]int{3167, 1}}, cmangosStep{Command: 23, Data: [3]int{3167}, Flags: 0x08}, "", ""},
		{"sound to the zone", ScriptStep{Command: 16, Data: [4]int{1000, 0x5}}, cmangosStep{Command: 16, Data: [3]int{1000, 0x9}}, "", ""},
		{"cast, interrupting", ScriptStep{Command: 15, Data: [4]int{133, 0x3}}, cmangosStep{Command: 15, Data: [3]int{133, 1}}, "cast flags 0x1", ""},
		{"summon, running and active", ScriptStep{Command: 10, Data: [4]int{2000, 30000}, DataInt: [4]int{0x3, 0, -1, 1}, X: 1, Y: 2, Z: 3},
			cmangosStep{Command: 10, Data: [3]int{2000, 30000}, Flags: 0x08, DataInt: [4]int{1}, X: 1, Y: 2, Z: 3}, "", ""},
		{"summon with a script", ScriptStep{Command: 10, Data: [4]int{2000}, DataInt: [4]int{0, 750, 0, 9}}, cmangosStep{Command: 10, Data: [3]int{2000}}, "the script it starts", ""},
		{"talk without text", ScriptStep{Command: 0}, cmangosStep{}, "", "no text"},
		{"by guid", ScriptStep{Command: 1, Data: [4]int{5}, TargetType: 11}, cmangosStep{}, "", "guid"},
	} {
		got, lost, ok, why := cmangosScriptStep(c.in)
		if c.why != "" {
			if ok || !strings.Contains(why, c.why) {
				t.Errorf("%s: ok %v why %q, want %q", c.name, ok, why, c.why)
			}
			continue
		}
		if !ok || got != c.want {
			t.Errorf("%s: %+v (%v, %s), want %+v", c.name, got, ok, why, c.want)
		}
		if all := strings.Join(lost, "; "); (c.lost == "") != (all == "") || !strings.Contains(all, c.lost) {
			t.Errorf("%s: lost %q, want %q", c.name, all, c.lost)
		}
	}
}

// The script rows read back from mariadb's batch output, by id; SpawnPathScriptIDs lists the ids the
// creatures kept name, once each.
func TestParseMovementScripts(t *testing.T) {
	raw := "9\t2\t1\t0\t1\t0\t0\t0\t10\t1234\t20\t2\t55\t0\t0\t0\t1.5\t-2\t3\t0.25\t0\t1\tHello\\tthere\n" +
		"9\t0\t0\t25\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t8\t-1\tNULL\n"
	got := parseMovementScripts([]byte(raw))
	if len(got) != 1 || len(got[9]) != 2 {
		t.Fatalf("parsed %v", got)
	}
	a, b := got[9][0], got[9][1]
	if a.Delay != 2 || a.Priority != 1 || a.Command != 0 || a.Data != [4]int{1} || a.TargetType != 10 || a.TargetParam1 != 1234 || a.TargetParam2 != 20 ||
		a.DataFlags != 2 || a.DataInt != [4]int{55} || a.X != 1.5 || a.Y != -2 || a.Z != 3 || a.O != 0.25 || a.TextChatType != 1 || a.Comments != "Hello\tthere" {
		t.Errorf("first row %+v", a)
	}
	if b.Command != 25 || b.ConditionID != 8 || b.TextChatType != -1 || b.Comments != "" {
		t.Errorf("second row %+v", b)
	}

	edits := []SpawnEdit{
		{Spawn: WorldSpawn{Kind: KindNPC, GUID: 1, Waypoints: []Waypoint{{ScriptID: 9}, {ScriptID: 4}, {ScriptID: 9}}}},
		{Spawn: WorldSpawn{Kind: KindNPC, GUID: 2, Waypoints: []Waypoint{{ScriptID: 5}}}, Deleted: true},
		{Spawn: WorldSpawn{Kind: KindNPC, GUID: 3, Waypoints: []Waypoint{{}, {ScriptID: 4}}}},
	}
	if ids := SpawnPathScriptIDs(edits); len(ids) != 2 || ids[0] != 4 || ids[1] != 9 {
		t.Errorf("SpawnPathScriptIDs = %v, want [4 9]", ids)
	}
}

// MovementScriptsOf reads the VMaNGOS database's waypoint scripts with the chat type of a talk's
// text, and leaves out an id the database lacks.
func TestMovementScriptsOfLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	db, err := worldDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := runSQL(db, "SELECT s.id, COUNT(*) FROM creature_movement_scripts s JOIN broadcast_text b ON b.entry = s.dataint WHERE s.command = 0 GROUP BY s.id ORDER BY s.id LIMIT 2")
	if err != nil {
		t.Fatal(err)
	}
	want := map[int]bool{}
	for _, f := range batchRows(raw, 2) {
		want[f.num(0)] = true
	}
	if len(want) < 2 {
		t.Fatalf("the world database has %d waypoint scripts that talk", len(want))
	}
	var ids []int
	for id := range want {
		ids = append(ids, id)
	}
	got, err := MovementScriptsOf(dir, append(ids, 16777215))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Errorf("%d scripts read of %v", len(got), ids)
	}
	for id := range want {
		talks := 0
		for _, st := range got[id] {
			if st.Command == 0 && st.TextChatType >= 0 {
				talks++
			}
		}
		if talks == 0 {
			t.Errorf("script %d: no talk with its text's chat type: %+v", id, got[id])
		}
	}
}
