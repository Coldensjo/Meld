package vmangos

import (
	"errors"
	"fmt"
	"strings"
)

// The Game Login character's test actions (#962): commands sent through the world server's SOAP
// console that name the character, since the console has no selected target. Only commands VMaNGOS
// allows from the console work there (src/game/Chat/Chat.cpp, the third field of a command's row):
// `.character level` and `.send items` are; `.levelup`, `.additem` and the `.quest` commands are not.

// maxCharacterLevel is the highest level a 1.12 character reaches (the server's MaxPlayerLevel).
const maxCharacterLevel = 60

// characterConsole is the SOAP console of the server in serverRoot, checked for a command that names
// the character called name: it fails, saying why, when there is no character or account, the name
// can't be sent as one argument, or SOAP is off in mangosd.conf.
func characterConsole(serverRoot, account, name string) (soapConsole, error) {
	switch {
	case name == "":
		return soapConsole{}, errors.New("Game Login has no character")
	case strings.ContainsAny(name, " \t\"'|"):
		// A character's name is letters only; anything else would split or end the command's argument.
		return soapConsole{}, fmt.Errorf("the character name %q can't be sent to the server's console", name)
	case strings.TrimSpace(account) == "":
		return soapConsole{}, errors.New("Game Login has no account to send the command with")
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

// consoleCommand sends one command through the SOAP console c, saying when nothing answers.
func consoleCommand(c soapConsole, account, password, command string) (string, error) {
	out, err := soapCommand(c, account, password, command)
	if errors.Is(err, errSoapClosed) {
		return "", fmt.Errorf("%w on %s:%d: is the world server restarted since SOAP.Enabled was set?", err, c.host, c.port)
	}
	return out, err
}

// levelCommand is the console command that sets the character called name to level: `.character
// level`, which works on a character in the world (it levels up there) and on one logged out (its row).
func levelCommand(name string, level int) string {
	return fmt.Sprintf("character level %s %d", name, level)
}

// SetCharacterLevel sets the character called name to level (1 to 60; a higher one is taken as 60)
// through the world server's SOAP console, logged in as account, and returns what the server said.
func SetCharacterLevel(serverRoot, account, password, name string, level int) (string, error) {
	name = strings.TrimSpace(name)
	if level < 1 {
		return "", fmt.Errorf("level %d isn't a character's level", level)
	}
	level = min(level, maxCharacterLevel)
	soap, err := characterConsole(serverRoot, account, name)
	if err != nil {
		return "", err
	}
	return consoleCommand(soap, account, password, levelCommand(name, level))
}

// mailSubject and mailText are the letter MailItems sends the items with.
const (
	mailSubject = "From Meld"
	mailText    = "Sent from Meld for testing."
)

// mailCommand is the console command that mails count of item to the character called name: `.send
// items`, which the server splits into stacks (at most 12 a letter, MAX_MAIL_ITEMS).
func mailCommand(name string, item, count int) string {
	return fmt.Sprintf("send items %s \"%s\" \"%s\" %d:%d", name, mailSubject, mailText, item, count)
}

// MailItems mails count of the item with entry item to the character called name, through the world
// server's SOAP console, logged in as account: the console can't put an item in a bag (`.additem`
// needs a selected player), and a letter reaches a character logged out too. It returns what the
// server said; the server refuses an item it doesn't have (one made since it started needs
// `.reload item_template`), more than the item's MaxCount, or more than 12 stacks.
func MailItems(serverRoot, account, password, name string, item, count int) (string, error) {
	name = strings.TrimSpace(name)
	if item <= 0 {
		return "", fmt.Errorf("item %d isn't an item's entry", item)
	}
	if count < 1 {
		return "", fmt.Errorf("can't send %d of an item", count)
	}
	soap, err := characterConsole(serverRoot, account, name)
	if err != nil {
		return "", err
	}
	return consoleCommand(soap, account, password, mailCommand(name, item, count))
}

// ConsoleReady says whether the character test actions can run on the server in serverRoot: nil when
// its SOAP console is on, else why not (ErrSoapOff, or a conf that can't be read).
func ConsoleReady(serverRoot string) error {
	soap, err := confSoap(serverRoot)
	if err != nil {
		return err
	}
	if !soap.enabled {
		return ErrSoapOff
	}
	return nil
}
