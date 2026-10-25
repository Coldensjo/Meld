package vmangos

import (
	"fmt"
	"sort"

	"Meld/internal/mpq"
)

// The sounds a game object plays (#674). In 1.12 a game object's look is a GameObjectDisplayInfo.dbc
// row: its ID, the model, then ten SoundEntries.dbc IDs, one a sound slot (wowdev's SoundSlot enum):
// stand, open, loop, close, destroy, opened and four custom ones. The client plays them where the
// object is, so a fire's crackle (CampFireLargeLoop, slot loop) or a street lamp's hum
// (NightElfStreetLampLoop, slot stand) is heard only near it. The server never reads the sound slots,
// so changing them is a write into Meld's patch only, and it changes every object of that display.

// GameObjectDisplayInfoPath and SoundEntriesPath are the tables' archive paths.
const (
	GameObjectDisplayInfoPath = `DBFilesClient\GameObjectDisplayInfo.dbc`
	SoundEntriesPath          = `DBFilesClient\SoundEntries.dbc`
)

// ObjectSoundSlots is how many sound slots a game object display has, and objectDisplayFields its
// 1.12 width: ID, the model and the slots.
const (
	ObjectSoundSlots    = 10
	objectDisplayFields = 2 + ObjectSoundSlots
)

// ObjectDisplaySounds are a game object display's model and its ten sound slots' SoundEntries IDs
// (0: none).
type ObjectDisplaySounds struct {
	Display uint32   `json:"display"`
	Model   string   `json:"model"`
	Sounds  []uint32 `json:"sounds"`
}

// openSoundTables reads GameObjectDisplayInfo.dbc and SoundEntries.dbc as the game will have them,
// the files waiting for it to close included (readOverlay), and checks their 1.12 widths.
func openSoundTables(dataDir string) (display, sounds []byte, err error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, nil, err
	}
	defer set.Close()
	if display, err = readOverlay(set, dataDir, GameObjectDisplayInfoPath); err != nil {
		return nil, nil, fmt.Errorf("GameObjectDisplayInfo.dbc: %w", err)
	}
	if sounds, err = readOverlay(set, dataDir, SoundEntriesPath); err != nil {
		return nil, nil, fmt.Errorf("SoundEntries.dbc: %w", err)
	}
	return display, sounds, nil
}

// parseSized parses a DBC and checks it has the 1.12 width.
func parseSized(b []byte, name string, fields int) (*dbcTable, error) {
	t, err := parseDBC(b)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	if t.fields != fields {
		return nil, fmt.Errorf("%s has %d fields, not 1.12's %d", name, t.fields, fields)
	}
	return t, nil
}

// soundList is every SoundEntries row with its name and first file, by ID.
func soundList(b []byte) ([]SoundOption, error) {
	t, err := parseSized(b, "SoundEntries.dbc", soundTableFields["SoundEntries"])
	if err != nil {
		return nil, err
	}
	entries := soundEntries(t)
	out := make([]SoundOption, 0, len(entries))
	for id, e := range entries {
		if id != 0 {
			out = append(out, SoundOption{ID: id, Name: e.name, File: e.file})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// SoundEntryList lists the client's SoundEntries.dbc rows (a sound the game plays: a name and up to
// ten files), each with a file to play, for the sound pickers.
func SoundEntryList(dataDir string) ([]SoundOption, error) {
	_, sounds, err := openSoundTables(dataDir)
	if err != nil {
		return nil, err
	}
	return soundList(sounds)
}

// objectDisplaySounds reads one display's slots from GameObjectDisplayInfo's bytes.
func objectDisplaySounds(b []byte, display uint32) (ObjectDisplaySounds, error) {
	t, err := parseSized(b, "GameObjectDisplayInfo.dbc", objectDisplayFields)
	if err != nil {
		return ObjectDisplaySounds{}, err
	}
	r, ok := t.row(display)
	if !ok || display == 0 {
		return ObjectDisplaySounds{}, fmt.Errorf("the client has no game object display %d", display)
	}
	out := ObjectDisplaySounds{Display: display, Model: t.str(r, 1), Sounds: make([]uint32, ObjectSoundSlots)}
	for i := range out.Sounds {
		out.Sounds[i] = t.u32(r, 2+i)
	}
	return out, nil
}

// ReadObjectDisplaySounds reads a game object display's sound slots as the game will have them.
func ReadObjectDisplaySounds(dataDir string, display uint32) (ObjectDisplaySounds, error) {
	b, _, err := openSoundTables(dataDir)
	if err != nil {
		return ObjectDisplaySounds{}, err
	}
	return objectDisplaySounds(b, display)
}

// setObjectDisplaySounds returns GameObjectDisplayInfo's bytes with the display's ten slots set to
// sounds, every other field and row as it was. A slot must name a SoundEntries row or be 0, and the
// display must be in the table already: the server checks a template's display against its own copy
// of the table, so a new row would be refused there. changed says whether any slot differs.
func setObjectDisplaySounds(display, soundEntriesDBC []byte, id uint32, sounds []uint32) (out []byte, changed bool, err error) {
	if len(sounds) != ObjectSoundSlots {
		return nil, false, fmt.Errorf("%d sound slots, not %d", len(sounds), ObjectSoundSlots)
	}
	t, err := parseSized(display, "GameObjectDisplayInfo.dbc", objectDisplayFields)
	if err != nil {
		return nil, false, err
	}
	r, ok := t.row(id)
	if !ok || id == 0 {
		return nil, false, fmt.Errorf("the client has no game object display %d", id)
	}
	se, err := parseSized(soundEntriesDBC, "SoundEntries.dbc", soundTableFields["SoundEntries"])
	if err != nil {
		return nil, false, err
	}
	rec := t.record(r)
	for i, s := range sounds {
		if _, ok := se.row(s); s != 0 && !ok {
			return nil, false, fmt.Errorf("sound slot %d: the client has no sound %d in SoundEntries.dbc", i, s)
		}
		if rec[2+i] != s {
			changed = true
		}
		rec[2+i] = s
	}
	if !changed {
		return display, false, nil
	}
	// The record keeps its model's offset into the string block, which setRecords leaves as it is.
	out, err = setRecords(display, [][]uint32{rec})
	return out, err == nil, err
}

// ObjectSoundFiles is the client file that sets a game object display's ten sound slots: the changed
// GameObjectDisplayInfo.dbc for Meld's patch, or none when nothing changed.
func ObjectSoundFiles(dataDir string, display uint32, sounds []uint32) ([]mpq.File, error) {
	d, s, err := openSoundTables(dataDir)
	if err != nil {
		return nil, err
	}
	out, changed, err := setObjectDisplaySounds(d, s, display, sounds)
	if err != nil || !changed {
		return nil, err
	}
	return []mpq.File{{Name: GameObjectDisplayInfoPath, Data: out}}, nil
}
