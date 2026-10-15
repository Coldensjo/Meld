package game

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"Meld/internal/config"
	"Meld/internal/vmangos"
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
	if name == "taskkill" {
		image, forced := args[len(args)-1], args[0] == "/F"
		if image != f.stuck || forced {
			delete(f.running, image)
		}
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

func TestStopForceClosesAuthThatHasNoWindow(t *testing.T) {
	exitWait = 10 * time.Millisecond
	authGrace = 10 * time.Millisecond
	defer func() { exitWait, authGrace = 20*time.Second, 3*time.Second }()
	run := &fakeRunner{running: map[string]bool{authImage: true}, stuck: authImage}
	c, err := session(run, "server").Stop()
	if err != nil {
		t.Fatal(err)
	}
	if !c.Auth {
		t.Fatalf("closed = %+v, want the auth server closed", c)
	}
	if last := run.calls[len(run.calls)-1]; !strings.HasPrefix(last, "taskkill /F") {
		t.Fatalf("last call = %q, want a forced close", last)
	}
}

func TestStopDoesNotForceTheWorldServer(t *testing.T) {
	exitWait = 10 * time.Millisecond
	defer func() { exitWait = 20 * time.Second }()
	run := &fakeRunner{running: map[string]bool{worldImage: true}, stuck: worldImage}
	if _, err := session(run, "server").Stop(); err == nil {
		t.Fatal("the world server was stopped by force")
	}
	for _, c := range run.calls {
		if strings.HasPrefix(c, "taskkill /F") {
			t.Fatalf("call %q forces the world server", c)
		}
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

// envRunner is a fakeRunner that can start a program with an environment, as OSRunner does.
type envRunner struct {
	fakeRunner
	dir string
	env []string
}

func (f *envRunner) StartEnv(dir, name string, env []string, args ...string) error {
	f.dir, f.env = dir, env
	return f.Start(dir, name, args...)
}

// With Benilla as the game, a session closes benilla.exe (not Wow.exe) and starts it from its folder
// with the install's Data folder and the login in its environment.
func TestSessionWithBenilla(t *testing.T) {
	r := &envRunner{fakeRunner: fakeRunner{running: map[string]bool{"benilla.exe": true, "Wow.exe": true}}}
	s := Session{ClientRoot: `C:\WoW`, Benilla: `C:\benilla`, Login: config.Login{Account: "MELD", Password: "secret"}, Run: r}
	c, err := s.Stop()
	if err != nil {
		t.Fatal(err)
	}
	if !c.Game || r.running["benilla.exe"] || !r.running["Wow.exe"] {
		t.Fatalf("closed %+v, running %v", c, r.running)
	}
	if err := s.Start(c); err != nil {
		t.Fatal(err)
	}
	want := []string{"WOW_DATA=" + filepath.Join(`C:\WoW`, "Data"), "WOW_USER=MELD", "WOW_PASS=secret"}
	if r.dir != `C:\benilla` || strings.Join(r.env, "|") != strings.Join(want, "|") || !r.running["benilla.exe"] {
		t.Fatalf("started from %q with %v", r.dir, r.env)
	}
}
