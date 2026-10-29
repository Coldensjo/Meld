package vmangos

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
)

// The Characters and Accounts tool (#855): the realm's accounts in the login database (realmd's
// account table) and their characters in the character database. The world server keeps a character
// that is in the world in memory and writes it over its row when it logs out, so a character is only
// changed while it is out of the world, as PlaceCharacter does.

// Account is one row of the login database's account table, with how many characters it has.
type Account struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	GMLevel    int    `json:"gmLevel"`
	Online     bool   `json:"online"`
	Locked     bool   `json:"locked"`
	JoinDate   string `json:"joinDate"`
	LastLogin  string `json:"lastLogin"`
	Characters int    `json:"characters"`
}

// AccountCharacter is a character as the tool's list shows it.
type AccountCharacter struct {
	Guid   int    `json:"guid"`
	Name   string `json:"name"`
	Race   int    `json:"race"`
	Class  int    `json:"class"`
	Gender int    `json:"gender"`
	Level  int    `json:"level"`
	Online bool   `json:"online"`
}

// CharacterRecord is a character's row for the editor: the columns it edits (characterColumns) as
// strings, as the template editors have them, and what it only shows.
type CharacterRecord struct {
	Guid       int               `json:"guid"`
	Account    int               `json:"account"`
	Online     bool              `json:"online"`
	Zone       int               `json:"zone"`
	XP         int               `json:"xp"`
	PlayedTime int               `json:"playedTime"`
	Values     map[string]string `json:"values"`
}

// characterColumns are the characters table's columns the editor changes, in the order it reads them:
// the first slice's (#855), then the look and the honor (#875). The record's values also hold the
// home (homeColumns), from character_homebind.
var characterColumns = []string{"name", "race", "class", "gender", "level", "money", "map", "position_x", "position_y", "position_z", "orientation",
	"skin", "face", "hair_style", "hair_color", "facial_hair",
	"honor_rank_points", "honor_highest_rank", "honor_stored_hk", "honor_stored_dk"}

// The server's limits (AccountMgr.h MAX_ACCOUNT_STR, ObjectMgr.h MAX_PLAYER_NAME, Player.h
// MAX_MONEY_AMOUNT, Common.h SEC_ADMINISTRATOR) and the 1.12 client's longest password.
const (
	maxAccountName = 16
	maxPassword    = 16
	maxPlayerName  = 12
	maxMoney       = 0x7FFFFFFF - 1
	maxGMLevel     = 6
	// honorRanks is the highest honor rank (HonorMgr.h HONOR_RANK_COUNT - 1: 1-4 the dishonored
	// ranks, 5-18 Private or Scout to Grand Marshal or High Warlord).
	honorRanks = 18
	// maxRankPoints bounds the rank points (a little past High Warlord's 60000; below 0 are the
	// dishonored ranks).
	maxRankPoints = 100000
)

// loginDatabase and characterDatabase are the two databases this reads, with the database started
// first when it is down (ensureDatabase).
func loginDatabase(serverRoot string) (worldDB, error) {
	return startedDatabase(serverRoot, "LoginDatabase.Info")
}

func characterDatabase(serverRoot string) (worldDB, error) {
	return startedDatabase(serverRoot, "CharacterDatabase.Info")
}

func startedDatabase(serverRoot, key string) (worldDB, error) {
	db, err := confDatabase(serverRoot, key)
	if err != nil {
		return db, err
	}
	return db, ensureDatabase(db, serverRoot)
}

// ListAccounts lists the realm's accounts by name, each with its count of characters.
func ListAccounts(serverRoot string) ([]Account, error) {
	login, err := loginDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	chars, err := confDatabase(serverRoot, "CharacterDatabase.Info")
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(login, "SELECT id, username, gmlevel, online, locked, joindate, last_login FROM account ORDER BY username")
	if err != nil {
		return nil, err
	}
	counts := map[int]int{}
	craw, err := runSQL(chars, "SELECT account, COUNT(*) FROM characters GROUP BY account")
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(craw, 2) {
		counts[f.num(0)] = f.num(1)
	}
	out := []Account{}
	for _, f := range batchRows(raw, 7) {
		id := f.num(0)
		out = append(out, Account{ID: id, Name: f[1], GMLevel: f.num(2), Online: f[3] != "0", Locked: f[4] != "0", JoinDate: f[5], LastLogin: f[6], Characters: counts[id]})
	}
	return out, nil
}

