package game

import (
	"errors"
	"strings"
	"testing"
	"time"

	"Meld/internal/vmangos"
)

// fakeDB stands in for the server folder's database and the world server's SOAP console.
type fakeDB struct {
	up, own bool
	calls   []string
	// soap is what the SOAP shutdown answers; run, when it succeeds, is the runner whose world server
	// it stops.
	soap error
	run  *fakeRunner
}

func (f *fakeDB) install(t *testing.T) {
	t.Helper()
	oldState, oldStart, oldStop, oldShut := databaseState, startDatabase, stopDatabase, shutdownWorld
	oldExit, oldGrace := exitWait, authGrace
	t.Cleanup(func() {
		databaseState, startDatabase, stopDatabase, shutdownWorld = oldState, oldStart, oldStop, oldShut
		exitWait, authGrace = oldExit, oldGrace
	})
	exitWait, authGrace = 10*time.Millisecond, 10*time.Millisecond
	databaseState = func(string) (bool, bool) { return f.up, f.up && f.own }
	startDatabase = func(string) error {
		f.calls = append(f.calls, "start database")
		f.up = true
		return nil
	}
	stopDatabase = func(string) error {
		f.calls = append(f.calls, "stop database")
		if !f.up {
			return nil
		}
		if !f.own {
			return vmangos.ErrForeignDatabase
		}
		f.up = false
		return nil
	}
	shutdownWorld = func(_, account, _ string) error {
		f.calls = append(f.calls, "soap shutdown as "+account)
		if f.soap == nil && f.run != nil {
			delete(f.run.running, worldImage)
		}
		return f.soap
	}
}

func TestStartServerStartsTheDatabaseFirst(t *testing.T) {
	db := &fakeDB{}
	db.install(t)
	run := &fakeRunner{running: map[string]bool{}}
	if err := session(run, "server").StartServer(); err != nil {
		t.Fatal(err)
	}
	if !db.up || !run.running[authImage] || !run.running[worldImage] {
		t.Fatalf("database %v, running %v", db.up, run.running)
	}
	if got := strings.Join(run.calls, "|"); got != "START realmd.exe|START mangosd.exe" {
		t.Fatalf("calls %q", got)
	}
	// Running already: nothing more is started.
	run.calls = nil
	if err := session(run, "server").StartServer(); err != nil || len(run.calls) > 0 {
		t.Fatalf("err %v, calls %q", err, run.calls)
	}
}

func TestStopServerSavesTheWorldThroughSoap(t *testing.T) {
	run := &fakeRunner{running: map[string]bool{worldImage: true, authImage: true}}
	db := &fakeDB{up: true, own: true, run: run}
	db.install(t)
	s := session(run, "server")
	s.Login.Account = "gm"
	if err := s.StopServer(); err != nil {
		t.Fatal(err)
	}
	if len(run.running) != 0 || db.up {
		t.Fatalf("running %v, database %v", run.running, db.up)
	}
	if got := strings.Join(db.calls, "|"); got != "soap shutdown as gm|stop database" {
		t.Fatalf("database calls %q", got)
	}
	for _, c := range run.calls {
		if strings.Contains(c, worldImage) {
			t.Fatalf("the world server was closed by %q after its SOAP shutdown", c)
		}
	}
}

func TestStopServerClosesAndThenForcesTheWorld(t *testing.T) {
	run := &fakeRunner{running: map[string]bool{worldImage: true}, stuck: worldImage}
	db := &fakeDB{soap: vmangos.ErrSoapOff}
	db.install(t)
	if err := session(run, "server").StopServer(); err != nil {
		t.Fatal(err)
	}
	if run.running[worldImage] {
		t.Fatal("the world server still runs")
	}
	if got := strings.Join(run.calls, "|"); got != "taskkill /IM mangosd.exe|taskkill /F /IM mangosd.exe" {
		t.Fatalf("calls %q", got)
	}
}

func TestStopServerLeavesAnotherDatabaseRunning(t *testing.T) {
	db := &fakeDB{up: true, own: false}
	db.install(t)
	var logged []string
	s := session(&fakeRunner{running: map[string]bool{}}, "server")
	s.Log = func(m string) { logged = append(logged, m) }
	if err := s.StopServer(); err != nil {
		t.Fatal(err)
	}
	if !db.up || !strings.Contains(strings.Join(logged, "|"), "left running") {
		t.Fatalf("database up %v, log %q", db.up, logged)
	}
}

func TestRestartServerStopsThenStarts(t *testing.T) {
	run := &fakeRunner{running: map[string]bool{worldImage: true, authImage: true}}
	db := &fakeDB{up: true, own: true, run: run}
	db.install(t)
	s := session(run, "server")
	s.Login.Account = "gm"
	if err := s.RestartServer(); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(db.calls, "|"); got != "soap shutdown as gm|stop database|start database" {
		t.Fatalf("database calls %q", got)
	}
	if !run.running[worldImage] || !run.running[authImage] {
		t.Fatalf("running %v", run.running)
	}
}

func TestServerControlsNeedAServerFolder(t *testing.T) {
	db := &fakeDB{}
	db.install(t)
	s := session(&fakeRunner{running: map[string]bool{}}, "")
	for name, err := range map[string]error{"start": s.StartServer(), "stop": s.StopServer(), "restart": s.RestartServer()} {
		if !errors.Is(err, errNoServer) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if len(db.calls) > 0 {
		t.Fatalf("database calls %q", db.calls)
	}
	if (s.ServerState() != ServerState{}) {
		t.Fatal("a state without a server folder")
	}
}
