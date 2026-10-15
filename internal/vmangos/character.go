package vmangos

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// CharacterSpot is where a character stands on the server: its map, its position in the server's
// coordinates and its facing (radians, from the server's +X towards +Y).
type CharacterSpot struct {
	Map int     `json:"map"`
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Z   float64 `json:"z"`
	O   float64 `json:"o"`
}

// How long PlaceCharacter waits for the world server to log a character out. A client that logs out
// is gone at once; one that vanished is kept in the world for two minutes (mangosd.conf's
// ForceLogoutDelay), so the wait covers that.
var (
	logoutWait = 150 * time.Second
	logoutPoll = 500 * time.Millisecond
)

// PlaceCharacter moves the character called name to spot in the server's character database, so it
// enters the world there. The world server saves a character over its row when it logs out, so while
// the world server runs (worldRunning) this first waits until the character is logged out.
func PlaceCharacter(serverRoot, name string, spot CharacterSpot, worldRunning func() bool) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("no character to place")
	}
	db, err := confDatabase(serverRoot, "CharacterDatabase.Info")
	if err != nil {
		return err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return err
	}
	where := " FROM characters WHERE name = " + sqlQuote(name)
	deadline := time.Now().Add(logoutWait)
	for {
		out, err := runSQL(db, "SELECT online"+where)
		if err != nil {
			return err
		}
		online := strings.TrimSpace(string(out))
		if online == "" {
			return fmt.Errorf("the server has no character called %s", name)
		}
		// The flag is left at 1 by a world server that stopped without logging its players out.
		if online == "0" || !worldRunning() {
			break
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s is still in the world: log out of the game and launch again", name)
		}
		time.Sleep(logoutPoll)
	}
	_, err = runSQL(db, placeSQL(name, spot))
	return err
}

// placeSQL puts the character called name at spot: off any transport or flight, and not in an instance.
func placeSQL(name string, s CharacterSpot) string {
	return fmt.Sprintf("UPDATE characters SET map = %d, instance = 0, position_x = %s, position_y = %s, position_z = %s, orientation = %s, "+
		"transport_guid = 0, transport_x = 0, transport_y = 0, transport_z = 0, transport_o = 0, current_taxi_path = '' WHERE name = %s",
		s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), sqlQuote(name))
}

// RealmName is the name of the server's first realm (realmd's realmlist), which the game is told to
// pick so it doesn't stop at the realm list. It reads the database only when it is already running.
func RealmName(serverRoot string) (string, error) {
	db, err := confDatabase(serverRoot, "LoginDatabase.Info")
	if err != nil {
		return "", err
	}
	out, err := runSQL(db, "SELECT name FROM realmlist ORDER BY id LIMIT 1")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
