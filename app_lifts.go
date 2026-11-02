package main

import (
	"bytes"
	"errors"
	"fmt"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// Lifts and elevators (#956): World › Lifts reads and writes the type 11 game objects' loops in
// TransportAnimation.dbc (internal/vmangos/lifts.go).

// LiftSaveResult is what SaveLift wrote: Save's result (AreaSaveResult's fields).
type LiftSaveResult struct {
	Patch   string `json:"patch"`
	Server  bool   `json:"server"`
	Waiting bool   `json:"waiting"`
	Restart bool   `json:"restart"`
}

// LiftMotions lists every lift template's loop in the client's TransportAnimation.dbc, as the game
// will see it.
func (a *App) LiftMotions() ([]vmangos.LiftMotion, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	dbc, err := vmangos.LoadLiftTable(dataDir)
	if err != nil {
		return nil, err
	}
	return vmangos.ReadLiftMotions(dbc)
}

// NewLiftEntry is the entry a new lift's template takes: the world database's first free game object
// entry.
func (a *App) NewLiftEntry() (uint32, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	entry, err := vmangos.NextTransportEntry(server)
	if err != nil {
		return 0, fmt.Errorf("world database: %w", err)
	}
	return entry, nil
}

// SaveLift writes a lift's loop into the client's TransportAnimation.dbc (Meld's patch: the client
// moves the lift from its own copy) and the server's data, and a new lift's template (type 11) into
// the world database first. The world server reads lifts only when it starts: the result says when it
// runs and needs a restart. Saving again rewrites the same rows, so a save that failed half way is
// finished by another.
func (a *App) SaveLift(edit vmangos.LiftEdit) (LiftSaveResult, error) {
	var res LiftSaveResult
	if externalOn() {
		// The loop is the server's data files, which an external server's folder doesn't take (#856).
		return res, errors.New("a lift's loop goes into the server folder's data, which is off while Meld is connected to an external database: disconnect first")
	}
	if err := vmangos.CheckLift(edit); err != nil {
		return res, err
	}
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return res, err
	}
	kind, err := vmangos.LiftEntryType(server, edit.Entry)
	if err != nil {
		return res, fmt.Errorf("world database: %w", err)
	}
	switch {
	case edit.New && kind != -1 && kind != 11:
		return res, fmt.Errorf("game object %d is no lift: pick New lift again for a free entry", edit.Entry)
	case !edit.New && kind != 11:
		return res, fmt.Errorf("game object %d is no lift (type 11) in the world database", edit.Entry)
	}
	old, err := vmangos.LoadLiftTable(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetLiftFrames(old, edit.Entry, edit.Frames)
	if err != nil {
		return res, err
	}
	if edit.New {
		sql, err := vmangos.LiftSQL(edit)
		if err != nil {
			return res, err
		}
		if err := a.applySQL(server, sql); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		vmangos.ForgetObjectTemplates()
	}
	tablesTried := false
	serverTable := func() error {
		tablesTried = true
		if _, err := vmangos.InstallServerLifts(server, out); err != nil {
			return fmt.Errorf("the lift's loop is saved in the client, but writing it into the server's data failed (Save again to retry): %w", err)
		}
		res.Server = true
		res.Restart = a.worldRunning()
		return nil
	}
	if bytes.Equal(old, out) {
		return res, serverTable()
	}
	res.Patch, res.Waiting, err = a.installClient(dataDir, []mpq.File{{Name: vmangos.TransportAnimationPath, Data: out}}, serverTable)
	if err != nil && !tablesTried {
		err = fmt.Errorf("writing the lift's loop into the client's patch failed (Save again to retry): %w", err)
	}
	return res, err
}
