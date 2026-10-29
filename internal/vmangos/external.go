package vmangos

import (
	"errors"
	"sync"
)

// An external database (#856): the databases of a VMaNGOS server on another machine, read from a copy
// of its mangosd.conf that the user points at, so Meld keeps no password of its own (the owner's
// choice). While one is set, every connection confDatabase makes goes to it, ensureDatabase never
// starts a database, and the server folder's database controls refuse (ErrExternalDatabase). The
// app turns off everything that writes files into a server folder (app_external.go).

var (
	externalMu   sync.RWMutex
	externalConf string
)

// ErrExternalDatabase is what a control of the server folder's own database says while an external
// database is set.
var ErrExternalDatabase = errors.New("connected to an external database: the local server's controls are off until Meld disconnects from it (File › Disconnect External Database)")

// SetExternal points every database connection at the mangosd.conf at path; "" goes back to the
// server folder's own run/mangosd.conf.
func SetExternal(path string) {
	externalMu.Lock()
	changed := externalConf != path
	externalConf = path
	externalMu.Unlock()
	if changed {
		forgetDatabaseLists()
	}
}

// forgetDatabaseLists drops the lists read from the world database (templates, displays' uses, held
// items), which are cached by server folder and would otherwise show the other database's rows.
func forgetDatabaseLists() {
	templatesMu.Lock()
	clear(creaturesCache)
	clear(objectsCache)
	templatesMu.Unlock()
	forgetDisplays()
	forgetObjectDisplays()
	forgetWeapons()
}

// hasDatabase says whether there is a world database to read: the server folder's, or an external one.
func hasDatabase(serverRoot string) bool {
	return serverRoot != "" || External() != ""
}

// External is the mangosd.conf SetExternal set, or "" while the server folder's databases are used.
func External() string {
	externalMu.RLock()
	defer externalMu.RUnlock()
	return externalConf
}

// DatabaseRef is one database of a mangosd.conf, without its password.
type DatabaseRef struct {
	Host string `json:"host"`
	Port string `json:"port"`
	User string `json:"user"`
	Name string `json:"name"`
}

// ExternalDatabase is what the warning before connecting to an external database names: its conf
// file and its world, character and login databases ("" names for one the conf lacks).
type ExternalDatabase struct {
	Conf       string      `json:"conf"`
	World      DatabaseRef `json:"world"`
	Characters DatabaseRef `json:"characters"`
	Login      DatabaseRef `json:"login"`
}

func refOf(d worldDB) DatabaseRef {
	return DatabaseRef{Host: d.host, Port: d.port, User: d.user, Name: d.name}
}

// ReadExternal reads the databases of the mangosd.conf at path without connecting to them. The world
// database is required; the character and login ones are named when the conf has them.
func ReadExternal(path string) (ExternalDatabase, error) {
	out := ExternalDatabase{Conf: path}
	world, err := readConfDatabase(path, "WorldDatabase.Info")
	if err != nil {
		return out, err
	}
	out.World = refOf(world)
	if c, err := readConfDatabase(path, "CharacterDatabase.Info"); err == nil {
		out.Characters = refOf(c)
	}
	if l, err := readConfDatabase(path, "LoginDatabase.Info"); err == nil {
		out.Login = refOf(l)
	}
	return out, nil
}

// PingExternal checks that the world database of the mangosd.conf at path answers, without starting
// anything: the connect step after the user confirmed the warning.
func PingExternal(path string) error {
	db, err := readConfDatabase(path, "WorldDatabase.Info")
	if err != nil {
		return err
	}
	_, err = runSQL(db, "SELECT 1")
	return err
}
