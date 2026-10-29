package vmangos

import (
	"fmt"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

func TestDeleteCharacterRefusesWhileTheWorldRuns(t *testing.T) {
	root := characterServer(t)
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		t.Fatalf("query while the world server runs: %s", sql)
		return nil, nil
	}
	if _, err := DeleteCharacter(root, 4, func() bool { return true }); err != errDeleteRunning {
		t.Fatalf("got %v", err)
	}
}

func TestDeleteCharacterCountsTheAccount(t *testing.T) {
	root := characterServer(t)
	old, oldPipe := runSQL, pipeMariadb
	defer func() { runSQL, pipeMariadb = old, oldPipe }()
	var script, count string
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case strings.HasPrefix(sql, "SELECT account, name"):
			return []byte("3\tKek\n"), nil
		case strings.HasPrefix(sql, "SELECT COUNT(*) FROM characters WHERE account = 3"):
			return []byte("2\n"), nil
		case strings.HasPrefix(sql, "REPLACE INTO realmcharacters"):
			if db.name != "realmd" {
				t.Errorf("realm count on %s", db.name)
			}
			count = sql
			return nil, nil
		}
		return []byte("1\n"), nil
	}
	pipeMariadb = func(args, env []string, input string) error {
		script = input
		return nil
	}
	name, err := DeleteCharacter(root, 4, func() bool { return false })
	if err != nil || name != "Kek" {
		t.Fatalf("%q, %v", name, err)
	}
	if !strings.Contains(script, "DELETE FROM characters WHERE guid = 4;") || !strings.HasPrefix(script, "START TRANSACTION;") {
		t.Fatalf("script %q", script)
	}
	if count != "REPLACE INTO realmcharacters (numchars, acctid, realmid) VALUES (2, 3, 1)" {
		t.Fatalf("count %q", count)
	}
}

func TestDeleteAccountWithCharacters(t *testing.T) {
	root := characterServer(t)
	old, oldPipe := runSQL, pipeMariadb
	defer func() { runSQL, pipeMariadb = old, oldPipe }()
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case strings.HasPrefix(sql, "SELECT online"):
			return []byte("0\n"), nil
		case strings.HasPrefix(sql, "SELECT guid FROM characters WHERE account = 3"):
			return []byte("4\n5\n"), nil
		}
		return nil, nil
	}
	var scripts []string
	pipeMariadb = func(args, env []string, input string) error {
		scripts = append(scripts, input)
		return nil
	}
	if err := DeleteAccount(root, 3, func() bool { return true }); err != errDeleteRunning || len(scripts) != 0 {
		t.Fatalf("with the world server running: %v, %d scripts", err, len(scripts))
	}
	if err := DeleteAccount(root, 3, func() bool { return false }); err != nil {
		t.Fatal(err)
	}
	if len(scripts) != 2 || !strings.Contains(scripts[0], "DELETE FROM characters WHERE guid = 4;") || !strings.Contains(scripts[0], "DELETE FROM characters WHERE guid = 5;") ||
		!strings.Contains(scripts[1], "DELETE FROM account WHERE id = 3;") {
		t.Fatalf("scripts %q", scripts)
	}
}

