package vmangos

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"Meld/internal/mpq"
)

// testAreaTable is an AreaTable of one zone, 12 Elwynn Forest, playing ZoneMusic music, SoundAmbience
// ambience and intro row intro.
func testAreaTable(t *testing.T, music, ambience, intro int) []byte {
	row := make([]any, areaFields)
	for i := range row {
		row[i] = 0
	}
	row[areaID], row[areaBit], row[areaAmbience], row[areaMusic], row[areaIntroMusic], row[areaName] = 12, 5, ambience, music, intro, "Elwynn Forest"
	return testDBC(t, areaFields, row).data
}

// TestDeleteSoundRows deletes an imported zone music: its SoundEntries row and the ZoneMusic row its
// import added go, the zone and the game object display that named them are cleared, every other row
// reads as before, and a client's own sound is refused.
func TestDeleteSoundRows(t *testing.T) {
	tables := testZoneTables(t)
	changed, res, err := importSoundRows(tables, "MyTheme.mp3", SoundImport{Name: "MyTheme", Kind: "music", Volume: 0.5})
	if err != nil || res.id != 503 || res.zone != 2 {
		t.Fatal(res, err)
	}
	after := applyImport(tables, changed)
	after["AreaTable"] = testAreaTable(t, 2, 24, 61)
	after["GameObjectDisplayInfo"] = testDBC(t, objectDisplayFields, []any{10, `World\Goober\G_Brazier01.mdx`, 0, 0, 502}, []any{11, `World\Goober\G_Lamp.mdx`, 503, 0, 0, 503}).data

	out, plan, err := deleteSoundRows(after, 503)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Name != "MyTheme" || !slices.Equal(plan.Files, []string{`Sound\Meld\MyTheme.mp3`}) {
		t.Errorf("the plan: %+v", plan)
	}
	if !slices.Equal(plan.Music, []SoundOption{{ID: 2, Name: "MyTheme"}}) || len(plan.Ambience) != 0 || len(plan.Intro) != 0 {
		t.Errorf("the zone rows: %+v", plan)
	}
	if !slices.Equal(plan.Zones, []SoundOption{{ID: 12, Name: "Elwynn Forest"}}) || !slices.Equal(plan.Displays, []uint32{11}) {
		t.Errorf("the users: zones %+v, displays %v", plan.Zones, plan.Displays)
	}
	for _, name := range []string{"SoundEntries", "ZoneMusic", "AreaTable", "GameObjectDisplayInfo"} {
		if _, ok := out[name]; !ok {
			t.Errorf("%s not changed", name)
		}
	}
	if _, ok := out["SoundAmbience"]; ok {
		t.Error("SoundAmbience changed")
	}
	done := applyImport(after, out)
	if _, err := soundEntryInfo(done, 503); err == nil {
		t.Error("sound 503 is still there")
	}
	if old, err := soundEntryInfo(done, 501); err != nil || old.Name != "Zone-Forest Day" || len(old.Music) != 1 || len(old.Intro) != 1 {
		t.Errorf("501 after the delete: %+v %v", old, err)
	}
	if beach, err := soundEntryInfo(done, 502); err != nil || beach.Name != "BeachDay" || beach.Displays != 1 || len(beach.Ambience) != 1 {
		t.Errorf("502 after the delete: %+v %v", beach, err)
	}
	zm, _ := parseDBC(done["ZoneMusic"])
	if _, ok := zm.row(2); ok || zm.records != 1 || zm.str(0, 1) != "Zone-Forest" {
		t.Errorf("ZoneMusic after the delete: %d rows", zm.records)
	}
	at, _ := parseDBC(done["AreaTable"])
	if at.u32(0, areaMusic) != 0 || at.u32(0, areaAmbience) != 24 || at.u32(0, areaIntroMusic) != 61 || at.str(0, areaName) != "Elwynn Forest" {
		t.Errorf("the zone after the delete: music %d, ambience %d, intro %d, %q", at.u32(0, areaMusic), at.u32(0, areaAmbience), at.u32(0, areaIntroMusic), at.str(0, areaName))
	}
	d, _ := parseDBC(done["GameObjectDisplayInfo"])
	r, _ := d.row(11)
	if d.u32(r, 2) != 0 || d.u32(r, 5) != 0 || d.str(r, 1) != `World\Goober\G_Lamp.mdx` {
		t.Errorf("display 11 after the delete: %v", d.record(r))
	}

	// A sound that both a ZoneMusic row's day and another sound's night name keeps that row.
	shared := applyImport(after, nil)
	if shared["ZoneMusic"], err = setRecords(after["ZoneMusic"], [][]uint32{{2, 0, 1, 1, 1, 1, 503, 501}}); err != nil {
		t.Fatal(err)
	}
	out2, plan2, err := deleteSoundRows(shared, 503)
	if err != nil {
		t.Fatal(err)
	}
	zm2, _ := parseDBC(applyImport(shared, out2)["ZoneMusic"])
	if r, ok := zm2.row(2); !ok || zm2.u32(r, 6) != 0 || zm2.u32(r, 7) != 501 || plan2.Zones[0].ID != 12 {
		t.Errorf("the shared row: %v %+v", ok, plan2)
	}
	if _, ok := out2["AreaTable"]; ok {
		t.Error("a zone whose music row stays was cleared")
	}

	if _, _, err := deleteSoundRows(after, 501); err == nil {
		t.Error("a client's own sound was deleted")
	}
	if _, _, err := deleteSoundRows(after, 999); err == nil {
		t.Error("a missing sound was deleted")
	}
}