// normalAccount is an account name or password as the server keeps it: trimmed and upper case
// (AccountMgr's normalizeString), since the client sends both in upper case.
func normalAccount(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// checkAccountName says why name can't be an account's, or nil.
func checkAccountName(name string) error {
	switch {
	case name == "":
		return errors.New("the account needs a name")
	case len([]rune(name)) > maxAccountName:
		return fmt.Errorf("an account name has at most %d characters", maxAccountName)
	}
	for _, r := range name {
		if !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return errors.New("an account name has only letters, digits and _ (the game's login screen types no others)")
		}
	}
	return nil
}

// checkPassword says why password can't be an account's, or nil.
func checkPassword(password string) error {
	switch {
	case password == "":
		return errors.New("the account needs a password")
	case len([]rune(password)) > maxPassword:
		return fmt.Errorf("a password has at most %d characters (the game's login screen takes no more)", maxPassword)
	}
	return nil
}

// srpN and srpG are the realm's SRP6 group (SRP6.cpp).
var (
	srpN, _ = new(big.Int).SetString("894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7", 16)
	srpG    = big.NewInt(7)
)

// srpVerifier is the account's verifier v for its upper-case name and password and its salt (the
// salt's hex, as the account table keeps it), as the server's SRP6::CalculateVerifier makes it:
// x = SHA1(salt, SHA1(NAME:PASSWORD)) with the salt's bytes and the result read little-endian, and
// v = g^x mod N, written as upper-case hex without leading zeros.
func srpVerifier(name, password, saltHex string) (string, error) {
	salt, ok := new(big.Int).SetString(saltHex, 16)
	if !ok || salt.Sign() == 0 {
		return "", errors.New("bad salt")
	}
	inner := sha1.Sum([]byte(name + ":" + password))
	h := sha1.New()
	h.Write(reversed(salt.Bytes()))
	h.Write(inner[:])
	x := new(big.Int).SetBytes(reversed(h.Sum(nil)))
	return strings.ToUpper(hex.EncodeToString(new(big.Int).Exp(srpG, x, srpN).Bytes())), nil
}

// reversed is a copy of b back to front.
func reversed(b []byte) []byte {
	out := make([]byte, len(b))
	for i, v := range b {
		out[len(b)-1-i] = v
	}
	return out
}

// newSalt is a random 32-byte salt with its top bit set, as the server's BN_rand makes one, in hex.
var newSalt = func() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[0] |= 0x80
	return strings.ToUpper(hex.EncodeToString(b)), nil
}

// passwordFields are the verifier and a new salt for an account's password, which is never stored itself.
func passwordFields(name, password string) (v, s string, err error) {
	if s, err = newSalt(); err != nil {
		return "", "", err
	}
	v, err = srpVerifier(name, password, s)
	return v, s, err
}

// CreateAccount adds an account called name (upper case, as the server keeps it) with password and
// GM level gm, and returns its id. The password is stored only as its SRP6 verifier and salt, as the
// server's `.account create` stores it; the realm list gets its row in realmcharacters.
func CreateAccount(serverRoot, name, password string, gm int) (int, error) {
	name, password = normalAccount(name), normalAccount(password)
	if err := checkAccountName(name); err != nil {
		return 0, err
	}
	if err := checkPassword(password); err != nil {
		return 0, err
	}
	if gm < 0 || gm > maxGMLevel {
		return 0, fmt.Errorf("the GM level is 0 to %d", maxGMLevel)
	}
	db, err := loginDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	out, err := runSQL(db, "SELECT COUNT(*) FROM account WHERE username = "+sqlQuote(name))
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(string(out)) != "0" {
		return 0, fmt.Errorf("there is an account called %s already", name)
	}
	v, s, err := passwordFields(name, password)
	if err != nil {
		return 0, err
	}
	out, err = runSQL(db, createAccountSQL(name, v, s, gm))
	if err != nil {
		return 0, err
	}
	id, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return 0, fmt.Errorf("the account was made, but its id was not read: %q", out)
	}
	return id, nil
}

// createAccountSQL inserts an account and its realmcharacters rows (as AccountMgr::CreateAccount
// does), and selects its id.
func createAccountSQL(name, v, s string, gm int) string {
	return fmt.Sprintf("INSERT INTO account (username, gmlevel, v, s, joindate) VALUES (%s, %d, %s, %s, NOW());\n"+
		"SET @id = LAST_INSERT_ID();\n"+
		"REPLACE INTO realmcharacters (realmid, acctid, numchars) SELECT id, @id, 0 FROM realmlist;\n"+
		"SELECT @id;", sqlQuote(name), gm, sqlQuote(v), sqlQuote(s))
}

