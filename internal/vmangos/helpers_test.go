package vmangos

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// Synthetic tests (#484) for the SQL and conversion helpers that need no client or database.

func quatNear(a, b [4]float64) bool {
	for i := range a {
		if math.Abs(a[i]-b[i]) > 1e-9 {
			return false
		}
	}
	return true
}

// tilted(o, tiltOf(o, q)) gives q back, and an object that only turns about Z has no tilt.
func TestTiltRoundTrip(t *testing.T) {
	for _, o := range []float64{0, 1.2, -2.5, math.Pi} {
		if got := tiltOf(o, facing(o)); got != nil {
			t.Errorf("o=%g: an upright object has tilt %v", o, got)
		}
		// A 30 degree lean about X, then turned about Z by 0.7.
		lean := [4]float64{math.Sin(math.Pi / 12), 0, 0, math.Cos(math.Pi / 12)}
		q := mulQuat(facing(0.7), lean)
		tilt := tiltOf(o, q)
		if tilt == nil || len(tilt) != 4 {
			t.Fatalf("o=%g: a leaning object lost its tilt: %v", o, tilt)
		}
		if back := tilted(o, tilt); !quatNear(back, q) {
			t.Errorf("o=%g: round trip gave %v, want %v", o, back, q)
		}
	}
}

// A tilt keeps its lean while the facing changes: the new rotation is the tilt turned by the new facing.
func TestTiltFollowsFacing(t *testing.T) {
	lean := [4]float64{0.2588190451, 0, 0, 0.9659258263}
	q := mulQuat(facing(1), lean)
	tilt := tiltOf(1, q)
	want := mulQuat(facing(2), lean)
	if got := tilted(2, tilt); !quatNear(got, want) {
		t.Errorf("turned to 2: %v, want %v", got, want)
	}
}

func TestPoolSQLRows(t *testing.T) {
	s := Spawn{GUID: 77, Pool: 5, PoolChance: 25, PoolName: "It's a pool"}

	if sql, why := poolSQL(s, &s, "creature"); sql != nil || why != "" {
		t.Errorf("unchanged pool wrote %v %q", sql, why)
	}
	// A spawn the database doesn't have, with no pool, writes nothing.
	if sql, why := poolSQL(Spawn{GUID: 1}, nil, "creature"); sql != nil || why != "" {
		t.Errorf("no pool wrote %v %q", sql, why)
	}

	sql, why := poolSQL(s, nil, "creature")
	if why != "" || len(sql) != 1 {
		t.Fatalf("new pool: %v %q", sql, why)
	}
	for _, want := range []string{"INSERT INTO `pool_creature`", "VALUES (77, 5, 25, 'It\\'s a pool')", "ON DUPLICATE KEY UPDATE"} {
		if !strings.Contains(sql[0], want) {
			t.Errorf("missing %q in %s", want, sql[0])
		}
	}

	sql, _ = poolSQL(s, nil, "gameobject")
	if len(sql) != 1 || !strings.Contains(sql[0], "`pool_gameobject`") {
		t.Errorf("object pool went to %v", sql)
	}

	// Only the chance changed.
	was := s
	s.PoolChance = 50
	if sql, _ := poolSQL(s, &was, "creature"); len(sql) != 1 || !strings.Contains(sql[0], "VALUES (77, 5, 50,") {
		t.Errorf("changed chance: %v", sql)
	}

	// Left its pool.
	gone := Spawn{GUID: 77}
	sql, why = poolSQL(gone, &was, "creature")
	if why != "" || len(sql) != 1 || sql[0] != "DELETE FROM `pool_creature` WHERE `guid` = 77;" {
		t.Errorf("left pool: %v %q", sql, why)
	}

	// A chance is held to 0..100; a nameless pool gets one made of its number.
	hi := Spawn{GUID: 3, Pool: 9, PoolChance: 250}
	sql, _ = poolSQL(hi, nil, "creature")
	if len(sql) != 1 || !strings.Contains(sql[0], "VALUES (3, 9, 100, 'Meld pool 9')") {
		t.Errorf("clamped chance: %v", sql)
	}

	for _, pool := range []int{-1, MaxPoolEntry + 1} {
		sql, why := poolSQL(Spawn{GUID: 3, Pool: pool}, nil, "creature")
		if sql != nil || why == "" {
			t.Errorf("pool %d: %v %q", pool, sql, why)
		}
	}
	if sql, why := poolSQL(Spawn{GUID: 3, Pool: MaxPoolEntry}, nil, "creature"); len(sql) != 1 || why != "" {
		t.Errorf("the largest pool is refused: %v %q", sql, why)
	}
}

