package vmangos

import (
	"math"
	"os"
	"strings"
	"testing"
)

// serverSpawn undoes regionSpawn: a spawn read into a region and written back lands where it was.
func TestServerSpawnUndoesRegionSpawn(t *testing.T) {
	row := spawnRow{WorldSpawn: WorldSpawn{Kind: KindNPC, GUID: 5, Entry: 6, Orientation: 1.25, RespawnSecs: 60, RespawnMaxSecs: 90,
		MovementType: 2, WanderDistance: 3, Equipment: 4, StandState: 1, EmoteState: 10, SheathState: 2}, sx: -8800.25, sy: -100.5, height: 42}
	w := regionSpawn(row, 32, 48, nil, [3]heldItem{})
	s := serverSpawn(w, 0, 32, 48)
	if math.Abs(s.X+8800.25) > 1e-3 || math.Abs(s.Y+100.5) > 1e-3 || s.Z != 42 || s.O != 1.25 {
		t.Fatalf("server position %v %v %v %v, want -8800.25 -100.5 42 1.25", s.X, s.Y, s.Z, s.O)
	}
	if s.Kind != Creature || s.RespawnMin != 60 || s.RespawnMax != 90 || s.MovementType != 2 || s.WanderDistance != 3 ||
		s.Equipment != 4 || s.StandState != 1 || s.EmoteState != 10 || s.SheathState != 2 {
		t.Fatalf("spawn settings: %+v", s)
	}
	if serverSpawn(WorldSpawn{Kind: KindObject}, 0, 0, 0).Kind != GameObject {
		t.Fatal("an object must stay an object")
	}
}

func TestRunScriptWrapsATransaction(t *testing.T) {
	old := runScript
	defer func() { runScript = old }()
	var got string
	runScript = func(_ worldDB, script string) error { got = script; return nil }
	if err := runScript(worldDB{}, "DELETE FROM `creature` WHERE `guid` = 1;"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "guid` = 1") {
		t.Fatalf("script %q", got)
	}
	// The real runner reads the script from stdin and keeps the database name as its last argument.
	args := worldDB{host: "h", port: "1", user: "u", password: "p", name: "mangos"}.args("")
	if args = args[:len(args)-2]; args[len(args)-1] != "mangos" {
		t.Fatalf("args %v", args)
	}
}

// TestRunScriptLive pipes a script that changes nothing to the server's world database, to check the
// runner reaches it. It needs VMANGOS_DIR with the database running.
func TestRunScriptLive(t *testing.T) {
	dir := os.Getenv("VMANGOS_DIR")
	if dir == "" {
		t.Skip("VMANGOS_DIR not set")
	}
	db, err := worldDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := runScript(db, "SELECT COUNT(*) FROM `creature` WHERE `guid` = 0;"); err != nil {
		t.Fatal(err)
	}
	if err := runScript(db, "SELECT nonsense FROM nowhere;"); err == nil {
		t.Fatal("a failing script must report its error")
	}
}
