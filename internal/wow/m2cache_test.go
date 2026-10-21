package wow

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/mpq"
)

// TestPartCacheEvicts keeps the most recently used partsLimit entries.
func TestPartCacheEvicts(t *testing.T) {
	var p partCache
	for i := 0; i < partsLimit; i++ {
		p.put(fmt.Sprint(i), i)
	}
	p.get("0") // 0 is now the most recently used, so 1 goes first
	p.put("new", -1)
	if _, ok := p.get("1"); ok {
		t.Fatal("the least recently used entry was kept")
	}
	for _, k := range []string{"0", "2", "new"} {
		if _, ok := p.get(k); !ok {
			t.Fatalf("%s was evicted", k)
		}
	}
	if p.order.Len() != partsLimit {
		t.Fatalf("%d entries, want %d", p.order.Len(), partsLimit)
	}
}

// TestDoodadsCached reads a doodad once across requests (#500), again after Forget names a model
// and after Open.
func TestDoodadsCached(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	const crate = `World\Generic\Crate.m2`
	if err := os.WriteFile(filepath.Join(data, "patch-3.MPQ"), mpq.Write([]mpq.File{{Name: crate, Data: []byte("not an m2")}}), 0o644); err != nil {
		t.Fatal(err)
	}
	c := NewClient()
	if err := c.Open(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Open("") })
	reads := 0
	c.SetOverlay(func(string) ([]byte, bool) { reads++; return nil, false })

	c.doodadHull(crate)
	c.doodadHull(`world\GENERIC\crate.M2`)
	c.doodadMesh(crate)
	c.doodadMesh(crate)
	if reads != 2 {
		t.Fatalf("%d reads, want 2: one for the hull, one for the mesh", reads)
	}
	c.Forget(`World/Generic/Other.blp`)
	c.doodadHull(crate)
	if reads != 2 {
		t.Fatalf("%d reads: a texture write dropped the parsed doodads", reads)
	}
	c.Forget(`World/Generic/Crate.m2`)
	c.doodadHull(crate)
	if reads != 3 {
		t.Fatalf("%d reads, want 3: a model write keeps the parsed doodads", reads)
	}
	if err := c.Open(root); err != nil {
		t.Fatal(err)
	}
	c.SetOverlay(func(string) ([]byte, bool) { reads++; return nil, false })
	c.doodadHull(crate)
	if reads != 4 {
		t.Fatalf("%d reads, want 4: Open kept the parsed doodads", reads)
	}
}
