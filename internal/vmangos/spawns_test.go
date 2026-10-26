package vmangos

import (
	"encoding/json"
	"math"
	"net/url"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestParseSpawnRows(t *testing.T) {
	raw := []byte("123\t45\tWolf\t\t1\t2\t14\t0\t0\t1\t-100.5\t-200\t30\t1.5\t300\t880\t1.25\t0\t7\t1\t233\t1\t1\t5.5\t420\t0\t0\t0\t0\n" +
		"124\t46\tInnkeeper\tInn\t10\t10\t12\t128\t0\t7\t-50\t-60\t31\t0\t600\t0\t1\t99\t0\t0\t0\t1\t2\t0\t600\t0\t0\t0\t0\r\n" +
		"125\t47\tChest\t\t0\t0\t0\t0\t0\t3\t10\t20\t5\t0\t120\t0\t1\t0\t0\t0\t0\t0\t0\t0\t180\t0\t0\t0.5\t0.866025\n")
	rows, err := parseSpawnRows(raw, "creature")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("%d rows, want 3", len(rows))
	}
	if w := rows[0]; w.Kind != KindMonster || w.Name != "Wolf" || w.GUID != 123 || w.LevelMax != 2 || w.sx != -100.5 || w.RespawnSecs != 300 || w.display != 880 || w.scale != 1.25 {
		t.Fatalf("wolf: %+v", w)
	}
	if w := rows[0]; w.Equipment != 7 || w.StandState != 1 || w.EmoteState != 233 || w.SheathState != 1 || w.MovementType != 1 ||
		w.WanderDistance != 5.5 || w.RespawnMaxSecs != 420 {
		t.Fatalf("wolf's spawn settings: %+v", w)
	}
	if n := rows[1]; n.Kind != KindNPC || n.Subname != "Inn" || n.NPCFlags != 128 || n.Type != 7 || n.addonDisplay != 99 || n.MovementType != 2 {
		t.Fatalf("innkeeper: %+v", n)
	}
	objs, err := parseSpawnRows(raw, "object")
	if err != nil {
		t.Fatal(err)
	}
	if objs[2].Kind != KindObject {
		t.Fatalf("an object row must be an object, got %q", objs[2].Kind)
	}
	if objs[2].Tilt != nil || rows[0].Tilt != nil {
		t.Fatalf("an object that only turns, and a creature, have no tilt: %v %v", objs[2].Tilt, rows[0].Tilt)
	}
}

// A tilted game object (#229), the Sunken Chest of guid 42485: its tilt is read, and written back
// unchanged while its facing is, or turned about Z by the change of facing.
// A backslash in a creature's name comes back as one backslash, not mariadb's escaped two (#478).
func TestParseSpawnRowsUnescapesNames(t *testing.T) {
	raw := []byte("123\t45\t" + `Back\\slash` + "\t" + `Sub\tname` + "\t1\t2\t14\t0\t0\t1\t-100.5\t-200\t30\t1.5\t300\t880\t1.25\t0\t7\t1\t233\t1\t1\t5.5\t420\t0\t0\t0\t0\n")
	rows, err := parseSpawnRows(raw, "creature")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Name != `Back\slash` || rows[0].Subname != "Sub\tname" {
		t.Fatalf("rows %+v", rows)
	}
}

