package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// TestSaveAfterDatabaseSaysWhatWasWritten checks that a save which writes the world database and then
// the client's patch says, when the patch write fails, that the database already holds it (#477), and
// that without a server folder the patch's own error comes back as it is. The database is a stand-in
// (App.runSQL) and a read-only patch-3 stands in for one the game holds.
func TestSaveAfterDatabaseSaysWhatWasWritten(t *testing.T) {
	if runtime.GOOS != "windows" && os.Geteuid() == 0 {
		t.Skip("root writes read-only files")
	}
	cache := t.TempDir()
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	// An empty 1.12 AreaTrigger.dbc: ten fields of four bytes, no records, an empty string block.
	dbc := []byte("WDBC")
	for _, v := range []uint32{0, 10, 40, 1} {
		dbc = binary.LittleEndian.AppendUint32(dbc, v)
	}
	dbc = append(dbc, 0)
	if err := os.WriteFile(filepath.Join(data, "dbc.MPQ"), mpq.Write([]mpq.File{{Name: vmangos.AreaTriggerPath, Data: dbc}}), 0o644); err != nil {
		t.Fatal(err)
	}
	patch := filepath.Join(data, vmangos.PatchName)
	if err := os.WriteFile(patch, mpq.Write([]mpq.File{{Name: "meld.txt", Data: []byte("held")}}), 0o444); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(patch, 0o644)

	var scripts []string
	a := &App{gameUp: func() bool { return false }, runSQL: func(_, script string) error {
		scripts = append(scripts, script)
		return nil
	}}
	a.cfg.WowPath = root
	a.pendingWatch.Store(true)
	trigger := []vmangos.AreaTrigger{{ID: 9001, X: 1, Y: 2, Z: 3, Radius: 5}}

	// No server folder: only the patch is written, and its failure is its own.
	_, err := a.SaveAreaTriggers(trigger, nil)
	if err == nil || !strings.Contains(err.Error(), "in use") || strings.Contains(err.Error(), "world database") || len(scripts) != 0 {
		t.Fatalf("without a server: %v (%d scripts), want the patch's own error", err, len(scripts))
	}

	// With one, the database is written first, and the patch's failure says so.
	a.cfg.VmangosPath = t.TempDir()
	_, err = a.SaveAreaTriggers(trigger, nil)
	if err == nil || !strings.Contains(err.Error(), "saved in the world database") || !strings.Contains(err.Error(), "Save again") {
		t.Fatalf("with a server: %v, want it to say the world database holds the portals", err)
	}
	if len(scripts) != 1 || !strings.Contains(scripts[0], "9001") {
		t.Fatalf("with a server: scripts %q, want the trigger's SQL", scripts)
	}
}

// TestTemplateSavedHandsOverTheRefusedColumn checks that a refused value comes back as the result's
// Refused, with no error (Wails would pass the page only the message), and any other failure as the
// error (#597).
func TestTemplateSavedHandsOverTheRefusedColumn(t *testing.T) {
	r, err := templateSaved("", fmt.Errorf("saving: %w", &vmangos.ColumnError{Column: "QuestLevel", Message: "QuestLevel must be from 0 to 255, not 300"}))
	if err != nil || r.Refused == nil || r.Refused.Column != "QuestLevel" || r.Refused.Message != "saving: QuestLevel must be from 0 to 255, not 300" {
		t.Errorf("refused: %+v, %v", r, err)
	}
	if r, err := templateSaved("", errors.New("the world database is down")); err == nil || r.Refused != nil {
		t.Errorf("a plain failure: %+v, %v", r, err)
	}
	if r, err := templateSaved("UPDATE", nil); err != nil || r.SQL != "UPDATE" || r.Refused != nil {
		t.Errorf("saved: %+v, %v", r, err)
	}
}
