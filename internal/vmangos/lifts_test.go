package vmangos

import (
	"bytes"
	"math"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// liftDBC is a TransportAnimation.dbc of rows (each ID, entry, time, x, y, z, seq; the offsets as
// whole yards).
func liftDBC(rows ...[7]uint32) []byte {
	var rec []byte
	for _, r := range rows {
		rec = appendFields(rec, r[0], r[1], r[2], math.Float32bits(float32(int32(r[3]))), math.Float32bits(float32(int32(r[4]))), math.Float32bits(float32(int32(r[5]))), r[6])
	}
	return dbcFile(liftFields, len(rows), rec, []byte{0})
}

func TestReadLiftMotions(t *testing.T) {
	dbc := liftDBC([7]uint32{5, 20, 5000, 0, 0, 10, 0}, [7]uint32{3, 10, 0, 0, 0, 0, 0}, [7]uint32{4, 20, 0, 0, 0, 0, 162}, [7]uint32{9, 10, 2000, 1, 2, 3, 0})
	m, err := ReadLiftMotions(dbc)
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 2 || m[0].Entry != 10 || m[1].Entry != 20 {
		t.Fatalf("motions = %+v", m)
	}
	if f := m[1].Frames; len(f) != 2 || f[0].Time != 0 || f[0].Seq != 162 || f[1].Time != 5000 || f[1].Z != 10 {
		t.Errorf("entry 20's frames = %+v, want time order with the offsets and sequence", f)
	}
	if f := m[0].Frames[1]; f.X != 1 || f.Y != 2 || f.Z != 3 {
		t.Errorf("entry 10's second frame = %+v", f)
	}
	if _, err := ReadLiftMotions(dbcFile(4, 0, nil, []byte{0})); err == nil {
		t.Error("a table of 4 fields was read as TransportAnimation.dbc")
	}
}

func TestSetLiftFrames(t *testing.T) {
	dbc := liftDBC([7]uint32{3, 10, 0, 0, 0, 0, 0}, [7]uint32{4, 10, 2000, 0, 0, 5, 0}, [7]uint32{7, 10, 4000, 0, 0, 0, 0}, [7]uint32{5, 20, 0, 0, 0, 0, 0}, [7]uint32{6, 20, 1000, 0, 0, 1, 0})
	frames := []LiftFrame{{Time: 0}, {Time: 3000, Z: 30}}
	out, err := SetLiftFrames(dbc, 10, frames)
	if err != nil {
		t.Fatal(err)
	}
	tbl, _, _ := liftTable(out)
	if tbl.records != 4 {
		t.Fatalf("%d rows after giving entry 10 two frames of three, want 4", tbl.records)
	}
	if _, ok := tbl.row(7); ok {
		t.Error("the entry's third row (ID 7) stayed")
	}
	if r, ok := tbl.row(4); !ok || tbl.u32(r, liftTime) != 3000 || tbl.f32(r, liftX+2) != 30 {
		t.Error("the second frame did not take the entry's second ID (4)")
	}
	// More frames than rows: the new ones go past the table's highest ID.
	out, err = SetLiftFrames(out, 20, []LiftFrame{{Time: 0}, {Time: 1000, Z: 1}, {Time: 2000, Z: 2}})
	if err != nil {
		t.Fatal(err)
	}
	tbl, _, _ = liftTable(out)
	if r, ok := tbl.row(7); !ok || tbl.u32(r, liftEntry) != 20 || tbl.u32(r, liftTime) != 2000 {
		t.Error("entry 20's third frame did not take ID 7, past the highest (6)")
	}
	m, _ := ReadLiftMotions(out)
	if len(m) != 2 || len(m[0].Frames) != 2 || len(m[1].Frames) != 3 {
		t.Errorf("motions after the saves = %+v", m)
	}
	// A new entry, and taking a loop out.
	out, err = SetLiftFrames(out, 30, []LiftFrame{{Time: 0}, {Time: 500, X: -2}})
	if err != nil {
		t.Fatal(err)
	}
	out, err = SetLiftFrames(out, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	m, _ = ReadLiftMotions(out)
	if len(m) != 2 || m[0].Entry != 20 || m[1].Entry != 30 || m[1].Frames[1].X != -2 {
		t.Errorf("motions after adding 30 and taking out 10 = %+v", m)
	}
}

func TestCheckLift(t *testing.T) {
	ok := []LiftFrame{{Time: 0}, {Time: 5000}, {Time: 10000, Z: 20}, {Time: 15000, Z: 20}, {Time: 20000}}
	if err := CheckLiftFrames(ok); err != nil {
		t.Errorf("a plain loop was refused: %v", err)
	}
	for name, f := range map[string][]LiftFrame{
		"one frame":       {{Time: 0}},
		"late start":      {{Time: 100}, {Time: 200}},
		"same time":       {{Time: 0}, {Time: 1000}, {Time: 1000, Z: 3}},
		"back in time":    {{Time: 0}, {Time: 1000}, {Time: 500}},
		"not a number":    {{Time: 0}, {Time: 1000, Z: float32(math.NaN())}},
		"far away":        {{Time: 0}, {Time: 1000, Z: 6000}},
		"longer than day": {{Time: 0}, {Time: maxLiftTime + 1}},
	} {
		if CheckLiftFrames(f) == nil {
			t.Errorf("%s: not refused", name)
		}
	}
	if CheckLift(LiftEdit{Entry: 900001, New: true, Name: "", DisplayID: 360, Size: 1, Frames: ok}) == nil {
		t.Error("a new lift without a name was taken")
	}
	if CheckLift(LiftEdit{Entry: 900001, New: true, Name: "Lift", DisplayID: 0, Size: 1, Frames: ok}) == nil {
		t.Error("a new lift without a model was taken")
	}
	if err := CheckLift(LiftEdit{Entry: 4170, Frames: ok}); err != nil {
		t.Errorf("an edited loop was refused: %v", err)
	}
}

func TestLiftSQL(t *testing.T) {
	sql, err := LiftSQL(LiftEdit{Entry: 900001, New: true, Name: "Tom's lift", DisplayID: 360, Size: 1.5})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"INSERT IGNORE INTO `gameobject_template` (`entry`, `patch`, `type`, `displayId`, `name`, `flags`, `size`) VALUES (900001, 0, 11, 360, 'Tom\\'s lift', 40, 1.5);",
		"UPDATE `gameobject_template` SET `displayId` = 360, `name` = 'Tom\\'s lift', `size` = 1.5 WHERE `entry` = 900001 AND `type` = 11;",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("the SQL lacks %s:\n%s", want, sql)
		}
	}
}

