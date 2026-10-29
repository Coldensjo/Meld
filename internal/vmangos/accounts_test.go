package vmangos

import (
	"strings"
	"testing"
)

// The server checks its SRP6 code at start with this account, salt and verifier (InitializeCrypto.cpp).
func TestSrpVerifierMatchesTheServer(t *testing.T) {
	v, err := srpVerifier("VMANGOS", "4EVER", "D04E6342FE6CB5FAE54C6182F885778D0AEFE4BFCDDC6B5C7DF7DC25FF6E3C2D")
	if err != nil {
		t.Fatal(err)
	}
	if want := "46FD48476D925C4422DD1761C299C79FD6C92B5243E4F3C6C62576C0DABD8260"; v != want {
		t.Fatalf("verifier %s, want %s", v, want)
	}
}

func TestNewSaltHasItsTopBit(t *testing.T) {
	s, err := newSalt()
	if err != nil {
		t.Fatal(err)
	}
	if len(s) != 64 || s[0] < '8' {
		t.Fatalf("salt %s: want 64 hex digits, the first 8 or more", s)
	}
}

func TestCheckAccountName(t *testing.T) {
	for name, ok := range map[string]bool{"ADMIN": true, "GM_2": true, "": false, "SEVENTEEN_LETTERS": false, "A B": false, "ÅSA": false} {
		if err := checkAccountName(name); (err == nil) != ok {
			t.Errorf("%q: %v", name, err)
		}
	}
}

