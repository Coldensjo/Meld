package vmangos

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestTriggerScriptRoundTrip checks the Portals dialog's export (#943): the script carries every
// field of the triggers' AreaTrigger rows in its "-- meld trigger" lines, with each trigger's
// areatrigger_template row and its teleport (a DELETE of the old one first), and its import plan
// gives back the same triggers, names and teleports included.
func TestTriggerScriptRoundTrip(t *testing.T) {
	rows := []AreaTrigger{
		{ID: 4300, MapID: 451, X: -9000.125, Y: 100.1, Z: 50, Radius: 5, Name: `Meld's "Big" portal`,
			Teleport: &TriggerTeleport{Map: 36, X: -16.4, Y: -383.07, Z: 61.78, O: 1.57, Level: 10, Message: "Too young, it's said"}},
		{ID: 4301, MapID: 451, X: 1, Y: 2, Z: 3, BoxX: 10, BoxY: 4.5, BoxZ: 6, BoxYaw: 0.3, Name: "Box  two"},
		{ID: 4302, MapID: 451, X: 4, Y: 5, Z: 6, Radius: 2},
	}
	script, err := TriggerScript(rows, true, "Meld Isle", time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"3 triggers of map 451 (Meld Isle), 1 with a teleport.",
		"-- meld trigger 4300 451 -9000.125 100.1 50 5 0 0 0 0\n",
		"-- meld trigger 4301 451 1 2 3 0 10 4.5 6 0.3\n",
		"-- Trigger 4302 (trigger 4302, no teleport)",
		"INSERT INTO `areatrigger_teleport` (`id`, `patch`, `name`, `message`, `required_level`, `target_map`,",
		"DELETE FROM `areatrigger_teleport` WHERE `id` = 4301;",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("the script lacks %q:\n%s", want, script)
		}
	}

	// Into a client that has none of them, with a server that has none either: every row new, as exported.
	dbc := triggerDBC(AreaTrigger{ID: 45, Radius: 5})
	none := func([]uint32) (map[uint32]AreaTrigger, error) { return nil, nil }
	plan, got, err := PlanTriggerImport(dbc, script, nil, none)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, rows) {
		t.Fatalf("imported rows = %+v\nwant %+v", got, rows)
	}
	if len(plan.Triggers) != 3 || plan.Triggers[0].Exists || plan.Triggers[0].Kept || plan.Teleports != 1 || !plan.Server ||
		plan.Skipped != 0 || plan.Others != 0 || len(plan.Unknown) != 0 || len(plan.Refused) != 0 || !reflect.DeepEqual(plan.Maps, []uint32{451}) {
		t.Fatalf("plan = %+v", plan)
	}
	// Written as Save writes them, they read back the same, but for the server's names and teleports.
	out, err := SetAreaTriggers(dbc, got, nil)
	if err != nil {
		t.Fatal(err)
	}
	back, err := ReadAreaTriggers(out, 451)
	if err != nil || len(back) != 3 {
		t.Fatalf("read back %+v (%v)", back, err)
	}
	for i := range back {
		back[i].Name, back[i].Teleport = rows[i].Name, rows[i].Teleport
	}
	if !reflect.DeepEqual(back, rows) {
		t.Fatalf("written and read back = %+v\nwant %+v", back, rows)
	}

	// Exported without a server, the script holds only the meld lines and says so, and the import
	// keeps the server's names and teleports.
	bare, err := TriggerScript(rows, false, "", time.Now())
	if err != nil || strings.Contains(bare, "INTO `areatrigger") || !strings.Contains(bare, "No server rows") {
		t.Fatalf("a script without the server:\n%s (%v)", bare, err)
	}
	kept := &TriggerTeleport{Map: 1, X: 9}
	server := func(ids []uint32) (map[uint32]AreaTrigger, error) {
		return map[uint32]AreaTrigger{4300: {ID: 4300, Name: "Server's", Teleport: kept}}, nil
	}
	plan, got, err = PlanTriggerImport(dbc, bare, nil, server)
	if err != nil || !plan.Triggers[0].Kept || got[0].Name != "Server's" || got[0].Teleport != kept || got[1].Teleport != nil || plan.Teleports != 1 {
		t.Fatalf("without the server's rows: plan %+v, rows %+v (%v)", plan, got, err)
	}
}

