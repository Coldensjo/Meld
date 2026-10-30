package vmangos

import (
	"encoding/binary"
	"maps"
	"slices"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// testWAV is a PCM WAV of n samples of bits bits (tag the format tag).
func testWAV(tag, bits uint16, n int) []byte {
	data := make([]byte, n*int(bits)/8)
	b := []byte("RIFF")
	b = binary.LittleEndian.AppendUint32(b, uint32(36+len(data)))
	b = append(b, "WAVEfmt "...)
	b = binary.LittleEndian.AppendUint32(b, 16)
	b = binary.LittleEndian.AppendUint16(b, tag)
	b = binary.LittleEndian.AppendUint16(b, 1)
	b = binary.LittleEndian.AppendUint32(b, 22050)
	b = binary.LittleEndian.AppendUint32(b, 22050*uint32(bits)/8)
	b = binary.LittleEndian.AppendUint16(b, bits/8)
	b = binary.LittleEndian.AppendUint16(b, bits)
	b = append(b, "data"...)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(data)))
	return append(b, data...)
}

// TestSoundFormat takes PCM WAVs and MP3s and refuses compressed or odd WAVs and other files.
func TestSoundFormat(t *testing.T) {
	for _, c := range []struct {
		name string
		data []byte
		want string
	}{
		{"16-bit PCM", testWAV(1, 16, 100), "wav"},
		{"8-bit PCM", testWAV(1, 8, 100), "wav"},
		{"ID3 MP3", []byte("ID3\x03\x00\x00\x00\x00\x00\x00"), "mp3"},
		{"bare MP3 frame", []byte{0xFF, 0xFB, 0x90, 0x64}, "mp3"},
		{"ADPCM", testWAV(2, 16, 100), ""},
		{"24-bit", testWAV(1, 24, 100), ""},
		{"no data", testWAV(1, 16, 100)[:36], ""},
		{"a PNG", []byte("\x89PNG\r\n\x1a\n...."), ""},
	} {
		got, err := SoundFormat(c.data)
		if got != c.want || (c.want == "") != (err != nil) {
			t.Errorf("%s: %q, %v", c.name, got, err)
		}
	}
}

// TestSoundFileName keeps a .wav or .mp3 name's letters, digits, _ and -, spaces as underscores.
func TestSoundFileName(t *testing.T) {
	for in, want := range map[string]string{`C:\x\My Loop.WAV`: "My_Loop.wav", "/a/b/theme-2.mp3": "theme-2.mp3", "bell.ogg": "", "bad!name.wav": "", ".wav": ""} {
		got, err := SoundFileName(in)
		if got != want || (want == "") != (err != nil) {
			t.Errorf("%s: %q, %v", in, got, err)
		}
	}
}

// testZoneTables are a SoundEntries of two sounds, a ZoneMusic, a ZoneIntroMusicTable and a
// SoundAmbience that play them, and a GameObjectDisplayInfo with one in a slot, by name.
func testZoneTables(t *testing.T) map[string][]byte {
	sound := func(id int, name, file, dir string) []any {
		row := make([]any, 29)
		for i := range row {
			row[i] = 0
		}
		row[0], row[1], row[2], row[3], row[13], row[23] = id, 28, name, file, 1, dir
		return row
	}
	return map[string][]byte{
		"SoundEntries":          testDBC(t, 29, sound(501, "Zone-Forest Day", "DayForest01.mp3", `Sound\Music\ZoneMusic\Forest`), sound(502, "BeachDay", "BeachDay.wav", `Sound\Ambience\ZoneAmbience`)).data,
		"ZoneMusic":             testDBC(t, 8, []any{1, "Zone-Forest", 180000, 180000, 300000, 300000, 501, 501}).data,
		"ZoneIntroMusicTable":   testDBC(t, 5, []any{61, "Forest Intro", 501, 1, 60}).data,
		"SoundAmbience":         testDBC(t, 3, []any{24, 502, 0}).data,
		"GameObjectDisplayInfo": testDBC(t, objectDisplayFields, []any{10, `World\Goober\G_Brazier01.mdx`, 0, 0, 502}).data,
		// Not read by the Sound tool; the Zones dialog's tables (zoneSoundTables) need it.
		"SoundProviderPreferences": testDBC(t, 24, []any{1, "Outdoors"}).data,
	}
}

