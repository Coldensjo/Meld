package vmangos

import (
	"encoding/json"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestRegionWithoutLiquids opens Naxxramas (map 533), whose tiles hold no liquid, and checks that
// the view sends its liquids as [] rather than null, which the editor can't loop over (#120). It
// needs WOW_DIR set to the client.
func TestRegionWithoutLiquids(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := LoadMapEntries(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	name := ""
	for _, e := range entries {
		if e.ID == 533 {
			name = e.Dir
		}
	}
	if name == "" {
		t.Skip("no map 533 in this client")
	}
	view, err := ReadRegion(dataDir, name, 38, 25, 1)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), `"liquids":null`) || strings.Contains(string(b), `"objects":null`) {
		t.Fatalf("%s 38_25 sends a null list", name)
	}
}
