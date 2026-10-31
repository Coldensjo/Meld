package vmangos

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// teleName is the name of Meld's own row in the world database's game_tele: the spot Play here moves a
// character to, rewritten on every use.
const teleName = "meld_here"

// soapConsole is the world server's SOAP console, as mangosd.conf sets it.
type soapConsole struct {
	enabled bool
	host    string
	port    int
}

// confValue reads key's value from the server's mangosd.conf: the text after `key =`, unquoted, or ""
// when the file doesn't set it.
func confValue(serverRoot, key string) (string, error) {
	b, err := os.ReadFile(filepath.Join(serverRoot, "run", "mangosd.conf"))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(k) == key {
			return strings.Trim(strings.TrimSpace(v), `"`), nil
		}
	}
	return "", nil
}

// confSoap reads the SOAP console's settings from mangosd.conf, with the server's defaults (off,
// 127.0.0.1:7878) for what it doesn't set.
func confSoap(serverRoot string) (soapConsole, error) {
	c := soapConsole{host: "127.0.0.1", port: 7878}
	on, err := confValue(serverRoot, "SOAP.Enabled")
	if err != nil {
		return c, err
	}
	c.enabled = on == "1"
	if ip, _ := confValue(serverRoot, "SOAP.IP"); ip != "" && ip != "0.0.0.0" {
		c.host = ip
	}
	if p, _ := confValue(serverRoot, "SOAP.Port"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			c.port = n
		}
	}
	return c, nil
}

// soapEnvelope is the request gSOAP's MaNGOS service (urn:MaNGOS, executeCommand) takes.
const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance" xmlns:xsd="http://www.w3.org/1999/XMLSchema" xmlns:ns1="urn:MaNGOS">
<SOAP-ENV:Body><ns1:executeCommand><command>%s</command></ns1:executeCommand></SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

// soapReply is the part of a SOAP response read: the command's output, or a fault's text.
type soapReply struct {
	Result      string `xml:"Body>executeCommandResponse>result"`
	FaultString string `xml:"Body>Fault>faultstring"`
}

// errSoapClosed is returned when nothing answers on the SOAP console's port.
var errSoapClosed = errors.New("the world server's SOAP console doesn't answer")

// soapCommand runs one console command (without the leading dot) on the world server, through its
// SOAP console, logged in as a game account of GM level 6 (Administrator, in realmd's account_access,
// which the server reads; account.gmlevel is not), as the console's own security. It returns what the command
// printed. A variable, so tests can stand in for the server.
var soapCommand = func(c soapConsole, account, password, command string) (string, error) {
	var body bytes.Buffer
	if err := xml.EscapeText(&body, []byte(command)); err != nil {
		return "", err
	}
	url := "http://" + net.JoinHostPort(c.host, strconv.Itoa(c.port)) + "/"
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(fmt.Sprintf(soapEnvelope, body.String())))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	req.SetBasicAuth(account, password)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		var op *net.OpError
		if errors.As(err, &op) && op.Op == "dial" {
			return "", errSoapClosed
		}
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return "", fmt.Errorf("the world server refused the account %s: check its password in Game Login", account)
	case http.StatusForbidden:
		return "", fmt.Errorf("the account %s needs GM level 6 (Administrator, a row in realmd's account_access for this realm; the server reads it at start) to use the server's console", account)
	}
	var r soapReply
	if err := xml.Unmarshal(raw, &r); err != nil {
		return "", fmt.Errorf("the SOAP console answered %s: %w", resp.Status, err)
	}
	if r.FaultString != "" || resp.StatusCode != http.StatusOK {
		msg := strings.TrimSpace(r.FaultString)
		if msg == "" {
			msg = resp.Status
		}
		return "", fmt.Errorf("%s failed: %s", command, msg)
	}
	return strings.TrimSpace(r.Result), nil
}