func TestMotherSQL(t *testing.T) {
	sql, why := motherSQL(Spawn{Pool: 4})
	if why != "" || len(sql) != 2 || sql[1] != "DELETE FROM `pool_pool` WHERE `pool_id` = 4;" {
		t.Errorf("no mother: %v %q", sql, why)
	}
	sql, why = motherSQL(Spawn{Pool: 4, MotherPool: 8, PoolName: "Herbs"})
	if why != "" || len(sql) != 2 || !strings.Contains(sql[1], "VALUES (4, 8, 0, 'Herbs')") || !strings.Contains(sql[1], "ON DUPLICATE KEY UPDATE") {
		t.Errorf("mother: %v %q", sql, why)
	}
	for _, m := range []int{-3, MaxPoolEntry + 1, 4} {
		sql, why := motherSQL(Spawn{Pool: 4, MotherPool: m})
		if sql != nil || why == "" {
			t.Errorf("mother %d: %v %q", m, sql, why)
		}
	}
	if _, why := motherSQL(Spawn{Pool: 4, MotherPool: 4}); !strings.Contains(why, "itself") {
		t.Errorf("self mother reason: %q", why)
	}
}

func TestFormationSQLRows(t *testing.T) {
	member := Spawn{GUID: 10, Leader: 9, FollowDist: 3, FollowAngle: -math.Pi / 2, GroupFlags: 3}

	if got := formationSQL(member, &member); got != nil {
		t.Errorf("unchanged formation wrote %v", got)
	}
	if got := formationSQL(Spawn{GUID: 10}, nil); got != nil {
		t.Errorf("no formation wrote %v", got)
	}

	// A new member: one REPLACE, with the angle in [0, 2pi) and no negative distance or flags.
	got := formationSQL(member, nil)
	if len(got) != 1 || !strings.HasPrefix(got[0], "REPLACE INTO `creature_groups`") {
		t.Fatalf("new member: %v", got)
	}
	if want := "VALUES (9, 10, 3, " + num(1.5*math.Pi) + ", 3);"; !strings.HasSuffix(got[0], want) {
		t.Errorf("member row %s, want it to end %s", got[0], want)
	}
	odd := Spawn{GUID: 10, Leader: 9, FollowDist: -4, GroupFlags: -1}
	if got := formationSQL(odd, nil); len(got) != 1 || !strings.HasSuffix(got[0], "VALUES (9, 10, 0, 0, 0);") {
		t.Errorf("negative values: %v", got)
	}

	// Left the formation: only its own row goes.
	left := Spawn{GUID: 10}
	if got := formationSQL(left, &member); len(got) != 1 || got[0] != "DELETE FROM `creature_groups` WHERE `member_guid` = 10;" {
		t.Errorf("member left: %v", got)
	}

	// A leader that stops leading takes the group's rows with it.
	lead := Spawn{GUID: 9, Leader: 9, GroupFlags: 1}
	if got := formationSQL(Spawn{GUID: 9}, &lead); len(got) != 1 || got[0] != "DELETE FROM `creature_groups` WHERE `leader_guid` = 9 OR `member_guid` = 9;" {
		t.Errorf("leader left: %v", got)
	}
	// ... and one that moves to another group is deleted from the old one, then written in the new.
	got = formationSQL(Spawn{GUID: 9, Leader: 20, FollowDist: 1}, &lead)
	if len(got) != 2 || !strings.Contains(got[0], "`leader_guid` = 9 OR") || !strings.Contains(got[1], "VALUES (20, 9, 1, 0, 0);") {
		t.Errorf("leader joined another: %v", got)
	}
}

func TestSlotAngle(t *testing.T) {
	for in, want := range map[float64]float64{0: 0, 1: 1, -math.Pi: math.Pi, 3 * math.Pi: math.Pi, math.NaN(): 0, math.Inf(1): 0} {
		if got := slotAngle(in); math.Abs(got-want) > 1e-9 {
			t.Errorf("slotAngle(%v) = %v, want %v", in, got, want)
		}
	}
}

