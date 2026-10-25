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

// TestClientWMOOnlyWDT rebuilds Blackfathom Deeps' WDT (a WMO-only map) from its own building's
// placement: the result is the client's file byte for byte. It needs WOW_DIR.
func TestClientWMOOnlyWDT(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := set.ReadFile(`World\Maps\Blackfathom\Blackfathom.wdt`)
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	var w GlobalWMO
	for o := 0; o+8 <= len(b); {
		id := string([]byte{b[o+3], b[o+2], b[o+1], b[o]})
		size := int(binary.LittleEndian.Uint32(b[o+4:]))
		p := b[o+8 : o+8+size]
		switch id {
		case "MWMO":
			w.Name = string(bytes.TrimRight(p, "\x00"))
		case "MODF":
			get3 := func(at int) (v [3]float32) {
				for k := 0; k < 3; k++ {
					v[k] = math.Float32frombits(binary.LittleEndian.Uint32(p[at+4*k:]))
				}
				return
			}
			w.Position, w.Rotation, w.Min, w.Max = get3(8), get3(20), get3(32), get3(44)
			w.DoodadSet = binary.LittleEndian.Uint16(p[58:])
		}
		o += 8 + size
	}
	got, err := BuildWMOOnlyWDT(b, w)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, b) {
		t.Fatalf("Blackfathom's WDT rebuilt is %d bytes and differs from the client's %d", len(got), len(b))
	}
}

// TestExportWMOOnlyMap exports a map that is one of the client's buildings: the patch holds its WDT
// with the global-WMO flag, the building's name and a placement at the world's middle (0 on X and Z,
// whatever its spot in the editor, #272) at its height, with its bounds round it, and no tiles or WDL.
// It needs WOW_DIR.
func TestExportWMOOnlyMap(t *testing.T) {
	dir := testclient.DataDir(t)
	readDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	patchDir := t.TempDir()
	name := `World\wmo\Dungeon\KL_Blackfathom\Blackfathom_instance.wmo`
	res, err := ExportMap(readDir, patchDir, "", MapSpec{Dir: "MeldVault", MapID: 1902, Global: &ObjectSpec{Type: "wmo:" + name, X: 100, Y: 20, Z: 200, Scale: 1}})
	if err != nil {
		t.Fatal(err)
	}
	arch, err := mpq.Open(res.Patch)
	if err != nil {
		t.Fatal(err)
	}
	defer arch.Close()
	wdt, err := arch.ReadFile(`World\Maps\MeldVault\MeldVault.wdt`)
	if err != nil {
		t.Fatal(err)
	}
	if arch.Has(`World\Maps\MeldVault\MeldVault.wdl`) || res.Tiles != 0 {
		t.Fatal("a WMO-only map got a horizon or tiles")
	}
	var flags uint32
	var mwmo string
	var pos, lo, hi [3]float32
	for o := 0; o+8 <= len(wdt); {
		id := string([]byte{wdt[o+3], wdt[o+2], wdt[o+1], wdt[o]})
		size := int(binary.LittleEndian.Uint32(wdt[o+4:]))
		p := wdt[o+8 : o+8+size]
		switch id {
		case "MPHD":
			flags = binary.LittleEndian.Uint32(p)
		case "MWMO":
			mwmo = string(bytes.TrimRight(p, "\x00"))
		case "MODF":
			for k := 0; k < 3; k++ {
				pos[k] = math.Float32frombits(binary.LittleEndian.Uint32(p[8+4*k:]))
				lo[k] = math.Float32frombits(binary.LittleEndian.Uint32(p[32+4*k:]))
				hi[k] = math.Float32frombits(binary.LittleEndian.Uint32(p[44+4*k:]))
			}
		}
		o += 8 + size
	}
	if flags&1 == 0 || mwmo != name || pos != [3]float32{0, 20, 0} || hi[0]-lo[0] < 50 || lo[0] > 0 || hi[0] < 0 || lo[2] > 0 || hi[2] < 0 {
		t.Fatalf("WDT flags %#x, building %q at %v, bounds %v to %v", flags, mwmo, pos, lo, hi)
	}
}

// wdtTemplate is a bare 1.12 WDT header: MVER and an MPHD of zeroes.
func wdtTemplate() []byte {
	var b []byte
	b = append(b, 'R', 'E', 'V', 'M', 4, 0, 0, 0, 18, 0, 0, 0)
	b = append(b, 'D', 'H', 'P', 'M', 32, 0, 0, 0)
	return append(b, make([]byte, 32)...)
}

