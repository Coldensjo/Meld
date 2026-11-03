package vmangos

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// The live checks of the features that use the world server's SOAP console (#1059): each runs on the
// scratch server startSoapServer starts (MELD_LIVE_SOAP=1 and VMANGOS_DIR, with the owner's world
// server stopped), against a scratch character of its scratch account, so no character of the owner's
// is read or written through the console. Run them with
// `MELD_LIVE_SOAP=1 VMANGOS_DIR=C:/WoW/vmangos go test ./internal/vmangos/ -run SoapFeaturesLive -v`.

// scratchCharacter copies the characters row of the server's first character into a new one of the
// scratch account, called name, out of the world, and returns its guid. Only that row is copied (no
// items, skills or reputation): enough for the console's commands, which name or number it. It runs as
// a setup step of startSoapServer, with the world server stopped, so the server knows the name when it
// starts. The scratch account's cleanup deletes it.
func scratchCharacter(t *testing.T, s liveSoap, name string) int {
	t.Helper()
	db, err := characterDatabase(s.Root)
	if err != nil {
		t.Fatal(err)
	}
	out, err := runSQL(db, "CREATE TEMPORARY TABLE meld_scratch SELECT * FROM characters ORDER BY guid LIMIT 1;\n"+
		fmt.Sprintf("UPDATE meld_scratch SET guid = (SELECT MAX(guid) + 1 FROM characters), account = %d, name = %s, online = 0;\n", s.AccountID, sqlQuote(name))+
		"INSERT INTO characters SELECT * FROM meld_scratch;\n"+
		"SELECT guid FROM meld_scratch;")
	if err != nil {
		t.Fatalf("the scratch character %s was not made: %v", name, err)
	}
	rows := batchRows(out, 1)
	if len(rows) == 0 {
		t.Fatalf("the scratch character %s was not made: the server has no character to copy", name)
	}
	return rows[0].num(0)
}

// scratchName is a character's name no other character has: prefix and four letters from the clock.
func scratchName(prefix string) string {
	n := time.Now().UnixNano() / 1000
	var b strings.Builder
	b.WriteString(prefix)
	for range 4 {
		b.WriteByte(byte('a' + n%26))
		n /= 26
	}
	return b.String()
}

// waitRow polls a query of one value on db until it gives want, for what the server writes through its
// database thread after its command has answered.
func waitRow(t *testing.T, db worldDB, query, want string) {
	t.Helper()
	var got string
	for start := time.Now(); time.Since(start) < 10*time.Second; time.Sleep(200 * time.Millisecond) {
		out, err := runSQL(db, query)
		if err != nil {
			t.Fatal(err)
		}
		if got = strings.TrimSpace(string(out)); got == want {
			return
		}
	}
	t.Errorf("%s gave %q, want %q", query, got, want)
}