func TestParseWaypoints(t *testing.T) {
	tile := float64(adt.TileSize)
	zp := float64(adt.ZeroPoint)
	// Server x and y 100, 200 on tile (1, 2): the editor's X is from the server's y.
	raw := []byte("5\t1\t100\t200\t30.5\t1.5\t2000\t7\t4\r\n" +
		"5\t2\t101\t201\t31\t0\t0\t0\t0\r\n" +
		"6\t1\t0\t0\t0\t0\t0\t0\t0\n" +
		"bad\t1\t0\t0\t0\t0\t0\t0\t0\n" + // owner not a number
		"7\t1\tx\t0\t0\t0\t0\t0\t0\n" + // coordinate not a number
		"8\t1\t0\t0\t0\t0\t0\n") // short row
	got := parseWaypoints(raw, 1, 2)
	if len(got) != 2 || len(got[5]) != 2 || len(got[6]) != 1 {
		t.Fatalf("owners: %+v", got)
	}
	w := got[5][0]
	want := Waypoint{
		X: float32(zp - 200 - 1*tile), Z: float32(zp - 100 - 2*tile), Y: 30.5,
		Orientation: 1.5, WaitMs: 2000, WanderDistance: 4, ScriptID: 7,
	}
	if !reflect.DeepEqual(w, want) {
		t.Errorf("first point %+v, want %+v", w, want)
	}
	if got[5][1].Y != 31 {
		t.Errorf("points out of order: %+v", got[5])
	}
	if len(parseWaypoints(nil, 0, 0)) != 0 {
		t.Error("no rows gave paths")
	}
}

