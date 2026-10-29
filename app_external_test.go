package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/vmangos"
	"Meld/internal/wow"
)

// While an external database is connected (#856), the bindings that write into the local server folder
// or drive the local server refuse with errExternal, and the database editors need no server folder.
// The conf points at a host nothing answers on; no binding here gets as far as a query.
func TestExternalTurnsOffTheServerFolderWrites(t *testing.T) {
	dir := t.TempDir()
	conf := filepath.Join(dir, "mangosd.conf")
	if err := os.WriteFile(conf, []byte("WorldDatabase.Info = \"192.0.2.1;3306;u;p;world\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := &App{wow: wow.NewClient()}
	a.cfg.WowPath = filepath.Join(dir, "no-client")
	vmangos.SetExternal(conf)
	t.Cleanup(func() { vmangos.SetExternal("") })

	calls := map[string]func() error{
		"StartServer":        a.StartServer,
		"StopServer":         a.StopServer,
		"RestartServer":      a.RestartServer,
		"EnableSoap":         a.EnableSoap,
		"PlayHere":           func() error { _, err := a.PlayHere(vmangos.CharacterSpot{}); return err },
		"UpdateRegionServer": func() error { return a.UpdateRegionServer(0, nil) },
		"PublishVmangosMap":  func() error { return a.PublishVmangosMap(vmangos.MapSpec{}) },
		"CreateAccount":      func() error { _, err := a.CreateAccount("probe", "probe", 0); return err },
	}
	for name, call := range calls {
		if err := call(); !errors.Is(err, errExternal) {
			t.Errorf("%s: %v, want errExternal", name, err)
		}
	}
	if _, err := a.SaveTaxi(vmangos.TaxiEdit{RemoveRoutes: []uint32{1}}); !errors.Is(err, errExternalRoutes) {
		t.Errorf("SaveTaxi with routes: %v", err)
	}
	if st := a.ServerStatus(); st.Available || st.Reason == "" {
		t.Errorf("server status while external: %+v", st)
	}
	// No server folder is set, and the database editors still get past the folder check.
	if _, err := a.serverRoot(); err != nil {
		t.Errorf("serverRoot: %v", err)
	}
	if a.worldRunning() {
		t.Error("the local world server counts while external")
	}
	vmangos.SetExternal("")
	if _, err := a.serverRoot(); err == nil {
		t.Error("serverRoot without a folder or an external database")
	}
}

// ConnectExternalDatabase refuses a conf whose world database doesn't answer, and stays local.
func TestConnectExternalNeedsAnAnsweringDatabase(t *testing.T) {
	a := &App{wow: wow.NewClient()}
	if _, err := a.ConnectExternalDatabase(""); err == nil {
		t.Error("connected to no conf")
	}
	if _, err := a.ConnectExternalDatabase(filepath.Join(t.TempDir(), "missing.conf")); err == nil {
		t.Error("connected to a missing conf")
	}
	if externalOn() {
		t.Fatal("a failed connect left the external database on")
	}
}
