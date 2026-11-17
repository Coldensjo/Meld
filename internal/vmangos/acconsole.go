package vmangos

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// An AzerothCore world server's remote access console (RA, worldserver.conf's Ra.Enable, Ra.IP and
// Ra.Port, on by default at 127.0.0.1:3443), which Play here sends its commands through for a 3.3.5a
// client, as VMaNGOS's go through SOAP (soap.go), which AzerothCore ships switched off. What the server
// does on the connection (RASession.cpp, described here, not copied): it sends "Authentication
// Required", then "Username: " and "Password: ", reading a line ending in CRLF after each; it lets in an
// account whose GM level is at least Ra.MinLevel (3) on every realm (account_access.RealmID -1) and
// sends the message of the day, else "Authentication failed" and closes. Then for each command it sends
// the prompt "AC>", reads the command's line, runs it as the server console does and sends what it
// prints; "quit" ends the session.

// acConsole is an AzerothCore server's remote access console.
type acConsole struct {
	enabled bool
	host    string
	port    int
}

// acPrompt is what the console sends before each command.
const acPrompt = "AC>"

// acConsoleWait bounds a console session: connecting, logging in and each command.
var acConsoleWait = 15 * time.Second

// acConf reads the remote access console's settings from worldserver.conf, with AzerothCore's defaults
// (on, 127.0.0.1:3443) for what it doesn't set.
func acConf(s AzerothCoreServer) (acConsole, error) {
	c := acConsole{enabled: true, host: "127.0.0.1", port: 3443}
	if s.Conf == "" {
		return c, errors.New("the AzerothCore server folder has no worldserver.conf")
	}
	on, err := readConfValue(s.Conf, "Ra.Enable")
	if err != nil {
		return c, err
	}
	c.enabled = on != "0"
	if ip, _ := readConfValue(s.Conf, "Ra.IP"); ip != "" && ip != "0.0.0.0" {
		c.host = ip
	}
	if p, _ := readConfValue(s.Conf, "Ra.Port"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			c.port = n
		}
	}
	return c, nil
}

// ErrRAOff says the AzerothCore world server's remote access console is off.
var ErrRAOff = errors.New("the world server's remote access console is off (Ra.Enable in worldserver.conf)")

// acDial connects to the console; a variable so tests can serve the session.
var acDial = func(addr string, wait time.Duration) (net.Conn, error) {
	return net.DialTimeout("tcp", addr, wait)
}

// acCommands logs in to the console as account and runs commands in order, returning what the server
// printed for each. It fails, saying why, when nothing answers, the login is refused or a command's
// output says it failed (acFailed).
func acCommands(c acConsole, account, password string, commands ...string) ([]string, error) {
	if !c.enabled {
		return nil, ErrRAOff
	}
	addr := net.JoinHostPort(c.host, strconv.Itoa(c.port))
	conn, err := acDial(addr, acConsoleWait)
	if err != nil {
		return nil, fmt.Errorf("the world server's remote access console on %s does not answer: is the world server running? (%w)", addr, err)
	}
	defer conn.Close()
	r := bufio.NewReader(conn)
	deadline := func() { _ = conn.SetDeadline(time.Now().Add(acConsoleWait)) }
	send := func(line string) error {
		deadline()
		_, err := conn.Write([]byte(line + "\r\n"))
		return err
	}
	deadline()
	if _, err := readUntil(r, "Username: "); err != nil {
		return nil, fmt.Errorf("the console on %s did not ask for a login: %w", addr, err)
	}
	if err := send(account); err != nil {
		return nil, err
	}
	deadline()
	if _, err := readUntil(r, "Password: "); err != nil {
		return nil, err
	}
	if err := send(password); err != nil {
		return nil, err
	}
	deadline()
	greeting, err := readUntil(r, acPrompt)
	if err != nil {
		if strings.Contains(greeting, "Authentication failed") {
			return nil, fmt.Errorf("the world server's console refused the account %s: it needs its password (Game Login) and a GM level of at least Ra.MinLevel (3) on all realms (account_access, RealmID -1)", account)
		}
		return nil, fmt.Errorf("logging in to the console on %s: %w", addr, err)
	}
	out := make([]string, 0, len(commands))
	for _, cmd := range commands {
		if err := send(cmd); err != nil {
			return out, err
		}
		deadline()
		text, err := readUntil(r, acPrompt)
		text = strings.TrimSpace(text)
		if err != nil {
			return out, fmt.Errorf("%s: no answer from the console: %w", cmd, err)
		}
		out = append(out, text)
		if why := acFailed(text); why != "" {
			return out, fmt.Errorf("%s failed: %s", cmd, why)
		}
	}
	_ = send("quit")
	return out, nil
}

// readUntil reads r until it has read mark, returning what came before it. A read that ends first
// returns what it read, with the error.
func readUntil(r *bufio.Reader, mark string) (string, error) {
	var b strings.Builder
	buf := make([]byte, 1)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			b.WriteByte(buf[0])
			if strings.HasSuffix(b.String(), mark) {
				s := b.String()
				return s[:len(s)-len(mark)], nil
			}
		}
		if err != nil {
			return b.String(), err
		}
	}
}

// acFailures are the starts of the lines AzerothCore's commands print when they fail (its language
// strings: an unknown command, a missing player or teleport, a bad argument).
var acFailures = []string{"There is no such command", "Player not found", "Teleport location not found", "Incorrect syntax", "Command can't be used", "You can't", "No such"}

// acFailed is the line of a command's output that says it failed, or "".
func acFailed(out string) string {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		for _, f := range acFailures {
			if strings.HasPrefix(line, f) {
				return line
			}
		}
	}
	return ""
}

// acCharacterDB is the AzerothCore server's character database (worldserver.conf's
// CharacterDatabaseInfo).
func acCharacterDB(s AzerothCoreServer) (worldDB, error) {
	db, err := readConfDatabase(s.Conf, "CharacterDatabaseInfo")
	if err != nil {
		return worldDB{}, fmt.Errorf("%s has no CharacterDatabaseInfo", s.Conf)
	}
	return db, nil
}

// ACTeleportCharacter is TeleportCharacter for an AzerothCore server: it writes spot into Meld's own
// game_tele row, has the world server reload that table and sends `tele name` through the remote access
// console, logged in as account. The server moves a character in the world at once and sets a logged-out
// one's position for its next login, so the character need not be in the world.
func ACTeleportCharacter(s AzerothCoreServer, account, password, name string, spot CharacterSpot) error {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return errors.New("Game Login has no character to move")
	case strings.ContainsAny(name, " \t\"'|\r\n"):
		return fmt.Errorf("the character name %q can't be sent to the server's console", name)
	case strings.TrimSpace(account) == "":
		return errors.New("Game Login has no account to send the command with")
	}
	ra, err := acConf(s)
	if err != nil {
		return err
	}
	if !ra.enabled {
		return ErrRAOff
	}
	chars, err := acCharacterDB(s)
	if err != nil {
		return err
	}
	out, err := runSQL(chars, "SELECT `online` FROM `characters` WHERE `name` = "+sqlQuote(name))
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(out)) == "" {
		return fmt.Errorf("the server has no character called %s", name)
	}
	world, err := acDatabase(s)
	if err != nil {
		return err
	}
	if _, err := runSQL(world, teleSQL(spot)); err != nil {
		return err
	}
	_, err = acCommands(ra, account, password, "reload game_tele", "tele name "+name+" "+teleName)
	return err
}