// SetAccount changes account id's GM level and, when password isn't empty, its password.
func SetAccount(serverRoot string, id, gm int, password string) error {
	if gm < 0 || gm > maxGMLevel {
		return fmt.Errorf("the GM level is 0 to %d", maxGMLevel)
	}
	db, err := loginDatabase(serverRoot)
	if err != nil {
		return err
	}
	name, err := runSQL(db, fmt.Sprintf("SELECT username FROM account WHERE id = %d", id))
	if err != nil {
		return err
	}
	username := strings.TrimSpace(string(name))
	if username == "" {
		return fmt.Errorf("there is no account %d", id)
	}
	set := fmt.Sprintf("gmlevel = %d", gm)
	if password != "" {
		password = normalAccount(password)
		if err := checkPassword(password); err != nil {
			return err
		}
		v, s, err := passwordFields(username, password)
		if err != nil {
			return err
		}
		// A changed password ends the session key the realm gave the old one.
		set += fmt.Sprintf(", v = %s, s = %s, sessionkey = ''", sqlQuote(v), sqlQuote(s))
	}
	_, err = runSQL(db, fmt.Sprintf("UPDATE account SET %s WHERE id = %d", set, id))
	return err
}

// DeleteAccount removes account id and its realmcharacters rows. It refuses an account that still
// has characters (deleting one takes its items, mail and pets out of many tables, which the server
// does) or is logged in while the world server runs.
func DeleteAccount(serverRoot string, id int, worldRunning func() bool) error {
	login, err := loginDatabase(serverRoot)
	if err != nil {
		return err
	}
	chars, err := confDatabase(serverRoot, "CharacterDatabase.Info")
	if err != nil {
		return err
	}
	out, err := runSQL(login, fmt.Sprintf("SELECT online FROM account WHERE id = %d", id))
	if err != nil {
		return err
	}
	switch strings.TrimSpace(string(out)) {
	case "":
		return fmt.Errorf("there is no account %d", id)
	case "0":
	default:
		if worldRunning() {
			return errors.New("the account is logged in: log out of the game first")
		}
	}
	out, err = runSQL(chars, fmt.Sprintf("SELECT COUNT(*) FROM characters WHERE account = %d", id))
	if err != nil {
		return err
	}
	switch n := strings.TrimSpace(string(out)); n {
	case "0":
	case "1":
		return errors.New("the account has a character: delete it in the game first")
	default:
		return fmt.Errorf("the account has %s characters: delete them in the game first", n)
	}
	if err := runScript(login, fmt.Sprintf("DELETE FROM account WHERE id = %d;\nDELETE FROM realmcharacters WHERE acctid = %d;", id, id)); err != nil {
		return err
	}
	// The account's tutorial flags are the character database's, as the server's DeleteAccount clears them.
	_, err = runSQL(chars, fmt.Sprintf("DELETE FROM character_tutorial WHERE account = %d", id))
	return err
}

// ListCharacters lists account's characters by name.
func ListCharacters(serverRoot string, account int) ([]AccountCharacter, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT guid, name, race, class, gender, level, online FROM characters WHERE account = %d ORDER BY name", account))
	if err != nil {
		return nil, err
	}
	out := []AccountCharacter{}
	for _, f := range batchRows(raw, 7) {
		out = append(out, AccountCharacter{Guid: f.num(0), Name: f[1], Race: f.num(2), Class: f.num(3), Gender: f.num(4), Level: f.num(5), Online: f[6] != "0"})
	}
	return out, nil
}

// ReadCharacter reads character guid's row and home for the editor.
func ReadCharacter(serverRoot string, guid int) (CharacterRecord, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return CharacterRecord{}, err
	}
	r, err := readCharacter(db, guid)
	if err != nil {
		return r, err
	}
	return r, readHome(db, &r)
}

