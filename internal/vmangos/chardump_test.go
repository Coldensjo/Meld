package vmangos

import (
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// dumpRow is one INSERT line of a dump as the server writes it, of values (nil for NULL).
func dumpRow(table string, vals ...any) string {
	parts := make([]string, len(vals))
	for i, v := range vals {
		if v == nil {
			parts[i] = "NULL"
		} else {
			parts[i] = fmt.Sprintf("'%v'", v)
		}
	}
	return "INSERT INTO `" + table + "` VALUES (" + strings.Join(parts, ", ") + ");"
}

// dumpCharacter is a characters row of 30 values: guid 4 of account 3, a level 12 female Orc Warrior
// called name, with a NULL at column 28 (known_taxi_mask's place), after every column the load reads.
func dumpCharacter(name string) string {
	vals := make([]any, 30)
	for i := range vals {
		vals[i] = 0
	}
	vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[11] = 4, 3, name, 2, 1, 1, 12
	vals[27] = nil
	return dumpRow("characters", vals...)
}

// itemRow is an item_instance row of 14 values, with charges (column 8) as given.
func itemRow(guid int, charges any) string {
	return dumpRow("item_instance", guid, 25, 4, 0, 0, 1, 0, charges, 1, "0 0 0 ", 0, 20, 0, nil)
}

// testDump is a small dump of a character with two items in its bags, a letter, a pet and a spell,
// with the server's two notes and its CRLF-free lines.
func testDump(name string) string {
	return strings.Join([]string{
		"IMPORTANT NOTE: This sql queries not created for apply directly, use '.pdump load' command in console or client chat instead.",
		"IMPORTANT NOTE: NOT APPLY ITS DIRECTLY to character DB or you will DAMAGE and CORRUPT character DB",
		"",
		dumpCharacter(name),
		dumpRow("character_inventory", 4, 0, 23, 100, 25),
		dumpRow("character_inventory", 4, 0, 24, 101, 25),
		dumpRow("character_pet", 7, 299, 4, nil, 0, 1, 10, 0, 1, 0, 0, 0, "Pup", 0, 0, 100, 0, 0, 0, 0, 0, nil, nil),
		dumpRow("character_spell", 4, 78, 1, 0),
		dumpRow("mail", 9, 0, 41, 0, 2, 4, "From Meld", 0, 1, 0, 0, 0, 0, 0),
		itemRow(100, "0 0 0 0 0 "),
		itemRow(101, "0 0 0 0 0 "),
		"",
	}, "\n")
}

func TestCheckDumpReadsTheCharacter(t *testing.T) {
	d, err := checkDump(testDump(`O\'neil`))
	if err != nil {
		t.Fatal(err)
	}
	if d.Name != "O'neil" || d.Race != 2 || d.Class != 1 || d.Gender != 1 || d.Level != 12 {
		t.Fatalf("character %+v", d)
	}
	if d.Items != 2 || d.Mail != 1 || d.Pets != 1 || d.Spells != 1 || d.Skills != 0 {
		t.Fatalf("counts %+v", d)
	}
	if d.widths["characters"] != 30 || d.widths["item_instance"] != 14 || d.widths["character_pet"] != 23 {
		t.Fatalf("widths %v", d.widths)
	}
	if _, err := checkDump(strings.ReplaceAll(testDump("Kek"), "\n", "\r\n")); err != nil {
		t.Fatalf("CRLF lines: %v", err)
	}
}

// TestCheckDumpRefusesWhatTheLoadMisreads checks the dumps the server's load would refuse, or misread
// where it finds a value by its quotes (#941).
func TestCheckDumpRefusesWhatTheLoadMisreads(t *testing.T) {
	good := testDump("Kek")
	cases := map[string]struct{ dump, want string }{
		"empty":            {"IMPORTANT NOTE: x\n\n", "holds no character"},
		"not a row":        {dumpCharacter("Kek") + "\nDELETE FROM characters;\n", "line 2 isn't a row"},
		"unknown table":    {dumpCharacter("Kek") + "\n" + dumpRow("guild", 1, "x") + "\n", "guild, which the server's .pdump load doesn't load"},
		"no character":     {dumpRow("character_spell", 4, 78, 1, 0) + "\n" + dumpCharacter("Kek"), "doesn't start with the character's row"},
		"two characters":   {dumpCharacter("Kek") + "\n" + dumpCharacter("Zug"), "more than one character"},
		"widths differ":    {good + itemRow(102, "0 ")[:len(itemRow(102, "0 "))-len(", NULL);")] + ");\n", "rows of item_instance in the dump have 14 and 13 values"},
		"NULL charges":     {good + itemRow(102, nil) + "\n", "line 12, a row of item_instance, has an empty (NULL) value or one ending in a backslash in its column 8"},
		"backslash":        {dumpCharacter(`Kek\\`), "column 3"},
		"too short":        {dumpCharacter("Kek") + "\n" + dumpRow("mail", 9, 0, 41) + "\n", "has 3 values; the server's load reads its column 8"},
		"unclosed quote":   {"INSERT INTO `characters` VALUES ('4, '3');", "isn't a row"},
		"too long":         {dumpCharacter("Kek") + "\n" + dumpRow("item_text", 5, strings.Repeat("a", maxDumpLine)) + "\n", "longer than the server reads at once"},
		"first value NULL": {dumpCharacter("Kek") + "\n" + dumpRow("character_spell", nil, 78, 1, 0) + "\n", "column 1"},
	}
	for name, c := range cases {
		if _, err := checkDump(c.dump); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v, want %q", name, err, c.want)
		}
	}
}

