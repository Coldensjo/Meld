package adt

import (
	"slices"
	"testing"
)

func uidsOf(t *testing.T, root []byte) []uint32 {
	t.Helper()
	placed, err := ParsePlacements(root)
	if err != nil {
		t.Fatal(err)
	}
	var out []uint32
	for _, p := range placed {
		out = append(out, p.UID)
	}
	slices.Sort(out)
	return out
}

// TestNextUIDSharedAcrossTiles builds two tiles from one counter, as an export does, and checks their
// added models get IDs no other has: numbered per tile they were {1, 2} and {1}, and the client drew
// only the first loaded of each (#491).
func TestNextUIDSharedAcrossTiles(t *testing.T) {
	tree := Object{Kind: M2, Name: `World\Test\Tree.m2`, Position: [3]float32{100, 30, 120}, Scale: 1}
	house := Object{Kind: WMO, Name: `World\Test\House.wmo`, Position: [3]float32{200, 30, 220}}
	next := uint32(500)
	a, err := BuildTile(hills(), Ring{}, Changes{TileX: 3, TileY: 4, Add: []Object{tree, house}, NextUID: &next})
	if err != nil {
		t.Fatal(err)
	}
	b, err := BuildTile(hills(), Ring{}, Changes{TileX: 4, TileY: 4, Add: []Object{tree}, NextUID: &next})
	if err != nil {
		t.Fatal(err)
	}
	if got := append(uidsOf(t, a), uidsOf(t, b)...); !slices.Equal(got, []uint32{500, 501, 502}) {
		t.Fatalf("IDs %v, want 500, 501 and 502", got)
	}
	if next != 503 {
		t.Fatalf("counter at %d after three models, want 503", next)
	}

	// A model kept by ID keeps it, and a new one in a tile whose own IDs pass the counter goes above them.
	kept := tree
	kept.UID = 501
	low := uint32(2)
	c, err := Rewrite(a, Changes{TileX: 3, TileY: 4, Remove: map[uint32]bool{501: true}, Add: []Object{kept, tree}, NextUID: &low})
	if err != nil {
		t.Fatal(err)
	}
	if got := uidsOf(t, c); !slices.Equal(got, []uint32{500, 501, 502}) {
		t.Fatalf("IDs %v, want 500 and 501 kept and 502 added", got)
	}
	if low != 503 {
		t.Fatalf("counter at %d, want 503", low)
	}

	// Without a counter, a tile numbers after its own highest ID, as before.
	d, err := Rewrite(a, Changes{TileX: 3, TileY: 4, Add: []Object{tree}})
	if err != nil {
		t.Fatal(err)
	}
	if got := uidsOf(t, d); !slices.Equal(got, []uint32{500, 501, 502}) {
		t.Fatalf("IDs %v, want 502 added after the tile's own", got)
	}
}

// TestMaxPlacementUID reads the highest ID from a whole tile and from the start of one, and says when
// the start is too short to hold the placement tables.
func TestMaxPlacementUID(t *testing.T) {
	root, err := BuildTile(hills(), Ring{}, Changes{TileX: 3, TileY: 4, Add: []Object{
		{Kind: M2, Name: `World\Test\Tree.m2`, UID: 40, Position: [3]float32{100, 30, 120}, Scale: 1},
		{Kind: WMO, Name: `World\Test\House.wmo`, UID: 90, Position: [3]float32{200, 30, 220}},
		{Kind: M2, Name: `World\Test\Rock.m2`, UID: 0xffffffff, Position: [3]float32{300, 30, 320}, Scale: 1},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if uid, found := MaxPlacementUID(root); uid != 90 || !found {
		t.Fatalf("whole tile: %d, %v; want 90, true", uid, found)
	}
	// The first map chunk follows the tables; a start that ends before it can't say.
	if uid, found := MaxPlacementUID(root[:200]); found {
		t.Fatalf("200 bytes found %d", uid)
	}
	if uid, found := MaxPlacementUID(root[:len(root)/2]); uid != 90 || !found {
		t.Fatalf("half the tile: %d, %v; want 90, true", uid, found)
	}
}
