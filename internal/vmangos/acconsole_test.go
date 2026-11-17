package vmangos

import (
	"bufio"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeRA serves one remote access session as an AzerothCore world server does, letting in account
// "pascal" with password "gm", and records the commands it is sent; answer gives each one's output.
func fakeRA(t *testing.T, answer func(string) string) (*[]string, func()) {
	var got []string
	old := acDial
	acDial = func(addr string, wait time.Duration) (net.Conn, error) {
		if addr != "127.0.0.1:3443" {
			t.Errorf("dialled %s", addr)
		}
		server, client := net.Pipe()
		go func() {
			defer server.Close()
			r := bufio.NewReader(server)
			line := func() string {
				s, err := r.ReadString('\n')
				if err == nil && !strings.HasSuffix(s, "\r\n") {
					t.Errorf("line %q does not end in CRLF", s)
				}
				return strings.TrimRight(s, "\r\n")
			}
			_, _ = server.Write([]byte("Authentication Required\r\nUsername: "))
			user := line()
			_, _ = server.Write([]byte("Password: "))
			pass := line()
			if user != "pascal" || pass != "gm" {
				_, _ = server.Write([]byte("Authentication failed\r\n"))
				return
			}
			_, _ = server.Write([]byte("Welcome to an AzerothCore server\r\n"))
			for {
				_, _ = server.Write([]byte(acPrompt))
				cmd := line()
				if cmd == "quit" || cmd == "" {
					_, _ = server.Write([]byte("Bye\r\n"))
					return
				}
				got = append(got, cmd)
				_, _ = server.Write([]byte(answer(cmd)))
			}
		}()
		return client, nil
	}
	return &got, func() { acDial = old }
}

// Play here on AzerothCore writes Meld's teleport row, then reloads game_tele and teleports the
// character by name through the remote access console.
func TestACTeleportCharacter(t *testing.T) {
	dir := t.TempDir()
	conf := filepath.Join(dir, "worldserver.conf")
	if err := os.WriteFile(conf, []byte("WorldDatabaseInfo = \"127.0.0.1;3306;acore;acore;acore_world\"\n"+
		"CharacterDatabaseInfo = \"127.0.0.1;3306;acore;acore;acore_characters\"\nRa.Enable = 1\nRa.IP = \"127.0.0.1\"\nRa.Port = 3443\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := AzerothCoreServer{Root: dir, Conf: conf}
	got, done := fakeRA(t, func(cmd string) string {
		if cmd == "reload game_tele" {
			return "DB table `game_tele` reloaded.\r\n"
		}
		return ""
	})
	defer done()
	old := runSQL
	defer func() { runSQL = old }()
	var tele string
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case strings.HasPrefix(sql, "SELECT `online`"):
			if db.name != "acore_characters" {
				t.Errorf("online asked of %s", db.name)
			}
			return []byte("1\n"), nil
		case strings.Contains(sql, "game_tele"):
			if db.name != "acore_world" {
				t.Errorf("game_tele written in %s", db.name)
			}
			tele = sql
		}
		return []byte("1\n"), nil
	}
	if err := ACTeleportCharacter(s, "pascal", "gm", "Kea", CharacterSpot{Map: 571, X: 5583, Y: 850, Z: 195, O: 1}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(*got, "|") != "reload game_tele|tele name Kea meld_here" {
		t.Errorf("commands = %q", *got)
	}
	if !strings.Contains(tele, "SELECT COALESCE(MAX(id), 0) + 1, 5583, 850, 195, 1, 571, 'meld_here' FROM game_tele;") {
		t.Errorf("game_tele SQL = %s", tele)
	}
	// A wrong password is refused with the reason, and a failing command's line is the error.
	if _, err := acCommands(acConsole{enabled: true, host: "127.0.0.1", port: 3443}, "pascal", "nope", "x"); err == nil || !strings.Contains(err.Error(), "refused the account pascal") {
		t.Errorf("wrong password: %v", err)
	}
	_, done2 := fakeRA(t, func(string) string { return "Player not found\r\n" })
	defer done2()
	if _, err := acCommands(acConsole{enabled: true, host: "127.0.0.1", port: 3443}, "pascal", "gm", "tele name Nobody meld_here"); err == nil || !strings.Contains(err.Error(), "Player not found") {
		t.Errorf("missing player: %v", err)
	}
	if _, err := acCommands(acConsole{}, "pascal", "gm", "x"); err != ErrRAOff {
		t.Errorf("console off: %v", err)
	}
}
