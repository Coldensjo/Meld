package wow

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"Meld/internal/mpq"
)

// testM2 is a vanilla M2 header whose texture table holds the hardcoded textures named.
func testM2(textures ...string) []byte {
	b := make([]byte, m2HeaderSize)
	copy(b, "MD20")
	binary.LittleEndian.PutUint32(b[4:], 256)
	binary.LittleEndian.PutUint32(b[0x5C:], uint32(len(textures)))
	binary.LittleEndian.PutUint32(b[0x60:], uint32(len(b)))
	names := len(b) + 16*len(textures)
	recs := make([]byte, 0, 16*len(textures))
	var blob []byte
	for _, t := range textures {
		recs = binary.LittleEndian.AppendUint32(recs, 0)
		recs = binary.LittleEndian.AppendUint32(recs, 0)
		recs = binary.LittleEndian.AppendUint32(recs, uint32(len(t)+1))
		recs = binary.LittleEndian.AppendUint32(recs, uint32(names+len(blob)))
		blob = append(append(blob, t...), 0)
	}
	return append(append(b, recs...), blob...)
}

// testWMO is a WMO root with one group, one material on texture and one doodad of model.
func testWMO(texture, model string) []byte {
	mohd := make([]byte, 64)
	binary.LittleEndian.PutUint32(mohd[4:], 1)
	momt := make([]byte, 64)
	modd := make([]byte, 40)
	mods := make([]byte, 32)
	copy(mods, "Set_$DefaultGlobal")
	binary.LittleEndian.PutUint32(mods[24:], 1)
	b := iffChunk("MVER", le(17))
	b = append(b, iffChunk("MOHD", mohd)...)
	b = append(b, iffChunk("MOTX", append([]byte(texture), 0))...)
	b = append(b, iffChunk("MOMT", momt)...)
	b = append(b, iffChunk("MODN", append([]byte(model), 0))...)
	b = append(b, iffChunk("MODS", mods)...)
	return append(b, iffChunk("MODD", modd)...)
}

// openTestClient writes files into a client folder's archive and opens it.
func openTestClient(t *testing.T, files ...mpq.File) *Client {
	t.Helper()
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, "base.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	c := NewClient()
	if err := c.Open(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Open("") })
	return c
}

func TestPlanImport(t *testing.T) {
	file := func(name, data string) mpq.File { return mpq.File{Name: name, Data: []byte(data)} }
	tree := testM2(`World\A\Bark.blp`, `World\A\Leaves.blp`)
	src := openTestClient(t,
		mpq.File{Name: `World\A\Tree.m2`, Data: tree},
		file(`World\A\Bark.blp`, "bark, theirs"),
		file(`World\A\Leaves.blp`, "leaves"),
		mpq.File{Name: `World\A\Hut.wmo`, Data: testWMO(`World\A\Wall.blp`, `World\A\Tree.mdx`)},
		file(`World\A\Hut_000.wmo`, "group"),
		file(`World\A\Wall.blp`, "wall"),
		file(`Tileset\A\Grass.blp`, "grass"),
		file(`Tileset\A\Grass_s.blp`, "grass sheen"),
		mpq.File{Name: `World\A\Rock.m2`, Data: testM2()},
		mpq.File{Name: `World\A\Clash.m2`, Data: testM2(`World\A\Nowhere.blp`)},
	)
	dst := openTestClient(t,
		file(`World\A\Bark.blp`, "bark, ours"),
		mpq.File{Name: `World\A\Rock.m2`, Data: testM2()},
		mpq.File{Name: `World\A\Clash.m2`, Data: testM2()},
	)

	plan, err := PlanImport(src, dst, []string{`World\A\Hut.wmo`, `World/A/Tree.m2`, `Tileset\A\Grass.blp`, `World\A\Rock.m2`, `World\A\Clash.m2`, `World\A\Gone.m2`})
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	var bytes int64
	for _, f := range plan.Files {
		names = append(names, strings.ToLower(f.Name))
		bytes += int64(len(f.Data))
	}
	sort.Strings(names)
	// The hut brings its group, its texture and its doodad with the doodad's leaves; the bark the
	// current client has a copy of is kept.
	want := []string{`tileset\a\grass.blp`, `tileset\a\grass_s.blp`, `world\a\hut.wmo`, `world\a\hut_000.wmo`, `world\a\leaves.blp`, `world\a\tree.m2`, `world\a\wall.blp`}
	if !reflect.DeepEqual(names, want) {
		t.Errorf("files %v, want %v", names, want)
	}
	if plan.Bytes != bytes {
		t.Errorf("bytes %d, want %d", plan.Bytes, bytes)
	}
	// The tree came with the hut.
	if want := []string{`World\A\Hut.wmo`, `World\A\Tree.m2`, `Tileset\A\Grass.blp`}; !reflect.DeepEqual(plan.Imported, want) {
		t.Errorf("imported %v, want %v", plan.Imported, want)
	}
	if want := []string{`World\A\Rock.m2`}; !reflect.DeepEqual(plan.Present, want) {
		t.Errorf("present %v, want %v", plan.Present, want)
	}
	if want := []string{`World\A\Bark.blp`}; !reflect.DeepEqual(plan.Kept, want) {
		t.Errorf("kept %v, want %v", plan.Kept, want)
	}
	if len(plan.Refused) != 2 || !strings.HasPrefix(plan.Refused[0], `World\A\Clash.m2: the current client has a different file`) || !strings.HasPrefix(plan.Refused[1], `World\A\Gone.m2: not in the other client`) {
		t.Errorf("refused %q", plan.Refused)
	}
	if len(plan.Missing) != 0 {
		t.Errorf("missing %v, want none", plan.Missing)
	}

	// A texture neither client has is reported, and the model still comes.
	src2 := openTestClient(t, mpq.File{Name: `World\B\Lamp.m2`, Data: testM2(`World\B\Glow.blp`)})
	plan, err = PlanImport(src2, dst, []string{`World\B\Lamp.m2`})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Files) != 1 || !reflect.DeepEqual(plan.Missing, []string{`World\B\Glow.blp`}) {
		t.Errorf("files %d, missing %v", len(plan.Files), plan.Missing)
	}

	if _, err := PlanImport(dst, dst, nil); err == nil {
		t.Error("a client imported into itself")
	}
}
