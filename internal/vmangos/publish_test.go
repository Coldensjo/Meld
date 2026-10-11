package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeRunner records the programs a publish runs, and fails the one named in failAt.
type fakeRunner struct {
	calls  []string
	failAt string
}

func (f *fakeRunner) Run(dir, name string, args []string, log func(string)) error {
	f.calls = append(f.calls, name+" "+strings.Join(args, " "))
	if f.failAt != "" && strings.Contains(name, f.failAt) {
		return errors.New("failed")
	}
	return nil
}

func (f *fakeRunner) Start(dir, name string, args ...string) error {
	f.calls = append(f.calls, "START "+name)
	return nil
}

func (f *fakeRunner) Running(image string) bool { return false }

// serverFolder makes a server folder with its configuration and map table.
func serverFolder(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "run"), 0o755)
	os.MkdirAll(filepath.Join(root, "data", "5875", "dbc"), 0o755)
	conf := "WorldDatabase.Info = \"127.0.0.1;3307;mangos;secret;mangos\"\n"
	os.WriteFile(filepath.Join(root, "run", "mangosd.conf"), []byte(conf), 0o644)
	return root
}

func TestPublishServerRunsStepsInOrder(t *testing.T) {
	server := serverFolder(t)
	client := t.TempDir()
	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: client, ServerRoot: server, Mariadb: "mariadb", Run: f}
	spec := MapSpec{Dir: "MyMap", MapID: 1900}
	if err := publishServer(p, filepath.Join(client, "Data"), spec, func(string) {}); err != nil {
		t.Fatal(err)
	}
	want := []string{"mariadb", "taskkill", "MapExtractor.exe", "VMapExtractor.exe", "VMapAssembler.exe", "START"}
	if len(f.calls) != len(want) {
		t.Fatalf("calls = %q", f.calls)
	}
	for i, w := range want {
		if !strings.Contains(f.calls[i], w) {
			t.Fatalf("call %d = %q, want %q", i, f.calls[i], w)
		}
	}
	if !strings.Contains(f.calls[0], "-p"+"secret") || !strings.Contains(f.calls[0], "INSERT IGNORE INTO map_template") || !strings.Contains(f.calls[0], "'MyMap'") {
		t.Fatalf("world database call = %q", f.calls[0])
	}
}

func TestPublishServerStopsBeforeStartingOnFailure(t *testing.T) {
	server := serverFolder(t)
	f := &fakeRunner{failAt: "MapExtractor"}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
	err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), MapSpec{Dir: "MyMap", MapID: 1900}, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "map extraction") {
		t.Fatalf("err = %v", err)
	}
	for _, c := range f.calls {
		if strings.HasPrefix(c, "START") {
			t.Fatal("the world server was started after a failed extraction")
		}
	}
}

func TestWorldDatabaseFromConfig(t *testing.T) {
	server := serverFolder(t)
	db, err := worldDatabase(server)
	if err != nil {
		t.Fatal(err)
	}
	if db.host != "127.0.0.1" || db.port != "3307" || db.user != "mangos" || db.password != "secret" || db.name != "mangos" {
		t.Fatalf("db = %+v", db)
	}
}