// TestSoundEntryInfo reads a sound's fields, files and what plays it.
func TestSoundEntryInfo(t *testing.T) {
	tables := testZoneTables(t)
	got, err := soundEntryInfo(tables, 501)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Zone-Forest Day" || got.Type != 28 || got.Dir != `Sound\Music\ZoneMusic\Forest` || !slices.Equal(got.Files, []string{`Sound\Music\ZoneMusic\Forest\DayForest01.mp3`}) || got.Imported {
		t.Errorf("501: %+v", got)
	}
	if len(got.Music) != 1 || got.Music[0].Name != "Zone-Forest" || len(got.Intro) != 1 || len(got.Ambience) != 0 || got.Displays != 0 {
		t.Errorf("501's uses: %+v", got)
	}
	beach, err := soundEntryInfo(tables, 502)
	if err != nil || len(beach.Ambience) != 1 || beach.Ambience[0].ID != 24 || beach.Displays != 1 || len(beach.Music) != 0 {
		t.Errorf("502: %+v %v", beach, err)
	}
	if _, err := soundEntryInfo(tables, 999); err == nil {
		t.Error("sound 999 read")
	}
}

// applyImport is tables with the changed ones of an import put in.
func applyImport(tables, changed map[string][]byte) map[string][]byte {
	out := maps.Clone(tables)
	maps.Copy(out, changed)
	return out
}

// TestImportSoundRows adds each kind's row, a zone row for music and ambience that the Zones dialog
// lists, updates an earlier import of the same file in place, and refuses a taken name, a bad
// volume or an unknown kind.
func TestImportSoundRows(t *testing.T) {
	tables := testZoneTables(t)
	changed, res, err := importSoundRows(tables, "MyTheme.mp3", SoundImport{Name: "MyTheme", Kind: "music", Volume: 0.5})
	if err != nil {
		t.Fatal(err)
	}
	if res.id != 503 || res.zone != 2 || res.reused || len(changed) != 2 {
		t.Fatalf("music: %+v, %d tables", res, len(changed))
	}
	after := applyImport(tables, changed)
	info, err := soundEntryInfo(after, 503)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "MyTheme" || info.Type != 28 || info.Volume != 0.5 || !info.Imported || !slices.Equal(info.Files, []string{`Sound\Meld\MyTheme.mp3`}) || len(info.Music) != 1 || info.Music[0].ID != 2 {
		t.Errorf("the imported music: %+v", info)
	}
	z, err := zoneSoundTables(after)
	if err != nil {
		t.Fatal(err)
	}
	if last := z.Music[len(z.Music)-1]; last != (SoundOption{ID: 2, Name: "MyTheme", File: `Sound\Meld\MyTheme.mp3`}) {
		t.Errorf("the Zones dialog's music: %+v", z.Music)
	}
	// The old rows keep their names and files.
	if old, _ := soundEntryInfo(after, 501); old.Name != "Zone-Forest Day" || old.Files[0] != `Sound\Music\ZoneMusic\Forest\DayForest01.mp3` {
		t.Errorf("501 changed: %+v", old)
	}

	// Imported again (as ambience, louder): the same row, and an ambience row besides the music one.
	again, res2, err := importSoundRows(after, "mytheme.MP3", SoundImport{Name: "MyTheme Night", Kind: "ambience", Volume: 0.8})
	if err != nil {
		t.Fatal(err)
	}
	if res2.id != 503 || !res2.reused || res2.zone != 25 {
		t.Errorf("again: %+v", res2)
	}
	after2 := applyImport(after, again)
	se, _ := parseDBC(after2["SoundEntries"])
	if se.records != 3 {
		t.Errorf("%d sounds after the second import", se.records)
	}
	if info, _ := soundEntryInfo(after2, 503); info.Name != "MyTheme Night" || info.Type != 50 || info.Volume != 0.8 || len(info.Ambience) != 1 || len(info.Files) != 1 {
		t.Errorf("the reimport: %+v", info)
	}

	// A one-shot adds only its SoundEntries row.
	if ch, res, err := importSoundRows(tables, "Clank.wav", SoundImport{Name: "Clank", Kind: "sound", Volume: 1}); err != nil || len(ch) != 1 || res.zone != 0 {
		t.Errorf("a one-shot: %v %+v %v", len(ch), res, err)
	}
	for _, bad := range []SoundImport{
		{Name: "beachday", Kind: "sound", Volume: 0.5},
		{Name: "", Kind: "sound", Volume: 0.5},
		{Name: `Say "hi"`, Kind: "sound", Volume: 0.5},
		{Name: "Loud", Kind: "sound", Volume: 1.5},
		{Name: "Quiet", Kind: "sound", Volume: 0},
		{Name: "Odd", Kind: "voice", Volume: 0.5},
	} {
		if _, _, err := importSoundRows(tables, "New.wav", bad); err == nil {
			t.Errorf("%+v was taken", bad)
		}
	}
}

