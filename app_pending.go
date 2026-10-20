package main

import (
	goruntime "runtime"
	"time"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Client files that wait for the game to close (#365): the spell editor's saves add rows to the
// client's tables without closing the game or the servers. The files go into Meld's patch at once when
// the game isn't running, else they wait (vmangos.AddPending) and a watcher writes them once it has
// closed, so the game has them the next time it starts. A patch write that closes the game anyway
// (installClosed) takes them along.

// pendingPoll is how often the watcher looks whether the game has closed.
const pendingPoll = 3 * time.Second

// gameRunning says whether the game holds Meld's patch open: only Windows locks a file a program has
// open, so elsewhere it never does.
func (a *App) gameRunning() bool {
	if goruntime.GOOS != "windows" {
		return false
	}
	sess, err := a.gameSession()
	return err == nil && sess.GameRunning()
}

// saveClientFiles writes files into Meld's patch without closing anything: at once when the game
// isn't running, else once it has closed. The caller has released Meld's own reader of the archives.
func (a *App) saveClientFiles(dataDir string, files []mpq.File) error {
	if len(files) == 0 {
		return nil
	}
	if a.gameRunning() {
		if err := vmangos.AddPending(dataDir, files); err != nil {
			return err
		}
		a.watchPending()
		return nil
	}
	pending, err := vmangos.PendingFiles(dataDir)
	if err != nil {
		return err
	}
	all := vmangos.WithPending(pending, files)
	if _, err := vmangos.InstallPatch(dataDir, all); err != nil {
		return err
	}
	return vmangos.ClearPending(dataDir, pending)
}

// watchPending starts the watcher, unless it runs already. It writes the waiting files once the game
// has closed and stops when none wait.
func (a *App) watchPending() {
	if !a.pendingWatch.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer a.pendingWatch.Store(false)
		for {
			dataDir, err := a.clientDataDir()
			if err != nil {
				return
			}
			pending, err := vmangos.PendingFiles(dataDir)
			if err != nil || len(pending) == 0 {
				return
			}
			if !a.gameRunning() {
				if err := a.writePending(dataDir, pending); err != nil {
					runtime.LogWarning(a.ctx, "The client files waiting for the game to close weren't written: "+err.Error())
					time.Sleep(10 * pendingPoll)
				}
				continue
			}
			time.Sleep(pendingPoll)
		}
	}()
}

// writePending writes the waiting files into the patch and drops them.
func (a *App) writePending(dataDir string, pending []mpq.File) error {
	defer a.releaseClient()()
	if _, err := vmangos.InstallPatch(dataDir, pending); err != nil {
		return err
	}
	vmangos.ForgetSpells()
	return vmangos.ClearPending(dataDir, pending)
}

// reloadSpells has the world server, when it runs, read spell_template again, so a saved spell works
// without restarting it. It needs the SOAP console; without it the server reads the spell at its next
// start, which is logged, not an error.
func (a *App) reloadSpells(server string) {
	sess, err := a.gameSession()
	if err != nil || !sess.WorldRunning() {
		return
	}
	if err := vmangos.ReloadSpells(server, sess.Login.Account, sess.Login.Password); err != nil {
		runtime.LogInfo(a.ctx, "The world server didn't reload its spells (it reads them at its next start): "+err.Error())
	}
}
