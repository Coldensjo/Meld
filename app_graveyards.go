package main

import (
	"bytes"
	"errors"
	"fmt"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// World › Graveyards (#947): the open map's graveyards (WorldSafeLocs.dbc) with their facings and the
// zones they serve from the world database, and their save into the client's patch, the server's
// copy of the table and the world database.

// errExternalGraveyards is SaveGraveyards' errExternal: the links and facings are database rows, the
// places a server file.
var errExternalGraveyards = errors.New("a new, moved, renamed or deleted graveyard goes into the server folder's WorldSafeLocs.dbc, which is off while Meld is connected to an external database: change only the facings and zone links, or disconnect first")

// GraveyardList is a map's graveyards, the ID a new one takes, and whether the world database was
// read (without it the facings and links are unknown and can't be saved).
type GraveyardList struct {
	Graveyards []vmangos.Graveyard `json:"graveyards"`
	NextID     uint32              `json:"nextId"`
	Server     bool                `json:"server"`
}

// Graveyards lists the graveyards of map mapID from the client's WorldSafeLocs.dbc, with their
// facings and zone links from the world database when there is one, for World › Graveyards.
func (a *App) Graveyards(mapID uint32) (GraveyardList, error) {
	var res GraveyardList
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadWorldSafeLocs(dataDir)
	if err != nil {
		return res, err
	}
	if res.Graveyards, err = vmangos.ReadGraveyards(dbc, mapID); err != nil {
		return res, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	var top uint32
	var serverDBC []byte
	if hasDB(server) {
		if top, err = vmangos.GraveyardExtras(server, res.Graveyards); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		res.Server = true
	}
	if server != "" && !externalOn() {
		if serverDBC, err = vmangos.ReadServerSafeLocs(server); err != nil {
			return res, err
		}
	}
	res.NextID, err = vmangos.NewGraveyardID(dbc, serverDBC, top)
	return res, err
}

// SaveGraveyards writes World › Graveyards' changed graveyards (rows, whole) and removed ones (remove,
// by ID) into the client's WorldSafeLocs.dbc (Meld's patch) and the server's copy, and their facings
// and zone links into the world database. Nothing is closed or restarted (#661): the running world
// server reloads the links, and the result says when it needs a restart for the places and facings.
func (a *App) SaveGraveyards(rows []vmangos.Graveyard, remove []uint32) (AreaSaveResult, error) {
	var res AreaSaveResult
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return res, err
	}
	if !hasDB(server) {
		return res, errors.New("graveyards are the server's: set the VMaNGOS server folder first")
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadWorldSafeLocs(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetGraveyards(dbc, rows, remove)
	if err != nil {
		return res, err
	}
	local := server != "" && !externalOn()
	var serverDBC []byte
	if local {
		if serverDBC, err = vmangos.ReadServerSafeLocs(server); err != nil {
			return res, err
		}
	}
	clientChanged := !bytes.Equal(out, dbc)
	serverChanged := local && !bytes.Equal(out, serverDBC)
	if externalOn() && clientChanged {
		return res, errExternalGraveyards
	}
	// The facings the server holds now, to tell whether a save changed one (read only at its start).
	was := make([]vmangos.Graveyard, len(rows))
	for i, g := range rows {
		was[i] = vmangos.Graveyard{ID: g.ID}
	}
	if _, err := vmangos.GraveyardExtras(server, was); err != nil {
		return res, fmt.Errorf("world database: %w", err)
	}
	facings := false
	for i, g := range rows {
		facings = facings || was[i].O != g.O
	}
	if err := a.applySQL(server, vmangos.GraveyardSQL(rows, remove)); err != nil {
		return res, fmt.Errorf("world database: %w", err)
	}
	res.Server = true
	running := a.worldRunning()
	res.Restart = running && (clientChanged || serverChanged || facings || len(remove) > 0)
	a.reloadWorld("SaveGraveyards")
	serverTable := func() error {
		if !serverChanged {
			return nil
		}
		if _, err := vmangos.InstallServerSafeLocs(server, out); err != nil {
			return fmt.Errorf("the graveyards' links are saved in the world database, but writing WorldSafeLocs.dbc into the server's data failed (Save again to retry): %w", err)
		}
		return nil
	}
	if !clientChanged {
		return res, serverTable()
	}
	tried := false
	res.Patch, res.Waiting, err = a.installClient(dataDir, []mpq.File{{Name: vmangos.WorldSafeLocsPath, Data: out}}, func() error {
		tried = true
		return serverTable()
	})
	if err != nil && !tried {
		err = afterDatabase("the graveyards are", err)
	}
	return res, err
}