// soundClient is a client data folder whose base.MPQ has the zone tables, an AreaTable and the
// client's own fire sound.
func soundClient(t *testing.T, fire []byte) string {
	t.Helper()
	dir := t.TempDir()
	tables := testZoneTables(t)
	files := []mpq.File{{Name: `Sound\Doodad\Fire.wav`, Data: fire}, {Name: AreaTablePath, Data: testAreaTable(t, 1, 24, 61)}}
	for name, path := range soundTablePaths {
		files = append(files, mpq.File{Name: path, Data: tables[name]})
	}
	if err := os.WriteFile(filepath.Join(dir, "base.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestRestoreAndDeleteSounds replaces a client's sound and imports one into Meld's patch, then restores
// the client's (the file dropped from the patch) and deletes the import (its file dropped, its rows
// gone), every other file of the patch carried over.
func TestRestoreAndDeleteSounds(t *testing.T) {
	root := t.TempDir()
	old := pendingRoot
	pendingRoot = func() string { return root }
	defer func() { pendingRoot = old }()
	fire := testWAV(1, 16, 100)
	dir := soundClient(t, fire)
	mine := testWAV(1, 16, 300)
	replace, err := PlanSoundReplace(dir, `Sound\Doodad\Fire.wav`, mine)
	if err != nil {
		t.Fatal(err)
	}
	imported, res, err := PlanSoundImport(dir, "MyTheme.mp3", []byte("ID3 not really"), SoundImport{Name: "MyTheme", Kind: "music", Volume: 0.5})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InstallPatch(dir, append(replace, imported...)); err != nil {
		t.Fatal(err)
	}
	theme := `Sound\Meld\MyTheme.mp3`
	states, err := ReadPatchFileStates(dir, []string{`Sound/Doodad/Fire.wav`, theme, `Sound\Doodad\Missing.wav`})
	if err != nil {
		t.Fatal(err)
	}
	want := []PatchFileState{{Path: `Sound\Doodad\Fire.wav`, InPatch: true, InClient: true}, {Path: theme, InPatch: true}, {Path: `Sound\Doodad\Missing.wav`}}
	if !slices.Equal(states, want) {
		t.Fatalf("states %+v", states)
	}
	read := func(path string) []byte {
		set, err := mpq.OpenDataDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer set.Close()
		b, _ := set.ReadFile(path)
		return b
	}
	if !bytes.Equal(read(`Sound\Doodad\Fire.wav`), mine) {
		t.Fatal("the replace doesn't read")
	}

	// Restore: the client's own file reads again; the import stays.
	if _, err := RemovePatchFiles(dir, []string{`Sound\Doodad\Fire.wav`}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(read(`Sound\Doodad\Fire.wav`), fire) {
		t.Error("the client's file doesn't read after the restore")
	}
	if info, err := ReadSoundEntry(dir, res.ID); err != nil || info.Name != "MyTheme" {
		t.Fatalf("the import after the restore: %+v %v", info, err)
	}

	// Delete: the import's file and rows go, a waiting file is taken along, the tables stay in the patch.
	if err := AddPending(dir, []mpq.File{{Name: `Sound\Meld\Other.wav`, Data: mine}}); err != nil {
		t.Fatal(err)
	}
	files, plan, err := PlanSoundDelete(dir, res.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(plan.Files, []string{theme}) || len(plan.Music) != 1 || len(plan.Zones) != 0 {
		t.Errorf("the plan: %+v", plan)
	}
	if _, err := InstallDropping(dir, files, plan.Files); err != nil {
		t.Fatal(err)
	}
	if states, _ := ReadPatchFileStates(dir, []string{theme, `Sound\Meld\Other.wav`, SoundEntriesPath}); !slices.Equal(states, []PatchFileState{{Path: theme}, {Path: `Sound\Meld\Other.wav`, InPatch: true}, {Path: SoundEntriesPath, InPatch: true, InClient: true}}) {
		t.Errorf("after the delete: %+v", states)
	}
	if _, err := ReadSoundEntry(dir, res.ID); err == nil {
		t.Error("the deleted sound reads")
	}
	if info, err := ReadSoundEntry(dir, 501); err != nil || info.Name != "Zone-Forest Day" {
		t.Errorf("501 after the delete: %+v %v", info, err)
	}
}