func writeConf(t *testing.T, body string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "run"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "run", "mangosd.conf"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestConfDatabase(t *testing.T) {
	conf := "# WorldDatabase.Info = \"bad;1;x;y;z\"\r\n" +
		"  #WorldDatabase.Info = \"bad;1;x;y;z\"\r\n" +
		"LoginDatabase.Info = \"127.0.0.1;3307;mangos;pass word;realmd\"\r\n" +
		"WorldDatabase.Info     = \"localhost;3307;root;my secret pw;mangos\"\r\n"
	root := writeConf(t, conf)

	got, err := confDatabase(root, "WorldDatabase.Info")
	if err != nil {
		t.Fatal(err)
	}
	if want := (worldDB{host: "localhost", port: "3307", user: "root", password: "my secret pw", name: "mangos"}); got != want {
		t.Errorf("world %+v, want %+v", got, want)
	}
	got, err = confDatabase(root, "LoginDatabase.Info")
	if err != nil || got.password != "pass word" || got.name != "realmd" {
		t.Errorf("login %+v %v", got, err)
	}
	// The password goes in the environment, never on the command line, where any process reads it (#482).
	if args := got.args("SELECT 1"); !reflect.DeepEqual(args, []string{"-h", "127.0.0.1", "-P", "3307", "-u", "mangos", "realmd", "-e", "SELECT 1"}) {
		t.Errorf("args %v", args)
	}
	if env := got.env(); !reflect.DeepEqual(env, []string{"MYSQL_PWD=pass word"}) {
		t.Errorf("env %v", env)
	}
	warned := "WARNING: option --ssl-verify-server-cert is disabled, because of an insecure passwordless login.\r\nERROR 1045 (28000): Access denied\r\n"
	if got := mariadbError(warned); got != "ERROR 1045 (28000): Access denied" {
		t.Errorf("mariadbError = %q", got)
	}

	// Only comments, a missing key, a line without quotes, a short line, a bad port: all "has no key".
	for name, body := range map[string]string{
		"comment":  "# WorldDatabase.Info = \"h;1;u;p;d\"\n",
		"absent":   "LoginDatabase.Info = \"h;1;u;p;d\"\n",
		"unquoted": "WorldDatabase.Info = h;1;u;p;d\n",
		"short":    "WorldDatabase.Info = \"h;1;u;p\"\n",
		"port":     "WorldDatabase.Info = \"h;port;u;p;d\"\n",
		"empty":    "",
	} {
		_, err := confDatabase(writeConf(t, body), "WorldDatabase.Info")
		if err == nil || !strings.Contains(err.Error(), "has no WorldDatabase.Info") {
			t.Errorf("%s: %v", name, err)
		}
	}
	// A missing file is the read error, not "has no key".
	if _, err := confDatabase(t.TempDir(), "WorldDatabase.Info"); err == nil || strings.Contains(err.Error(), "has no") {
		t.Errorf("missing conf: %v", err)
	}
}

func TestCantConnect(t *testing.T) {
	for msg, want := range map[string]bool{
		"ERROR 2002 (HY000): Can't connect to local server":          true,
		"ERROR 2003 (HY000): Can't connect to server on 'localhost'": true,
		"Can't connect": true,
		"ERROR 1045 (28000): Access denied for user":        false,
		"ERROR 1064 (42000): You have an error in your SQL": false,
	} {
		if got := cantConnect(errors.New(msg)); got != want {
			t.Errorf("%q: %v", msg, got)
		}
	}
	if cantConnect(nil) {
		t.Error("nil error is a connect failure")
	}
}

func TestTeleAndPlaceSQL(t *testing.T) {
	s := CharacterSpot{Map: 1, X: -1234.5, Y: 77.25, Z: 9.0000004, O: 3.14}
	tele := teleSQL(s)
	for _, want := range []string{
		"DELETE FROM game_tele WHERE name = 'meld_here';\n",
		"SELECT COALESCE(MAX(id), 0) + 1, -1234.5, 77.25, 9, 3.14, 1, 'meld_here' FROM game_tele;",
	} {
		if !strings.Contains(tele, want) {
			t.Errorf("teleSQL missing %q in:\n%s", want, tele)
		}
	}
	if strings.Count(tele, ";") != 2 {
		t.Errorf("teleSQL should be two statements:\n%s", tele)
	}

	place := placeSQL("O'Brien\\", s)
	for _, want := range []string{
		"UPDATE characters SET map = 1, instance = 0, position_x = -1234.5, position_y = 77.25, position_z = 9, orientation = 3.14, ",
		"transport_guid = 0", "current_taxi_path = ''",
		"WHERE name = 'O\\'Brien\\\\'",
	} {
		if !strings.Contains(place, want) {
			t.Errorf("placeSQL missing %q in:\n%s", want, place)
		}
	}
}

func TestCarryOver(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "old.MPQ")
	old := []mpq.File{
		{Name: `World\Maps\X\X_1_1.adt`, Data: []byte("old tile")},
		{Name: `World\Maps\X\X_1_2.adt`, Data: []byte("kept tile")},
		{Name: `Textures\Minimap\a.blp`, Data: []byte("kept minimap")},
	}
	if err := os.WriteFile(path, mpq.Write(old), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := mpq.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	// The replaced name matches in any case and with either slash.
	keep, err := carryOver(a, []mpq.File{{Name: "world/maps/x/x_1_1.ADT", Data: []byte("new")}})
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, e := range keep {
		names[strings.ToUpper(e.Name)] = true
		if e.Name == "" || e.Name[0] == '(' {
			t.Errorf("marker %q carried over", e.Name)
		}
	}
	if len(keep) != 2 || !names[`WORLD\MAPS\X\X_1_2.ADT`] || !names[`TEXTURES\MINIMAP\A.BLP`] {
		t.Errorf("carried %v", names)
	}
	for _, e := range keep {
		if e.Size == 0 || e.Data == nil {
			t.Errorf("%s has no data", e.Name)
		}
	}

	// Nothing replaced: everything stays; everything replaced: nothing does.
	if keep, _ := carryOver(a, nil); len(keep) != 3 {
		t.Errorf("nothing replaced kept %d", len(keep))
	}
	if keep, _ := carryOver(a, old); len(keep) != 0 {
		t.Errorf("all replaced kept %d", len(keep))
	}
}

func TestIsMapTile(t *testing.T) {
	// The map ID in three digits, then y and x in two each, then ".map".
	for name, want := range map[string]bool{
		"0010203.map":    true,
		"001.map":        false,
		"00102030.map":   false,
		"0020203.map":    false,
		"0010203.vmtile": false,
		"0010203.MAP":    false,
	} {
		if got := isMapTile(name, 1); got != want {
			t.Errorf("isMapTile(%q, 1) = %v", name, got)
		}
	}
	if !isMapTile("5300203.map", 530) || isMapTile("5300203.map", 53) {
		t.Error("map 530's tile mismatched")
	}
}

func TestServerMapsCurrent(t *testing.T) {
	root := t.TempDir()
	maps := filepath.Join(root, "data", "maps")
	if err := os.MkdirAll(maps, 0o755); err != nil {
		t.Fatal(err)
	}
	patch := filepath.Join(t.TempDir(), "patch-3.MPQ")
	base := time.Now().Add(-time.Hour)
	set := func(p string, at time.Time) {
		t.Helper()
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, at, at); err != nil {
			t.Fatal(err)
		}
	}

	if serverMapsCurrent(root, 1, patch) {
		t.Error("current without a patch")
	}
	set(patch, base)
	if serverMapsCurrent(root, 1, patch) {
		t.Error("current without any tile")
	}
	set(filepath.Join(maps, "0010203.map"), base.Add(-time.Minute))
	if serverMapsCurrent(root, 1, patch) {
		t.Error("an older tile counts as current")
	}
	set(filepath.Join(maps, "0020203.map"), base.Add(time.Minute))
	set(filepath.Join(maps, "0010203.vmtile"), base.Add(time.Minute))
	if serverMapsCurrent(root, 1, patch) {
		t.Error("another map's or file's newer tile counts")
	}
	set(filepath.Join(maps, "0010204.map"), base.Add(time.Minute))
	if !serverMapsCurrent(root, 1, patch) {
		t.Error("a newer tile of the map is not current")
	}
	if serverMapsCurrent(t.TempDir(), 1, patch) {
		t.Error("current without a maps folder")
	}
}

