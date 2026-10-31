package vmangos

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Exporting and importing a character (#941), through the world server's own `.pdump write` and
// `.pdump load` (src/game/PlayerDump.cpp), sent through its SOAP console: the server knows every table
// a character spans and, on a load, gives the character, its items, mail, pets and item texts new
// guids from its own counters, which only the running server holds. Both read and write a file on the
// server's machine, so Meld hands the server a file in a folder of its own (stageDir) and copies it
// to or from the one the user picked. A dump is the server's INSERT lines, one row a line; the
// server's load finds a row's values by their quotes and rewrites some of them in place, so checkDump
// refuses what that would misread. A character in the world is not exported (the dump would miss what
// changed since the server last saved it), and a load never takes a name in use: the server would
// load it under its old name, flagged for a rename at login, instead.

// pdumpTables are the tables a dump holds (PlayerDump.cpp dumpTables), each with the columns (from 1)
// PlayerDumpReader::LoadDump reads or rewrites in its rows.
var pdumpTables = map[string][]int{
	"characters":               {1, 2, 3, 15}, // guid, account, name, character_flags (a rename)
	"character_action":         {1},
	"character_aura":           {1},
	"character_homebind":       {1},
	"character_honor_cp":       {1},
	"character_inventory":      {1, 2, 4}, // guid, bag, item_guid
	"character_queststatus":    {1},
	"character_pet":            {1, 3}, // id, owner_guid
	"character_reputation":     {1},
	"character_skills":         {1},
	"character_spell":          {1},
	"character_spell_cooldown": {1},
	"mail":                     {1, 6, 8}, // id, receiver_guid, item_text_id
	"mail_items":               {1, 2, 4}, // mail_id, item_guid, receiver_guid
	"pet_aura":                 {1},
	"pet_spell":                {1},
	"pet_spell_cooldown":       {1},
	"character_gifts":          {1, 2},     // guid, item_guid
	"item_instance":            {1, 3, 13}, // guid, owner_guid, text
	"item_loot":                {1, 2},     // guid, owner_guid
	"item_text":                {1, 2},     // id, text
}

// maxDumpLine is the most bytes of a line, its end included, the server's load reads at once (its
// fgets buffer of 32000, less the closing zero).
const maxDumpLine = 31999

// maxAccountCharacters is the most characters an account has on a realm (the client's limit, which
// LoadDump checks as DUMP_TOO_MANY_CHARS).
const maxAccountCharacters = 10

// CharacterDump is what a dump holds, for the import's question: the character's name, race, class,
// gender and level, and how many of its things come with it; and, for the account it would go into,
// whether a character there is called that already and how many characters the account has.
type CharacterDump struct {
	Name       string `json:"name"`
	Race       int    `json:"race"`
	Class      int    `json:"class"`
	Gender     int    `json:"gender"`
	Level      int    `json:"level"`
	Items      int    `json:"items"`
	Mail       int    `json:"mail"`
	Pets       int    `json:"pets"`
	Spells     int    `json:"spells"`
	Skills     int    `json:"skills"`
	Quests     int    `json:"quests"`
	NameTaken  bool   `json:"nameTaken"`
	Characters int    `json:"characters"`
	// widths is each table's count of values a row, for checkDumpColumns.
	widths map[string]int
}

// ImportedCharacter is the character an import made: its new guid and its name.
type ImportedCharacter struct {
	Guid int    `json:"guid"`
	Name string `json:"name"`
}

// errPdumpStopped refuses an export or import while the world server is stopped.
var errPdumpStopped = errors.New("start the world server first: it writes and reads the character's file itself (.pdump), and only it knows the next free guids")

// dumpValue is one value of a dump row: its text as the dump writes it (escaped, without the quotes),
// or NULL.
type dumpValue struct {
	text string
	null bool
}

// parseDumpLine reads one INSERT line of a dump, as CreateDumpString writes it:
// INSERT INTO `table` VALUES ('a', NULL, 'b');
func parseDumpLine(line string) (string, []dumpValue, error) {
	rest, ok := strings.CutPrefix(line, "INSERT INTO `")
	if !ok {
		return "", nil, errors.New("not an INSERT INTO line")
	}
	table, rest, ok := strings.Cut(rest, "` VALUES (")
	if !ok || table == "" {
		return "", nil, errors.New("no VALUES list")
	}
	var vals []dumpValue
	for {
		switch {
		case strings.HasPrefix(rest, "NULL"):
			vals = append(vals, dumpValue{null: true})
			rest = rest[len("NULL"):]
		case strings.HasPrefix(rest, "'"):
			i := 1
			for i < len(rest) && rest[i] != '\'' {
				if rest[i] == '\\' {
					i++
				}
				i++
			}
			if i >= len(rest) {
				return table, nil, errors.New("a value's quote is not closed")
			}
			vals = append(vals, dumpValue{text: rest[1:i]})
			rest = rest[i+1:]
		default:
			return table, nil, errors.New("a value is neither quoted nor NULL")
		}
		if strings.HasPrefix(rest, ", ") {
			rest = rest[2:]
			continue
		}
		if rest == ");" {
			return table, vals, nil
		}
		return table, nil, errors.New("the values don't end with );")
	}
}

// unescapeDump undoes the escaping mysql_real_escape_string gives a value.
func unescapeDump(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' || i+1 == len(s) {
			b.WriteByte(s[i])
			continue
		}
		i++
		switch s[i] {
		case '0':
			b.WriteByte(0)
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 'Z':
			b.WriteByte(26)
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

// checkDump reads a dump and says what it holds, or why the server's load would refuse or misread it:
// a line it doesn't read as a row, a table it doesn't load, no characters row first (or more than
// one), a line longer than the server reads at once, rows of one table with different counts of
// values, or a NULL value or one ending in a backslash at or before a column the load reads, which
// throws its count of the quotes off.
func checkDump(text string) (CharacterDump, error) {
	d := CharacterDump{widths: map[string]int{}}
	rows := map[string]int{}
	n := 0
	for i, line := range strings.Split(text, "\n") {
		if len(line)+1 > maxDumpLine {
			return d, fmt.Errorf("line %d of the dump is longer than the server reads at once (%d bytes)", i+1, maxDumpLine)
		}
		line = strings.TrimRight(line, "\r")
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed == "" || strings.HasPrefix(trimmed, "IMPORTANT NOTE:") {
			continue
		}
		table, vals, err := parseDumpLine(line)
		if err != nil {
			return d, fmt.Errorf("line %d isn't a row of a character dump: %v", i+1, err)
		}
		cols, ok := pdumpTables[table]
		if !ok {
			return d, fmt.Errorf("line %d is a row of %s, which the server's .pdump load doesn't load", i+1, table)
		}
		if n == 0 && table != "characters" {
			return d, errors.New("the dump doesn't start with the character's row (characters)")
		}
		if n > 0 && table == "characters" {
			return d, errors.New("the dump holds more than one character")
		}
		n++
		if w, ok := d.widths[table]; ok && w != len(vals) {
			return d, fmt.Errorf("the rows of %s in the dump have %d and %d values", table, w, len(vals))
		}
		d.widths[table] = len(vals)
		last := cols[len(cols)-1]
		if len(vals) < last {
			return d, fmt.Errorf("line %d, a row of %s, has %d values; the server's load reads its column %d", i+1, table, len(vals), last)
		}
		for c := 0; c < last; c++ {
			// The load takes a quote after a backslash for an escaped one (findnth).
			if vals[c].null || strings.HasSuffix(vals[c].text, `\`) {
				return d, fmt.Errorf("line %d, a row of %s, has an empty (NULL) value or one ending in a backslash in its column %d, which the server's .pdump load would misread", i+1, table, c+1)
			}
		}
		rows[table]++
		if table == "characters" {
			num := func(c int) int { v, _ := strconv.Atoi(vals[c-1].text); return v }
			d.Name = unescapeDump(vals[2].text)
			if len(vals) >= 12 {
				d.Race, d.Class, d.Gender, d.Level = num(4), num(5), num(6), num(12)
			}
		}
	}
	if n == 0 {
		return d, errors.New("the file holds no character: it isn't a dump the server's .pdump write made")
	}
	d.Items, d.Mail, d.Pets = rows["item_instance"], rows["mail"], rows["character_pet"]
	d.Spells, d.Skills, d.Quests = rows["character_spell"], rows["character_skills"], rows["character_queststatus"]
	return d, nil
}

// checkDumpColumns compares the dump's rows with the character database's tables: the load inserts
// them without naming the columns, so a row of another width (a dump from another core or version)
// would fail inside the server's transaction, and the server would say it loaded.
func checkDumpColumns(db worldDB, widths map[string]int) error {
	tables := make([]string, 0, len(widths))
	for t := range widths {
		tables = append(tables, t)
	}
	sort.Strings(tables)
	quoted := make([]string, len(tables))
	for i, t := range tables {
		quoted[i] = sqlQuote(t)
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT table_name, COUNT(*) FROM information_schema.columns WHERE table_schema = %s AND table_name IN (%s) GROUP BY table_name",
		sqlQuote(db.name), strings.Join(quoted, ", ")))
	if err != nil {
		return err
	}
	have := map[string]int{}
	for _, r := range batchRows(raw, 2) {
		have[strings.ToLower(r[0])] = r.num(1)
	}
	for _, t := range tables {
		switch n, ok := have[t]; {
		case !ok:
			return fmt.Errorf("the character database has no %s table, which the dump fills: it was made by another core", t)
		case n != widths[t]:
			return fmt.Errorf("the dump's rows of %s have %d values and the server's table %d columns: it was made by another core or version", t, widths[t], n)
		}
	}
	return nil
}

// pdumpConsole is the SOAP console the dump commands go through, logged in as account: it fails,
// saying why, when there is no account, the world server is stopped or SOAP is off.
func pdumpConsole(serverRoot, account string, worldRunning func() bool) (soapConsole, error) {
	if strings.TrimSpace(account) == "" {
		return soapConsole{}, errors.New("Game Login has no account to send the server's .pdump command with (Game › Game Login…, an account of GM level 6, Administrator, in realmd's account_access)")
	}
	if !worldRunning() {
		return soapConsole{}, errPdumpStopped
	}
	soap, err := confSoap(serverRoot)
	if err != nil {
		return soap, err
	}
	if !soap.enabled {
		return soap, ErrSoapOff
	}
	return soap, nil
}

// stageDir makes the folder Meld hands the server its dump files in, a new one each time. A variable,
// so tests can put it in their own folder.
var stageDir = func() (string, error) {
	return os.MkdirTemp("", "meld-pdump-")
}

// serverPath is path as the server's console takes it: absolute, with forward slashes, quoted. The
// console has no escapes and the server opens files by their ANSI name, so a path with a quote, a bar
// or a letter outside ASCII is refused.
func serverPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	abs = filepath.ToSlash(abs)
	for _, r := range abs {
		if r < 0x20 || r > 0x7e || r == '"' || r == '|' {
			return "", fmt.Errorf("the server's console can't name the file %s (a quote, a bar or a letter outside ASCII): set TEMP to a plain folder", abs)
		}
	}
	return `"` + abs + `"`, nil
}

// ExportCharacter has the world server write character guid to a dump (`.pdump write`, through its
// SOAP console, logged in as account) and returns the character's name and the dump. The world
// server must run, and the character must be out of the world.
func ExportCharacter(serverRoot, account, password string, guid int, worldRunning func() bool) (string, []byte, error) {
	soap, err := pdumpConsole(serverRoot, account, worldRunning)
	if err != nil {
		return "", nil, err
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", nil, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT name, online FROM characters WHERE guid = %d", guid))
	if err != nil {
		return "", nil, err
	}
	rows := batchRows(raw, 2)
	if len(rows) == 0 {
		return "", nil, fmt.Errorf("there is no character %d", guid)
	}
	name := rows[0][0]
	if rows[0].num(1) != 0 {
		return "", nil, fmt.Errorf("%s is in the world: log out of the game first, or the file would miss what changed since the server last saved it", name)
	}
	dir, err := stageDir()
	if err != nil {
		return "", nil, err
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "character.pdump")
	arg, err := serverPath(file)
	if err != nil {
		return "", nil, err
	}
	if _, err := consoleCommand(soap, account, password, fmt.Sprintf("pdump write %s %d", arg, guid)); err != nil {
		return "", nil, fmt.Errorf("the world server didn't write %s: %w", name, err)
	}
	dump, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil, fmt.Errorf("the world server said it wrote %s, but the file isn't there: is the server on another machine?", name)
	}
	if err != nil {
		return "", nil, err
	}
	if _, err := checkDump(string(dump)); err != nil {
		return "", nil, fmt.Errorf("the server's dump of %s couldn't be loaded again: %w", name, err)
	}
	return name, dump, nil
}

// PlanCharacterImport says what the dump holds and, for the account it would go into, whether a
// character is called that already and how many characters the account has; or why the server's
// load would refuse or misread it.
func PlanCharacterImport(serverRoot string, dump []byte, account int) (CharacterDump, error) {
	d, err := checkDump(string(dump))
	if err != nil {
		return d, err
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return d, err
	}
	if err := checkDumpColumns(db, d.widths); err != nil {
		return d, err
	}
	taken, err := countRows(db, "SELECT COUNT(*) FROM characters WHERE name = "+sqlQuote(normalName(d.Name)))
	if err != nil {
		return d, err
	}
	d.NameTaken = taken > 0
	d.Characters, err = countRows(db, fmt.Sprintf("SELECT COUNT(*) FROM characters WHERE account = %d", account))
	return d, err
}

// countRows runs a query of one number and reads it.
func countRows(db worldDB, sql string) (int, error) {
	out, err := runSQL(db, sql)
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return 0, fmt.Errorf("%s gave %q", sql, out)
	}
	return n, nil
}

// importWait is how long ImportCharacter waits for the server's transaction to bring the character
// (the server's load returns before its database thread commits it), and importPoll how often it looks.
var (
	importWait = 10 * time.Second
	importPoll = 200 * time.Millisecond
)

// ImportCharacter has the world server load a dump into account as a new character called name (the
// dump's own name when ""), through `.pdump load` sent through its SOAP console logged in as
// soapAccount, and returns the character it made. The server gives it a new guid, and its items, mail
// and pets new ones. The name must be free: the server would otherwise load it under the dump's name
// flagged for a rename. It waits for the character's row, then counts the account's characters on the
// realm list as DeleteCharacter does.
func ImportCharacter(serverRoot, soapAccount, password string, dump []byte, account int, name string, worldRunning func() bool) (ImportedCharacter, error) {
	soap, err := pdumpConsole(serverRoot, soapAccount, worldRunning)
	if err != nil {
		return ImportedCharacter{}, err
	}
	d, err := PlanCharacterImport(serverRoot, dump, account)
	if err != nil {
		return ImportedCharacter{}, err
	}
	name = normalName(name)
	if name == "" {
		name = normalName(d.Name)
	}
	if p := nameProblem(name); p != "" {
		return ImportedCharacter{}, errors.New(p)
	}
	login, err := loginDatabase(serverRoot)
	if err != nil {
		return ImportedCharacter{}, err
	}
	if n, err := countRows(login, fmt.Sprintf("SELECT COUNT(*) FROM account WHERE id = %d", account)); err != nil {
		return ImportedCharacter{}, err
	} else if n == 0 {
		return ImportedCharacter{}, fmt.Errorf("there is no account %d", account)
	}
	if d.Characters >= maxAccountCharacters {
		return ImportedCharacter{}, fmt.Errorf("the account has %d characters, the most the game allows on a realm", d.Characters)
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return ImportedCharacter{}, err
	}
	if n, err := countRows(db, "SELECT COUNT(*) FROM characters WHERE name = "+sqlQuote(name)); err != nil {
		return ImportedCharacter{}, err
	} else if n > 0 {
		return ImportedCharacter{}, fmt.Errorf("there is a character called %s already: give the imported one another name", name)
	}
	dir, err := stageDir()
	if err != nil {
		return ImportedCharacter{}, err
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "character.pdump")
	if err := os.WriteFile(file, dump, 0o644); err != nil {
		return ImportedCharacter{}, err
	}
	arg, err := serverPath(file)
	if err != nil {
		return ImportedCharacter{}, err
	}
	if _, err := consoleCommand(soap, soapAccount, password, fmt.Sprintf("pdump load %s %d %s", arg, account, name)); err != nil {
		return ImportedCharacter{}, fmt.Errorf("the world server didn't load %s: %w", name, err)
	}
	q := "SELECT guid, account FROM characters WHERE name = " + sqlQuote(name)
	for start := time.Now(); ; time.Sleep(importPoll) {
		raw, err := runSQL(db, q)
		if err != nil {
			return ImportedCharacter{}, err
		}
		if rows := batchRows(raw, 2); len(rows) > 0 {
			if rows[0].num(1) != account {
				return ImportedCharacter{}, fmt.Errorf("the character called %s is on account %d, not %d", name, rows[0].num(1), account)
			}
			c := ImportedCharacter{Guid: rows[0].num(0), Name: name}
			if err := recountCharacters(serverRoot, db, account); err != nil {
				return c, fmt.Errorf("%s was imported, but %w", name, err)
			}
			return c, nil
		}
		if time.Since(start) >= importWait {
			return ImportedCharacter{}, fmt.Errorf("the world server took the dump, but no character called %s arrived: its log (Server.log) says why", name)
		}
	}
}
