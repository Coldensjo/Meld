package vmangos

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// testSoundTables are a GameObjectDisplayInfo of two displays (a brazier with a loop sound, a chest
// with none) and a SoundEntries of two sounds, as bytes.
func testSoundTables(t *testing.T) (display, sounds []byte) {
	brazier := []any{10, `World\Goober\G_Brazier01.mdx`, 0, 0, 501}
	chest := []any{11, `World\Goober\G_Chest.mdx`}
	display = testDBC(t, objectDisplayFields, brazier, chest).data
	sound := func(id int, name, file string) []any {
		row := make([]any, 29)
		for i := range row {
			row[i] = 0
		}
		row[0], row[2], row[3], row[23] = id, name, file, `Sound\Doodad`
		return row
	}
	sounds = testDBC(t, 29, sound(501, "CampFireSmallLoop", "CampFireSmall.wav"), sound(502, "ForgeLoop", "Forge.wav")).data
	return display, sounds
}

// TestObjectDisplaySounds reads a display's slots and the sound list, and refuses a display the
// table lacks.
func TestObjectDisplaySounds(t *testing.T) {
	d, s := testSoundTables(t)
	got, err := objectDisplaySounds(d, 10)
	if err != nil {
		t.Fatal(err)
	}
	if got.Model != `World\Goober\G_Brazier01.mdx` || !slices.Equal(got.Sounds, []uint32{0, 0, 501, 0, 0, 0, 0, 0, 0, 0}) {
		t.Errorf("brazier: %+v", got)
	}
	if _, err := objectDisplaySounds(d, 99); err == nil {
		t.Error("display 99 read")
	}
	list, err := soundList(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[1] != (SoundOption{ID: 502, Name: "ForgeLoop", File: `Sound\Doodad\Forge.wav`}) {
		t.Errorf("sounds: %+v", list)
	}
}

// TestSetObjectDisplaySounds gives the chest a sound and changes the brazier's: only the slots
// change, the models and the other row stay, and an unknown sound or display is refused.
func TestSetObjectDisplaySounds(t *testing.T) {
	d, s := testSoundTables(t)
	slots := make([]uint32, ObjectSoundSlots)
	slots[0] = 502
	out, changed, err := setObjectDisplaySounds(d, s, 11, slots)
	if err != nil || !changed {
		t.Fatal(changed, err)
	}
	if len(out) != len(d) {
		t.Errorf("the table grew from %d to %d bytes", len(d), len(out))
	}
	chest, err := objectDisplaySounds(out, 11)
	if err != nil || chest.Model != `World\Goober\G_Chest.mdx` || !slices.Equal(chest.Sounds, slots) {
		t.Errorf("chest: %+v %v", chest, err)
	}
	brazier, _ := objectDisplaySounds(out, 10)
	if brazier.Model != `World\Goober\G_Brazier01.mdx` || brazier.Sounds[2] != 501 {
		t.Errorf("the brazier changed: %+v", brazier)
	}
	if _, changed, err := setObjectDisplaySounds(out, s, 11, slots); err != nil || changed {
		t.Errorf("setting the same slots again: changed %v, %v", changed, err)
	}
	bad := slices.Clone(slots)
	bad[3] = 777
	if _, _, err := setObjectDisplaySounds(d, s, 11, bad); err == nil || !strings.Contains(err.Error(), "777") {
		t.Errorf("an unknown sound: %v", err)
	}
	if _, _, err := setObjectDisplaySounds(d, s, 12, slots); err == nil {
		t.Error("a display the table lacks was added")
	}
	if _, _, err := setObjectDisplaySounds(d, s, 11, slots[:9]); err == nil {
		t.Error("nine slots taken")
	}
}

// TestClientObjectDisplaySounds rewrites a real display's slots in the client's own
// GameObjectDisplayInfo.dbc: the result parses as the client's reader reads it, only that row's
// slots differ, and the client's sound list has the fires' loop. It needs WOW_DIR.
func TestClientObjectDisplaySounds(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	d, err := set.ReadFile(GameObjectDisplayInfoPath)
	if err != nil {
		t.Fatal(err)
	}
	s, err := set.ReadFile(SoundEntriesPath)
	if err != nil {
		t.Fatal(err)
	}
	list, err := soundList(s)
	if err != nil {
		t.Fatal(err)
	}
	var loop SoundOption
	for _, o := range list {
		if o.Name == "CampFireLargeLoop" {
			loop = o
		}
	}
	if loop.ID == 0 || !strings.HasPrefix(strings.ToLower(loop.File), `sound\`) {
		t.Fatalf("no CampFireLargeLoop with a file among %d sounds: %+v", len(list), loop)
	}
	before, err := parseDBC(d)
	if err != nil {
		t.Fatal(err)
	}
	// The first display with a model and no sound at all gets the fire's loop in its loop slot.
	var id uint32
	for r := 0; r < before.records && id == 0; r++ {
		if before.str(r, 1) != "" && slices.Equal(before.record(r)[2:], make([]uint32, ObjectSoundSlots)) {
			id = before.u32(r, 0)
		}
	}
	slots := make([]uint32, ObjectSoundSlots)
	slots[2] = loop.ID
	out, changed, err := setObjectDisplaySounds(d, s, id, slots)
	if err != nil || !changed {
		t.Fatal(changed, err)
	}
	after, err := parseDBC(out)
	if err != nil {
		t.Fatal(err)
	}
	if after.records != before.records || after.fields != before.fields || !bytes.Equal(out[after.strsAt:], d[before.strsAt:]) {
		t.Fatal("the table's shape or string block changed")
	}
	for r := 0; r < before.records; r++ {
		want := before.record(r)
		if want[0] == id {
			copy(want[2:], slots)
		}
		if !slices.Equal(after.record(r), want) {
			t.Fatalf("row %d (display %d): %v, want %v", r, want[0], after.record(r), want)
		}
	}
	got, err := objectDisplaySounds(out, id)
	if err != nil || got.Model != before.str(before.byID[id], 1) {
		t.Errorf("display %d: %+v %v", id, got, err)
	}
	t.Logf("display %d (%s) given %s (%d, %s)", id, got.Model, loop.Name, loop.ID, loop.File)
}

// TestCopyObjectDisplay copies the brazier to a display of its own: the new row has its model and
// slots under an ID above both the client's and the server's tables, the other rows of each stay as
// they were, and a display the client lacks is refused.
func TestCopyObjectDisplay(t *testing.T) {
	d, _ := testSoundTables(t)
	// The server's copy has a display the client lacks, above the client's.
	server := testDBC(t, objectDisplayFields, []any{10, `World\Goober\G_Brazier01.mdx`}, []any{40, `World\Goober\G_Other.mdx`, 7}).data
	id, client, srv, err := copyObjectDisplay(d, server, 10)
	if err != nil {
		t.Fatal(err)
	}
	if id != 41 {
		t.Errorf("new display %d, want 41", id)
	}
	for name, table := range map[string][]byte{"client": client, "server": srv} {
		got, err := objectDisplaySounds(table, id)
		if err != nil || got.Model != `World\Goober\G_Brazier01.mdx` || !slices.Equal(got.Sounds, []uint32{0, 0, 501, 0, 0, 0, 0, 0, 0, 0}) {
			t.Errorf("%s: the copy is %+v %v", name, got, err)
		}
	}
	for _, c := range []struct {
		name        string
		before, now []byte
	}{{"client", d, client}, {"server", server, srv}} {
		b, _ := parseDBC(c.before)
		a, err := parseDBC(c.now)
		if err != nil || a.records != b.records+1 {
			t.Fatalf("%s: %v, %d rows after %d", c.name, err, a.records, b.records)
		}
		for r := 0; r < b.records; r++ {
			if !slices.Equal(a.record(r)[2:], b.record(r)[2:]) || a.u32(r, 0) != b.u32(r, 0) || a.str(r, 1) != b.str(r, 1) {
				t.Errorf("%s: row %d changed", c.name, r)
			}
		}
	}
	// Without a server the ID is the client's next.
	if id, _, srv, err := copyObjectDisplay(d, nil, 11); err != nil || id != 12 || srv != nil {
		t.Errorf("no server: %d %v %v", id, srv != nil, err)
	}
	if _, _, _, err := copyObjectDisplay(d, server, 12); err == nil {
		t.Error("a display the client lacks was copied")
	}
}

// TestInstallServerObjectDisplays writes the table into the server's data and keeps the extractor's
// as the backup.
func TestInstallServerObjectDisplays(t *testing.T) {
	dir := t.TempDir()
	dbcDir := filepath.Join(dir, "data", "5875", "dbc")
	for _, p := range []string{filepath.Join(dir, "run"), dbcDir} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "run", "mangosd.conf"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	old, _ := testSoundTables(t)
	if err := os.WriteFile(serverObjectDisplayPath(dir), old, 0o644); err != nil {
		t.Fatal(err)
	}
	_, _, srv, err := copyObjectDisplay(old, old, 10)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InstallServerObjectDisplays(dir, srv); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(serverObjectDisplayPath(dir)); !bytes.Equal(got, srv) {
		t.Error("the server's table is not the new one")
	}
	if got, _ := os.ReadFile(serverObjectDisplayPath(dir) + BackupSuffix); !bytes.Equal(got, old) {
		t.Error("the backup is not the extractor's table")
	}
}

// TestClientCopyObjectDisplay copies the Forge's display (197) in the client's own table: the copy
// has its model and slots under the table's next ID. It needs WOW_DIR.
func TestClientCopyObjectDisplay(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	d, err := readClientFile(dataDir, GameObjectDisplayInfoPath)
	if err != nil {
		t.Fatal(err)
	}
	forge, err := objectDisplaySounds(d, 197)
	if err != nil {
		t.Fatal(err)
	}
	id, out, _, err := copyObjectDisplay(d, nil, 197)
	if err != nil {
		t.Fatal(err)
	}
	got, err := objectDisplaySounds(out, id)
	if err != nil || got.Model != forge.Model || !slices.Equal(got.Sounds, forge.Sounds) {
		t.Errorf("display %d: %+v %v, want %+v", id, got, err, forge)
	}
	if _, ok := mustParse(t, d).row(id); ok {
		t.Errorf("display %d was taken already", id)
	}
	t.Logf("display 197 (%s) copied to %d", forge.Model, id)
}

func mustParse(t *testing.T, b []byte) *dbcTable {
	t.Helper()
	tb, err := parseDBC(b)
	if err != nil {
		t.Fatal(err)
	}
	return tb
}
