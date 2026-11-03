package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"Meld/internal/adt"
)

// cmangosDungeon is a dungeon made in Meld, of two tiles, as Publish gets it.
func cmangosDungeon() MapSpec {
	tile := func(x int) TileSpec { return TileSpec{X: x, Y: 10, Outer: flatTile(0)} }
	return MapSpec{Dir: chainMap, MapID: chainID, Tiles: []TileSpec{tile(10), tile(11)},
		Info: &MapInfo{Type: 1, Name: "Probe Halls", MaxPlayers: 5, ResetDelay: 3, GhostMap: 1, GhostX: -230.5, GhostY: 1571.25}}
}

// The instance_template row names only columns CMaNGOS classic's table has, with the dungeon's player
// limit, reset delay and ghost entrance; a world map, or a map without its info, gets none.
func TestCMaNGOSInstanceSQL(t *testing.T) {
	cols := cmangosSchema(t)["instance_template"]
	if cols == nil {
		t.Fatal("the fixture has no instance_template")
	}
	spec := cmangosDungeon()
	sql := CMaNGOSInstanceSQL(spec)
	statements := 0
	for _, line := range strings.Split(sql, "\n") {
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		statements++
		if !strings.HasPrefix(line, "INSERT INTO `instance_template` (") {
			t.Errorf("not an instance_template insert: %s", line)
		}
		for _, m := range regexp.MustCompile("`(\\w+)`").FindAllStringSubmatch(line, -1) {
			if id := strings.ToLower(m[1]); id != "instance_template" && !cols[id] {
				t.Errorf("instance_template has no column %s", m[1])
			}
		}
	}
	if statements != 1 {
		t.Fatalf("%d statements:\n%s", statements, sql)
	}
	for _, want := range []string{
		"of Probe Halls (map 1902, a dungeon made in Meld)",
		"VALUES (1902, 0, 0, 0, 5, 3, 1, -230.5, 1571.25, '') ON DUPLICATE KEY UPDATE `maxPlayers` = VALUES(`maxPlayers`)",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("SQL lacks %q:\n%s", want, sql)
		}
	}
	// No ghost entrance is CMaNGOS's 0 at 0,0; a battleground says it needs more; a raid's limit fits a tinyint.
	spec.Info.Type, spec.Info.GhostMap, spec.Info.MaxPlayers = 3, -1, 300
	if sql := CMaNGOSInstanceSQL(spec); !strings.Contains(sql, "VALUES (1902, 0, 0, 0, 255, 3, 0, 0, 0, '')") || !strings.Contains(sql, "battleground_template") {
		t.Errorf("a battleground without a ghost entrance:\n%s", sql)
	}
	spec.Info.Type = 0
	if sql := CMaNGOSInstanceSQL(spec); sql != "" {
		t.Errorf("a world map got %q", sql)
	}
	spec.Info = nil
	if sql := CMaNGOSInstanceSQL(spec); sql != "" {
		t.Errorf("a map without info got %q", sql)
	}
}

// The Changes window's instance_template row (#1085) holds the SQL and names the file it goes to, or
// where it would go before a CMaNGOS folder is set; a world map lists none.
func TestCMaNGOSInstanceRow(t *testing.T) {
	spec := cmangosDungeon()
	root := filepath.Join(t.TempDir(), "cmangos")
	row, ok := CMaNGOSInstanceRow(spec, root)
	if !ok || row.Table != "instance_template" || row.Key != "map 1902" || row.Core != string(CMaNGOSClassic) || row.SQL != CMaNGOSInstanceSQL(spec) {
		t.Fatalf("row = %+v", row)
	}
	if want := CMaNGOSInstanceSQLPath(CMaNGOSServer{Root: root}, spec); !strings.Contains(row.Reason, want) {
		t.Errorf("reason %q lacks %s", row.Reason, want)
	}
	if row, _ := CMaNGOSInstanceRow(spec, ""); !strings.Contains(row.Reason, "once one is set") {
		t.Errorf("without a folder: %q", row.Reason)
	}
	spec.Info.Type = 0
	if _, ok := CMaNGOSInstanceRow(spec, root); ok {
		t.Error("a world map got a row")
	}
}