func TestParseDumpLine(t *testing.T) {
	table, vals, err := parseDumpLine(`INSERT INTO ` + "`item_text`" + ` VALUES ('5', 'It\'s, a \\ note', NULL, '');`)
	if err != nil || table != "item_text" || len(vals) != 4 {
		t.Fatalf("%q %v %v", table, vals, err)
	}
	if vals[1].text != `It\'s, a \\ note` || unescapeDump(vals[1].text) != `It's, a \ note` || !vals[2].null || vals[3].text != "" {
		t.Fatalf("values %+v", vals)
	}
}

// dumpConsole is a SOAP console that records each command and, for a `pdump write`, writes dump to
// the file it names, as the server does; a `pdump load` of a name containing "Bad" fails as the
// server's broken-dump answer does.
func dumpConsole(t *testing.T, got *[]string, dump string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s := string(b)
		cmd := html.UnescapeString(s[strings.Index(s, "<command>")+len("<command>") : strings.Index(s, "</command>")])
		*got = append(*got, cmd)
		if strings.HasPrefix(cmd, "pdump write ") {
			path := strings.Split(cmd, `"`)[1]
			if err := os.WriteFile(filepath.FromSlash(path), []byte(dump), 0o644); err != nil {
				t.Error(err)
			}
		}
		if strings.Contains(cmd, "Bad") {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultstring>Dump file have broken data!</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`)
			return
		}
		_, _ = io.WriteString(w, `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:MaNGOS"><SOAP-ENV:Body><ns1:executeCommandResponse><result>done</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`)
	}))
	t.Cleanup(srv.Close)
	c := consoleAt(t, srv)
	return soapServer(t, "SOAP.Enabled = 1\nSOAP.IP = \""+c.host+"\"\nSOAP.Port = "+strconv.Itoa(c.port)+"\n")
}

// stageIn puts the staged dump files in a folder of the test's, and lists the ones made.
func stageIn(t *testing.T) *[]string {
	t.Helper()
	old := stageDir
	t.Cleanup(func() { stageDir = old })
	var made []string
	stageDir = func() (string, error) {
		d, err := os.MkdirTemp(t.TempDir(), "pdump-")
		made = append(made, d)
		return d, err
	}
	return &made
}

