package vmangos

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// TestClientWMOOnlyWDT rebuilds Blackfathom Deeps' WDT (a WMO-only map) from its own building's
// placement: the result is the client's file byte for byte. It needs WOW_DIR.
func TestClientWMOOnlyWDT(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
// with the global-WMO flag, the building's name and a placement with its bounds, and no tiles or WDL.
// It needs WOW_DIR.
func TestExportWMOOnlyMap(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	var lo, hi [3]float32
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
				lo[k] = math.Float32frombits(binary.LittleEndian.Uint32(p[32+4*k:]))
				hi[k] = math.Float32frombits(binary.LittleEndian.Uint32(p[44+4*k:]))
			}
		}
		o += 8 + size
	}
	if flags&1 == 0 || mwmo != name || hi[0]-lo[0] < 50 || lo[0] > 100 || hi[0] < 100 {
		t.Fatalf("WDT flags %#x, building %q, bounds %v to %v", flags, mwmo, lo, hi)
	}
}