// TestSoapFeaturesLive checks the SOAP features on one scratch server (about 20 s): the table reloads
// a save sends (#961), Play here's refusal of a character out of the world (#13; moving one in the
// world needs the game), the Game Login character's level and mail (#962), and the character export
// and import round trip (#941).
func TestSoapFeaturesLive(t *testing.T) {
	name := scratchName("Meldsoap")
	var guid int
	s := startSoapServer(t, func(s liveSoap) { guid = scratchCharacter(t, s, name) })
	db, err := characterDatabase(s.Root)
	if err != nil {
		t.Fatal(err)
	}
	worldRunning := func() bool { return OSRunner{}.Running(worldServerImage) }

	t.Run("Reloads", func(t *testing.T) {
		// Every command records.Reloads (internal/records) sends, with a template reloaded by row too.
		cmds := []string{"creature_template", "creature_template 6", "gameobject_template", "gameobject_template 1731",
			"npc_vendor", "creature_questrelation", "creature_involvedrelation", "gameobject_questrelation", "gameobject_involvedrelation",
			"gameobject_loot_template", "page_text", "quest_template", "gossip_menu_option", "gossip_menu", "creature_spells",
			"item_template", "game_weather", "game_graveyard_zone", "spell_template"}
		for _, l := range []string{"creature", "gameobject", "item", "pickpocketing", "skinning", "fishing", "disenchant", "mail", "reference"} {
			cmds = append(cmds, l+"_loot_template")
		}
		for _, c := range cmds {
			if err := ReloadTables(s.Root, s.Account, s.Password, []string{c}); err != nil {
				t.Errorf("reload %s: %v", c, err)
			}
		}
	})

	t.Run("PlayHereOutOfWorld", func(t *testing.T) {
		err := TeleportCharacter(s.Root, s.Account, s.Password, name, CharacterSpot{})
		if err == nil || !strings.Contains(err.Error(), "isn't in the world") {
			t.Errorf("teleport of %s out of the world: %v, want the refusal", name, err)
		}
		err = TeleportCharacter(s.Root, s.Account, s.Password, scratchName("Meldnone"), CharacterSpot{})
		if err == nil || !strings.Contains(err.Error(), "has no character") {
			t.Errorf("teleport of no character: %v, want the refusal", err)
		}
	})

	t.Run("Level", func(t *testing.T) {
		out, err := SetCharacterLevel(s.Root, s.Account, s.Password, name, 7)
		if err != nil {
			t.Fatalf("level: %v", err)
		}
		t.Logf("level: %s", out)
		waitRow(t, db, fmt.Sprintf("SELECT level FROM characters WHERE guid = %d", guid), "7")
		// Past 60 is sent as 60.
		if _, err := SetCharacterLevel(s.Root, s.Account, s.Password, name, 70); err != nil {
			t.Fatalf("level 70: %v", err)
		}
		waitRow(t, db, fmt.Sprintf("SELECT level FROM characters WHERE guid = %d", guid), "60")
	})

	t.Run("Mail", func(t *testing.T) {
		// Linen Cloth, three of them in one letter.
		out, err := MailItems(s.Root, s.Account, s.Password, name, 2589, 3)
		if err != nil {
			t.Fatalf("mail: %v", err)
		}
		t.Logf("mail: %s", out)
		waitRow(t, db, fmt.Sprintf("SELECT COUNT(*) FROM mail WHERE receiver_guid = %d AND subject = %s", guid, sqlQuote(mailSubject)), "1")
		waitRow(t, db, fmt.Sprintf("SELECT COUNT(*) FROM mail_items WHERE receiver_guid = %d AND item_id = 2589", guid), "1")
	})

	t.Run("ExportImport", func(t *testing.T) {
		got, dump, err := ExportCharacter(s.Root, s.Account, s.Password, guid, worldRunning)
		if err != nil {
			t.Fatalf("export: %v", err)
		}
		if got != name {
			t.Errorf("export named %q, want %q", got, name)
		}
		if _, err := ImportCharacter(s.Root, s.Account, s.Password, dump, s.AccountID, name, worldRunning); err == nil {
			t.Error("an import under a taken name was not refused")
		}
		copyName := normalName(scratchName("Meldcopy"))
		c, err := ImportCharacter(s.Root, s.Account, s.Password, dump, s.AccountID, copyName, worldRunning)
		if err != nil {
			t.Fatalf("import: %v", err)
		}
		if c.Guid == guid || c.Name != copyName {
			t.Errorf("imported %+v, want a new guid called %s", c, copyName)
		}
		cols := "race, class, gender, level, map, position_x, position_y, position_z"
		a, err := runSQL(db, fmt.Sprintf("SELECT %s FROM characters WHERE guid = %d", cols, guid))
		if err != nil {
			t.Fatal(err)
		}
		b, err := runSQL(db, fmt.Sprintf("SELECT %s, account FROM characters WHERE guid = %d", cols, c.Guid))
		if err != nil {
			t.Fatal(err)
		}
		if want := strings.TrimSpace(string(a)) + "\t" + fmt.Sprint(s.AccountID); strings.TrimSpace(string(b)) != want {
			t.Errorf("the imported row is %q, want %q", b, want)
		}
	})
}