// TestClientSoundImport imports a music sound into the client's own tables: they parse as the
// client's reader reads them, every old row reads as before, the new sound and its ZoneMusic row are
// listed for the pickers, and the client's sound files are listed and read. It needs WOW_DIR.
func TestClientSoundImport(t *testing.T) {
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
	tables := map[string][]byte{}
	for name, path := range soundTablePaths {
		if tables[name], err = set.ReadFile(path); err != nil {
			t.Fatal(err)
		}
	}
	if tables["SoundProviderPreferences"], err = set.ReadFile(`DBFilesClient\SoundProviderPreferences.dbc`); err != nil {
		t.Fatal(err)
	}
	before, err := soundList(tables["SoundEntries"])
	if err != nil {
		t.Fatal(err)
	}
	changed, res, err := importSoundRows(tables, "MeldTestTheme.mp3", SoundImport{Name: "MeldTestTheme", Kind: "music", Volume: 0.7})
	if err != nil {
		t.Fatal(err)
	}
	after := applyImport(tables, changed)
	list, err := soundList(after["SoundEntries"])
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != len(before)+1 || !slices.Equal(list[:len(before)], before) {
		t.Fatalf("%d sounds after, %d before, or an old one changed", len(list), len(before))
	}
	if last := list[len(list)-1]; last != (SoundOption{ID: res.id, Name: "MeldTestTheme", File: `Sound\Meld\MeldTestTheme.mp3`}) {
		t.Errorf("the new sound: %+v", last)
	}
	// Every field of every old row is as it was, strings by their text.
	ob, _ := parseDBC(tables["SoundEntries"])
	nb, _ := parseDBC(after["SoundEntries"])
	strField := map[int]bool{seName: true, seDir: true}
	for f := seFile; f < seFile+soundFiles; f++ {
		strField[f] = true
	}
	for r := 0; r < ob.records; r++ {
		for f := 0; f < ob.fields; f++ {
			if strField[f] && ob.str(r, f) != nb.str(r, f) || !strField[f] && ob.u32(r, f) != nb.u32(r, f) {
				t.Fatalf("row %d field %d changed", r, f)
			}
		}
	}
	z, err := zoneSoundTables(after)
	if err != nil {
		t.Fatal(err)
	}
	if last := z.Music[len(z.Music)-1]; last.ID != res.zone || last.Name != "MeldTestTheme" || last.File != `Sound\Meld\MeldTestTheme.mp3` {
		t.Errorf("the Zones dialog's music ends with %+v", last)
	}
	files, err := SoundFileList(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	loop := `Sound\Doodad\CampFireLargeLoop.wav`
	if !slices.ContainsFunc(files, func(f string) bool { return strings.EqualFold(f, loop) }) {
		t.Fatalf("%d sound files, none %s", len(files), loop)
	}
	data, err := set.ReadFile(loop)
	if err != nil {
		t.Fatal(err)
	}
	if f, err := SoundFormat(data); f != "wav" {
		t.Errorf("the client's own %s: %q, %v", loop, f, err)
	}
	t.Logf("sound %d, ZoneMusic %d; %d sound files", res.id, res.zone, len(files))
}