func TestCreateAccount(t *testing.T) {
	root := characterServer(t)
	old, oldSalt := runSQL, newSalt
	defer func() { runSQL, newSalt = old, oldSalt }()
	newSalt = func() (string, error) { return "D04E6342FE6CB5FAE54C6182F885778D0AEFE4BFCDDC6B5C7DF7DC25FF6E3C2D", nil }
	var insert string
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		if db.name != "realmd" {
			t.Fatalf("query on %s: %s", db.name, sql)
		}
		switch {
		case sql == "SELECT 1":
			return []byte("1\n"), nil
		case strings.HasPrefix(sql, "SELECT COUNT(*)"):
			if !strings.Contains(sql, "'VMANGOS'") {
				t.Errorf("name not upper case: %s", sql)
			}
			return []byte("0\n"), nil
		case strings.HasPrefix(sql, "INSERT"):
			insert = sql
			return []byte("7\n"), nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	id, err := CreateAccount(root, " vmangos ", "4ever", 3)
	if err != nil {
		t.Fatal(err)
	}
	if id != 7 {
		t.Errorf("id %d, want 7", id)
	}
	for _, want := range []string{"VALUES ('VMANGOS', 3, '46FD48476D925C4422DD1761C299C79FD6C92B5243E4F3C6C62576C0DABD8260', 'D04E", "REPLACE INTO realmcharacters", "SELECT @id"} {
		if !strings.Contains(insert, want) {
			t.Errorf("insert %q lacks %q", insert, want)
		}
	}
	if strings.Contains(insert, "4EVER") {
		t.Error("the password itself was stored")
	}
}

// characterRow is readCharacter's row for testCharacter as the mariadb client prints it, online or not.
func characterRow(online string) []byte {
	c := testCharacter()
	f := make([]string, 0, len(characterColumns)+6)
	for _, col := range characterColumns {
		f = append(f, c.Values[col])
	}
	f = append(f, "3", online, "12", "0", "50", "0")
	return []byte(strings.Join(f, "\t") + "\n")
}

func testCharacter() CharacterRecord {
	return CharacterRecord{Guid: 4, Account: 3, Values: map[string]string{
		"name": "Kek", "race": "1", "class": "1", "gender": "0", "level": "4", "money": "100",
		"map": "0", "position_x": "-8949.95", "position_y": "-132.493", "position_z": "83.5312", "orientation": "0",
		"skin": "2", "face": "1", "hair_style": "3", "hair_color": "4", "facial_hair": "1",
		"honor_rank_points": "0", "honor_highest_rank": "0", "honor_stored_hk": "0", "honor_stored_dk": "0",
		"home_map": "0", "home_zone": "12", "home_x": "-8949.95", "home_y": "-132.493", "home_z": "83.5312",
	}}
}

func TestCharacterSet(t *testing.T) {
	set, err := characterSet(testCharacter(), map[string]string{"level": "60", "money": "100", "name": " kEK "}, 60)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(set, ", "); got != "xp = 0, level = 60" {
		t.Errorf("level: %s", got)
	}
	set, _ = characterSet(testCharacter(), map[string]string{"position_x": "12.5", "gender": "1", "name": "zug"}, 60)
	got := strings.Join(set, ", ")
	for _, want := range []string{"name = 'Zug'", "gender = 1", "position_x = 12.5", "instance = 0", "transport_guid = 0", "current_taxi_path = ''", "skin = 0", "hair_style = 0"} {
		if !strings.Contains(got, want) {
			t.Errorf("%q lacks %q", got, want)
		}
	}
	for _, bad := range []map[string]string{{"level": "61"}, {"level": "0"}, {"money": "-1"}, {"name": "K"}, {"name": "Kek2"}, {"gender": "2"}, {"position_z": "up"}, {"race": "12"}} {
		_, err := characterSet(testCharacter(), bad, 60)
		var col string
		for c := range bad {
			col = c
		}
		if r := Refused(err); r == nil || r.Column != col {
			t.Errorf("%v: got %v, want a refusal of %s", bad, err, col)
		}
	}
}

func TestSaveCharacterRefusesOneInTheWorld(t *testing.T) {
	root := characterServer(t)
	old := runSQL
	defer func() { runSQL = old }()
	online := "1"
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case sql == "SELECT 1":
			return []byte("1\n"), nil
		case strings.HasPrefix(sql, "SELECT name, race"):
			return characterRow(online), nil
		case strings.HasPrefix(sql, "SELECT map, zone"):
			return nil, nil
		case strings.HasPrefix(sql, "UPDATE"):
			return nil, nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	if _, err := SaveCharacter(root, "", 4, map[string]string{"level": "5"}, func() bool { return true }); err == nil || !strings.Contains(err.Error(), "in the world") {
		t.Fatalf("online: got %v", err)
	}
	// Left online by a world server that stopped: saved.
	sql, err := SaveCharacter(root, "", 4, map[string]string{"level": "5"}, func() bool { return false })
	if err != nil || sql != "UPDATE characters SET xp = 0, level = 5 WHERE guid = 4" {
		t.Fatalf("got %q, %v", sql, err)
	}
	online = "0"
	if _, err := SaveCharacter(root, "", 4, map[string]string{"name": "Zug"}, func() bool { return true }); Refused(err) == nil || Refused(err).Column != "name" {
		t.Fatalf("rename with the world server up: got %v", err)
	}
}

func TestDeleteAccount(t *testing.T) {
	root := characterServer(t)
	old, oldPipe := runSQL, pipeMariadb
	defer func() { runSQL, pipeMariadb = old, oldPipe }()
	var tutorial, script string
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case strings.HasPrefix(sql, "DELETE FROM character_tutorial"):
			tutorial = sql
			return nil, nil
		case strings.HasPrefix(sql, "SELECT guid FROM characters"):
			return nil, nil // no characters
		}
		return []byte("1\n"), nil // online, but the world server is down
	}
	pipeMariadb = func(args, env []string, input string) error {
		script = input
		return nil
	}
	if err := DeleteAccount(root, 5, func() bool { return false }); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "DELETE FROM account WHERE id = 5;") || !strings.Contains(script, "DELETE FROM realmcharacters WHERE acctid = 5;") || tutorial == "" {
		t.Fatalf("script %q, tutorial %q", script, tutorial)
	}
	if err := DeleteAccount(root, 5, func() bool { return true }); err == nil || !strings.Contains(err.Error(), "logged in") {
		t.Fatalf("logged in: got %v", err)
	}
}
