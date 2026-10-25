package vmangos

import (
	"bytes"
	"encoding/binary"
	"flag"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// The /wow/navtile reply, made by NavTile from a generated tile (no server data) into
// frontend/tests/fixtures/navtile.bin, which frontend/tests/wire.test.ts decodes with parseNavTile
// (#520). A layout change fails here until the fixture is written again:
// go test ./internal/vmangos/ -run TestWireFixtures -update
var update = flag.Bool("update", false, "write the frontend's wire fixture (frontend/tests/fixtures/navtile.bin)")

func TestWireFixtures(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "data", "mmaps")
	os.MkdirAll(dir, 0o755)
	le := binary.LittleEndian
	params := make([]byte, navParamsSize)
	for i, f := range []float32{-6933.5, 12.25, -16000, 533.25, 266.5} {
		le.PutUint32(params[i*4:], math.Float32bits(f))
	}
	os.WriteFile(filepath.Join(dir, "001.mmap"), params, 0o644)
	tile := fakeTile64(3, 1, 2, 1, 0, 1, 1, 0)
	file := make([]byte, mmapHeaderSize, mmapHeaderSize+len(tile))
	le.PutUint32(file, mmapMagic)
	le.PutUint32(file[4:], dtNavMeshVersion)
	le.PutUint32(file[8:], mmapVersion)
	le.PutUint32(file[12:], uint32(len(tile)))
	os.WriteFile(filepath.Join(dir, "0010504.mmtile"), append(file, tile...), 0o644)
	got, err := NavTile(root, 1, 4, 5)
	if err != nil {
		t.Fatal(err)
	}

	path := filepath.Join("..", "..", "frontend", "tests", "fixtures", "navtile.bin")
	if *update {
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (write it: go test ./internal/vmangos/ -run TestWireFixtures -update)", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("navtile.bin: NavTile's bytes changed; if the layout changed on purpose, write the fixture again (-update) and make parseNavTile and frontend/tests/wire.test.ts follow")
	}
}
