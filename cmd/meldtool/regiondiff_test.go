package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/vmangos"
	"Meld/internal/wow"
)

// TestRegionDiffNamesHeights builds a client region with one raised vertex and checks region-diff
// names the heights as the input that makes the tile differ (#1034). It needs the client (make test-full).
func TestRegionDiffNamesHeights(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	view, err := vmangos.ReadRegion(dataDir, "Azeroth", 29, 51, 1)
	if err != nil {
		t.Fatal(err)
	}
	raised := append([]float32(nil), view.Heights...)
	raised[len(raised)/2] += 5
	edit := vmangos.RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: vmangos.EncodeHeights(raised), Objects: view.Objects}
	raw, err := json.Marshal(edit)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "edit.json")
	if err := os.WriteFile(file, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := regionDiff([]string{file, dataDir}, &out); err != nil {
		t.Fatal(err)
	}
	var rep regionDiffReport
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	if len(rep.Tiles) != 1 || rep.Tiles[0].Tile != "29_51" || !slices.Contains(rep.Tiles[0].Causes, "heights") {
		t.Fatalf("report: %s", out.String())
	}
}
