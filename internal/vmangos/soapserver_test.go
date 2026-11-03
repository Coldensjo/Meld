package vmangos

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
)

// liveSoapEnv is the variable that lets a test start the world server with its SOAP console on
// (startSoapServer). It is off in `make test` and `make test-full`: the server is the owner's, and
// a run takes its character database for a minute (#996).
const liveSoapEnv = "MELD_LIVE_SOAP"

// soapServerWait is how long the scratch world server gets to load the world and open its console.
var soapServerWait = 3 * time.Minute

// liveSoap is a world server startSoapServer started for one test, and the scratch account of GM
// level 6 its console is used with.
type liveSoap struct {
	// Root is the server folder to hand the vmangos functions: a temp folder whose run\mangosd.conf is
	// the owner's with the SOAP console on, so they read SOAP from it and the databases from the same lines.
	Root      string
	Account   string
	Password  string
	AccountID int
	Console   soapConsole
}

// startSoapServer starts the server's world server (mangosd.exe) on a copy of its mangosd.conf with
// the SOAP console on, for a live check of the features that use it (Play here, the reloads, character
// export and import, #996), and stops it when the test ends. The owner's mangosd.conf is not changed.
//
// It skips unless MELD_LIVE_SOAP=1 and VMANGOS_DIR names the server (never config.json's fallback: it
// writes the login database), on Windows, with the world server stopped (two world servers on one
// character database would undo each other's saves) and the database up. Before the start it makes a
// scratch account (MELDSOAP and a number) with an account_access row of GM level 6 for the realm,
// which the console needs and the server reads only at its start (#995). The copy also turns the
// server's own console off (nothing types into it) and writes the logs to the temp folder, whose
// logs\Server.log a failure quotes. On cleanup it shuts the server down through SOAP (killed if that
// fails) and deletes the account with its characters and rows. A test that uses it makes scratch
// characters only (#884).
func startSoapServer(t *testing.T) liveSoap {
	t.Helper()
	if os.Getenv(liveSoapEnv) != "1" {
		t.Skip(liveSoapEnv + "=1 not set: this test starts the world server")
	}
	server := os.Getenv("VMANGOS_DIR")
	if server == "" {
		t.Skip("VMANGOS_DIR not set")
	}
	if hostOS != "windows" {
		t.Skip("the world server runs on Windows only")
	}
	exe := filepath.Join(server, "run", "mangosd.exe")
	if _, err := os.Stat(exe); err != nil {
		t.Fatalf("no world server: %v", err)
	}
	if (OSRunner{}).Running(worldServerImage) {
		t.Skip("the world server is running: stop it first (two servers on one character database)")
	}
	testclient.AllowDatabase(t)

	root := t.TempDir()
	logs := filepath.Join(root, "logs")
	if err := os.MkdirAll(filepath.Join(root, "run"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(logs, 0o755); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(server, "run", "mangosd.conf"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	for _, kv := range [][2]string{
		{"SOAP.Enabled", "1"},
		{"Console.Enable", "0"},
		{"BeepAtStart", "0"},
		{"LogsDir", `"` + filepath.ToSlash(logs) + `"`},
	} {
		text = setConfLine(text, kv[0], kv[1])
	}
	conf := filepath.Join(root, "run", "mangosd.conf")
	if err := os.WriteFile(conf, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	soap, err := confSoap(root)
	if err != nil {
		t.Fatal(err)
	}
	addr := net.JoinHostPort(soap.host, strconv.Itoa(soap.port))
	if portOpen(addr) {
		t.Skipf("something already listens on the SOAP port %s", addr)
	}

	s := liveSoap{Root: root, Account: fmt.Sprintf("MELDSOAP%d", time.Now().UnixNano()%100000000), Password: "SOAPTEST", Console: soap}
	s.AccountID, err = CreateAccount(root, s.Account, s.Password, 6)
	if err != nil {
		t.Skipf("the scratch account was not made (is the database up?): %v", err)
	}
	t.Cleanup(func() {
		if err := DeleteAccount(root, s.AccountID, func() bool { return OSRunner{}.Running(worldServerImage) }); err != nil {
			t.Errorf("the scratch account %s (id %d) was not deleted: %v", s.Account, s.AccountID, err)
		}
	})

	cmd := exec.Command(exe, "-c", conf)
	cmd.Dir = filepath.Dir(exe)
	hideConsole(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting the world server: %v", err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	// Registered after the account's cleanup, so it runs first: the server is gone before its account is.
	t.Cleanup(func() {
		select {
		case <-exited:
			return
		default:
		}
		if err := ShutdownWorld(root, s.Account, s.Password); err != nil {
			t.Logf("the SOAP shutdown failed, killing the world server: %v", err)
			_ = cmd.Process.Kill()
		}
		select {
		case <-exited:
		case <-time.After(time.Minute):
			t.Errorf("the world server did not exit a minute after its shutdown; killing it")
			_ = cmd.Process.Kill()
			<-exited
		}
	})

	deadline := time.Now().Add(soapServerWait)
	for !portOpen(addr) {
		select {
		case err := <-exited:
			exited <- err // for the cleanup
			t.Fatalf("the world server exited before its SOAP console opened (%v)\n%s", err, logTail(filepath.Join(logs, "Server.log"), 20))
		case <-time.After(500 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatalf("the world server's SOAP console did not open on %s within %v\n%s", addr, soapServerWait, logTail(filepath.Join(logs, "Server.log"), 20))
		}
	}
	return s
}

// worldServerImage is the world server's program, as the task list names it.
const worldServerImage = "mangosd.exe"

// setConfLine sets key's line in a mangosd.conf's text to `key = value`, keeping the line's ending
// (a commented `#key` line is not it), or adds the line at the end when the text has none.
func setConfLine(text, key, value string) string {
	lines := strings.SplitAfter(text, "\n")
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "#") {
			continue
		}
		if k, _, ok := strings.Cut(t, "="); ok && strings.TrimSpace(k) == key {
			body := strings.TrimRight(line, "\r\n")
			lines[i] = key + " = " + value + line[len(body):]
			return strings.Join(lines, "")
		}
	}
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	return text + key + " = " + value + "\n"
}

// portOpen reports whether something accepts connections on addr.
func portOpen(addr string) bool {
	c, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// logTail is the last n lines of a log file, or why there are none.
func logTail(path string, n int) string {
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "(no " + path + ")"
		}
		return err.Error()
	}
	lines := strings.Split(strings.TrimRight(string(b), "\r\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return path + ":\n" + strings.Join(lines, "\n")
}

func TestSetConfLine(t *testing.T) {
	in := "#SOAP.Enabled = 1\r\nSOAP.Enabled = 0\r\nLogsDir = \"C:/x\"\r\n"
	got := setConfLine(setConfLine(in, "SOAP.Enabled", "1"), "LogsDir", `"D:/y"`)
	want := "#SOAP.Enabled = 1\r\nSOAP.Enabled = 1\r\nLogsDir = \"D:/y\"\r\n"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if got := setConfLine("A = 1", "Console.Enable", "0"); got != "A = 1\nConsole.Enable = 0\n" {
		t.Errorf("added line: %q", got)
	}
}

// TestSoapServerLive starts the scratch world server (MELD_LIVE_SOAP=1 and VMANGOS_DIR, with the
// owner's world server stopped; about a minute) and runs a console command and a table reload through
// it, so the helper itself is checked before the live tests that use it.
func TestSoapServerLive(t *testing.T) {
	s := startSoapServer(t)
	out, err := soapCommand(s.Console, s.Account, s.Password, "server info")
	if err != nil {
		t.Fatalf("server info: %v", err)
	}
	if out == "" {
		t.Error("server info printed nothing")
	}
	t.Logf("server info: %s", out)
	if err := ReloadTables(s.Root, s.Account, s.Password, []string{"game_tele"}); err != nil {
		t.Errorf("reload game_tele: %v", err)
	}
}
