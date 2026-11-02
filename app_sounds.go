package main

import (
	"fmt"
	"os"

	"Meld/internal/vmangos"
)

// The Sound tool (#684, Tools › Sounds…): the client's sounds listed, exported as the files they are,
// imported from WAV or MP3 files as new sounds and put over a client sound's file, each write in Meld's
// patch without closing anything (as ImportIcons does): at once, or once the game has closed. A replaced
// sound is restored and an imported one deleted by dropping its file from the patch (#901), which waits
// for the game to close as well when the game holds the patch, as the Icons tool's Delete does (#925).

var soundFilters = []fileFilter{{DisplayName: "Sound (*.wav, *.mp3)", Pattern: "*.wav;*.mp3"}}

// SoundFiles lists the client's sound files (WAV and MP3 under Sound\), by path.
func (a *App) SoundFiles() ([]string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SoundFileList(dataDir)
}

// SoundEntry reads a SoundEntries.dbc row with its files and what plays it, for the Sound tool.
func (a *App) SoundEntry(id int) (vmangos.SoundEntryInfo, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.SoundEntryInfo{}, err
	}
	return vmangos.ReadSoundEntry(dataDir, uint32(id))
}

// OpenSoundFileDialog asks for a WAV or MP3 file to import or to put over a client sound. Returns ""
// if cancelled.
func (a *App) OpenSoundFileDialog(title string) (string, error) {
	return a.openFile(dialogOptions{Title: title, Filters: soundFilters})
}

// ImportSound adds the sound file at path to the client as opt says: the file under Sound\Meld and a
// SoundEntries.dbc row naming it, with a ZoneMusic or SoundAmbience row for music or ambience, so the
// object editor's and the Zones dialog's pickers list it. The game plays it from its next start.
func (a *App) ImportSound(path string, opt vmangos.SoundImport) (vmangos.SoundImported, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.SoundImported{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return vmangos.SoundImported{}, err
	}
	files, res, err := vmangos.PlanSoundImport(dataDir, path, data, opt)
	if err != nil {
		return vmangos.SoundImported{}, err
	}
	if _, res.Waiting, err = a.queueClientFiles(dataDir, files); err != nil {
		return vmangos.SoundImported{}, err
	}
	return res, nil
}

// ReplaceSound puts the sound file at path over the client's sound file target (a path under Sound\),
// in Meld's patch: every sound that names target plays it. waiting says it waits for the game to close.
func (a *App) ReplaceSound(target, path string) (waiting bool, err error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return false, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	files, err := vmangos.PlanSoundReplace(dataDir, target, data)
	if err != nil {
		return false, err
	}
	_, waiting, err = a.queueClientFiles(dataDir, files)
	return waiting, err
}

// ExportSoundsDialog asks for the folder to save sound files in. Returns "" if cancelled.
func (a *App) ExportSoundsDialog() (string, error) {
	return a.openDirectory(dialogOptions{Title: "Export Sounds", CanCreateDirectories: true})
}

// SoundsExported is what ExportSounds wrote: how many files, and the paths it could not read.
type SoundsExported struct {
	Written int      `json:"written"`
	Failed  []string `json:"failed"`
}

// ExportSounds saves the client's sound files at paths in dir, each under its own name, as stored.
func (a *App) ExportSounds(paths []string, dir string) (SoundsExported, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return SoundsExported{}, err
	}
	n, failed, err := vmangos.ExportSounds(dataDir, paths, dir)
	return SoundsExported{Written: n, Failed: failed}, err
}

// SoundFileStates says, for each client sound file at paths, whether Meld's patch has it (or it waits
// for the game to close) and whether the client's own archives do: a file in both was replaced, and
// Restore the client's (RestoreSound) takes the replacement out.
func (a *App) SoundFileStates(paths []string) ([]vmangos.PatchFileState, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadPatchFileStates(dataDir, paths)
}

// RestoreSound takes the file Meld's patch put over the client's sound file path out of the patch
// (#901), or drops it if it waits for the game to close, so the client's own file plays again. A
// patch the game holds open can't be written again, so then the file waits to leave the patch until
// the game has closed (#925), and waiting says so.
func (a *App) RestoreSound(path string) (waiting bool, err error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return false, err
	}
	if !vmangos.IsSoundPath(path) {
		return false, fmt.Errorf("%s is not a sound file under Sound\\", path)
	}
	states, err := vmangos.ReadPatchFileStates(dataDir, []string{path})
	if err != nil {
		return false, err
	}
	st := states[0]
	switch {
	case !st.InClient:
		return false, fmt.Errorf("the client has no %s of its own to restore: an imported sound is deleted instead", st.Path)
	case st.Leaving:
		// Restored already, waiting for the game to close.
		return true, nil
	case !st.InPatch && !st.Waiting:
		return false, fmt.Errorf("%s is the client's own: Meld's patch doesn't replace it", st.Path)
	}
	if st.InPatch {
		return a.queueClientDrops(dataDir, []string{st.Path})
	}
	_, err = vmangos.DropPendingFiles(dataDir, []string{st.Path})
	a.emitPending(dataDir)
	return false, err
}

// SoundDeletePlan reads what DeleteSound would remove and clear for the imported sound id, changing
// nothing, for the confirmation.
func (a *App) SoundDeletePlan(id int) (vmangos.SoundDeletePlan, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.SoundDeletePlan{}, err
	}
	_, plan, err := vmangos.PlanSoundDelete(dataDir, uint32(id))
	return plan, err
}

// DeleteSound deletes the imported sound id (#901): its file leaves Meld's patch, its SoundEntries row
// and the zone sound rows that played only it go, and the zones' fields and the game object displays'
// slots that named them are cleared, in one write when the game isn't running. While it runs, a file
// still waiting for the game to close is dropped, and the tables and the file's removal from the patch
// wait with the rest (#925). waiting says they wait.
func (a *App) DeleteSound(id int) (waiting bool, err error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return false, err
	}
	files, plan, err := vmangos.PlanSoundDelete(dataDir, uint32(id))
	if err != nil {
		return false, err
	}
	if a.sandboxed() || !a.gameRunning() {
		_, err = vmangos.InstallDropping(dataDir, files, plan.Files)
		a.emitPending(dataDir)
		return false, err
	}
	states, err := vmangos.ReadPatchFileStates(dataDir, plan.Files)
	if err != nil {
		return false, err
	}
	var leave []string
	for _, st := range states {
		if st.InPatch {
			leave = append(leave, st.Path)
		}
	}
	if _, err := vmangos.DropPendingFiles(dataDir, plan.Files); err != nil {
		return false, err
	}
	if len(leave) > 0 {
		if err := vmangos.AddPendingDrops(dataDir, leave); err != nil {
			return false, err
		}
	}
	_, waiting, err = a.queueClientFiles(dataDir, files)
	a.emitPending(dataDir)
	if err == nil && len(leave) > 0 {
		// queueClientFiles starts the watcher only for files; a removal alone needs it too.
		a.watchPending()
		waiting = true
	}
	return waiting, err
}