func TestTiltedObjectKeepsItsTilt(t *testing.T) {
	raw := []byte("42485\t32\tSunken Chest\t\t0\t0\t0\t0\t0\t3\t-9366.48\t-2472.26\t17.0271\t-2.28118\t300\t0\t1\t0\t0\t0\t0\t0\t0\t0\t300" +
		"\t-0.118706\t-0.071149\t0.899253\t-0.414959\n")
	rows, err := parseSpawnRows(raw, "object")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows[0].Tilt) != 4 {
		t.Fatalf("a tilted object must have a tilt, got %v", rows[0].Tilt)
	}
	// The spawn goes to the editor and back as JSON.
	b, err := json.Marshal(regionSpawn(rows[0], 32, 48, nil, [3]heldItem{}))
	if err != nil {
		t.Fatal(err)
	}
	var w WorldSpawn
	if err := json.Unmarshal(b, &w); err != nil {
		t.Fatal(err)
	}
	orig := serverSpawn(w, 0, 32, 48)
	now := orig
	now.X += 2
	res := ExportSQL([]Edit{{Spawn: now, Original: &orig}}, fixedTime)
	if !strings.Contains(res.SQL, "`rotation0` = -0.118706, `rotation1` = -0.071149, `rotation2` = 0.899253, `rotation3` = -0.414959,") {
		t.Fatalf("a moved tilted object must keep its rotation:\n%s", res.SQL)
	}
	// Turned by a quarter: the whole rotation turns about Z, so the tilt's size stays and the
	// quaternion is the old one turned.
	w.Orientation += math.Pi / 2
	q := *serverSpawn(w, 0, 32, 48).Rotation
	want := mulQuat(facing(float64(w.Orientation)-orig.O), *orig.Rotation)
	for i := range q {
		if math.Abs(q[i]-want[i]) > 1e-6 {
			t.Fatalf("turned rotation %v, want %v", q, want)
		}
	}
	if math.Abs(math.Hypot(q[0], q[1])-math.Hypot(-0.118706, -0.071149)) > 1e-6 {
		t.Fatalf("turning about Z changed the tilt: %v", q)
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
	got := regionSpawn(s, 32, 48, nil, [3]heldItem{})
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
	if got.Scale != 1 {
		t.Fatalf("a spawn without a scale is drawn at 1, got %v", got.Scale)
	}
}

// TestReadSpawnsLive reads a real block from the server's world database and resolves its models
// from the client. It needs VMANGOS_DIR set to the server folder, with its database running, and
// WOW_DIR set to the client.
func TestReadSpawnsLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	clientDir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(clientDir)
	if err != nil {
		t.Fatal(err)
	}
	spawns, err := ReadSpawns(dir, dataDir, "Azeroth", 32, 48, 4)
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

// TestSpawnModelsLoad checks that the models the spawns name load through the editor's model
// loader, for the same live block. It needs VMANGOS_DIR and WOW_DIR.
func TestSpawnModelsLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("heavy client scan; run make test-full")
	}
	dir := testclient.ServerDir(t)
	clientDir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(clientDir)
	if err != nil {
		t.Fatal(err)
	}
	spawns, err := ReadSpawns(dir, dataDir, "Azeroth", 32, 48, 4)
	if err != nil {
		t.Fatal(err)
	}
	var c wow.Client
	if err := c.Open(clientDir); err != nil {
		t.Fatal(err)
	}
	withModel, failed, dressed := 0, 0, 0
	seen := map[string]bool{}
	for _, s := range spawns {
		if s.Model == "" {
			continue
		}
		withModel++
		key := s.Model + "?" + s.Look
		if seen[key] {
			continue
		}
		seen[key] = true
		q, err := url.ParseQuery(s.Look)
		if err != nil {
			t.Fatalf("%q: look %q: %v", s.Name, s.Look, err)
		}
		look := wow.ParseLook(q)
		look.Anim = s.Anim
		if len(look.Attach) > 0 {
			dressed++
		}
		// An invisible trigger names a model with nothing to draw, which Model answers with its hull and
		// no groups (#333) rather than an error; the editor shows those as markers.
		if _, err := c.Model(s.Model, look); err != nil {
			failed++
			if failed <= 3 {
				t.Errorf("%s %q: model %q: %v", s.Kind, s.Name, s.Model, err)
			}
		}
	}
	if withModel*10 < len(spawns)*9 {
		t.Fatalf("only %d of %d spawns name a model", withModel, len(spawns))
	}
	t.Logf("%d spawns with models, %d distinct looks (%d with items attached), %d failed to load", withModel, len(seen), dressed, failed)
}
