package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// externalConfFile writes a mangosd.conf copy for an external server (#856) and returns its path.
func externalConfFile(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "mangosd.conf")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// useExternal sets the external database for one test.
func useExternal(t *testing.T, path string) {
	t.Helper()
	SetExternal(path)
	t.Cleanup(func() { SetExternal("") })
}

const externalBody = "WorldDatabase.Info = \"db.example.org;3306;editor;s3cret;world\"\n" +
	"CharacterDatabase.Info = \"db.example.org;3306;editor;s3cret;chars\"\n" +
	"LoginDatabase.Info = \"login.example.org;3310;realm;other;realmd\"\n"

func TestReadExternalNamesTheDatabasesWithoutPasswords(t *testing.T) {
	got, err := ReadExternal(externalConfFile(t, externalBody))
	if err != nil {
		t.Fatal(err)
	}
	if got.World != (DatabaseRef{Host: "db.example.org", Port: "3306", User: "editor", Name: "world"}) {
		t.Errorf("world %+v", got.World)
	}
	if got.Characters.Name != "chars" || got.Login != (DatabaseRef{Host: "login.example.org", Port: "3310", User: "realm", Name: "realmd"}) {
		t.Errorf("characters %+v, login %+v", got.Characters, got.Login)
	}
	// Only the world database is required.
	only, err := ReadExternal(externalConfFile(t, "WorldDatabase.Info = \"h;1;u;p;w\"\n"))
	if err != nil || only.World.Name != "w" || only.Login.Name != "" {
		t.Errorf("world only: %+v %v", only, err)
	}
	if _, err := ReadExternal(externalConfFile(t, "LoginDatabase.Info = \"h;1;u;p;d\"\n")); err == nil {
		t.Error("a conf without a world database was read")
	}
}

func TestExternalReplacesTheFoldersDatabases(t *testing.T) {
	root := soapServer(t, "")
	useExternal(t, externalConfFile(t, externalBody))
	for key, want := range map[string]string{"WorldDatabase.Info": "world", "CharacterDatabase.Info": "chars", "LoginDatabase.Info": "realmd"} {
		got, err := confDatabase(root, key)
		if err != nil || got.name != want || got.password == "" {
			t.Errorf("%s: %+v %v", key, got, err)
		}
	}
	// No server folder at all: the external conf is enough.
	if got, err := confDatabase("", "WorldDatabase.Info"); err != nil || got.host != "db.example.org" {
		t.Errorf("no folder: %+v %v", got, err)
	}
	if !hasDatabase("") {
		t.Error("an external database is no database")
	}
	SetExternal("")
	if got, err := confDatabase(root, "WorldDatabase.Info"); err != nil || got.port != "1" {
		t.Errorf("after disconnecting: %+v %v", got, err)
	}
	if hasDatabase("") {
		t.Error("no folder and no external database is a database")
	}
}

func TestExternalDatabaseIsNeverStartedOrStopped(t *testing.T) {
	root := soapServer(t, "")
	f := &fakeDatabase{up: false, datadir: batchEscaped(filepath.Join(root, "database"))}
	f.install(t)
	var hosts []string
	inner := runSQL
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		hosts = append(hosts, db.host)
		return inner(db, sql)
	}
	useExternal(t, externalConfFile(t, externalBody))

	err := ensureDatabase(worldDB{host: "db.example.org", port: "3306"}, root)
	if err == nil || !strings.Contains(err.Error(), "external database at db.example.org:3306") {
		t.Fatalf("down external database: %v", err)
	}
	if err := StartDatabase(root); !errors.Is(err, ErrExternalDatabase) {
		t.Fatalf("start: %v", err)
	}
	f.up = true
	if err := StopDatabase(root); !errors.Is(err, ErrExternalDatabase) || f.shutdowns != 0 {
		t.Fatalf("stop: %v, %d shutdowns", err, f.shutdowns)
	}
	if running, own := DatabaseState(root); running || own {
		t.Fatalf("state of the local database while external: %v %v", running, own)
	}
	for _, h := range hosts {
		if h != "db.example.org" {
			t.Fatalf("queried %s while the external database is set", h)
		}
	}
}

func TestSetExternalForgetsTheDatabaseLists(t *testing.T) {
	templatesMu.Lock()
	creaturesCache["k"] = []CreatureTemplate{{Entry: 1}}
	templatesMu.Unlock()
	useExternal(t, externalConfFile(t, externalBody))
	templatesMu.Lock()
	n := len(creaturesCache)
	templatesMu.Unlock()
	if n != 0 {
		t.Fatalf("%d creature lists kept across a database switch", n)
	}
}
