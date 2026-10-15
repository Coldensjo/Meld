package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// characterServer is a server folder whose mangosd.conf names the character and login databases.
func characterServer(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	conf := "LoginDatabase.Info = \"127.0.0.1;3307;mangos;mangos;realmd\"\n" +
		"CharacterDatabase.Info = \"127.0.0.1;3307;mangos;mangos;characters\"\n"
	if err := os.MkdirAll(filepath.Join(root, "run"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "run", "mangosd.conf"), []byte(conf), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestPlaceCharacterWaitsForTheLogout(t *testing.T) {
	root := characterServer(t)
	old, oldPoll := runSQL, logoutPoll
	defer func() { runSQL, logoutPoll = old, oldPoll }()
	logoutPoll = time.Millisecond
	polls := 0
	var update string
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		if db.name != "characters" {
			t.Fatalf("query on %s: %s", db.name, sql)
		}
		switch {
		case sql == "SELECT 1":
			return []byte("1\n"), nil
		case strings.HasPrefix(sql, "SELECT online"):
			polls++
			if polls < 3 {
				return []byte("1\n"), nil // still in the world
			}
			return []byte("0\n"), nil
		case strings.HasPrefix(sql, "UPDATE"):
			update = sql
			return nil, nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	spot := CharacterSpot{Map: 1, X: -11769.5, Y: -4744.25, Z: 1.5, O: 3.25}
	if err := PlaceCharacter(root, " Sizaro ", spot, func() bool { return true }); err != nil {
		t.Fatal(err)
	}
	if polls != 3 {
		t.Fatalf("polled %d times, want until the character was out (3)", polls)
	}
	for _, want := range []string{"map = 1,", "instance = 0", "position_x = -11769.5,", "position_y = -4744.25,", "position_z = 1.5,", "orientation = 3.25,", "transport_guid = 0", "current_taxi_path = ''", "WHERE name = 'Sizaro'"} {
		if !strings.Contains(update, want) {
			t.Errorf("update %q lacks %q", update, want)
		}
	}
}

func TestPlaceCharacterSkipsTheWaitWithTheWorldServerDown(t *testing.T) {
	root := characterServer(t)
	old := runSQL
	defer func() { runSQL = old }()
	updated := false
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		switch {
		case strings.HasPrefix(sql, "SELECT online"):
			return []byte("1\n"), nil // left over from a world server that stopped
		case strings.HasPrefix(sql, "UPDATE"):
			updated = true
		}
		return []byte("1\n"), nil
	}
	if err := PlaceCharacter(root, "Sizaro", CharacterSpot{}, func() bool { return false }); err != nil {
		t.Fatal(err)
	}
	if !updated {
		t.Fatal("the character wasn't placed")
	}
}

func TestPlaceCharacterNeedsTheCharacter(t *testing.T) {
	root := characterServer(t)
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		if strings.HasPrefix(sql, "UPDATE") {
			t.Fatal("placed a character the server doesn't have")
		}
		if strings.HasPrefix(sql, "SELECT online") {
			return nil, nil
		}
		return []byte("1\n"), nil
	}
	err := PlaceCharacter(root, "Nobody", CharacterSpot{}, func() bool { return true })
	if err == nil || !strings.Contains(err.Error(), "no character called Nobody") {
		t.Fatalf("got %v", err)
	}
}

func TestRealmName(t *testing.T) {
	root := characterServer(t)
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		if db.name != "realmd" || !strings.Contains(sql, "FROM realmlist") {
			t.Fatalf("query on %s: %s", db.name, sql)
		}
		return []byte("Ironforge Test\n"), nil
	}
	name, err := RealmName(root)
	if err != nil || name != "Ironforge Test" {
		t.Fatalf("realm %q, %v", name, err)
	}
}