func readCharacter(db worldDB, guid int) (CharacterRecord, error) {
	n := len(characterColumns)
	raw, err := runSQL(db, fmt.Sprintf("SELECT %s, account, online, zone, xp, played_time_total FROM characters WHERE guid = %d", strings.Join(characterColumns, ", "), guid))
	if err != nil {
		return CharacterRecord{}, err
	}
	rows := batchRows(raw, n+5)
	if len(rows) == 0 {
		return CharacterRecord{}, fmt.Errorf("there is no character %d", guid)
	}
	f := rows[0]
	r := CharacterRecord{Guid: guid, Account: f.num(n), Online: f[n+1] != "0", Zone: f.num(n + 2), XP: f.num(n + 3), PlayedTime: f.num(n + 4), Values: map[string]string{}}
	for i, c := range characterColumns {
		r.Values[c] = f[i]
	}
	return r, nil
}

// SaveCharacter writes the changed values (by column: characterColumns and homeColumns) into
// character guid's row and home and returns the SQL it ran, or a ColumnError for a value it refuses.
// The character must be out of the world while the world server runs (worldRunning), and a rename
// needs the world server stopped, since it keeps every character's name in a cache it reads names
// from. A look is checked against the client's tables in dataDir.
func SaveCharacter(serverRoot, dataDir string, guid int, values map[string]string, worldRunning func() bool) (string, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	cur, err := readCharacter(db, guid)
	if err != nil {
		return "", err
	}
	if err := readHome(db, &cur); err != nil {
		return "", err
	}
	running := worldRunning()
	if cur.Online && running {
		return "", fmt.Errorf("%s is in the world: log out of the game first (the world server writes the character over its row when it logs out)", cur.Values["name"])
	}
	set, err := characterSet(cur, values, maxLevel(serverRoot))
	if err != nil {
		return "", err
	}
	home, err := homeSQL(serverRoot, guid, cur.Values, values)
	if err != nil {
		return "", err
	}
	if len(set) == 0 && home == "" {
		return "", nil
	}
	if after, changed := lookAfter(cur.Values, values); changed {
		c, err := loadCharTables(dataDir)
		if err != nil {
			return "", err
		}
		if err := c.looks(after[0], after[1]).check(after[2], after[3], after[4], after[5], after[6]); err != nil {
			return "", err
		}
	}
	if name, ok := values["name"]; ok && normalName(name) != cur.Values["name"] {
		if running {
			return "", refuse("name", "Stop the world server to rename a character: it keeps the names of all characters while it runs")
		}
		out, err := runSQL(db, fmt.Sprintf("SELECT COUNT(*) FROM characters WHERE name = %s AND guid <> %d", sqlQuote(normalName(name)), guid))
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(string(out)) != "0" {
			return "", refuse("name", "There is a character called %s already", normalName(name))
		}
	}
	race, class := pick(values, cur.Values, "race"), pick(values, cur.Values, "class")
	if race != cur.Values["race"] || class != cur.Values["class"] {
		world, err := worldDatabase(serverRoot)
		if err != nil {
			return "", err
		}
		out, err := runSQL(world, fmt.Sprintf("SELECT COUNT(*) FROM playercreateinfo WHERE race = %s AND class = %s", race, class))
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(string(out)) == "0" {
			col := "class"
			if race != cur.Values["race"] {
				col = "race"
			}
			return "", refuse(col, "The server has no such race and class together (its playercreateinfo)")
		}
	}
	var ran []string
	if len(set) > 0 {
		sql := fmt.Sprintf("UPDATE characters SET %s WHERE guid = %d", strings.Join(set, ", "), guid)
		if _, err := runSQL(db, sql); err != nil {
			return "", err
		}
		ran = append(ran, sql)
	}
	if home != "" {
		if _, err := runSQL(db, home); err != nil {
			return strings.Join(ran, ";\n"), err
		}
		ran = append(ran, home)
	}
	return strings.Join(ran, ";\n"), nil
}

// lookAfter is the race, gender, skin, face, hair style, hair colour and facial hair the character
// has once values are written (characterSet resets the parts of the look a new race or gender is not
// given with), and whether any of them changes.
func lookAfter(cur, values map[string]string) ([7]int, bool) {
	var out [7]int
	changed, newBody := false, false
	for i, col := range []string{"race", "gender"} {
		v := pick(values, cur, col)
		out[i] = atoi(v)
		if v != cur[col] {
			changed, newBody = true, true
		}
	}
	for i, col := range lookColumns {
		v, given := values[col]
		v = strings.TrimSpace(v)
		switch {
		case given && v != cur[col]:
			out[2+i], changed = atoi(v), true
		case newBody:
			out[2+i] = 0
		default:
			out[2+i] = atoi(cur[col])
		}
	}
	return out, changed
}

