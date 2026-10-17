package game

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// wdbFile builds a WDB cache: a header, a record per entry (its data the entry's name) and the end marker.
func wdbFile(sig string, entries ...uint32) []byte {
	var b bytes.Buffer
	b.WriteString(sig)
	binary.Write(&b, binary.LittleEndian, []uint32{5875, 0x656e4742, 0x7c, 1})
	for _, e := range entries {
		data := []byte("name" + string(rune('A'+e%26)) + "\x00")
		binary.Write(&b, binary.LittleEndian, []uint32{e, uint32(len(data))})
		b.Write(data)
	}
	b.Write(make([]byte, 8))
	return b.Bytes()
}

func TestForgetPrunesTheClientCaches(t *testing.T) {
	root := t.TempDir()
	wdb := filepath.Join(root, "WDB")
	if err := os.MkdirAll(wdb, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(wdb, creatureCache), wdbFile("BOMW", 6, 240, 16244), 0o644)
	os.WriteFile(filepath.Join(wdb, objectCache), wdbFile("BOGW", 1630, 175656), 0o644)
	os.WriteFile(filepath.Join(wdb, questCache), wdbFile("BOQW", 7, 9666), 0o644)
	other := wdbFile("BDIW", 240)
	os.WriteFile(filepath.Join(wdb, "itemcache.wdb"), other, 0o644)

	var s Stale
	s.AddCreature(240)
	s.AddObject(175656)
	s.AddObject(99) // not cached
	s.AddQuest(9666)
	if err := s.Forget(root, ""); err != nil {
		t.Fatal(err)
	}
	if !s.Empty() {
		t.Error("the entries were kept after a clean forget")
	}
	check := func(name string, want []byte) {
		t.Helper()
		got, err := os.ReadFile(filepath.Join(wdb, name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s:\n got %x\nwant %x", name, got, want)
		}
	}
	check(creatureCache, wdbFile("BOMW", 6, 16244))
	check(objectCache, wdbFile("BOGW", 1630))
	check(questCache, wdbFile("BOQW", 7))
	check("itemcache.wdb", other)
}

func TestForgetDeletesACacheItCantRead(t *testing.T) {
	root := t.TempDir()
	wdb := filepath.Join(root, "WDB")
	os.MkdirAll(wdb, 0o755)
	cut := wdbFile("BOMW", 6, 240)
	cut = cut[:len(cut)-12] // into the last record
	os.WriteFile(filepath.Join(wdb, creatureCache), cut, 0o644)
	var s Stale
	s.AddCreature(240)
	if err := s.Forget(root, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(wdb, creatureCache)); !os.IsNotExist(err) {
		t.Errorf("a cut-short cache was kept: %v", err)
	}
}

func TestForgetWithoutCachesIsFine(t *testing.T) {
	var s Stale
	s.AddObject(1)
	if err := s.Forget(t.TempDir(), t.TempDir()); err != nil {
		t.Fatal(err)
	}
}

func TestForgetPrunesBenillasNameCache(t *testing.T) {
	benilla := t.TempDir()
	dir := filepath.Join(benilla, "benilla-config", "cache")
	os.MkdirAll(dir, 0o755)
	text := "benilla-namecache\t2\t5875\tenGB\tTest\n" +
		"C\t240\t7\t0\t0\t0\t1\t0\t1985\tMarshal Dughan\t\n" +
		"C\t6\t7\t0\t0\t0\t0\t0\t10913\tKobold Vermin\t\n"
	path := filepath.Join(dir, "Test.tsv")
	os.WriteFile(path, []byte(text), 0o644)
	foreign := filepath.Join(dir, "notes.tsv")
	os.WriteFile(foreign, []byte("C\t240\tkeep\n"), 0o644)

	var s Stale
	s.AddCreature(240)
	if err := s.Forget(t.TempDir(), benilla); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if strings.Contains(string(got), "Marshal Dughan") || !strings.Contains(string(got), "Kobold Vermin") ||
		!strings.HasPrefix(string(got), benillaCacheTag) {
		t.Errorf("Benilla's cache is now %q", got)
	}
	if b, _ := os.ReadFile(foreign); string(b) != "C\t240\tkeep\n" {
		t.Errorf("a file that isn't Benilla's name cache changed: %q", b)
	}
}

func TestStartClearsTheCacheBeforeTheGame(t *testing.T) {
	root := t.TempDir()
	wdb := filepath.Join(root, "WDB")
	os.MkdirAll(wdb, 0o755)
	os.WriteFile(filepath.Join(wdb, objectCache), wdbFile("BOGW", 1630), 0o644)
	stale := &Stale{}
	stale.AddObject(1630)
	r := &fakeRunner{running: map[string]bool{}}
	s := Session{ClientRoot: root, Run: r, Stale: stale}
	if err := s.StartGame(); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(wdb, objectCache))
	if !bytes.Equal(got, wdbFile("BOGW")) {
		t.Errorf("the object was left in the cache: %x", got)
	}
	if !stale.Empty() {
		t.Error("the entry was kept")
	}
}