// TestDeleteCharacterSQLLive runs deleteCharacterSQL on a scratch copy of the character database's
// tables (a test_ database, which the server's mariadb lets any user make), with a guild, a group, mail,
// a pet and petitions around the deleted character, and checks what is left. It needs VMANGOS_DIR with
// the database running, and skips when the scratch database can't be made.
func TestDeleteCharacterSQLLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	chars, err := confDatabase(dir, "CharacterDatabase.Info")
	if err != nil {
		t.Fatal(err)
	}
	const scratch = "test_meld_chardelete"
	if _, err := runSQL(chars, "DROP DATABASE IF EXISTS "+scratch+"; CREATE DATABASE "+scratch); err != nil {
		t.Skip("no scratch database: " + err.Error())
	}
	defer func() { _, _ = runSQL(chars, "DROP DATABASE IF EXISTS "+scratch) }()
	db := chars
	db.name = scratch

	tables := []string{"characters", "guild", "guild_member", "guild_rank", "guild_eventlog", "groups", "group_member", "group_instance", "character_instance", "petition", "petition_sign",
		"mail", "mail_items", "item_instance", "character_pet", "pet_spell", "pet_aura", "pet_spell_cooldown", "character_social", "character_inventory"}
	for _, tb := range characterTables {
		tables = append(tables, tb[0])
	}
	var setup strings.Builder
	setup.WriteString("SET SESSION sql_mode = '';\n")
	made := map[string]bool{}
	for _, tb := range tables {
		if !made[tb] {
			made[tb] = true
			fmt.Fprintf(&setup, "CREATE TABLE `%s` LIKE `%s`.`%s`;\n", tb, chars.name, tb)
		}
	}
	// Accounts 900 (9101, 9103) and 901 (9102, 9104, 9105).
	setup.WriteString(`INSERT INTO characters (guid, account, name) VALUES (9101, 900, 'Gone'), (9102, 901, 'Bee'), (9103, 900, 'Cee'), (9104, 901, 'Dee'), (9105, 901, 'Eee');
INSERT INTO guild (guild_id, name, leader_guid) VALUES (77, 'Led', 9101), (78, 'Alone', 9104);
INSERT INTO guild_member (guild_id, guid, ` + "`rank`" + `) VALUES (77, 9101, 0), (77, 9103, 3), (77, 9102, 1), (78, 9104, 0);
INSERT INTO guild_rank (guild_id, id, name) VALUES (77, 0, 'GM'), (78, 0, 'GM');
INSERT INTO ` + "`groups`" + ` (group_id, leader_guid) VALUES (5, 9101), (6, 9104);
INSERT INTO group_member (group_id, member_guid) VALUES (5, 9101), (5, 9103), (5, 9102), (6, 9104), (6, 9105);
INSERT INTO group_instance (leader_guid, instance, permanent) VALUES (9101, 500, 0), (9101, 501, 1);
INSERT INTO character_instance (guid, instance, permanent) VALUES (9102, 502, 0), (9102, 503, 1);
INSERT INTO mail (id, message_type, sender_guid, receiver_guid, has_items, cod, money) VALUES (1, 0, 9102, 9101, 1, 100, 5), (2, 0, 9103, 9101, 1, 100, 0), (3, 0, 9102, 9101, 1, 0, 0), (4, 2, 9102, 9101, 1, 100, 0);
INSERT INTO mail_items (mail_id, item_guid, item_id, receiver_guid) VALUES (1, 9201, 25, 9101), (2, 9202, 25, 9101), (3, 9203, 25, 9101), (4, 9205, 25, 9101);
INSERT INTO item_instance (guid, owner_guid, item_id) VALUES (9201, 9101, 25), (9202, 9101, 25), (9203, 9101, 25), (9204, 9101, 25), (9205, 9101, 25), (9206, 9102, 25);
INSERT INTO character_inventory (guid, bag, slot, item_guid, item_id) VALUES (9101, 0, 23, 9204, 25);
INSERT INTO character_pet (id, owner_guid) VALUES (9301, 9101), (9302, 9102);
INSERT INTO pet_spell (guid, spell) VALUES (9301, 1), (9302, 1);
INSERT INTO petition (owner_guid, petition_guid, charter_guid, name) VALUES (9101, 1, 9204, 'Mine'), (9102, 2, 9206, 'Theirs');
INSERT INTO petition_sign (owner_guid, petition_guid, player_guid) VALUES (9102, 2, 9101), (9102, 2, 9103);
INSERT INTO character_social (guid, friend) VALUES (9102, 9101), (9101, 9103), (9102, 9103);
`)
	if err := runScript(db, setup.String()); err != nil {
		t.Fatal(err)
	}
	if err := runScript(db, deleteCharacterSQL(9101, 900, 1000, 3600)); err != nil {
		t.Fatal(err)
	}
	if err := runScript(db, deleteCharacterSQL(9104, 901, 1000, 3600)); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ sql, want string }{
		{"SELECT guid FROM characters ORDER BY guid", "9102 9103 9105"},
		// Guild 77 passes to its best rank, guild 78 lost its last member.
		{"SELECT guild_id, leader_guid FROM guild", "77\t9102"},
		{"SELECT guid, `rank` FROM guild_member ORDER BY guid", "9102\t0 9103\t3"},
		{"SELECT guild_id FROM guild_rank", "77"},
		// Group 5 passes to its first member with its binds and the new leader's; group 6 is disbanded.
		{"SELECT group_id, leader_guid FROM `groups`", "5\t9102"},
		{"SELECT group_id, member_guid FROM group_member ORDER BY member_guid", "5\t9102 5\t9103"},
		{"SELECT leader_guid, instance, permanent FROM group_instance ORDER BY instance", "9102\t500\t0 9102\t502\t0 9102\t503\t1"},
		{"SELECT guid, instance FROM character_instance ORDER BY instance", "9102\t503"},
		// Mail 1 and 2 go back, after the delay for another account; 3 (no COD) and 4 (an auction's) go.
		{"SELECT id, sender_guid, receiver_guid, cod, checked, stationery, money, deliver_time, expire_time FROM mail ORDER BY id",
			"1\t9101\t9102\t0\t2\t41\t5\t4600\t2596600 2\t9101\t9103\t0\t2\t41\t0\t1000\t2593000"},
		{"SELECT mail_id, receiver_guid FROM mail_items ORDER BY mail_id", "1\t9102 2\t9103"},
		{"SELECT guid, owner_guid FROM item_instance ORDER BY guid", "9201\t9102 9202\t9103 9206\t9102"},
		{"SELECT COUNT(*) FROM character_inventory", "0"},
		{"SELECT id FROM character_pet", "9302"},
		{"SELECT guid FROM pet_spell", "9302"},
		{"SELECT owner_guid FROM petition", "9102"},
		{"SELECT player_guid FROM petition_sign", "9103"},
		{"SELECT guid, friend FROM character_social", "9102\t9103"},
	} {
		out, err := runSQL(db, c.sql)
		if err != nil {
			t.Fatal(err)
		}
		if got := strings.Join(strings.Fields(strings.ReplaceAll(strings.TrimSpace(string(out)), "\t", "\\t")), " "); got != strings.ReplaceAll(c.want, "\t", "\\t") {
			t.Errorf("%s:\n got %s\nwant %s", c.sql, got, strings.ReplaceAll(c.want, "\t", "\\t"))
		}
	}
}