func TestExportCharacterWritesThroughTheConsole(t *testing.T) {
	dump := testDump("Kek")
	var got []string
	root := dumpConsole(t, &got, dump)
	made := stageIn(t)
	old := runSQL
	defer func() { runSQL = old }()
	online := "0"
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		if strings.HasPrefix(sql, "SELECT name, online FROM characters WHERE guid = 4") {
			return []byte("Kek\t" + online + "\n"), nil
		}
		if sql == "SELECT 1" {
			return []byte("1\n"), nil
		}
		return nil, nil
	}
	running := func() bool { return true }
	name, b, err := ExportCharacter(root, "gm", "pw", 4, running)
	if err != nil || name != "Kek" || string(b) != dump {
		t.Fatalf("%q, %d bytes, %v", name, len(b), err)
	}
	want := fmt.Sprintf(`pdump write "%s" 4`, filepath.ToSlash(filepath.Join((*made)[0], "character.pdump")))
	if len(got) != 1 || got[0] != want {
		t.Fatalf("sent %q, want %q", got, want)
	}
	if _, err := os.Stat((*made)[0]); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the staging folder is left: %v", err)
	}

	got = nil
	online = "1"
	if _, _, err := ExportCharacter(root, "gm", "pw", 4, running); err == nil || !strings.Contains(err.Error(), "Kek is in the world") {
		t.Fatalf("in the world: %v", err)
	}
	online = "0"
	if _, _, err := ExportCharacter(root, "gm", "pw", 4, func() bool { return false }); err != errPdumpStopped {
		t.Fatalf("world stopped: %v", err)
	}
	if _, _, err := ExportCharacter(root, "", "pw", 4, running); err == nil {
		t.Fatal("no account: no error")
	}
	if _, _, err := ExportCharacter(soapServer(t, "SOAP.Enabled = 0\n"), "gm", "pw", 4, running); !errors.Is(err, ErrSoapOff) {
		t.Fatalf("console off: %v", err)
	}
	if got != nil {
		t.Fatalf("sent %q for a refused export", got)
	}
}

// importDB stands in for the databases an import reads: the tables' widths of testDump, account 3
// with two characters, the characters called a name in taken, and the imported character's row,
// which arrives at the second look after the load.
type importDB struct {
	taken    map[string]bool
	looked   int
	recounts []string
	itemCols int
}

func (d *importDB) run(db worldDB, sql string) ([]byte, error) {
	switch {
	case sql == "SELECT 1":
		return []byte("1\n"), nil
	case strings.HasPrefix(sql, "SELECT table_name, COUNT(*) FROM information_schema.columns WHERE table_schema = 'characters'"):
		return []byte(fmt.Sprintf("characters\t30\ncharacter_inventory\t5\ncharacter_pet\t23\ncharacter_spell\t4\nmail\t14\nitem_instance\t%d\n", d.itemCols)), nil
	case strings.HasPrefix(sql, "SELECT COUNT(*) FROM characters WHERE name = "):
		name := strings.Trim(strings.TrimPrefix(sql, "SELECT COUNT(*) FROM characters WHERE name = "), "'")
		if d.taken[name] {
			return []byte("1\n"), nil
		}
		return []byte("0\n"), nil
	case sql == "SELECT COUNT(*) FROM characters WHERE account = 3":
		return []byte("2\n"), nil
	case strings.HasPrefix(sql, "SELECT COUNT(*) FROM characters WHERE account = "):
		return []byte("0\n"), nil
	case sql == "SELECT COUNT(*) FROM account WHERE id = 3":
		return []byte("1\n"), nil
	case strings.HasPrefix(sql, "SELECT COUNT(*) FROM account WHERE id = "):
		return []byte("0\n"), nil
	case strings.HasPrefix(sql, "SELECT guid, account FROM characters WHERE name = "):
		d.looked++
		if d.looked < 2 {
			return nil, nil
		}
		return []byte("9005\t3\n"), nil
	case strings.HasPrefix(sql, "REPLACE INTO realmcharacters"):
		d.recounts = append(d.recounts, sql)
		return nil, nil
	}
	return nil, fmt.Errorf("unexpected query %s", sql)
}