func starterTables() SpellTables {
	return SpellTables{
		CastTimes: []SpellOption{{ID: 1, Value: 1500, Scaled: true}, {ID: 2, Value: 1500}, {ID: 3, Value: 0}, {ID: 4, Value: 2500}},
		Ranges:    []SpellOption{{ID: 5, Value: 30}, {ID: 6, Value: 5}, {ID: 7, Value: 40}, {ID: 8, Value: 0}},
		Durations: []SpellOption{{ID: 9, Value: 15000}, {ID: 10, Value: 1800000}},
		Radii:     []SpellOption{{ID: 11, Value: 10}},
	}
}

func TestStarterValues(t *testing.T) {
	cols := []TemplateColumn{
		{Name: "school", Kind: "uint"}, {Name: "description", Kind: "text"}, {Name: "attributes", Kind: "uint"},
		{Name: "effectBonusCoefficient1", Kind: "float"}, {Name: "castingTimeIndex", Kind: "uint"},
		{Name: "rangeIndex", Kind: "uint"}, {Name: "spellVisual1", Kind: "uint"}, {Name: "spellIconId", Kind: "uint"},
		{Name: "durationIndex", Kind: "uint"}, {Name: "spellLevel", Kind: "uint"}, {Name: "effectRadiusIndex1", Kind: "uint"},
		{Name: "manaCost", Kind: "uint"},
	}
	v, err := starterValues(cols, "bolt", starterTables(), 222, 333)
	if err != nil {
		t.Fatal(err)
	}
	// The unscaled 1.5 sec row (2), not the level-scaled one (1); the 30 yard range.
	for k, want := range map[string]string{
		"school": "2", "castingTimeIndex": "2", "rangeIndex": "5", "spellVisual1": "222", "spellIconId": "333",
		"spellLevel": "1", "attributes": "65536", "effectBonusCoefficient1": "-1", "manaCost": "30", "durationIndex": "0",
		"effectRadiusIndex1": "0",
	} {
		if v[k] != want {
			t.Errorf("%s = %q, want %q", k, v[k], want)
		}
	}
	if !strings.HasPrefix(v["description"], "Hurls") {
		t.Errorf("description %q", v["description"])
	}
	if len(v) != len(cols) {
		t.Errorf("%d values for %d columns", len(v), len(cols))
	}

	// A column the server's table doesn't have is not filled in.
	v, err = starterValues(cols[:2], "bolt", starterTables(), 1, 2)
	if err != nil || len(v) != 2 {
		t.Errorf("fewer columns: %v %v", v, err)
	}
	if _, ok := v["manaCost"]; ok {
		t.Error("filled a column the table lacks")
	}

	// Starters with a duration and a radius pick those rows.
	v, err = starterValues(cols, "dot", starterTables(), 1, 2)
	if err != nil || v["durationIndex"] != "9" {
		t.Errorf("dot: %v %v", v["durationIndex"], err)
	}
	v, err = starterValues(cols, "area", starterTables(), 1, 2)
	if err != nil || v["effectRadiusIndex1"] != "11" {
		t.Errorf("area: %v %v", v["effectRadiusIndex1"], err)
	}

	if _, err := starterValues(cols, "nope", starterTables(), 1, 2); err == nil || !strings.Contains(err.Error(), "no spell starter") {
		t.Errorf("unknown starter: %v", err)
	}
	// A client without the row it needs says which.
	missing := starterTables()
	missing.Ranges = nil
	if _, err := starterValues(cols, "bolt", missing, 1, 2); err == nil || !strings.Contains(err.Error(), "range") {
		t.Errorf("no range: %v", err)
	}
	// Every starter works against a client that has all the rows.
	for _, s := range spellStarters {
		if _, err := starterValues(cols, s.ID, starterTables(), 1, 2); err != nil {
			t.Errorf("%s: %v", s.ID, err)
		}
	}
}

