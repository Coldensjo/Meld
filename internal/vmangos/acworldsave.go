package vmangos

import (
	"errors"
	"time"
)

// Saving the editor's spawn edits into the AzerothCore world database it read them from (acworld.go):
// the AzerothCore spawn SQL (azerothcore.go) under the database's own numbers (acDirect), run in one
// transaction. The world server reads its spawns at start-up, so a save shows in the game after its
// next restart.

// ACSpawnSQL is SpawnSQL for the AzerothCore database the editor reads: the edits of the region at
// (x, y) of map mapName (its ID from the client's Map.dbc in dataDir), under the guids and pool entries
// the editor has, which are the database's. A creature's equipment goes by its items: those the editor
// sends, else those of its equipment number (acEquipKey).
func ACSpawnSQL(dataDir, mapName string, x, y, size int, edits []SpawnEdit, now time.Time) (Result, error) {
	if err := checkRegion(x, y, size); err != nil {
		return Result{}, err
	}
	id, ok := ClientMapID(dataDir, mapName)
	if !ok {
		return Result{}, errors.New("the client has no map " + mapName)
	}
	return acSpawnSQL(int(id), x, y, edits, now), nil
}

// acSpawnSQL is ACSpawnSQL once the map's ID is known.
func acSpawnSQL(mapID, x, y int, edits []SpawnEdit, now time.Time) Result {
	list := make([]Edit, 0, len(edits))
	for _, e := range edits {
		ed := Edit{Spawn: serverSpawn(e.Spawn, mapID, x, y), Created: e.Created, Deleted: e.Deleted}
		ed.Spawn.EquipItems = acSpawnItems(e.Spawn)
		if e.Original != nil {
			o := serverSpawn(*e.Original, mapID, x, y)
			o.EquipItems = acSpawnItems(*e.Original)
			ed.Original = &o
		}
		list = append(list, ed)
	}
	return azerothcoreSQL(list, now, acDirect)
}

// acSpawnItems are the items of a creature's equipment number: the items the editor holds for it when
// they are the number's, else the ones remembered for it; nil for none (0 and -1) or an unknown number.
func acSpawnItems(w WorldSpawn) *[3]int {
	if w.Kind == KindObject || w.Equipment <= 0 {
		return nil
	}
	if w.EquipItems != [3]int{} && acEquipKey(w.EquipItems) == w.Equipment {
		items := w.EquipItems
		return &items
	}
	if items := ACEquipmentItems(w.Equipment); items != [3]int{} {
		return &items
	}
	return nil
}

// CheckACSpawnIDs is CheckSpawnIDs for an AzerothCore database: what it has under the unsaved spawns'
// guids and entries.
func CheckACSpawnIDs(s AzerothCoreServer, q SpawnIDQuery) (SpawnIDReport, error) {
	db, err := acDatabase(s)
	if err != nil {
		return SpawnIDReport{}, err
	}
	return checkSpawnIDs(db, q)
}

// ApplyACSpawnEdits writes a region's spawn edits into the AzerothCore world database, refusing them all
// when a new spawn's guid was given to another spawn since it was placed (#199). It returns the SQL it
// ran.
func ApplyACSpawnEdits(s AzerothCoreServer, dataDir, mapName string, x, y, size int, edits []SpawnEdit, now time.Time) (Result, error) {
	res, err := ACSpawnSQL(dataDir, mapName, x, y, size, edits, now)
	if err != nil {
		return res, err
	}
	db, err := acDatabase(s)
	if err != nil {
		return res, err
	}
	if q, any := createdQuery(edits); any {
		r, err := checkSpawnIDs(db, q)
		if err != nil {
			return res, err
		}
		if err := collisionError(edits, r); err != nil {
			return res, err
		}
	}
	return res, runScript(db, res.SQL)
}