// TestClientLifts reads the client's own lifts (WOW_DIR=C:/WoW/client): Thunder Bluff's lift 4171
// rises about 61.6 yards from its spawn (to the spawn of its partner 4170, 61.5 yards higher) and
// comes back in a 30 s loop, and writing every loop back unchanged gives the same table.
func TestClientLifts(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	dbc, err := LoadLiftTable(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	m, err := ReadLiftMotions(dbc)
	if err != nil {
		t.Fatal(err)
	}
	var mesa *LiftMotion
	for i := range m {
		if m[i].Entry == 4171 {
			mesa = &m[i]
		}
		if err := CheckLiftFrames(m[i].Frames); err != nil {
			t.Errorf("the client's lift %d: %v", m[i].Entry, err)
		}
	}
	if mesa == nil {
		t.Fatal("no loop for Thunder Bluff's lift 4171")
	}
	f := mesa.Frames
	top := float32(0)
	for _, k := range f {
		top = max(top, k.Z)
	}
	if f[len(f)-1].Time != 30000 || math.Abs(float64(top)-61.6) > 0.5 {
		t.Errorf("4171's loop is %d ms and rises %.1f yd, want 30000 and about 61.6", f[len(f)-1].Time, top)
	}
	out := dbc
	for _, l := range m {
		if out, err = SetLiftFrames(out, l.Entry, l.Frames); err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(out, dbc) {
		t.Error("writing every loop back unchanged changed the table")
	}
}
