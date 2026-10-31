package vmangos

import (
	"errors"
	"math"
	"strings"
	"testing"

	"Meld/internal/adt"
)

// The stops of a map count the routes from and to them, and a stop whose every route out is a spell's
// flight is not one a flight master stands at (ObjectMgr's taxi mask).
func TestLinkNodes(t *testing.T) {
	nodes, err := linkNodes(taxiFixture(), 0, map[uint32]bool{11: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 {
		t.Fatalf("stops %+v", nodes)
	}
	if n := nodes[0]; n.ID != 1 || n.From != 1 || n.To != 1 || !n.Network {
		t.Errorf("Goldshire %+v", n)
	}
	if n := nodes[1]; n.ID != 2 || n.From != 1 || n.To != 1 || n.Network {
		t.Errorf("Lakeshire, whose one route out is a spell's, %+v", n)
	}
	other, _ := linkNodes(taxiFixture(), 1, nil)
	if len(other) != 1 || other[0].From != 0 || other[0].To != 0 || !other[0].Network {
		t.Errorf("Ratchet, with no route, %+v", other)
	}
}

func TestGroundAt(t *testing.T) {
	const cell = adt.TileSize / adt.ChunksPerTile / adt.CellsPerChunk
	ch := adt.Chunk{IndexX: 1, IndexY: 2}
	for i := range ch.Heights {
		ch.Heights[i] = 10
	}
	ch.Heights[9] = 14 // the middle of the chunk's first cell
	ch.Holes[0] = 1 << 1
	g := &tileGround{terrain: &adt.Terrain{Chunks: []adt.Chunk{ch}}}
	ox, oz := 1*cell*adt.CellsPerChunk, 2*cell*adt.CellsPerChunk
	for _, c := range []struct {
		u, v float64
		want float32
	}{{0.5, 0.5, 14}, {0, 0, 10}, {0.5, 0, 10}, {0.5, 0.25, 12}, {0.25, 0.5, 12}, {0.75, 0.5, 12}, {0.5, 0.75, 12}} {
		h, ok := g.groundAt(ox+c.u*cell, oz+c.v*cell)
		if !ok || math.Abs(float64(h-c.want)) > 1e-3 {
			t.Errorf("(%v, %v): %v %v, want %v", c.u, c.v, h, ok, c.want)
		}
	}
	if _, ok := g.groundAt(ox+1.5*cell, oz+0.5*cell); ok {
		t.Error("a hole has ground")
	}
	if _, ok := g.groundAt(0, 0); ok {
		t.Error("a chunk the tile lacks has ground")
	}
}

func TestInBuilding(t *testing.T) {
	g := &tileGround{places: []adt.Placement{
		{Kind: adt.M2, Extents: [2][3]float32{{0, 0, 0}, {100, 100, 100}}},
		{Kind: adt.WMO, Extents: [2][3]float32{{200, 0, 200}, {300, 50, 300}}},
	}}
	if g.inBuilding(50, 50, 50) {
		t.Error("an M2 counts as a building")
	}
	if !g.inBuilding(250, 20, 250) || !g.inBuilding(199, 52, 301) {
		t.Error("a point in a WMO's bounds (or a yard or two out) is not in it")
	}
	if g.inBuilding(250, 60, 250) {
		t.Error("a point well above a WMO is in it")
	}
}

// A teleport onto a map of one building (a dungeon's WDT, no tiles) is flagged only when it lands
// outside the building's bounds, and the tiles are never read for it.
func TestGroundReaderBuildingMap(t *testing.T) {
	// The WDT's frame is the file frame less ZeroPoint (wmoonly.go): the building spans x 0..100,
	// height 0..40 and z 200..300 there, server x -300..-200 and server y -100..0.
	wdt, err := BuildWMOOnlyWDT(wdtTemplate(), GlobalWMO{Name: `World\wmo\Dungeon\Probe.wmo`, Min: [3]float32{0, 0, 200}, Max: [3]float32{100, 40, 300}})
	if err != nil {
		t.Fatal(err)
	}
	reads := map[string]int{}
	g := &groundReader{tiles: map[string]*tileGround{}, globals: map[string]*GlobalWMO{}, read: func(name string) ([]byte, error) {
		reads[name]++
		if strings.HasSuffix(name, ".wdt") {
			return wdt, nil
		}
		return nil, errors.New("no tile")
	}}
	at := func(x, y, z float32) PortalLink {
		l := PortalLink{Dest: TriggerTeleport{Map: 36, X: x, Y: y, Z: z}}
		g.at(&l, "Probe")
		return l
	}
	if l := at(-250, -50, 10); l.OutsideBuilding || l.Ground != nil || l.InBuilding {
		t.Errorf("inside the building: %+v", l)
	}
	if l := at(-250, -50, 42); l.OutsideBuilding {
		t.Error("two yards over the roof is out of it")
	}
	if l := at(-250, -50, -30); !l.OutsideBuilding {
		t.Error("30 yards under the building is in it")
	}
	if l := at(-250, 50, 10); !l.OutsideBuilding {
		t.Error("50 yards beside the building is in it")
	}
	if len(reads) != 1 || reads[`World\Maps\Probe\Probe.wdt`] != 1 {
		t.Errorf("reads %v", reads)
	}
}

func TestDestTile(t *testing.T) {
	tx, ty, lx, lz := destTile(0, 0)
	if tx != 32 || ty != 32 || lx != 0 || lz != 0 {
		t.Errorf("the world's middle: tile %d,%d at %v,%v", tx, ty, lx, lz)
	}
	// Goldshire (server -9460, 60) is on Azeroth_31_49.
	if tx, ty, _, _ = destTile(-9460, 60); tx != 31 || ty != 49 {
		t.Errorf("Goldshire on tile %d,%d", tx, ty)
	}
}

func TestIntoTeleportsSQL(t *testing.T) {
	sql := intoTeleportsSQL(42)
	if n := strings.Count(sql, "= 42"); n != 3 {
		t.Errorf("want the three sources filtered on map 42, got %d: %s", n, sql)
	}
	for _, want := range []string{"FROM areatrigger_teleport", "FROM spell_target_position p", "FROM gossip_scripts s WHERE s.command = 6"} {
		if !strings.Contains(sql, want) {
			t.Errorf("%s lacks %q", sql, want)
		}
	}
}

func TestSpawnTeleportsScript(t *testing.T) {
	spawns := []LinkSpawn{{Kind: "creature", Entry: 100, Guid: 5}, {Kind: "object", Entry: 200, Guid: 6}}
	script := spawnTeleportsScript(spawns)
	if !strings.HasPrefix(script, "SELECT '#0';\n") || !strings.Contains(script, ";\nSELECT '#1';\n") {
		t.Errorf("markers missing: %.200s", script)
	}
	raw := []byte("#0\nGossip: Take me\t1\t10\t20\t30\t0\nGossip: Take me\t1\t10\t20\t30\t0\n#1\nCasts Portal\t0\t1\t2\t3\t0.5\n")
	links := parseSpawnTeleportsScript(raw, spawns)
	if len(links) != 2 {
		t.Fatalf("links %+v", links)
	}
	if l := links[0]; l.Kind != "creature" || l.Entry != 100 || l.Guid != 5 || l.Dest.Map != 1 || l.Dest.Z != 30 {
		t.Errorf("first %+v", l)
	}
	if l := links[1]; l.Kind != "object" || l.Entry != 200 || l.Label != "Casts Portal" || l.Dest.O != 0.5 {
		t.Errorf("second %+v", l)
	}
}
