package game

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"WorldEditor/internal/config"
	"WorldEditor/internal/vmangos"
)

// fakeRunner keeps a set of running images. taskkill stops an image, and Start runs one.
type fakeRunner struct {
	running map[string]bool
	calls   []string
	// stuck names an image that taskkill can't stop.
	stuck string
}

func (f *fakeRunner) Run(dir, name string, args []string, log func(string)) error {
	f.calls = append(f.calls, name+" "+strings.Join(args, " "))
	if name == "taskkill" && args[1] != f.stuck {
		delete(f.running, args[1])
	}
	return nil
}

func (f *fakeRunner) Start(dir, name string, args ...string) error {
	f.calls = append(f.calls, "START "+filepath.Base(name))
	f.running[filepath.Base(name)] = true
	return nil
}

func (f *fakeRunner) Running(image string) bool { return f.running[image] }

func session(run vmangos.Runner, server string) Session {
	return Session{ClientRoot: "client", ServerRoot: server, Run: run, Ready: func(int) bool { return true }}
}

func TestStopClosesOnlyWhatIsRunning(t *testing.T) {
	run := &fakeRunner{running: map[string]bool{gameImage: true, worldImage: true}}
	c, err := session(run, "server").Stop()
	if err != nil {
		t.Fatal(err)
	}
	if want := (Closed{Game: true, World: true}); c != want {
		t.Fatalf("closed = %+v, want %+v", c, want)
	}
	if len(run.calls) != 2 || !strings.Contains(run.calls[0], "Wow.exe") || !strings.Contains(run.calls[1], "mangosd.exe") {
		t.Fatalf("calls = %q", run.calls)
	}
}

func TestStopLeavesServersAloneWithoutAServerFolder(t *testing.T) {
	run := &fakeRunner{running: map[string]bool{gameImage: true, worldImage: true, authImage: true}}
	c, err := session(run, "").Stop()
	if err != nil {
		t.Fatal(err)
	}
	if want := (Closed{Game: true}); c != want {
		t.Fatalf("closed = %+v, want %+v", c, want)
	}
	if !run.running[worldImage] || !run.running[authImage] {
		t.Fatal("the servers were stopped without a server folder")
	}
}

func TestStopReportsAProgramThatWontClose(t *testing.T) {
	exitWait = 10 * time.Millisecond
	defer func() { exitWait = 20 * time.Second }()
	run := &fakeRunner{running: map[string]bool{gameImage: true, worldImage: true}, stuck: worldImage}
	c, err := session(run, "server").Stop()
	if err == nil || !strings.Contains(err.Error(), worldImage) {
		t.Fatalf("err = %v, want one naming %s", err, worldImage)
	}
	// The game closed before the world server got stuck, so Start still brings the game back.
	if !c.Game || c.World {
		t.Fatalf("closed = %+v", c)
	}
}

func TestStartOpensAuthWorldThenGame(t *testing.T) {
	run := &fakeRunner{running: map[string]bool{}}
	s := session(run, "server")
	s.Login = config.Login{}
	if err := s.Start(Closed{Game: true, World: true, Auth: true}); err != nil {
		t.Fatal(err)
	}
	want := []string{"START realmd.exe", "START mangosd.exe", "START Wow.exe"}
	if strings.Join(run.calls, "|") != strings.Join(want, "|") {
		t.Fatalf("calls = %q, want %q", run.calls, want)
	}
}

func TestStartOpensNothingThatWasNotClosed(t *testing.T) {
	run := &fakeRunner{running: map[string]bool{}}
	if err := session(run, "server").Start(Closed{}); err != nil {
		t.Fatal(err)
	}
	if len(run.calls) != 0 {
		t.Fatalf("calls = %q", run.calls)
	}
}

func TestStartJoinsErrorsAndTriesEveryStep(t *testing.T) {
	run := &failingStarter{fakeRunner: fakeRunner{running: map[string]bool{}}}
	err := session(run, "server").Start(Closed{World: true, Game: true})
	if err == nil {
		t.Fatal("no error")
	}
	if len(run.calls) != 2 {
		t.Fatalf("calls = %q, want both the server and the game tried", run.calls)
	}
	if !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want the start failure", err)
	}
}

var errBoom = errors.New("boom")

// failingStarter fails every Start.
type failingStarter struct{ fakeRunner }

func (f *failingStarter) Start(dir, name string, args ...string) error {
	f.calls = append(f.calls, "START "+filepath.Base(name))
	return errBoom
}