func TestImportCharacterLoadsThroughTheConsole(t *testing.T) {
	dump := testDump("Kek")
	var got []string
	root := dumpConsole(t, &got, "")
	made := stageIn(t)
	old, oldPoll := runSQL, importPoll
	defer func() { runSQL, importPoll = old, oldPoll }()
	importPoll = time.Millisecond
	db := &importDB{taken: map[string]bool{"Kek": true}, itemCols: 14}
	runSQL = db.run
	running := func() bool { return true }

	plan, err := PlanCharacterImport(root, []byte(dump), 3)
	if err != nil || plan.Name != "Kek" || !plan.NameTaken || plan.Characters != 2 || plan.Items != 2 {
		t.Fatalf("plan %+v, %v", plan, err)
	}
	// The dump's name is taken: the server would load it under that name, flagged for a rename.
	if _, err := ImportCharacter(root, "gm", "pw", []byte(dump), 3, "", running); err == nil || !strings.Contains(err.Error(), "called Kek already") {
		t.Fatalf("name taken: %v", err)
	}
	if got != nil {
		t.Fatalf("sent %q for a taken name", got)
	}
	c, err := ImportCharacter(root, "gm", "pw", []byte(dump), 3, " probezug ", running)
	if err != nil || c.Guid != 9005 || c.Name != "Probezug" {
		t.Fatalf("%+v, %v", c, err)
	}
	staged := filepath.Join((*made)[0], "character.pdump")
	want := fmt.Sprintf(`pdump load "%s" 3 Probezug`, filepath.ToSlash(staged))
	if len(got) != 1 || got[0] != want {
		t.Fatalf("sent %q, want %q", got, want)
	}
	if db.looked != 2 || len(db.recounts) != 1 || db.recounts[0] != "REPLACE INTO realmcharacters (numchars, acctid, realmid) VALUES (2, 3, 1)" {
		t.Fatalf("looked %d times, recounts %q", db.looked, db.recounts)
	}

	got = nil
	for name, c := range map[string]struct {
		account int
		name    string
		want    string
	}{
		"bad name":   {3, "Two Words", "only the letters A to Z"},
		"no account": {8, "Probezug", "no account 8"},
	} {
		if _, err := ImportCharacter(root, "gm", "pw", []byte(dump), c.account, c.name, running); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
	db.itemCols = 15
	if _, err := ImportCharacter(root, "gm", "pw", []byte(dump), 3, "Probezug", running); err == nil || !strings.Contains(err.Error(), "item_instance have 14 values and the server's table 15 columns") {
		t.Fatalf("another version's dump: %v", err)
	}
	db.itemCols = 14
	if _, err := ImportCharacter(root, "gm", "pw", []byte(dump), 3, "Probezug", func() bool { return false }); err != errPdumpStopped {
		t.Fatalf("world stopped: %v", err)
	}
	if got != nil {
		t.Fatalf("sent %q for a refused import", got)
	}
	if _, err := ImportCharacter(root, "gm", "pw", []byte(dump), 3, "Bad", running); err == nil || !strings.Contains(err.Error(), "broken data") {
		t.Fatalf("the server's refusal: %v", err)
	}
}

func TestImportCharacterSaysWhenNothingArrives(t *testing.T) {
	var got []string
	root := dumpConsole(t, &got, "")
	stageIn(t)
	old, oldPoll, oldWait := runSQL, importPoll, importWait
	defer func() { runSQL, importPoll, importWait = old, oldPoll, oldWait }()
	importPoll, importWait = time.Millisecond, 5*time.Millisecond
	db := &importDB{itemCols: 14, looked: -1 << 30}
	runSQL = db.run
	if _, err := ImportCharacter(root, "gm", "pw", []byte(testDump("Kek")), 3, "", func() bool { return true }); err == nil || !strings.Contains(err.Error(), "no character called Kek arrived") {
		t.Fatalf("got %v", err)
	}
	if len(db.recounts) != 0 {
		t.Fatalf("recounted %q", db.recounts)
	}
}

func TestServerPathRefusesWhatTheConsoleCantName(t *testing.T) {
	if p, err := serverPath(filepath.Join(t.TempDir(), "a b", "c.pdump")); err != nil || !strings.HasPrefix(p, `"`) || strings.Contains(p, `\`) {
		t.Fatalf("%q, %v", p, err)
	}
	for _, bad := range []string{"Bjö rn", `x"y`, "a|b"} {
		if _, err := serverPath(filepath.Join(t.TempDir(), bad)); err == nil {
			t.Errorf("%q: no error", bad)
		}
	}
}
