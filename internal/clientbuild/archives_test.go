package clientbuild

import (
	"os"
	"path/filepath"
	"testing"
)

// Meld's patch is patch-3.MPQ but in 3.3.5a, which ships its own patch-3.MPQ (#1065).
func TestPatchName(t *testing.T) {
	for b, want := range map[Build]string{Vanilla: "patch-3.MPQ", TBC: "patch-3.MPQ", WotLK: "patch-4.MPQ", Unknown: "patch-3.MPQ"} {
		if got := b.PatchName(); got != want {
			t.Errorf("%v.PatchName() = %s, want %s", b, got, want)
		}
	}
	if got := PatchFor(client(t, nil, "common.MPQ", "common-2.MPQ", "lichking.MPQ")); got != "patch-4.MPQ" {
		t.Errorf("PatchFor(a 3.3.5a Data folder) = %s, want patch-4.MPQ", got)
	}
}

// The locale folder is the one holding its locale-<name>.MPQ; Config.wtf's SET locale picks among
// several, else the first by name.
func TestLocale(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if got := Locale(data); got != "" {
		t.Errorf("Locale of a missing folder = %q", got)
	}
	for _, f := range []string{"enUS/locale-enUS.MPQ", "enGB/LOCALE-ENGB.mpq", "deDE/patch-deDE.MPQ", "Interface/locale-Interface.txt"} {
		path := filepath.Join(data, filepath.FromSlash(f))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got := Locale(data); got != "enGB" {
		t.Errorf("Locale without Config.wtf = %q, want enGB", got)
	}
	if err := os.MkdirAll(filepath.Join(root, "WTF"), 0o755); err != nil {
		t.Fatal(err)
	}
	for conf, want := range map[string]string{"SET locale \"enUS\"\n": "enUS", "set LOCALE \"deDE\"\n": "enGB", "SET realmList \"x\"\n": "enGB"} {
		if err := os.WriteFile(filepath.Join(root, "WTF", "Config.wtf"), []byte(conf), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := Locale(data); got != want {
			t.Errorf("Locale with Config.wtf %q = %q, want %s", conf, got, want)
		}
	}
}