// TeleportCharacter moves the character called name, in the world now, to spot while the game runs:
// it writes the spot into Meld's own game_tele row (teleName), has the world server reload that table
// and sends `.tele name` through the SOAP console, logged in as account. It fails, saying why, when
// SOAP is off in mangosd.conf, the console doesn't answer or the character isn't in the world.
func TeleportCharacter(serverRoot, account, password, name string, spot CharacterSpot) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("Game Login has no character to move")
	}
	if strings.TrimSpace(account) == "" {
		return errors.New("Game Login has no account to send the command with")
	}
	soap, err := confSoap(serverRoot)
	if err != nil {
		return err
	}
	if !soap.enabled {
		return ErrSoapOff
	}
	chars, err := confDatabase(serverRoot, "CharacterDatabase.Info")
	if err != nil {
		return err
	}
	out, err := runSQL(chars, "SELECT online FROM characters WHERE name = "+sqlQuote(name))
	if err != nil {
		return err
	}
	switch strings.TrimSpace(string(out)) {
	case "":
		return fmt.Errorf("the server has no character called %s", name)
	case "0":
		return fmt.Errorf("%s isn't in the world: enter it in the game first, or use Launch", name)
	}
	world, err := confDatabase(serverRoot, "WorldDatabase.Info")
	if err != nil {
		return err
	}
	if _, err := runSQL(world, teleSQL(spot)); err != nil {
		return err
	}
	if _, err := soapCommand(soap, account, password, "reload game_tele"); err != nil {
		if errors.Is(err, errSoapClosed) {
			return fmt.Errorf("%w on %s:%d: is the world server running, and restarted since SOAP.Enabled was set?", err, soap.host, soap.port)
		}
		return err
	}
	_, err = soapCommand(soap, account, password, "tele name "+name+" "+teleName)
	return err
}

// teleSQL writes spot into Meld's game_tele row, replacing the one written before. A new row takes
// the next free id, so it never collides with the table's own.
func teleSQL(s CharacterSpot) string {
	return fmt.Sprintf("DELETE FROM game_tele WHERE name = %s;\n"+
		"INSERT INTO game_tele (id, position_x, position_y, position_z, orientation, map, name) "+
		"SELECT COALESCE(MAX(id), 0) + 1, %s, %s, %s, %s, %d, %s FROM game_tele;",
		sqlQuote(teleName), num(s.X), num(s.Y), num(s.Z), num(s.O), s.Map, sqlQuote(teleName))
}

// ErrSoapOff says the world server's SOAP console is off in mangosd.conf.
var ErrSoapOff = errors.New("the world server's SOAP console is off (SOAP.Enabled in mangosd.conf)")

// ShutdownWorld asks the running world server to shut down now (`.server shutdown 0`)
// through its SOAP console, logged in as account: the server saves the characters in the world and
// exits, which a closed console window does not wait for. It fails when SOAP is off, no account is
// saved or the console refuses; the caller then closes the server another way.
func ShutdownWorld(serverRoot, account, password string) error {
	if strings.TrimSpace(account) == "" {
		return errors.New("Game Login has no account to send the command with")
	}
	soap, err := confSoap(serverRoot)
	if err != nil {
		return err
	}
	if !soap.enabled {
		return ErrSoapOff
	}
	_, err = soapCommand(soap, account, password, "server shutdown 0")
	return err
}

// ReloadSpells has the running world server read spell_template again (`.reload spell_template`,
// which needs GM level 5) through its SOAP console, logged in as account, so a saved spell works
// without restarting it.
func ReloadSpells(serverRoot, account, password string) error {
	return ReloadTables(serverRoot, account, password, []string{"spell_template"})
}

// ReloadTables has the running world server read world database tables again through its SOAP
// console, logged in as account: one `.reload <command>` for each of commands, in order (a table's
// name, as VMaNGOS's reload subcommands name them, with an entry after it for one template row). They
// need GM level 5. It stops at the first that fails, and fails with ErrSoapOff when SOAP is off.
func ReloadTables(serverRoot, account, password string, commands []string) error {
	if len(commands) == 0 {
		return nil
	}
	if strings.TrimSpace(account) == "" {
		return errors.New("Game Login has no account to send the command with")
	}
	soap, err := confSoap(serverRoot)
	if err != nil {
		return err
	}
	if !soap.enabled {
		return ErrSoapOff
	}
	for _, c := range commands {
		if _, err := soapCommand(soap, account, password, "reload "+c); err != nil {
			if errors.Is(err, errSoapClosed) {
				return fmt.Errorf("%w on %s:%d: is the world server restarted since SOAP.Enabled was set?", err, soap.host, soap.port)
			}
			return err
		}
	}
	return nil
}
