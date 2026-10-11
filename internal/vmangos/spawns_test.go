package vmangos

import (
	"math"
	"os"
	"testing"

	"WorldEditor/internal/adt"
)

func TestParseSpawnRows(t *testing.T) {
	raw := []byte("123\t45\tWolf\t\t1\t2\t14\t0\t0\t1\t-100.5\t-200\t30\t1.5\t300\n" +
		"124\t46\tInnkeeper\tInn\t10\t10\t12\t128\t0\t7\t-50\t-60\t31\t0\t600\n" +
		"125\t47\tChest\t\t0\t0\t0\t0\t0\t3\t10\t20\t5\t0\t120\n")
	rows, err := parseSpawnRows(raw, "creature")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("%d rows, want 3", len(rows))
	}
	if w := rows[0]; w.Kind != KindMonster || w.Name != "Wolf" || w.GUID != 123 || w.LevelMax != 2 || w.sx != -100.5 || w.RespawnSecs != 300 {
		t.Fatalf("wolf: %+v", w)
	}
	if n := rows[1]; n.Kind != KindNPC || n.Subname != "Inn" || n.NPCFlags != 128 || n.Type != 7 {
		t.Fatalf("innkeeper: %+v", n)
	}
	objs, err := parseSpawnRows(raw, "object")
	if err != nil {
		t.Fatal(err)
	}
	if objs[2].Kind != KindObject {
		t.Fatalf("an object row must be an object, got %q", objs[2].Kind)
	}
}

func TestParseSpawnRowsRejectsShortRows(t *testing.T) {
	if _, err := parseSpawnRows([]byte("1\t2\tWolf\n"), "creature"); err == nil {
		t.Fatal("a short row must be an error")
	}
}

// A server point maps to the block by the ADT convention: server x is ZeroPoint less the tile's Z,
// server y is ZeroPoint less the tile's X.
func TestRegionSpawnConversion(t *testing.T) {
	const tile = adt.TileSize
	zp := float64(adt.ZeroPoint)
	// Tile (32, 48): ADT X runs 32T..33T, so server y is in [zp-33T, zp-32T] = [-533, 0];
	// ADT Z runs 48T..49T, so server x is in [zp-49T, zp-48T] = [-9067, -8534].
	s := spawnRow{WorldSpawn: WorldSpawn{Name: "Wolf"}, sx: -8800, sy: -100, height: 42}
	got := regionSpawn(s, 32, 48)
	if math.Abs(float64(got.X)-100) > 0.01 {
		t.Fatalf("x = %v, want 100 (ADT X %v less the block's start)", got.X, zp+100)
	}
	if want := zp + 8800 - 48*tile; math.Abs(float64(got.Z)-want) > 0.01 {
		t.Fatalf("z = %v, want %v", got.Z, want)
	}
	if got.Y != 42 {
		t.Fatalf("height %v, want 42", got.Y)
	}
	if got.Name != "Wolf" {
		t.Fatalf("the template's fields must come through, got %q", got.Name)
	}
}

// TestReadSpawnsLive reads a real block from the server's world database. It needs VMANGOS_DIR set
// to the server folder, with its database running.
func TestReadSpawnsLive(t *testing.T) {
	dir := os.Getenv("VMANGOS_DIR")
	if dir == "" {
		t.Skip("VMANGOS_DIR not set")
	}
	spawns, err := ReadSpawns(dir, "Azeroth", 32, 48, 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(spawns) == 0 {
		t.Fatal("the block has no spawns")
	}
	limit := float32(4 * adt.TileSize * 1.01)
	kinds := map[string]int{}
	for _, s := range spawns {
		kinds[s.Kind]++
		if s.X < -1 || s.X > limit || s.Z < -1 || s.Z > limit {
			t.Fatalf("%s %q at %v,%v lies outside the block", s.Kind, s.Name, s.X, s.Z)
		}
	}
	if kinds[KindMonster]+kinds[KindNPC] == 0 || kinds[KindObject] == 0 {
		t.Fatalf("expected monsters and objects, got %v", kinds)
	}
}
