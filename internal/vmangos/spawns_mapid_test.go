package vmangos

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"Meld/internal/mpq"
)

// clientWithMaps is a client Data folder whose Map.dbc has the given folders, row i at ID ids[i]
// (five fields a row: ID, folder, type, flags, name).
func clientWithMaps(t *testing.T, ids []uint32, dirs []string) string {
	t.Helper()
	strs := "\x00"
	var rows []byte
	for i, dir := range dirs {
		off := uint32(len(strs))
		strs += dir + "\x00"
		for _, f := range []uint32{ids[i], off, MapContinent, 0, 0} {
			rows = binary.LittleEndian.AppendUint32(rows, f)
		}
	}
	dbc := []byte("WDBC")
	for _, v := range []uint32{uint32(len(dirs)), 5, 20, uint32(len(strs))} {
		dbc = binary.LittleEndian.AppendUint32(dbc, v)
	}
	dbc = append(append(dbc, rows...), strs...)
	data := t.TempDir()
	if err := os.WriteFile(filepath.Join(data, "base.MPQ"), mpq.Write([]mpq.File{{Name: `DBFilesClient\Map.dbc`, Data: dbc}}), 0o644); err != nil {
		t.Fatal(err)
	}
	return data
}

// Over an external database with no server folder, a region's map ID comes from the client's
// Map.dbc (#883), so the spawns load and their edits name the right map.
func TestSpawnMapIDFromTheClientWithoutAServerFolder(t *testing.T) {
	useExternal(t, externalConfFile(t, externalBody))
	data := clientWithMaps(t, []uint32{0, 1, 901}, []string{"Azeroth", "Kalimdor", "MyIsle"})
	for name, want := range map[string]int{"Kalimdor": 1, "myisle": 901} {
		if got, err := serverMapID("", data, name); err != nil || got != want {
			t.Errorf("%s: %d %v, want %d", name, got, err, want)
		}
	}
	if _, err := serverMapID("", data, "Nowhere"); err == nil || !strings.Contains(err.Error(), "Nowhere") {
		t.Errorf("a map the client lacks: %v", err)
	}
	res, err := SpawnSQL("", data, "MyIsle", 32, 32, 1, []SpawnEdit{{Spawn: WorldSpawn{Kind: KindNPC, GUID: 7, Entry: 8}, Created: true}}, time.Unix(0, 0))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.SQL, "901") {
		t.Errorf("the spawn SQL does not name map 901:\n%s", res.SQL)
	}
}
