package main

import (
	"errors"
	"path/filepath"
	goruntime "runtime"
	"time"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Client files that wait for the game to close (#365): no save or compile closes the game or the
// servers (#661). The files go into Meld's patch at once when the game isn't running, else they wait
// (vmangos.AddPending) and a watcher writes them once it has closed, so the game has them the next
// time it starts; "client:pending" tells the status bar how many wait. Any patch write takes the
// waiting files along. Every patch write runs one at a time (vmangos.InstallPatch,
// InstallWithPending), so the watcher never writes beside another (#657).

// pendingPoll is how often the watcher looks whether the game has closed.
const pendingPoll = 3 * time.Second

// gameWait is how long a publish or a server map rebuild waits for the author to close the game,
// whose patch it needs written, before it gives up (#661).
const gameWait = 15 * time.Minute

// gameRunning says whether the game holds Meld's patch open: only Windows locks a file a program has
// open, so elsewhere it never does.
func (a *App) gameRunning() bool {
	if a.gameUp != nil {
		return a.gameUp()
	}
	if goruntime.GOOS != "windows" {
		return false
	}
	sess, err := a.gameSession()
	return err == nil && sess.GameRunning()
}

// saveClientFiles writes files into Meld's patch without closing anything: at once when the game
// isn't running, else once it has closed.
func (a *App) saveClientFiles(dataDir string, files []mpq.File) error {
	_, _, err := a.queueClientFiles(dataDir, files)
	return err
}

// queueClientFiles is saveClientFiles that says where the files go (the patch's path) and whether
// they wait for the game to close.
func (a *App) queueClientFiles(dataDir string, files []mpq.File) (patch string, waiting bool, err error) {
	if len(files) == 0 {
		return "", false, nil
	}
	if a.gameRunning() {
		if err := vmangos.AddPending(dataDir, files); err != nil {
			return "", false, err
		}
		a.emitPending(dataDir)
		a.watchPending()
		return filepath.Join(dataDir, vmangos.PatchName), true, nil
	}
	patch, err = vmangos.InstallWithPending(dataDir, files)
	return patch, false, err
}

// installClient writes files into the client's patch as saveClientFiles does, never closing the game
// or the servers (#661), then runs also (when set), the server's share of the save. waiting says the
// files wait for the game to close.
func (a *App) installClient(dataDir string, files []mpq.File, also func() error) (patch string, waiting bool, err error) {
	if a.sandboxed() && also != nil {
		// The probes' throwaway client: the server's tables are the real ones.
		return "", false, errSandboxed
	}
	if patch, waiting, err = a.queueClientFiles(dataDir, files); err != nil {
		return "", false, err
	}
	if also != nil {
		err = also()
	}
	return patch, waiting, err
}

// installClientFiles is installClient without a server share, for the saves that only say where they wrote.
func (a *App) installClientFiles(dataDir string, files []mpq.File) (string, error) {
	patch, _, err := a.installClient(dataDir, files, nil)
	return patch, err
}

// worldRunning says whether the world server runs, so a save the server reads only at its start says
// to restart it.
func (a *App) worldRunning() bool {
	sess, err := a.gameSession()
	return err == nil && sess.WorldRunning()
}

// emitPending tells the status bar how many client files wait for the game to close.
func (a *App) emitPending(dataDir string) {
	pending, err := vmangos.PendingFiles(dataDir)
	if err == nil && a.ctx != nil {
		runtime.EventsEmit(a.ctx, "client:pending", len(pending))
	}
}

// ClientFilesWaiting is how many client files wait for the game to close, for the status bar at start.
func (a *App) ClientFilesWaiting() int {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return 0
	}
	pending, err := vmangos.PendingFiles(dataDir)
	if err != nil {
		return 0
	}
	return len(pending)
}

// waitForGameClosed waits, up to gameWait, until the game no longer runs and the files waiting for it
// are in the patch, saying once what it waits for: a publish writes the patch itself, and the server's
// map data is built from the patch (#661). It never closes the game.
func (a *App) waitForGameClosed(dataDir string, log func(string)) error {
	deadline := time.Now().Add(gameWait)
	said := false
	for {
		pending, err := vmangos.PendingFiles(dataDir)
		if err != nil {
			return err
		}
		if !a.gameRunning() {
			if len(pending) == 0 {
				return nil
			}
			// The watcher may sleep a while yet: write them now (it finds nothing left).
			if _, err := vmangos.InstallWithPending(dataDir, nil); err != nil {
				return err
			}
			a.emitPending(dataDir)
			continue
		}
		if !said {
			log("Close the game: the client's patch can't be written while it runs. This goes on as soon as it is closed.")
			said = true
		}
		if time.Now().After(deadline) {
			return errors.New("the game kept running, so the client's patch could not be written: close it and try again")
		}
		time.Sleep(pendingPoll)
	}
}

// flushPending writes the files waiting for the game into the patch when the game isn't running, so
// a launch right after a compile that queued them starts with them, not the watcher's next look.
func (a *App) flushPending() {
	dataDir, err := a.clientDataDir()
	if err != nil || a.gameRunning() {
		return
	}
	if _, err := vmangos.InstallWithPending(dataDir, nil); err != nil {
		runtime.LogWarning(a.ctx, "The client files waiting for the game to close weren't written: "+err.Error())
		return
	}
	a.emitPending(dataDir)
}

// pendingRetry is how long the watcher waits after a write the patch refused as in use before it tries
// again, and pendingTries how many such writes it makes before it gives up (#481). A var, for the tests.
var pendingRetry = 10 * pendingPoll

const pendingTries = 5

// watchPending starts the watcher, unless it runs already. It writes the waiting files once the game
// has closed and stops when none wait.
func (a *App) watchPending() {
	if !a.pendingWatch.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer a.pendingWatch.Store(false)
		a.runPendingWatch()
	}()
}

// runPendingWatch is the watcher's loop. A write that fails gives up at once when a retry won't fix
// it (the patch isn't Meld's), or after pendingTries when the patch stays in use, and says so once in
// the Log ("client:pending-failed"). The files keep waiting: the next patch write takes them along,
// and the next save while the game runs starts the watcher again (#481).
func (a *App) runPendingWatch() {
	failed := 0
	for {
		dataDir, err := a.clientDataDir()
		if err != nil {
			return
		}
		pending, err := vmangos.PendingFiles(dataDir)
		if err != nil || len(pending) == 0 {
			a.emitPending(dataDir)
			return
		}
		if !a.gameRunning() {
			// Read again under the patch lock, so a write that took them along meanwhile
			// (another save, a publish) leaves nothing to write twice.
			if _, err := vmangos.InstallWithPending(dataDir, nil); err != nil {
				failed++
				if !vmangos.InUse(err) || failed >= pendingTries {
					msg := "The client files waiting for the game to close weren't written, and Meld stopped trying: " + err.Error() + ". They still wait: the next save to the client takes them along."
					if a.ctx != nil {
						runtime.LogWarning(a.ctx, msg)
						runtime.EventsEmit(a.ctx, "client:pending-failed", msg)
					}
					return
				}
				time.Sleep(pendingRetry)
			}
			continue
		}
		time.Sleep(pendingPoll)
	}
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
