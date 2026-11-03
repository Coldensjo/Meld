package mpq

import (
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/clientbuild"
)

// layout writes a Data folder under a new client root: each archive (a path under Data, "enUS/..."
// for the locale folder) holding the files named, each file's bytes the archive's name, so a read
// tells which archive won. It returns the Data folder.
func layout(t *testing.T, archives map[string][]string) string {
	t.Helper()
	data := filepath.Join(t.TempDir(), "Data")
	for name, files := range archives {
		path := filepath.Join(data, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		var fs []File
		for _, f := range files {
			fs = append(fs, File{Name: f, Data: []byte(name)})
		}
		if err := os.WriteFile(path, Write(fs), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return data
}

// reads checks which archive each file is read from, with Meld's patch and without it.
func reads(t *testing.T, s *Set, want map[string][2]string) {
	t.Helper()
	for name, w := range want {
		if got, err := s.ReadFile(name); err != nil || string(got) != w[0] {
			t.Errorf("ReadFile(%s) = %q, %v; want %q", name, got, err, w[0])
		}
		if got, err := s.ReadFileExcept(name, s.PatchName()); err != nil || string(got) != w[1] {
			t.Errorf("ReadFileExcept(%s, %s) = %q, %v; want %q", name, s.PatchName(), got, err, w[1])
		}
	}
}

const (
	mapDBC  = `DBFilesClient\Map.dbc`
	areaDBC = `DBFilesClient\AreaTable.dbc`
	tile    = `World\Maps\Azeroth\Azeroth_31_29.adt`
	tex     = `Tileset\Grass.blp`
	sound   = `Sound\Music\Zone.mp3`
)

// A 3.3.5a Data folder opens its locale folder too, in the client's order (#1065): Data's patch-2
// and patch-3 beat the locale patches, those beat patch.MPQ, every patch beats the base archives, and
// Meld's patch-4.MPQ beats them all, DBCs included.
func TestOpenDataDirWotLKOrder(t *testing.T) {
	data := layout(t, map[string][]string{
		"common.MPQ":                     {tile, tex},
		"common-2.MPQ":                   {tile},
		"lichking.MPQ":                   {tile, sound},
		"expansion.MPQ":                  {sound},
		"patch.MPQ":                      {mapDBC, areaDBC},
		"patch-2.MPQ":                    {tex},
		"patch-3.MPQ":                    {areaDBC},
		"enUS/locale-enUS.MPQ":           {mapDBC, areaDBC, tex},
		"enUS/lichking-locale-enUS.MPQ":  {mapDBC},
		"enUS/expansion-locale-enUS.MPQ": {mapDBC},
		"enUS/patch-enUS.MPQ":            {mapDBC},
		"enUS/patch-enUS-2.MPQ":          {mapDBC, areaDBC},
		"enUS/patch-enUS-3.MPQ":          {mapDBC},
		"patch-4.MPQ":                    {mapDBC, tile},
		// A folder without its locale-<name>.MPQ is no locale folder.
		"deDE/patch-deDE-9.MPQ": {mapDBC, tile},
	})
	s, err := OpenDataDir(data)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.Build() != clientbuild.WotLK || s.PatchName() != "patch-4.MPQ" {
		t.Fatalf("build %v, patch %s; want 3.3.5a and patch-4.MPQ", s.Build(), s.PatchName())
	}
	if n := len(s.Archives()); n != 14 {
		t.Errorf("opened %d archives, want 14 (the deDE folder left out)", n)
	}
	reads(t, s, map[string][2]string{
		mapDBC:  {"patch-4.MPQ", "enUS/patch-enUS-3.MPQ"},
		areaDBC: {"patch-3.MPQ", "patch-3.MPQ"},
		tile:    {"patch-4.MPQ", "lichking.MPQ"},
		tex:     {"patch-2.MPQ", "patch-2.MPQ"},
		sound:   {"expansion.MPQ", "expansion.MPQ"},
	})
}

// A 2.4.3 Data folder (common.MPQ and expansion.MPQ, the locale folder named by WTF\Config.wtf) is
// read in the same order, with Meld's patch named patch-3.MPQ.
func TestOpenDataDirTBCOrder(t *testing.T) {
	data := layout(t, map[string][]string{
		"common.MPQ":                     {tile, tex},
		"expansion.MPQ":                  {tile},
		"patch.MPQ":                      {mapDBC},
		"patch-2.MPQ":                    {tex, areaDBC},
		"enGB/locale-enGB.MPQ":           {mapDBC, areaDBC},
		"enUS/locale-enUS.MPQ":           {mapDBC, areaDBC},
		"enUS/expansion-locale-enUS.MPQ": {areaDBC},
		"enUS/patch-enUS.MPQ":            {mapDBC},
		"enUS/patch-enUS-2.MPQ":          {mapDBC},
		"patch-3.MPQ":                    {mapDBC},
	})
	wtf := filepath.Join(filepath.Dir(data), "WTF")
	if err := os.MkdirAll(wtf, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wtf, "Config.wtf"), []byte("SET gxResolution \"1024x768\"\r\nSET locale \"enUS\"\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := OpenDataDir(data)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.Build() != clientbuild.TBC || s.PatchName() != "patch-3.MPQ" {
		t.Fatalf("build %v, patch %s; want 2.4.3 and patch-3.MPQ", s.Build(), s.PatchName())
	}
	reads(t, s, map[string][2]string{
		mapDBC:  {"patch-3.MPQ", "enUS/patch-enUS-2.MPQ"},
		areaDBC: {"patch-2.MPQ", "patch-2.MPQ"},
		tile:    {"expansion.MPQ", "expansion.MPQ"},
		tex:     {"patch-2.MPQ", "patch-2.MPQ"},
	})
}

// A 1.12 client opens only its Data folder's archives, as before: a locale-like folder in it is
// left alone.
func TestOpenDataDirVanillaIgnoresSubfolders(t *testing.T) {
	data := layout(t, map[string][]string{
		"dbc.MPQ":              {mapDBC},
		"terrain.MPQ":          {tile},
		"patch.MPQ":            {mapDBC},
		"patch-2.MPQ":          {tile},
		"enUS/locale-enUS.MPQ": {mapDBC, tile},
		"patch-3.MPQ":          {tile},
	})
	s, err := OpenDataDir(data)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.Build() != clientbuild.Vanilla || s.PatchName() != "patch-3.MPQ" || len(s.Archives()) != 5 {
		t.Fatalf("build %v, patch %s, %d archives; want 1.12.1, patch-3.MPQ and 5", s.Build(), s.PatchName(), len(s.Archives()))
	}
	reads(t, s, map[string][2]string{
		mapDBC: {"patch.MPQ", "patch.MPQ"},
		tile:   {"patch-3.MPQ", "patch-2.MPQ"},
	})
}