func TestIntRange(t *testing.T) {
	for typ, want := range map[string][2]int64{
		"tinyint(3) unsigned":   {0, 255},
		"tinyint(4)":            {-128, 127},
		"smallint(5) unsigned":  {0, 65535},
		"smallint(6)":           {-32768, 32767},
		"mediumint(8) unsigned": {0, 16777215},
		"mediumint(9)":          {-8388608, 8388607},
		"int(10) unsigned":      {0, 4294967295},
		"int(11)":               {-2147483648, 2147483647},
		"bigint(20) unsigned":   {0, math.MaxInt64},
		"bigint(20)":            {math.MinInt64, math.MaxInt64},
	} {
		if lo, hi := intRange(typ); lo != want[0] || hi != want[1] {
			t.Errorf("%s: %d..%d, want %d..%d", typ, lo, hi, want[0], want[1])
		}
	}
}

func TestSQLValue(t *testing.T) {
	num8 := TemplateColumn{Name: "level", Kind: "uint", Min: 0, Max: 255}
	for in, want := range map[string]string{"0": "0", " 255 ": "255", "007": "7"} {
		if got, err := sqlValue(num8, in); err != nil || got != want {
			t.Errorf("uint %q: %q %v", in, got, err)
		}
	}
	for _, in := range []string{"256", "-1", "1.5", "", "abc"} {
		if got, err := sqlValue(num8, in); err == nil {
			t.Errorf("uint %q accepted as %q", in, got)
		}
	}
	signed := TemplateColumn{Name: "faction", Kind: "int", Min: -128, Max: 127}
	if got, err := sqlValue(signed, "-128"); err != nil || got != "-128" {
		t.Errorf("int min: %q %v", got, err)
	}
	if _, err := sqlValue(signed, "-129"); err == nil || !strings.Contains(err.Error(), "from -128 to 127") {
		t.Errorf("int below: %v", err)
	}
	// A uint with no range given still refuses a negative; an int with none takes any.
	if _, err := sqlValue(TemplateColumn{Name: "u", Kind: "uint"}, "-5"); err == nil {
		t.Error("negative uint accepted")
	}
	if got, err := sqlValue(TemplateColumn{Name: "i", Kind: "int"}, "-5"); err != nil || got != "-5" {
		t.Errorf("unranged int: %q %v", got, err)
	}

	nullable := TemplateColumn{Name: "n", Kind: "int", Nullable: true}
	if got, err := sqlValue(nullable, "  "); err != nil || got != "NULL" {
		t.Errorf("nullable blank: %q %v", got, err)
	}

	fl := TemplateColumn{Name: "speed", Kind: "float"}
	if got, err := sqlValue(fl, "1.25"); err != nil || got != "1.25" {
		t.Errorf("float: %q %v", got, err)
	}
	for _, in := range []string{"x", "NaN", "Inf", "-inf", ""} {
		if got, err := sqlValue(fl, in); err == nil {
			t.Errorf("float %q accepted as %q", in, got)
		}
	}

	txt := TemplateColumn{Name: "name", Kind: "text", MaxLen: 5}
	if got, err := sqlValue(txt, " it's "); err != nil || got != `'it\'s'` {
		t.Errorf("text: %q %v", got, err)
	}
	if got, err := sqlValue(txt, ""); err != nil || got != "''" {
		t.Errorf("empty non-null text: %q %v", got, err)
	}
	if _, err := sqlValue(txt, "toolong"); err == nil || !strings.Contains(err.Error(), "longer than 5") {
		t.Errorf("long text: %v", err)
	}
	if got, err := sqlValue(TemplateColumn{Name: "free", Kind: "text"}, strings.Repeat("a", 500)); err != nil || len(got) != 502 {
		t.Errorf("unlimited text: %d %v", len(got), err)
	}
}