// pick is values[col] when it is set, else cur[col].
func pick(values, cur map[string]string, col string) string {
	if v, ok := values[col]; ok {
		return strings.TrimSpace(v)
	}
	return cur[col]
}

// normalName is a character name as the server keeps it: the first letter upper case, the rest lower
// (normalizePlayerName).
func normalName(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) == 0 {
		return ""
	}
	return strings.ToUpper(string(r[:1])) + strings.ToLower(string(r[1:]))
}

// characterSet checks the changed values against the server's rules and gives the SET clauses that
// write them, with what a change takes along: a new spot leaves any transport, flight and instance
// (as placeSQL does), a new level starts it with no experience, and a new race or gender resets the
// parts of the look (skin, face, hair) not given with it to their first choice, which every race and
// gender has. Whether the look fits the race and gender is SaveCharacter's check (lookAfter).
func characterSet(cur CharacterRecord, values map[string]string, top int) ([]string, error) {
	var set []string
	moved, looks := false, false
	given := map[string]bool{}
	for _, col := range characterColumns {
		v, ok := values[col]
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if col == "name" {
			v = normalName(v)
		}
		if v == cur.Values[col] {
			continue
		}
		switch col {
		case "name":
			n := len([]rune(v))
			if n < 2 || n > maxPlayerName {
				return nil, refuse(col, "A character's name has 2 to %d letters", maxPlayerName)
			}
			for _, r := range v {
				if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z') {
					return nil, refuse(col, "A character's name has only the letters A to Z")
				}
			}
			set = append(set, "name = "+sqlQuote(v))
			continue
		case "race", "class":
			if _, err := intIn(col, v, 1, 11); err != nil {
				return nil, err
			}
			looks = looks || col == "race"
		case "gender":
			if _, err := intIn(col, v, 0, 1); err != nil {
				return nil, err
			}
			looks = true
		case "level":
			if _, err := intIn(col, v, 1, top); err != nil {
				return nil, err
			}
			set = append(set, "xp = 0")
		case "money":
			if _, err := intIn(col, v, 0, maxMoney); err != nil {
				return nil, err
			}
		case "map":
			if _, err := intIn(col, v, 0, 1<<31-1); err != nil {
				return nil, err
			}
			moved = true
		case "skin", "face", "hair_style", "hair_color", "facial_hair":
			if _, err := intIn(col, v, 0, 255); err != nil {
				return nil, err
			}
			given[col] = true
		case "honor_highest_rank":
			if _, err := intIn(col, v, 0, honorRanks); err != nil {
				return nil, err
			}
		case "honor_stored_hk", "honor_stored_dk":
			if _, err := intIn(col, v, 0, 1<<31-1); err != nil {
				return nil, err
			}
		case "honor_rank_points":
			f, err := strconv.ParseFloat(v, 64)
			if err != nil || math.IsNaN(f) || math.Abs(f) > maxRankPoints {
				return nil, refuse(col, "%s is not a number from -%d to %d", v, maxRankPoints, maxRankPoints)
			}
			v = num(f)
		default: // the position and facing
			f, err := strconv.ParseFloat(v, 64)
			if err != nil || math.IsNaN(f) || f > 1e9 || f < -1e9 {
				return nil, refuse(col, "%s is no number", v)
			}
			v = num(f)
			moved = true
		}
		set = append(set, col+" = "+v)
	}
	if moved {
		set = append(set, "instance = 0", "transport_guid = 0", "transport_x = 0", "transport_y = 0", "transport_z = 0", "transport_o = 0", "current_taxi_path = ''")
	}
	if looks {
		for _, c := range lookColumns {
			if !given[c] {
				set = append(set, c+" = 0")
			}
		}
	}
	return set, nil
}

// maxLevel is the server's highest player level (mangosd.conf's MaxPlayerLevel, 60 when unset).
func maxLevel(serverRoot string) int {
	v, _ := confValue(serverRoot, "MaxPlayerLevel")
	if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 255 {
		return n
	}
	return 60
}

// intIn reads v as a whole number from lo to hi, or refuses it for col.
func intIn(col, v string, lo, hi int) (int, error) {
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		return 0, refuse(col, "%s is not a whole number from %d to %d", v, lo, hi)
	}
	return n, nil
}
