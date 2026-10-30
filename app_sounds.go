package main

import (
	"os"

	"Meld/internal/vmangos"
)

// The Sound tool (#684, Tools › Sounds…): the client's sounds listed, exported as the files they are,
// imported from WAV or MP3 files as new sounds and put over a client sound's file, each write in Meld's
// patch without closing anything (as ImportIcons does): at once, or once the game has closed.

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
