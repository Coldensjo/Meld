package vmangos

import (
	"bytes"
	"encoding/binary"
	"math"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// triggerDBC builds a 1.12 AreaTrigger.dbc of rows.
func triggerDBC(rows ...AreaTrigger) []byte {
	out := []byte("WDBC")
	out = binary.LittleEndian.AppendUint32(out, uint32(len(rows)))
	out = binary.LittleEndian.AppendUint32(out, areaTriggerFields)
	out = binary.LittleEndian.AppendUint32(out, areaTriggerFields*4)
	out = binary.LittleEndian.AppendUint32(out, 1)
	for _, r := range rows {
		for _, v := range triggerRecord(r) {
			out = binary.LittleEndian.AppendUint32(out, v)
		}
	}
	return append(out, 0)
}

func TestSetAreaTriggersEditsAddsAndRemoves(t *testing.T) {
	a := AreaTrigger{ID: 45, MapID: 0, X: 1, Y: 2, Z: 3, Radius: 5}
	b := AreaTrigger{ID: 46, MapID: 1, X: 4, Y: 5, Z: 6, BoxX: 10, BoxY: 4, BoxZ: 6, BoxYaw: 1.5}
	dbc := triggerDBC(a, b)
	same, err := SetAreaTriggers(dbc, nil, nil)
	if err != nil || !bytes.Equal(same, dbc) {
		t.Fatalf("unchanged write differs: %v", err)
	}
	a2 := a
	a2.Radius = 8
	c := AreaTrigger{ID: 47, MapID: 0, X: 7, Y: 8, Z: 9, Radius: 3}
	out, err := SetAreaTriggers(dbc, []AreaTrigger{c, a2}, []uint32{46})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, triggerDBC(a2, c)) {
		t.Fatal("expected trigger 45 edited in place, 46 gone and 47 at the end")
	}
	on0, _ := ReadAreaTriggers(out, 0)
	if len(on0) != 2 || on0[0].Radius != 8 || on0[1].ID != 47 {
		t.Fatalf("read back %+v", on0)
	}
	if _, err := SetAreaTriggers(dbc, []AreaTrigger{{ID: 48, Radius: 0, BoxX: 1}}, nil); err == nil {
		t.Fatal("a trigger with no size was accepted")
	}
	if _, err := SetAreaTriggers(dbc, []AreaTrigger{a2}, []uint32{45}); err == nil {
		t.Fatal("a trigger both saved and removed was accepted")
	}
	if id, _ := NewAreaTriggerID(dbc, 100); id != 101 {
		t.Fatalf("new ID %d, want 101 (above the server's)", id)
	}
	if id, _ := NewAreaTriggerID(dbc, 0); id != 47 {
		t.Fatalf("new ID %d, want 47", id)
	}
}

func TestAreaTriggerSQL(t *testing.T) {
	sql := AreaTriggerSQL([]AreaTrigger{{ID: 4300, MapID: 0, X: -9000.5, Y: 100, Z: 50, Radius: 5, Name: "Meld's portal",
		Teleport: &TriggerTeleport{Map: 1, X: 1, Y: 2, Z: 3, O: 0.5, Level: 10, Message: "Too young"}}}, []uint32{4301})
	for _, want := range []string{
		"DELETE FROM `areatrigger_template` WHERE `id` = 4301;",
		"DELETE FROM `areatrigger_teleport` WHERE `id` = 4301;",
		"VALUES (4300, 5875, 'Meld\\'s portal', 0, -9000.5, 100, 50, 5, 0, 0, 0, 0);",
		"VALUES (4300, 0, 'Meld\\'s portal', 'Too young', 10, 1, 1, 2, 3, 0.5);",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("missing %q in\n%s", want, sql)
		}
	}
}

// TestClientAreaTriggers reads the client's own AreaTrigger.dbc: 1.12's ten-field rows, written back
// unchanged, and a trigger near the Deadmines entrance (Westfall, ID 78). It needs WOW_DIR.
func TestClientAreaTriggers(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	dbc, err := set.ReadFile(AreaTriggerPath)
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	same, err := SetAreaTriggers(dbc, nil, nil)
	if err != nil || !bytes.Equal(same, dbc) {
		t.Fatalf("the client's table written back differs (%v)", err)
	}
	rows, err := ReadAreaTriggers(dbc, 0)
	if err != nil || len(rows) == 0 {
		t.Fatalf("no Azeroth triggers: %v", err)
	}
	var dm *AreaTrigger
	for i := range rows {
		if rows[i].ID == 78 {
			dm = &rows[i]
		}
	}
	if dm == nil || math.Abs(float64(dm.X)+11208) > 50 || math.Abs(float64(dm.Y)-1675) > 50 {
		t.Fatalf("trigger 78 (the Deadmines) is %+v", dm)
	}
}
