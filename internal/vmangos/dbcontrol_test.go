package vmangos

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeDatabase stands in for mariadb: up says whether it answers, datadir is what @@datadir gives (as
// batch mode escapes it), and a shutdown takes it down.
type fakeDatabase struct {
	up        bool
	datadir   string
	shutdowns int
}

func (f *fakeDatabase) install(t *testing.T) {
	t.Helper()
	oldSQL, oldShut, oldPoll := runSQL, shutdownDatabase, dbStopPoll
	t.Cleanup(func() { runSQL, shutdownDatabase, dbStopPoll = oldSQL, oldShut, oldPoll })
	dbStopPoll = time.Millisecond
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		if !f.up {
			return nil, errors.New("mariadb: exit status 1: ERROR 2003 (HY000): Can't connect to server on '127.0.0.1' (10061)")
		}
		if sql == "SELECT @@datadir" {
			return []byte(f.datadir + "\n"), nil
		}
		return []byte("1\n"), nil
	}
	shutdownDatabase = func(db worldDB) error {
		if db.port != "1" {
			t.Fatalf("shut down the database on port %s", db.port)
		}
		f.shutdowns++
		f.up = false
		return nil
	}
}

// batchEscaped is a path as mariadb's batch mode prints it, each backslash doubled, with the trailing
// separator the server gives its datadir.
func batchEscaped(dir string) string {
	return strings.ReplaceAll(dir+string(filepath.Separator), `\`, `\\`)
}

func TestDatabaseStateTellsTheFoldersOwnDatabase(t *testing.T) {
	root := soapServer(t, "")
	f := &fakeDatabase{up: true, datadir: batchEscaped(filepath.Join(root, "database"))}
	f.install(t)
	if running, own := DatabaseState(root); !running || !own {
		t.Fatalf("own database: running %v, own %v", running, own)
	}
	f.datadir = batchEscaped(filepath.Join(t.TempDir(), "data"))
	if running, own := DatabaseState(root); !running || own {
		t.Fatalf("another database: running %v, own %v", running, own)
	}
	f.up = false
	if running, _ := DatabaseState(root); running {
		t.Fatal("a database that doesn't answer is running")
	}
}

func TestStopDatabaseStopsOnlyTheFoldersOwn(t *testing.T) {
	root := soapServer(t, "")
	f := &fakeDatabase{up: true, datadir: batchEscaped(filepath.Join(t.TempDir(), "data"))}
	f.install(t)
	if err := StopDatabase(root); !errors.Is(err, ErrForeignDatabase) || f.shutdowns != 0 || !f.up {
		t.Fatalf("another database: err %v, %d shutdowns", err, f.shutdowns)
	}
	f.datadir = batchEscaped(filepath.Join(root, "database"))
	if err := StopDatabase(root); err != nil || f.shutdowns != 1 || f.up {
		t.Fatalf("own database: err %v, %d shutdowns, up %v", err, f.shutdowns, f.up)
	}
	// Stopped already: nothing to do.
	if err := StopDatabase(root); err != nil || f.shutdowns != 1 {
		t.Fatalf("stopped database: err %v, %d shutdowns", err, f.shutdowns)
	}
}

func TestShutdownWorldSendsTheCommand(t *testing.T) {
	root := soapServer(t, "SOAP.Enabled = 1\n")
	old := soapCommand
	defer func() { soapCommand = old }()
	var sent []string
	soapCommand = func(_ soapConsole, account, _, command string) (string, error) {
		sent = append(sent, account+": "+command)
		return "", nil
	}
	if err := ShutdownWorld(root, "gm", "pw"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(sent, "|") != "gm: server shutdown 0" {
		t.Fatalf("sent %q", sent)
	}
	if err := ShutdownWorld(root, "", ""); err == nil {
		t.Fatal("no account sent the command")
	}
	off := soapServer(t, "")
	if err := ShutdownWorld(off, "gm", "pw"); !errors.Is(err, ErrSoapOff) {
		t.Fatalf("SOAP off: %v", err)
	}
}
