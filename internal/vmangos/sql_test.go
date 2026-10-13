package vmangos

import (
	"math"
	"strings"
	"testing"
	"time"
)

var fixedTime = time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

func TestExportAddChangeDelete(t *testing.T) {
	orig := Spawn{Kind: Creature, GUID: 42, Entry: 3, Name: "Guard", Map: 0, X: 1, Y: 2, Z: 3, O: 0, Scale: 1, RespawnMin: 120, RespawnMax: 180,
		MovementType: 1, WanderDistance: 5, Display: 3167, Equipment: 7, SheathState: 1}
	moved := orig
	moved.X = 10.5
	moved.StandState = 1 // sitting
	moved.Equipment = 9
	moved.MovementType = 0
	moved.WanderDistance = 0

	added := Spawn{Kind: GameObject, GUID: 900000, Entry: 7, Name: "Chest", Map: 1, X: 4, Y: 5, Z: 6, O: math.Pi / 2, Scale: 1}
	gone := Spawn{Kind: Creature, GUID: 43, Entry: 4, Name: "Rat", Map: 0}

	res := ExportSQL([]Edit{
		{Spawn: moved, Original: &orig},
		{Spawn: added, Created: true},
		{Spawn: gone, Original: &gone, Deleted: true},
		{Spawn: Spawn{GUID: 5, Entry: 9, Map: 0}, Created: true, Deleted: true}, // added then deleted: nothing
	}, fixedTime)

	if res.Added != 1 || res.Changed != 1 || res.Deleted != 1 {
		t.Fatalf("counts = %d/%d/%d", res.Added, res.Changed, res.Deleted)
	}
	for _, want := range []string{
		"UPDATE `creature` SET `map` = 0, `position_x` = 10.5,",
		"`spawntimesecsmin` = 120, `spawntimesecsmax` = 180, `wander_distance` = 0, `movement_type` = 0 WHERE `guid` = 42;",
		"INSERT INTO `gameobject` (`guid`, `id`, `map`",
		"VALUES (900000, 7, 1, 4, 5, 6, 1.570796,",
		"DELETE FROM `creature` WHERE `guid` = 43;",
		"DELETE FROM `creature_linking` WHERE `guid` = 43 OR `master_guid` = 43;",
		"INSERT INTO `creature_addon` (`guid`, `patch`) SELECT 42, 0 FROM DUAL WHERE NOT EXISTS",
		"UPDATE `creature_addon` SET `equipment_id` = 9, `stand_state` = 1 WHERE `guid` = 42;",
		"-- Exported 2026-10-11T12:00:00Z: 1 added, 1 changed, 1 deleted.",
	} {
		if !strings.Contains(res.SQL, want) {
			t.Errorf("SQL lacks %q\n%s", want, res.SQL)
		}
	}
	if strings.Contains(res.SQL, "WHERE `guid` = 5;") {
		t.Error("a spawn added and deleted in the editor reached the SQL")
	}
}

func TestExportSkipsAndReportsScale(t *testing.T) {
	orig := Spawn{Kind: Creature, GUID: 1, Entry: 2, Name: "Boar", Map: 0, Scale: 1}
	edit := orig
	edit.Scale = 1.5
	res := ExportSQL([]Edit{{Spawn: edit, Original: &orig}, {Spawn: Spawn{Kind: Creature, GUID: 2, Map: MaxGameMap + 1}, Created: true}}, fixedTime)
	if len(res.Skipped) != 2 {
		t.Fatalf("skipped = %q", res.Skipped)
	}
	if !strings.Contains(res.SQL, "--   Boar (guid 1, entry 2): its scale (1.5)") {
		t.Errorf("scale not reported:\n%s", res.SQL)
	}
}

func TestNumFormatting(t *testing.T) {
	cases := map[float64]string{1: "1", 0.1234567: "0.123457", -2.5: "-2.5", math.NaN(): "0", math.Inf(1): "0"}
	for in, want := range cases {
		if got := num(in); got != want {
			t.Errorf("num(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestLabelCannotEndComment(t *testing.T) {
	got := label(Spawn{GUID: 1, Entry: 2, Name: "evil */ DROP\nTABLE"})
	if strings.ContainsAny(got, "\n\r") || strings.Contains(got, "*/") {
		t.Errorf("label = %q", got)
	}
}

func TestExportLeavesAnUnchangedAddonAlone(t *testing.T) {
	orig := Spawn{Kind: Creature, GUID: 7, Entry: 1, Map: 0, Display: 10, Equipment: -1, SheathState: 1, Scale: 1}
	moved := orig
	moved.Y = 4
	res := ExportSQL([]Edit{{Spawn: moved, Original: &orig}}, fixedTime)
	if strings.Contains(res.SQL, "creature_addon") {
		t.Fatalf("only the position changed, but the addon is written:\n%s", res.SQL)
	}
	// A created creature without an original writes the addon columns that aren't the defaults.
	added := Spawn{Kind: Creature, GUID: 8, Entry: 1, Map: 0, Equipment: -1, SheathState: 1, EmoteState: 233, Scale: 1}
	res = ExportSQL([]Edit{{Spawn: added, Created: true}}, fixedTime)
	if !strings.Contains(res.SQL, "UPDATE `creature_addon` SET `emote_state` = 233 WHERE `guid` = 8;") {
		t.Fatalf("the added creature's emote is not written:\n%s", res.SQL)
	}
	if !strings.Contains(res.SQL, "VALUES (8, 1, 0, 0, 0, 0, 0, 300, 300, 0, 100, 100, 0,") {
		t.Fatalf("an added creature without a respawn time gets the default:\n%s", res.SQL)
	}
}