// TestTriggerImportPlan checks what the plan says of a script on a client and server that have some
// of its IDs: a trigger of another map or another name is named, a target map the client lacks is
// listed, and other rows, statements and columns are counted.
func TestTriggerImportPlan(t *testing.T) {
	dbc := triggerDBC(AreaTrigger{ID: 45, MapID: 0, Radius: 5}, AreaTrigger{ID: 46, MapID: 1, Radius: 5})
	script := strings.Join([]string{
		"-- Area triggers exported by Meld.",
		triggerLine(AreaTrigger{ID: 45, MapID: 0, X: 1, Radius: 3}),
		triggerLine(AreaTrigger{ID: 46, MapID: 451, Radius: 4}),
		triggerLine(AreaTrigger{ID: 600, MapID: 451, BoxX: 1, BoxY: 2, BoxZ: 3}),
		"REPLACE INTO areatrigger_template (id, build, name, map_id, x, y, z, radius, cooldown) VALUES (45, 5875, 'Same', 0, 1, 0, 0, 3, 9), (45, 6005, 'Later build', 0, 1, 0, 0, 3, 0);",
		"REPLACE INTO areatrigger_template VALUES (46, 5875, 'Moved', 451, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, '');",
		"DELETE FROM areatrigger_teleport WHERE id = 46;",
		"INSERT INTO areatrigger_teleport (id, patch, name, message, required_level, required_condition, target_map, target_position_x, target_position_y, target_position_z, target_orientation) VALUES (46, 0, 'Moved', '', 0, 0, 999, 1, 2, 3, 0);",
		"INSERT INTO areatrigger_teleport (id, patch, name, target_map) VALUES (700, 0, 'Elsewhere', 0);",
		"UPDATE creature_template SET name = 'x' WHERE entry = 1;",
	}, "\n")
	server := func(ids []uint32) (map[uint32]AreaTrigger, error) {
		return map[uint32]AreaTrigger{45: {ID: 45, Name: "Same"}, 46: {ID: 46, Name: "Old 46"}, 600: {ID: 600, Name: "Kept name"}}, nil
	}
	plan, rows, err := PlanTriggerImport(dbc, script, map[uint32]bool{0: true, 1: true}, server)
	if err != nil {
		t.Fatal(err)
	}
	if p := plan.Triggers[0]; !p.Exists || p.OtherMap || p.Was != "" || p.Name != "Same" || p.Kept {
		t.Fatalf("the same trigger again = %+v, want it to replace itself", p)
	}
	if p := plan.Triggers[1]; !p.Exists || !p.OtherMap || p.WasMap != 1 || p.Was != "Old 46" || p.Teleport == nil || p.Teleport.Map != 999 {
		t.Fatalf("another trigger's ID = %+v, want map 1 and Old 46 named", p)
	}
	if p := plan.Triggers[2]; p.Exists || !p.Kept || p.Name != "Kept name" {
		t.Fatalf("a trigger without server rows = %+v, want the server's name kept", p)
	}
	if !reflect.DeepEqual(plan.MissingMaps, []uint32{451}) || !reflect.DeepEqual(plan.MissingTargets, []uint32{999}) || plan.Teleports != 1 {
		t.Fatalf("missing maps %v, targets %v, teleports %d", plan.MissingMaps, plan.MissingTargets, plan.Teleports)
	}
	if plan.Others != 1 || plan.Skipped != 1 || !reflect.DeepEqual(plan.Unknown, []string{"areatrigger_teleport.required_condition", "areatrigger_template.condition_id", "areatrigger_template.cooldown", "areatrigger_template.script_id", "areatrigger_template.script_name"}) {
		t.Fatalf("others %d, skipped %d, unknown %v", plan.Others, plan.Skipped, plan.Unknown)
	}
	if len(plan.Refused) != 0 || rows[1].MapID != 451 || rows[0].X != 1 {
		t.Fatalf("refused %v, rows %+v", plan.Refused, rows)
	}

	// A trigger Save would refuse refuses the import.
	bad := triggerLine(AreaTrigger{ID: 700, MapID: 0})
	if plan, _, err := PlanTriggerImport(dbc, bad, nil, nil); err != nil || len(plan.Refused) != 1 || !strings.Contains(plan.Refused[0], "no size") || plan.Server {
		t.Fatalf("a trigger without a size: refused %v (%v)", plan.Refused, err)
	}
}

