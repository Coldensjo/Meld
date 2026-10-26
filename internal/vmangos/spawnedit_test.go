package vmangos

import (
	"errors"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"

	"Meld/internal/testclient"
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

// runScript sends mariadb the script inside one START TRANSACTION … COMMIT, every statement
// between them, and reports the runner's failure. The world tables are MyISAM, so the transaction
// doesn't undo their writes; it still holds for InnoDB tables and keeps the script one unit.
func TestRunScriptWrapsATransaction(t *testing.T) {
	old := pipeMariadb
	defer func() { pipeMariadb = old }()
	var gotArgs, gotEnv []string
	var got string
	var fail error
	pipeMariadb = func(args, env []string, input string) error { gotArgs, gotEnv, got = args, env, input; return fail }
	db := worldDB{host: "h", port: "1", user: "u", password: "secret", name: "mangos"}
	statements := []string{"DELETE FROM `creature` WHERE `guid` = 1;", "INSERT INTO `creature` (`guid`) VALUES (2);"}
	if err := runScript(db, strings.Join(statements, "\n")); err != nil {
		t.Fatal(err)
	}
	// The script comes on stdin: no -e, and the database name stays the last argument.
	if len(gotArgs) == 0 || gotArgs[len(gotArgs)-1] != "mangos" {
		t.Fatalf("args %v", gotArgs)
	}
	for _, a := range gotArgs {
		if a == "-e" {
			t.Fatalf("args %v pass -e; the script must come on stdin", gotArgs)
		}
		if strings.Contains(a, "secret") {
			t.Fatalf("args %v hold the password; it goes in MYSQL_PWD (#482)", gotArgs)
		}
	}
	if !reflect.DeepEqual(gotEnv, []string{"MYSQL_PWD=secret"}) {
		t.Fatalf("env %v, want the password in MYSQL_PWD", gotEnv)
	}
	lines := strings.Split(strings.TrimSpace(got), "\n")
	if len(lines) != len(statements)+2 || lines[0] != "START TRANSACTION;" || lines[len(lines)-1] != "COMMIT;" {
		t.Fatalf("script not wrapped in one transaction:\n%s", got)
	}
	for i, s := range statements {
		if lines[i+1] != s {
			t.Fatalf("line %d = %q, want %q inside the transaction:\n%s", i+1, lines[i+1], s, got)
		}
	}
	if strings.Count(got, "START TRANSACTION") != 1 || strings.Count(got, "COMMIT") != 1 {
		t.Fatalf("one transaction expected:\n%s", got)
	}
	// A failing statement makes mariadb exit non-zero before COMMIT; runScript must say so.
	fail = errors.New("mariadb: exit status 1: ERROR 1146")
	if err := runScript(db, statements[0]); !errors.Is(err, fail) {
		t.Fatalf("runScript = %v, want the runner's error", err)
	}
}

// No script runScript runs may open or commit a transaction of its own: MariaDB can't nest them, so
// an inner START TRANSACTION commits the one runScript opened and splits the script in two (#463).
// This reads the package's source, so a new builder is caught too.
func TestNoScriptBuilderOpensATransaction(t *testing.T) {
	files, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		name := f.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || name == "spawnedit.go" {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, word := range []string{"START TRANSACTION", "BEGIN;", "COMMIT;", "ROLLBACK;"} {
			if strings.Contains(strings.ToUpper(string(src)), word) {
				t.Errorf("%s writes %q; runScript already wraps every script in one transaction", name, word)
			}
		}
	}
	sql, err := WeatherSQL([]ZoneWeather{{Zone: 12}})
	if err != nil {
		t.Fatal(err)
	}
	sql = AreaSQL([]AreaRow{{ID: 1, Name: "a"}}) + sql + TaxiSQL([]TaxiNode{{ID: 2}}, []uint32{3}, []uint32{4})
	for _, word := range []string{"TRANSACTION", "COMMIT"} {
		if strings.Contains(sql, word) {
			t.Errorf("AreaSQL+WeatherSQL+TaxiSQL holds %s:\n%s", word, sql)
		}
	}
}

// TestRunScriptLive pipes a script that changes nothing to the server's world database, to check the
// runner reaches it. It needs VMANGOS_DIR with the database running.
func TestRunScriptLive(t *testing.T) {
	dir := testclient.ServerDir(t)
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

func TestReadWaypoints(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	var queries []string
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		queries = append(queries, sql)
		if strings.Contains(sql, "creature_movement_template") {
			return []byte("20\t1\t-8800\t-100\t40\t0\t0\t0\t0\n20\t2\t-8810\t-100\t41\t0\t0\t0\t0\n"), nil
		}
		// Creature 1 has its own path, with a wait, a facing, a script and a wander.
		return []byte("1\t1\t-8800\t-100\t40\t1.5\t3000\t77\t2\n1\t2\t-8790\t-90\t41\t0\t0\t0\t0\n"), nil
	}
	spawns := []WorldSpawn{
		{Kind: KindMonster, GUID: 1, Entry: 10, MovementType: 2},
		{Kind: KindNPC, GUID: 2, Entry: 20, MovementType: 2},
		{Kind: KindNPC, GUID: 3, Entry: 20, MovementType: 0},
		{Kind: KindObject, GUID: 4, Entry: 30},
	}
	if err := readWaypoints(worldDB{}, spawns, 32, 48); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(queries[0], "IN (1, 2, 3)") || !strings.Contains(queries[0], "path_id = 0") {
		t.Fatalf("own paths query: %s", queries[0])
	}
	if len(queries) != 2 || !strings.Contains(queries[1], "entry IN (20)") {
		t.Fatalf("only creature 2 walks waypoints without its own: %v", queries)
	}
	own := spawns[0].Waypoints
	if len(own) != 2 || spawns[0].PathFromTemplate {
		t.Fatalf("creature 1's path: %+v", spawns[0])
	}
	if p := own[0]; p.WaitMs != 3000 || p.ScriptID != 77 || p.Orientation != 1.5 || p.WanderDistance != 2 || p.Y != 40 {
		t.Fatalf("point 1: %+v", p)
	}
	// The point is where regionSpawn puts a spawn at the same server position.
	at := regionSpawn(spawnRow{sx: -8800, sy: -100, height: 40}, 32, 48, nil, [3]heldItem{})
	if math.Abs(float64(own[0].X-at.X)) > 1e-3 || math.Abs(float64(own[0].Z-at.Z)) > 1e-3 {
		t.Fatalf("point at %v,%v, spawn at %v,%v", own[0].X, own[0].Z, at.X, at.Z)
	}
	if len(spawns[1].Waypoints) != 2 || !spawns[1].PathFromTemplate {
		t.Fatalf("creature 2 walks its template's path: %+v", spawns[1])
	}
	if spawns[2].Waypoints != nil || spawns[3].Waypoints != nil {
		t.Fatal("an idle creature and an object have no path")
	}
}

func TestServerSpawnPath(t *testing.T) {
	w := WorldSpawn{Kind: KindMonster, GUID: 1, Waypoints: []Waypoint{{X: 100, Y: 40, Z: 200, WaitMs: 5, WanderDistance: 1, ScriptID: 2, Orientation: 0.5}}}
	s := serverSpawn(w, 0, 32, 48)
	at := serverSpawn(WorldSpawn{X: 100, Y: 40, Z: 200}, 0, 32, 48)
	if len(s.Path) != 1 {
		t.Fatalf("path %+v", s.Path)
	}
	if p := s.Path[0]; p.X != at.X || p.Y != at.Y || p.Z != 40 || p.WaitMs != 5 || p.WanderDistance != 1 || p.ScriptID != 2 || p.O != 0.5 {
		t.Fatalf("point %+v, want at %v %v", p, at.X, at.Y)
	}
}

func TestLikePattern(t *testing.T) {
	bs := string(rune(92))
	cases := map[string]string{
		"Wolf":         "'%Wolf%'",
		"50%":          "'%50" + bs + "%%'",
		"a_b":          "'%a" + bs + "_b%'",
		"O'Brien":      "'%O" + bs + "'Brien%'",
		"x" + bs + "y": "'%x" + bs + bs + bs + bs + "y%'",
	}
	for in, want := range cases {
		if got := likePattern(in); got != want {
			t.Errorf("likePattern(%q) = %s, want %s", in, got, want)
		}
	}
}

// TestSearchCreaturesLive searches the server's creature templates. It needs VMANGOS_DIR with the
// database running.
func TestSearchCreaturesLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	got, err := SearchCreatures(dir, "Northshire Guard", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) == 0 || got[0].Name != "Northshire Guard" || got[0].Display == 0 || got[0].LevelMin == 0 {
		t.Fatalf("search: %+v", got)
	}
	if odd, err := SearchCreatures(dir, "'; DROP TABLE x; --", 5); err != nil || len(odd) != 0 {
		t.Fatalf("a quote in the search must stay text: %v %v", odd, err)
	}
	next, err := NextCreatureGUID(dir)
	if err != nil || next <= 1 {
		t.Fatalf("next guid %d, %v", next, err)
	}
}
