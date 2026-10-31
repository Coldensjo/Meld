package vmangos

import (
	"testing"
	"time"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestCheckLinksLive reads Elwynn Forest's world links (#953) from the real client and world database:
// the stock map must have flight stops with routes, area triggers sending players to known maps, and
// the spawns' teleports must come back in one script, in a few seconds.
func TestCheckLinksLive(t *testing.T) {
	if testing.Short() {
		t.Skip("reads the client and the world database")
	}
	data, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	server := testclient.ServerDir(t)
	db, err := openWorld(server)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := runSQL(db, "SELECT 'creature', id, MIN(guid) FROM creature WHERE map = 0 AND position_x BETWEEN -10000 AND -9000 AND position_y BETWEEN -1000 AND 1000 GROUP BY id "+
		"UNION ALL SELECT 'object', id, MIN(guid) FROM gameobject WHERE map = 0 AND position_x BETWEEN -10000 AND -9000 AND position_y BETWEEN -1000 AND 1000 GROUP BY id")
	if err != nil {
		t.Fatal(err)
	}
	var spawns []LinkSpawn
	for _, f := range batchRows(raw, 3) {
		spawns = append(spawns, LinkSpawn{Kind: f[0], Entry: f.num(1), Guid: f.num(2)})
	}
	start := time.Now()
	r := checkLinks(db, data, LinkQuery{MapID: 0, Spawns: spawns})
	took := time.Since(start)
	t.Logf("%d templates: %d stops, %d teleports in %v", len(spawns), len(r.Nodes), len(r.Portals), took)
	if r.Error != "" {
		t.Errorf("error: %s", r.Error)
	}
	if !r.Checked || len(r.Nodes) < 10 {
		t.Errorf("expected Azeroth's flight stops, got %d", len(r.Nodes))
	}
	routed := 0
	for _, n := range r.Nodes {
		if n.From > 0 {
			routed++
		}
	}
	if routed < len(r.Nodes)/2 {
		t.Errorf("only %d of %d stops have a route from them", routed, len(r.Nodes))
	}
	kinds := map[string]int{}
	grounded, instance := 0, 0
	for _, l := range r.Portals {
		kinds[l.Kind]++
		if !l.MapKnown {
			t.Logf("unknown map: %+v", l)
		}
		if l.Ground != nil {
			grounded++
		}
		// The stock Stockade entrance lands inside its building (#979); the Deadmines has tiles, so it is
		// measured against them instead.
		if l.Dest.Map == 34 || l.Dest.Map == 36 {
			instance++
			if l.OutsideBuilding {
				t.Errorf("a stock teleport into %s lands outside its building: %+v", l.MapName, l)
			}
		}
	}
	if instance == 0 {
		t.Error("expected the Deadmines and Stockade entrances among Elwynn's triggers")
	}
	t.Logf("by kind %v, %d with the ground read", kinds, grounded)
	if kinds["trigger"] == 0 || kinds["into"] == 0 {
		t.Errorf("expected Azeroth's triggers and teleports into it, got %v", kinds)
	}
	if took > 20*time.Second {
		t.Errorf("took %v", took)
	}
}