// TestTriggerScriptRefusesWhatItCantRead checks that a script without "-- meld trigger" lines, or
// with one cut short, a doubled trigger or a teleport whose level isn't a number, is refused with a
// message saying why.
func TestTriggerScriptRefusesWhatItCantRead(t *testing.T) {
	dbc := triggerDBC()
	line := triggerLine(AreaTrigger{ID: 600, Radius: 2})
	for name, c := range map[string]struct{ script, want string }{
		"no meld lines": {"REPLACE INTO areatrigger_template (id, name) VALUES (600, 'P');", "carries no area triggers"},
		"cut short":     {"-- meld trigger 600 0 1 2", "has 4 fields"},
		"not a number":  {"-- meld trigger 600 0 x 0 0 2 0 0 0 0", `x "x"`},
		"no ID":         {"-- meld trigger 0 0 0 0 0 2 0 0 0 0", "no trigger ID"},
		"twice":         {line + line, "twice"},
		"a bad level":   {line + "INSERT INTO areatrigger_teleport (id, required_level) VALUES (600, 'ten');", `required_level "ten"`},
	} {
		_, _, err := PlanTriggerImport(dbc, c.script, nil, nil)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v, want %q", name, err, c.want)
		}
	}
}

// TestClientTriggerScriptRoundTrip exports the client's own Azeroth triggers (with the server's names
// and teleports when its database answers) and plans the script's import back into the same client:
// every trigger replaces itself under its own name and teleport, nothing is refused, and the rows
// written back leave AreaTrigger.dbc as it was. It needs WOW_DIR (and VMANGOS_DIR for the server).
func TestClientTriggerScriptRoundTrip(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	dbc, err := LoadAreaTriggerTable(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := ReadAreaTriggers(dbc, 0)
	if err != nil {
		t.Fatal(err)
	}
	var lookup func([]uint32) (map[uint32]AreaTrigger, error)
	if server := testclient.ServerDirIfAny(t); server != "" {
		if _, err := TriggerExtras(server, rows); err != nil {
			t.Fatal(err)
		}
		lookup = func(ids []uint32) (map[uint32]AreaTrigger, error) {
			out := map[uint32]AreaTrigger{}
			for _, a := range rows {
				out[a.ID] = a
			}
			return out, nil
		}
	}
	script, err := TriggerScript(rows, lookup != nil, "Eastern Kingdoms", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	maps := map[uint32]bool{}
	if entries, err := LoadMapEntries(dataDir); err == nil {
		for _, m := range entries {
			maps[m.ID] = true
		}
	}
	plan, got, err := PlanTriggerImport(dbc, script, maps, lookup)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Refused) > 0 || len(plan.MissingMaps) > 0 || len(plan.MissingTargets) > 0 || plan.Skipped > 0 || plan.Others > 0 || len(plan.Unknown) > 0 {
		t.Fatalf("plan = refused %v, missing maps %v, targets %v, skipped %d, others %d, unknown %v", plan.Refused, plan.MissingMaps, plan.MissingTargets, plan.Skipped, plan.Others, plan.Unknown)
	}
	for _, p := range plan.Triggers {
		if !p.Exists || p.OtherMap || p.Was != "" {
			t.Fatalf("trigger %+v, want it to replace itself", p)
		}
	}
	if !reflect.DeepEqual(got, rows) {
		t.Fatal("the imported triggers differ from the exported ones")
	}
	if lookup != nil && plan.Teleports == 0 {
		t.Fatal("no teleports among Azeroth's triggers, though the server answered")
	}
	if out, err := SetAreaTriggers(dbc, got, nil); err != nil || !bytes.Equal(out, dbc) {
		t.Fatalf("written back, AreaTrigger.dbc changed (%v)", err)
	}
}
