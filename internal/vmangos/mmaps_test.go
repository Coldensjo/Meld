package vmangos

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// fakeTile64 builds a Detour tile in the server's 64-bit layout with the given counts, each section
// filled with its own byte, and the links' block with 0xee.
func fakeTile64(verts, polys, links, dMeshes, dVerts, dTris, bv, off int) []byte {
	le := binary.LittleEndian
	head := make([]byte, dtHeaderSize)
	le.PutUint32(head, dtNavMeshMagic)
	le.PutUint32(head[4:], dtNavMeshVersion)
	for i, n := range []int{polys, verts, links, dMeshes, dVerts, dTris, bv, off} {
		le.PutUint32(head[24+i*4:], uint32(n))
	}
	d := head
	fill := func(n int, b byte) {
		for i := 0; i < align4(n); i++ {
			d = append(d, b)
		}
	}
	fill(12*verts, 1)
	fill(32*polys, 2)
	fill(16*links, 0xee)
	fill(12*dMeshes, 4)
	fill(12*dVerts, 5)
	fill(4*dTris, 6)
	fill(16*bv, 7)
	fill(36*off, 8)
	return d
}

func TestDetourTile32ShrinksTheLinks(t *testing.T) {
	d := fakeTile64(5, 3, 7, 3, 4, 9, 5, 1)
	out, err := detourTile32(d)
	if err != nil {
		t.Fatal(err)
	}
	if want := len(d) - 4*7; len(out) != want {
		t.Fatalf("got %d bytes, want %d", len(out), want)
	}
	head := dtHeaderSize + 12*5 + 32*3
	if string(out[:head]) != string(d[:head]) {
		t.Fatal("the header, vertices or polygons changed")
	}
	for i := head; i < head+12*7; i++ {
		if out[i] != 0 {
			t.Fatalf("link byte %d is %#x, not zeroed", i-head, out[i])
		}
	}
	if out[head+12*7] != 4 || out[len(out)-1] != 8 {
		t.Fatal("the sections after the links moved")
	}
	if _, err := detourTile32(d[:len(d)-4]); err == nil {
		t.Fatal("a tile cut short was taken")
	}
}

func TestNavTileReadsTheFiles(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "data", "mmaps")
	os.MkdirAll(dir, 0o755)
	le := binary.LittleEndian
	params := make([]byte, navParamsSize)
	for i, f := range []float32{-6933.33, 0, -16000, 533.333, 533.333} {
		le.PutUint32(params[i*4:], math.Float32bits(f))
	}
	os.WriteFile(filepath.Join(dir, "000.mmap"), params, 0o644)
	tile := fakeTile64(3, 1, 3, 1, 0, 1, 1, 0)
	file := make([]byte, mmapHeaderSize, mmapHeaderSize+len(tile))
	le.PutUint32(file, mmapMagic)
	le.PutUint32(file[4:], dtNavMeshVersion)
	le.PutUint32(file[8:], mmapVersion)
	le.PutUint32(file[12:], uint32(len(tile)))
	// Map 0, row 23, column 37: the file is named by the row first.
	os.WriteFile(filepath.Join(dir, "0002337.mmtile"), append(file, tile...), 0o644)

	got, err := NavTile(root, 0, 37, 23)
	if err != nil {
		t.Fatal(err)
	}
	if string(got[:NavTileParams]) != string(params[:NavTileParams]) {
		t.Fatal("the params changed")
	}
	if le.Uint32(got[NavTileParams:]) != dtNavMeshMagic || len(got) != NavTileParams+len(tile)-4*3 {
		t.Fatalf("the tile came out %d bytes", len(got)-NavTileParams)
	}
	if _, err := NavTile(root, 0, 23, 37); !IsNotExist(err) {
		t.Fatalf("a missing tile gave %v", err)
	}
	le.PutUint32(file[8:], 5)
	os.WriteFile(filepath.Join(dir, "0002337.mmtile"), append(file, tile...), 0o644)
	if _, err := NavTile(root, 0, 37, 23); err == nil || !strings.Contains(err.Error(), "version 5") {
		t.Fatalf("an old generator's tile gave %v", err)
	}
}

// With VMANGOS_DIR set to a server folder with built mmaps, every tile of map 0 converts.
func TestServerNavTiles(t *testing.T) {
	if testing.Short() {
		t.Skip("heavy client scan; run make test-full")
	}
	root := testclient.ServerFolder(t)
	names, _ := filepath.Glob(filepath.Join(root, "data", "mmaps", "000*.mmtile"))
	if len(names) == 0 {
		t.Skip("no mmaps for map 0")
	}
	for _, n := range names {
		b, err := os.ReadFile(n)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := mmtileData(b); err != nil {
			t.Errorf("%s: %v", filepath.Base(n), err)
		}
	}
	t.Logf("%d tiles", len(names))
}
