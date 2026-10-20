package main

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"time"

	"Meld/internal/sandbox"
	"Meld/internal/vmangos"
	"Meld/internal/wow"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// The probes' throwaway client (#368): a probe that checks a feature writing Meld's patch first turns
// the sandbox on (P.sandboxClient), and every client read and write then goes to a copy of the Data
// folder in the user's cache, whose archives are links to the real ones and whose patch is a copy.
// Only `wails dev` offers it. The dev window shares this Go process with the probe page, so the
// sandbox ends by itself after sandboxLimit, and the probe runner ends it after every probe; while it
// is on, nothing that closes the game, starts the servers or writes the server's tables runs, so a
// probe can't touch the owner's game or database through it either.

// sandboxLimit is how long the sandbox stays on without being ended.
const sandboxLimit = 10 * time.Minute

// sandboxRoot is the folder of the throwaway client, kept between probes (the links are cheap to
// keep and the patch is copied afresh each time).
func sandboxRoot() (string, error) {
	d, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "Meld", "probe-client"), nil
}

// sandboxed says whether the throwaway client is on.
func (a *App) sandboxed() bool {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.sandboxData != ""
}

// errSandboxed is what a call that would reach the real game or server says while the sandbox is on.
var errSandboxed = errors.New("a probe is using a throwaway copy of the client; the game and the servers are left alone until it ends")

// ClientSandbox is the throwaway client StartClientSandbox turned on: its Data folder, and the stamp
// of the real patch, which EndClientSandbox compares.
type ClientSandbox struct {
	DataDir   string        `json:"dataDir"`
	RealPatch sandbox.Stamp `json:"realPatch"`
}

// StartClientSandbox points every client read and write at a fresh throwaway copy of the client, for
// a probe; only in `wails dev`. A sandbox already on starts again from a fresh copy.
func (a *App) StartClientSandbox() (ClientSandbox, error) {
	if a.ctx == nil || runtime.Environment(a.ctx).BuildType != "dev" {
		return ClientSandbox{}, errors.New("the throwaway client is only for the probes, in wails dev")
	}
	a.sandboxMu.Lock()
	defer a.sandboxMu.Unlock()
	a.endSandboxLocked()
	a.cfgMu.Lock()
	wowPath := a.cfg.WowPath
	a.cfgMu.Unlock()
	if wowPath == "" {
		return ClientSandbox{}, errors.New("no WoW client is set")
	}
	realData, err := wow.ResolveDataDir(wowPath)
	if err != nil {
		return ClientSandbox{}, err
	}
	root, err := sandboxRoot()
	if err != nil {
		return ClientSandbox{}, err
	}
	// The archives close while the copy is refreshed: Windows doesn't replace or unlink a file
	// Meld's own reader holds open.
	a.wow.Suspend()
	data, err := sandbox.Prepare(realData, root)
	if err == nil {
		err = vmangos.DropPending(data)
	}
	if err != nil {
		_ = a.wow.Open(wowPath)
		return ClientSandbox{}, err
	}
	forgetClientTables()
	a.cfgMu.Lock()
	a.sandboxData = data
	a.cfgMu.Unlock()
	a.sandboxGen++
	gen := a.sandboxGen
	a.sandboxStamp = sandbox.StampOf(filepath.Join(realData, vmangos.PatchName))
	a.sandboxReal = realData
	a.sandboxTimer = time.AfterFunc(sandboxLimit, func() {
		a.sandboxMu.Lock()
		defer a.sandboxMu.Unlock()
		if a.sandboxGen == gen {
			a.endSandboxLocked()
			runtime.LogWarning(a.ctx, "The probes' throwaway client was on for 10 minutes and has ended.")
		}
	})
	if err := a.wow.Open(data); err != nil {
		a.endSandboxLocked()
		return ClientSandbox{}, err
	}
	return ClientSandbox{DataDir: data, RealPatch: a.sandboxStamp}, nil
}

// SandboxEnded is what EndClientSandbox found: whether a sandbox was on, and whether the real patch
// has the size and modification time it had when the sandbox started.
type SandboxEnded struct {
	WasOn         bool          `json:"wasOn"`
	RealUnchanged bool          `json:"realUnchanged"`
	RealPatch     sandbox.Stamp `json:"realPatch"`
}

// EndClientSandbox points the client reads and writes back at the real client. Nothing happens
// when no sandbox is on.
func (a *App) EndClientSandbox() SandboxEnded {
	a.sandboxMu.Lock()
	defer a.sandboxMu.Unlock()
	if !a.sandboxed() {
		return SandboxEnded{}
	}
	before, real := a.sandboxStamp, a.sandboxReal
	a.endSandboxLocked()
	now := sandbox.StampOf(filepath.Join(real, vmangos.PatchName))
	return SandboxEnded{WasOn: true, RealUnchanged: now == before, RealPatch: now}
}

// endSandboxLocked turns the sandbox off, with sandboxMu held, and reopens the real client.
func (a *App) endSandboxLocked() {
	if a.sandboxTimer != nil {
		a.sandboxTimer.Stop()
		a.sandboxTimer = nil
	}
	a.cfgMu.Lock()
	on := a.sandboxData != ""
	a.sandboxData = ""
	wowPath := a.cfg.WowPath
	a.cfgMu.Unlock()
	if !on {
		return
	}
	a.sandboxGen++
	forgetClientTables()
	_ = a.wow.Open(wowPath)
}

// forgetClientTables drops what was read of the client's tables that isn't kept by data folder, so
// neither client sees the other's.
func forgetClientTables() {
	vmangos.ForgetSpells()
	vmangos.ForgetIcons()
	vmangos.ForgetItemDisplays()
}

// SandboxWriteFile writes a file a probe made (base64 data) into the throwaway client's folder of
// scratch files and returns its path, for a binding that reads a file the user picked (an icon's
// PNG). Only while the sandbox is on.
func (a *App) SandboxWriteFile(name, data string) (string, error) {
	if !a.sandboxed() {
		return "", errors.New("the throwaway client is not on")
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	root, err := sandboxRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "files")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, filepath.Base(name))
	return path, os.WriteFile(path, b, 0o644)
}