// PublishCMaNGOS writes the map into the client's patch, its instance_template SQL into the server's
// meld-sql folder and rebuilds the server's map data with its extractors; a second publish of the same
// map over map data newer than the patch runs nothing; a stock extractor is refused before the patch
// is written.
func TestPublishCMaNGOS(t *testing.T) {
	cache, oldRoot := t.TempDir(), pendingRoot
	pendingRoot = func() string { return cache }
	defer func() { pendingRoot = oldRoot }()

	client := chainClient(t)
	dataDir := filepath.Join(client, "Data")
	spec := cmangosDungeon()

	stock, _ := cmangosFixture(t, false)
	run := cmangosRunner(stock.Data, 0, chainID)
	if _, err := PublishCMaNGOS(stock, client, spec, true, run, func(string) {}); !errors.Is(err, ErrStockExtractor) || len(run.calls) != 0 {
		t.Fatalf("a stock extractor: %v, calls %q", err, run.calls)
	}
	if _, err := os.Stat(PatchPath(dataDir)); !os.IsNotExist(err) {
		t.Fatalf("the patch was written before the extractor was refused: %v", err)
	}

	s, _ := cmangosFixture(t, true)
	run = cmangosRunner(s.Data, 0, chainID)
	run.writes["ad.exe"] = append(run.writes["ad.exe"], "meld-staging/maps/19021010.map", "meld-staging/maps/19021110.map")
	var log []string
	sqlPath, err := PublishCMaNGOS(s, client, spec, true, run, func(l string) { log = append(log, l) })
	if err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(log, "\n"))
	}
	if want := filepath.Join(s.Root, "meld-sql", chainMap+"_instance_template.sql"); sqlPath != want || CMaNGOSInstanceSQLPath(s, spec) != want {
		t.Errorf("SQL path %q, want %q", sqlPath, want)
	}
	if got := readText(t, sqlPath); got != CMaNGOSInstanceSQL(spec) {
		t.Errorf("the SQL file holds %q", got)
	}
	if patchFile(t, dataDir, adt.TilePath(chainMap, 10, 10, "")) == nil {
		t.Error("the patch lacks the map's tile")
	}
	if len(run.calls) != 3 || !strings.Contains(run.calls[0], "ad.exe") {
		t.Fatalf("calls %q; want the three extractors, no MoveMapGen", run.calls)
	}
	if got := readText(t, filepath.Join(s.Data, "maps", "19021010.map")); got != "new" {
		t.Errorf("the server's map file = %q", got)
	}

	// Unchanged, over map data newer than the patch: nothing runs, and the SQL is written again.
	later := time.Now().Add(time.Hour)
	for _, f := range []string{"19021010.map", "19021110.map"} {
		if err := os.Chtimes(filepath.Join(s.Data, "maps", f), later, later); err != nil {
			t.Fatal(err)
		}
	}
	os.Remove(sqlPath)
	run.calls, log = nil, nil
	if _, err := PublishCMaNGOS(s, client, spec, true, run, func(l string) { log = append(log, l) }); err != nil || len(run.calls) != 0 {
		t.Fatalf("an unchanged publish: %v, calls %q", err, run.calls)
	}
	if !strings.Contains(strings.Join(log, "\n"), "Nothing changed") || readText(t, sqlPath) == "(missing)" {
		t.Errorf("log %q", log)
	}

	// A world map writes no SQL.
	spec.Info.Type = 0
	if p, err := PublishCMaNGOS(s, client, spec, true, run, func(string) {}); err != nil || p != "" {
		t.Errorf("a world map: %q, %v", p, err)
	}
}
