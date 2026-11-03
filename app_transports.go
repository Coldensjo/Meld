package main

import (
	"bytes"
	"errors"
	"fmt"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// Making and editing boats and zeppelins (#955): World › Transports' New transport and Edit. The
// reading is Transports (app_client_tables.go).

// TransportSaveResult is what SaveTransport wrote: Save's result (AreaSaveResult's fields), and the
// period written into the transports row, in milliseconds.
type TransportSaveResult struct {
	Patch   string `json:"patch"`
	Server  bool   `json:"server"`
	Waiting bool   `json:"waiting"`
	Restart bool   `json:"restart"`
	Period  uint32 `json:"period"`
}

// NewTransportIDs is the entry (the world database's first free game object entry) and taxi path ID
// (past the client's tables' highest) a new transport takes.
func (a *App) NewTransportIDs() (vmangos.TransportIDs, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.TransportIDs{}, err
	}
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return vmangos.TransportIDs{}, err
	}
	path, err := vmangos.NextTaxiPath(tt)
	if err != nil {
		return vmangos.TransportIDs{}, err
	}
	entry, err := vmangos.NextTransportEntry(server)
	if err != nil {
		return vmangos.TransportIDs{}, fmt.Errorf("world database: %w", err)
	}
	return vmangos.TransportIDs{Entry: entry, PathID: path}, nil
}

// SaveTransport writes a boat or zeppelin: its template and `transports` row (with the period the
// client works out from the route) into the world database, and its taxi path into the client's
// TaxiPath.dbc and TaxiPathNode.dbc (Meld's patch: the client sails it from its own copy) and the
// server's data. The world server reads transports only when it starts: the result says when it
// runs and needs a restart. Saving again rewrites the same rows, so a save that failed half way is
// finished by another.
func (a *App) SaveTransport(edit vmangos.TransportEdit) (TransportSaveResult, error) {
	var res TransportSaveResult
	if externalOn() {
		// The path is the server's data files, which an external server's folder doesn't take (#856).
		return res, errors.New("a transport's route goes into the server folder's data, which is off while Meld is connected to an external database: disconnect first")
	}
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return res, err
	}
	maps, err := vmangos.LoadMapEntries(dataDir)
	if err != nil {
		return res, err
	}
	instanced := map[uint32]bool{}
	for _, m := range maps {
		instanced[m.ID] = m.Type != 0
	}
	period, err := vmangos.CheckTransport(edit, func(id uint32) bool { return instanced[id] })
	if err != nil {
		return res, err
	}
	res.Period = period
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetTransportPath(tt, edit.PathID, edit.Points)
	if err != nil {
		return res, err
	}
	sql, err := vmangos.TransportSQL(edit, period)
	if err != nil {
		return res, err
	}
	free, err := vmangos.TransportEntryFree(server, edit.Entry)
	if err != nil {
		return res, fmt.Errorf("world database: %w", err)
	}
	if !free {
		return res, fmt.Errorf("game object %d is no transport: pick New transport again for a free entry", edit.Entry)
	}
	if err := a.applySQL(server, sql); err != nil {
		return res, fmt.Errorf("world database: %w", err)
	}
	vmangos.ForgetObjectTemplates()
	var files []mpq.File
	for _, f := range []struct {
		name     string
		old, new []byte
	}{{vmangos.TaxiPathPath, tt.Paths, out.Paths}, {vmangos.TaxiPathNodePath, tt.Points, out.Points}} {
		if !bytes.Equal(f.old, f.new) {
			files = append(files, mpq.File{Name: f.name, Data: f.new})
		}
	}
	tablesTried := false
	serverTables := func() error {
		tablesTried = true
		if _, err := vmangos.InstallServerTaxi(server, out); err != nil {
			return fmt.Errorf("the transport is saved in the world database and the client, but writing its route into the server's data failed (Save again to retry): %w", err)
		}
		res.Server = true
		res.Restart = a.worldRunning()
		return nil
	}
	if len(files) == 0 {
		return res, serverTables()
	}
	res.Patch, res.Waiting, err = a.installClient(dataDir, files, serverTables)
	if err != nil && !tablesTried {
		err = fmt.Errorf("the transport is saved in the world database, but writing its route into the client's patch failed (Save again to retry): %w", err)
	}
	return res, err
}

// TransportDeleteResult is what DeleteTransport did: Save's result (AreaSaveResult's fields), and
// whether the path was kept because another transport sails it.
type TransportDeleteResult struct {
	Patch      string `json:"patch"`
	Server     bool   `json:"server"`
	Waiting    bool   `json:"waiting"`
	Restart    bool   `json:"restart"`
	PathID     uint32 `json:"pathId"`
	PathShared bool   `json:"pathShared"`
}

// DeleteTransport takes a boat or zeppelin out (#1039): its template and `transports` rows from the
// world database, then its taxi path from the client's TaxiPath.dbc and TaxiPathNode.dbc (Meld's
// patch) and the server's data, unless another transport sails the same path. The rows go first: a
// path no template sails is left alone by the server and the client, so a delete that fails after
// them leaves only an unused path.
func (a *App) DeleteTransport(entry uint32) (TransportDeleteResult, error) {
	var res TransportDeleteResult
	if externalOn() {
		return res, errors.New("a transport's route is in the server folder's data, which is off while Meld is connected to an external database: disconnect first")
	}
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return res, err
	}
	path, shared, ok, err := vmangos.TransportPathOf(server, entry)
	if err != nil {
		return res, fmt.Errorf("world database: %w", err)
	}
	if !ok {
		return res, fmt.Errorf("game object %d is no transport", entry)
	}
	res.PathID, res.PathShared = path, shared
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return res, err
	}
	out := tt
	if !shared {
		if out, err = vmangos.RemoveTransportPath(tt, path); err != nil {
			return res, err
		}
	}
	if err := a.applySQL(server, vmangos.DeleteTransportSQL(entry)); err != nil {
		return res, fmt.Errorf("world database: %w", err)
	}
	vmangos.ForgetObjectTemplates()
	res.Restart = a.worldRunning()
	var files []mpq.File
	for _, f := range []struct {
		name     string
		old, new []byte
	}{{vmangos.TaxiPathPath, tt.Paths, out.Paths}, {vmangos.TaxiPathNodePath, tt.Points, out.Points}} {
		if !bytes.Equal(f.old, f.new) {
			files = append(files, mpq.File{Name: f.name, Data: f.new})
		}
	}
	if len(files) == 0 {
		return res, nil
	}
	tablesTried := false
	serverTables := func() error {
		tablesTried = true
		if _, err := vmangos.InstallServerTaxi(server, out); err != nil {
			return fmt.Errorf("the transport is out of the world database and its path out of the client, but taking the path out of the server's data failed (it stays there unused): %w", err)
		}
		res.Server = true
		return nil
	}
	res.Patch, res.Waiting, err = a.installClient(dataDir, files, serverTables)
	if err != nil && !tablesTried {
		err = fmt.Errorf("the transport is out of the world database, but taking its path out of the client's patch failed (it stays there unused): %w", err)
	}
	return res, err
}