// TestParseGlobalWMO reads back the building BuildWMOOnlyWDT places, and finds none in a map of tiles.
func TestParseGlobalWMO(t *testing.T) {
	want := GlobalWMO{Name: `World\wmo\Dungeon\Test\Test.wmo`, Rotation: [3]float32{0, 180, 0},
		Min: [3]float32{-150, -35, -200}, Max: [3]float32{150, 15, 8}, DoodadSet: 2}
	b, err := BuildWMOOnlyWDT(wdtTemplate(), want)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := wmoOnlyBuilding(b)
	if !ok || got != want {
		t.Fatalf("read %+v (%v), want %+v", got, ok, want)
	}
	tiles, err := BuildWDT(wdtTemplate(), func(x, y int) bool { return x == 3 && y == 4 })
	if err != nil {
		t.Fatal(err)
	}
	if !wdtHasTiles(tiles) || wdtHasTiles(b) {
		t.Fatal("wdtHasTiles is wrong")
	}
	if _, ok := wmoOnlyBuilding(tiles); ok {
		t.Fatal("a map of tiles read as a single building")
	}
}

// TestGlobalBlock picks the tiles round a building at the map's middle: the Stockade's bounds lie
// either side of tile 32's corner, so the block is tiles 31 and 32 each way.
func TestGlobalBlock(t *testing.T) {
	x, y, size := GlobalBlock(GlobalWMO{Min: [3]float32{-151.8, -35.7, -197.3}, Max: [3]float32{150.3, 15.2, 8.1}})
	if x != 31 || y != 31 || size != 2 {
		t.Fatalf("block %d,%d size %d, want 31,31 size 2", x, y, size)
	}
	// Molten Core lies east and north of the middle: three tiles across, so the block is square at 3.
	x, y, size = GlobalBlock(GlobalWMO{Min: [3]float32{271.3, -233.5, -1333.1}, Max: [3]float32{1255, 72.9, -489.9}})
	if x != 32 || y != 29 || size != 3 {
		t.Fatalf("block %d,%d size %d, want 32,29 size 3", x, y, size)
	}
}

// TestClientWMOOnlyRegion opens the Stormwind Stockade (a WMO-only map) as a region and saves it back:
// unchanged it writes nothing, a new doodad set writes the WDT with it, and moving the building or
// adding a model is refused. It needs WOW_DIR.
func TestClientWMOOnlyRegion(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	v, err := ReadWMOOnlyRegion(dataDir, "StormwindJail")
	if err != nil {
		t.Fatal(err)
	}
	if !v.WMOOnly || v.X != 31 || v.Y != 31 || v.Size != 2 || len(v.Objects) != 1 || v.Objects[0].UID != GlobalUID {
		t.Fatalf("region %d,%d size %d, WMO-only %v, objects %+v", v.X, v.Y, v.Size, v.WMOOnly, v.Objects)
	}
	b := v.Objects[0]
	// The building's origin is the map's middle: tile 32's corner, one tile into the block.
	if math.Abs(float64(b.X)-533.33) > 0.1 || math.Abs(float64(b.Z)-533.33) > 0.1 || v.Heights[0] >= -35 {
		t.Fatalf("building at %v,%v, ground at %v", b.X, b.Z, v.Heights[0])
	}
	edit := func(objects ...ObjectView) RegionEdit {
		return RegionEdit{MapName: v.MapName, X: v.X, Y: v.Y, Size: v.Size, Heights: EncodeHeights(v.Heights), Objects: objects}
	}
	files, res, err := RegionChanges(dataDir, edit(b))
	if err != nil || len(files) != 0 || !res.Building || res.Tiles != 0 || res.Files != 0 {
		t.Fatalf("unchanged: %d files, %+v, %v", len(files), res, err)
	}
	withSet := b
	withSet.Type += "?set=1"
	files, err = BuildRegion(dataDir, edit(withSet))
	if err != nil || len(files) != 1 || !strings.HasSuffix(files[0].Name, ".wdt") {
		t.Fatalf("new doodad set: %d files, %v", len(files), err)
	}
	if w, ok := wmoOnlyBuilding(files[0].Data); !ok || w.DoodadSet != 1 || w.Position != [3]float32{} {
		t.Fatalf("new doodad set wrote %+v", w)
	}
	// What Launch and Compile to Server ask (RegionPending): the one file the client lacks.
	if _, res, err = RegionChanges(dataDir, edit(withSet)); err != nil || res.Files != 1 || !res.WDT {
		t.Fatalf("new doodad set pending: %+v, %v", res, err)
	}
	moved := b
	moved.X += 5
	if _, err := BuildRegion(dataDir, edit(moved)); err == nil {
		t.Fatal("moving the building was not refused")
	}
	if _, err := BuildRegion(dataDir, edit(b, ObjectView{Type: `m2:World\Generic\Tree.m2`, Scale: 1})); err == nil {
		t.Fatal("a model besides the building was not refused")
	}
}
