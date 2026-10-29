package main

import (
	"os"
	"path/filepath"
	"time"

	"Meld/internal/vmangos"
)

// LoadSpawns reads the creatures and game objects the server's world database places in a block of
// tiles. It needs the VMaNGOS server folder and the server's database running, or an external
// database (#856), whose map IDs then come from the client's Map.dbc (#883).
func (a *App) LoadSpawns(mapName string, x, y, size int) ([]vmangos.WorldSpawn, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadSpawns(server, dataDir, mapName, x, y, size)
}

// SpawnLook dresses a creature display with an equipment and a pose, for a spawn whose display,
// equipment, stand state, emote or sheath state was edited.
func (a *App) SpawnLook(display, equipment, stand, emote, sheath int) (vmangos.LookResult, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.LookResult{}, err
	}
	return vmangos.CreatureLook(server, dataDir, display, equipment, stand, emote, sheath)
}

// ListWeapons lists every item of the world database a creature can hold, for the gear picker.
func (a *App) ListWeapons() ([]vmangos.WeaponEntry, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListWeapons(server, dataDir)
}

// EquipmentItems are the main hand, off hand and ranged items of an equipment template.
func (a *App) EquipmentItems(id int) ([3]int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return [3]int{}, err
	}
	return vmangos.EquipmentItems(server, id)
}

// EquipmentDisplays are the display IDs of the held items of each equipment template in ids, for
// the pickers' icons.
func (a *App) EquipmentDisplays(ids []int) (map[int][3]int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.EquipmentDisplays(server, ids)
}

// EquipmentFor is the equipment template with these items (main hand, off hand, ranged), made
// in the world database when none has them; 0 for none.
func (a *App) EquipmentFor(items [3]int) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.EquipmentFor(server, items)
}

// GameEvents lists the world database's events (holidays, the Darkmoon Faire, invasions), for showing
// the spawns of each.
func (a *App) GameEvents() ([]vmangos.GameEvent, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.GameEvents(server)
}

// SpawnEmotes lists the client's emotes, for picking a spawn's looping emote.
func (a *App) SpawnEmotes() ([]vmangos.Emote, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.Emotes(dataDir)
}

// SpawnTeleports lists where a creature (kind "creature") or game object (kind "object") spawn sends
// a player or moves itself: its gossip, the spells it casts and the scripts it runs (#306, #308).
func (a *App) SpawnTeleports(kind string, entry, guid int) ([]vmangos.SpawnTeleport, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SpawnTeleports(server, kind, entry, guid)
}

// SpawnScripts lists the scripts attached to a creature (kind "creature") or game object (kind
// "object") spawn in the world database: its template's C++ script and AI, an object's use and event
// scripts, a creature's EventAI events and path scripts (#137).
func (a *App) SpawnScripts(kind string, entry, guid int) ([]vmangos.SpawnScript, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SpawnScripts(server, kind, entry, guid)
}

// ScriptCommands lists the commands of script id in one of the script tables SpawnScripts names
// (#736).
func (a *App) ScriptCommands(table string, id int) ([]vmangos.ScriptCommand, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ScriptCommands(server, table, id)
}

// NextObjectGUID is the first free game object guid of the world database, for placed objects.
func (a *App) NextObjectGUID() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextObjectGUID(server)
}

// NextPoolEntry is the first spawn pool entry the world database doesn't use yet, for a pool made
// in the editor.
func (a *App) NextPoolEntry() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextPoolEntry(server)
}

// NextCreatureGUID is the first creature guid the world database doesn't use yet, for creatures
// placed in the editor.
func (a *App) NextCreatureGUID() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextCreatureGUID(server)
}

// CheckSpawnIDs tells File › Check Map what the world database has under the unsaved spawns' guids
// and entries (#195).
func (a *App) CheckSpawnIDs(q vmangos.SpawnIDQuery) (vmangos.SpawnIDReport, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.SpawnIDReport{}, err
	}
	return vmangos.CheckSpawnIDs(server, q)
}

// ModelAnimations lists the animations an M2 model has, for the creature editor's preview.
func (a *App) ModelAnimations(model string) ([]vmangos.AnimInfo, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ModelAnimations(dataDir, model)
}

// SpawnEditSQL turns a region's spawn edits into SQL for the world database, without running it.
func (a *App) SpawnEditSQL(mapName string, x, y, size int, edits []vmangos.SpawnEdit) (vmangos.Result, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.Result{}, err
	}
	return vmangos.SpawnSQL(server, dataDir, mapName, x, y, size, edits, time.Now())
}

// ApplySpawnEdits writes a region's spawn edits into the world database. The SQL run is kept in
// <user cache>/Meld/spawn-sql first, so what changed can be looked up (or undone by hand).
func (a *App) ApplySpawnEdits(mapName string, x, y, size int, edits []vmangos.SpawnEdit) (vmangos.Result, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return vmangos.Result{}, err
	}
	// A new spawn whose guid another spawn took since must not replace that spawn (#199).
	if err := vmangos.CheckCreatedGUIDs(server, edits); err != nil {
		return vmangos.Result{}, err
	}
	res, err := vmangos.SpawnSQL(server, dataDir, mapName, x, y, size, edits, time.Now())
	if err != nil {
		return res, err
	}
	if cache, err := os.UserCacheDir(); err == nil {
		dir := filepath.Join(cache, "Meld", "spawn-sql")
		if os.MkdirAll(dir, 0o755) == nil {
			_ = os.WriteFile(filepath.Join(dir, time.Now().Format("20060102-150405")+"-"+mapName+".sql"), []byte(res.SQL), 0o644)
		}
	}
	return res, vmangos.ApplySQL(server, res.SQL)
}
