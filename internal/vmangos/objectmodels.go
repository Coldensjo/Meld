package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// The server's game object collision (#923): the world server builds an object's collision (line of
// sight, and movement for a door or a wall) from data/vmaps/temp_gameobject_models, a list keyed by
// display ID that the vmap extractor writes from the client's GameObjectDisplayInfo
// (vmangos GameObjectModel.cpp, LoadGameObjectModelList, and GameObjectModel::initialize). A display
// of its own (#723) is missing from it until the vmaps are extracted again, so its base display's
// record is copied under the new ID when the copy is made.

// serverObjectModelsPath is the server's list of game object models, under its folder.
func serverObjectModelsPath(serverDir string) string {
	return filepath.Join(serverDir, "data", "vmaps", "temp_gameobject_models")
}

// objectModelRecord is one record of temp_gameobject_models: the bytes from its display ID to the
// end of its bounding box.
type objectModelRecord struct {
	display uint32
	start   int
	end     int
}

// objectModelRecords splits a temp_gameobject_models list into its records: uint32 displayId,
// uint32 nameLength, the name, then the bounding box's low and high corners (six float32).
func objectModelRecords(list []byte) ([]objectModelRecord, error) {
	var recs []objectModelRecord
	for at := 0; at < len(list); {
		if len(list)-at < 8 {
			return nil, fmt.Errorf("temp_gameobject_models ends inside a record at byte %d", at)
		}
		n := int(binary.LittleEndian.Uint32(list[at+4:]))
		// The server stops at a name of 500 bytes or more, as a corrupt file.
		if n >= 500 || len(list)-at-8 < n+24 {
			return nil, fmt.Errorf("temp_gameobject_models has a broken record at byte %d", at)
		}
		end := at + 8 + n + 24
		recs = append(recs, objectModelRecord{display: binary.LittleEndian.Uint32(list[at:]), start: at, end: end})
		at = end
	}
	return recs, nil
}

// copyObjectModel returns list with display base's record copied under id at its end, replacing
// any record id had. found is false, and list comes back as it was, when base has no record (a
// display without collision).
func copyObjectModel(list []byte, base, id uint32) (out []byte, found bool, err error) {
	recs, err := objectModelRecords(list)
	if err != nil {
		return nil, false, err
	}
	var src []byte
	for _, r := range recs {
		if r.display == base {
			src = list[r.start:r.end]
		}
	}
	if src == nil {
		return list, false, nil
	}
	out = make([]byte, 0, len(list)+len(src))
	for _, r := range recs {
		if r.display != id {
			out = append(out, list[r.start:r.end]...)
		}
	}
	at := len(out)
	out = append(out, src...)
	binary.LittleEndian.PutUint32(out[at:], id)
	return out, true, nil
}

// InstallServerObjectModel gives display id the collision of display base in the server's
// temp_gameobject_models, keeping the first copy it replaces as a backup. It does nothing, and
// returns false, when the server has no such list (no vmaps built) or base has no record there. The
// world server reads the list at its start.
func InstallServerObjectModel(serverDir string, base, id uint32) (bool, error) {
	if err := CheckServer(serverDir); err != nil {
		return false, err
	}
	target := serverObjectModelsPath(serverDir)
	list, err := os.ReadFile(target)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	out, found, err := copyObjectModel(list, base, id)
	if err != nil || !found {
		return false, err
	}
	if err := checkFree(target); err != nil {
		return false, err
	}
	if err := backup(target, target+BackupSuffix); err != nil {
		return false, err
	}
	tmp := target + ".tmp"
	if err := writeSynced(tmp, out); err != nil {
		return false, err
	}
	if err := replaceFile(tmp, target); err != nil {
		return false, err
	}
	return true, nil
}
