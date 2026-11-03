package vmangos

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// A new world made in Meld, published to a CMaNGOS classic server (#1037): the client's patch as for
// VMaNGOS, then the server's map data rebuilt by its own extractors (UpdateCMaNGOSMaps), which also
// copy the patch's Map.dbc, with the new map's row, into the server's dbc. CMaNGOS has no map_template:
// a dungeon, raid or battleground needs an instance_template row instead, or the world server refuses
// to make the map (MapManager::CreateDungeonMap, IsValidMAP). Meld runs no SQL against a CMaNGOS
// database (the server tools stay VMaNGOS-only, #894), so that row goes into a file to import.
//
// instance_template's columns (cmangos/mangos-classic, sql/base/mangos.sql): map, parent, levelMin,
// levelMax, maxPlayers, reset_delay (days), ghostEntranceMap, ghostEntranceX, ghostEntranceY,
// ScriptName, and mountAllowed in later databases. ObjectMgr::LoadInstanceTemplate drops a row whose map
// is not instanceable in Map.dbc, or whose ghost entrance is not on a continent. CMaNGOS's code is GPL:
// its behaviour is described here, none of it is copied.

// cmangosSQLDir is the folder under the CMaNGOS server's own where Meld leaves the SQL to import.
const cmangosSQLDir = "meld-sql"

// CMaNGOSInstanceSQLPath is where PublishCMaNGOS writes map m's instance_template row on the server s,
// or "" when the map needs none (a world map).
func CMaNGOSInstanceSQLPath(s CMaNGOSServer, m MapSpec) string {
	if CMaNGOSInstanceSQL(m) == "" {
		return ""
	}
	return filepath.Join(s.Root, cmangosSQLDir, m.Dir+"_instance_template.sql")
}

// CMaNGOSInstanceRow is map m's instance_template row as the Changes window lists it while the
// export's core is CMaNGOS classic (#1085), and false for a map that needs none. root is the CMaNGOS
// server folder the SQL file goes into, or "" when none is set.
func CMaNGOSInstanceRow(m MapSpec, root string) (RowChange, bool) {
	sql := CMaNGOSInstanceSQL(m)
	if sql == "" {
		return RowChange{}, false
	}
	where := filepath.Join(cmangosSQLDir, m.Dir+"_instance_template.sql") + " in the CMaNGOS server folder, once one is set (Edit › Preferences › Folders)"
	if root != "" {
		where = CMaNGOSInstanceSQLPath(CMaNGOSServer{Root: root}, m)
	}
	return RowChange{Table: "instance_template", Key: fmt.Sprintf("map %d", m.MapID), Action: "add or change", Core: string(CMaNGOSClassic), SQL: sql,
		Reason: "the map's row for the CMaNGOS world server, which Compile to CMaNGOS Server writes to " + where + ", to import"}, true
}

// CMaNGOSInstanceSQL is the instance_template row of a dungeon, raid or battleground made in Meld, for a
// CMaNGOS classic world database, or "" for a world map (or a map without its info, which Publish makes
// a world map). The row takes the info's player limit, reset delay and ghost entrance, and keeps what
// an existing row has in its other columns (the level range, parent, script), which Meld has no field
// for. A ghost entrance of none (-1, VMaNGOS's) is CMaNGOS's 0 at 0,0, as its own rows without one.
func CMaNGOSInstanceSQL(m MapSpec) string {
	i := m.Info
	if i == nil || i.Type == 0 || i.Type > 3 {
		return ""
	}
	ghostMap, ghostX, ghostY := int32(0), float32(0), float32(0)
	if i.GhostMap >= 0 {
		ghostMap, ghostX, ghostY = i.GhostMap, i.GhostX, i.GhostY
	}
	name := i.Name
	if name == "" {
		name = m.Dir
	}
	kind := map[uint32]string{1: "dungeon", 2: "raid", 3: "battleground"}[i.Type]
	var b strings.Builder
	fmt.Fprintf(&b, "-- The instance_template row of %s (map %d, a %s made in Meld) for a CMaNGOS classic world database.\n", strings.Join(strings.Fields(name), " "), m.MapID, kind)
	b.WriteString("-- Import it into the world database, then start the world server: without the row it refuses to make the map.\n")
	if i.Type == 3 {
		b.WriteString("-- A battleground also needs its battleground_template row, which Meld does not write.\n")
	}
	fmt.Fprintf(&b, "INSERT INTO `instance_template` (`map`, `parent`, `levelMin`, `levelMax`, `maxPlayers`, `reset_delay`, `ghostEntranceMap`, `ghostEntranceX`, `ghostEntranceY`, `ScriptName`) "+
		"VALUES (%d, 0, 0, 0, %d, %d, %d, %s, %s, '') "+
		"ON DUPLICATE KEY UPDATE `maxPlayers` = VALUES(`maxPlayers`), `reset_delay` = VALUES(`reset_delay`), "+
		"`ghostEntranceMap` = VALUES(`ghostEntranceMap`), `ghostEntranceX` = VALUES(`ghostEntranceX`), `ghostEntranceY` = VALUES(`ghostEntranceY`);\n",
		m.MapID, min(i.MaxPlayers, 255), i.ResetDelay, ghostMap, num(float64(ghostX)), num(float64(ghostY)))
	return b.String()
}

// PublishCMaNGOS publishes a map made in Meld to a CMaNGOS classic server: it checks the server's
// extractors first, writes the map into the client's patch (only the files that changed), writes its
// instance_template SQL (CMaNGOSInstanceSQLPath) for a dungeon, and rebuilds the server's map data
// with UpdateCMaNGOSMaps, which waits for a running world server to stop. An unchanged map over map
// data newer than the patch leaves the server alone, as Publish does. Returns the SQL file's path, or "".
func PublishCMaNGOS(s CMaNGOSServer, clientRoot string, spec MapSpec, skipMoveMaps bool, run Runner, log func(string)) (string, error) {
	if run == nil {
		run = OSRunner{}
	}
	clientData := filepath.Join(clientRoot, "Data")
	if info, err := os.Stat(clientData); err != nil || !info.IsDir() {
		return "", fmt.Errorf("%s has no Data folder: set the WoW client folder first", clientRoot)
	}
	if _, err := cmangosTools(s, clientRoot, run); err != nil {
		return "", err
	}

	log("Writing the map into the client's patch…")
	current := mapsCurrent(filepath.Join(s.Data, "maps"), spec.MapID, PatchPath(clientData))
	res, err := ExportMap(clientData, clientData, "", spec)
	if err != nil {
		return "", err
	}
	if res.Patch != "" {
		log(fmt.Sprintf("Wrote %d of %d tiles to %s (the rest were unchanged)", res.Changed, res.Tiles, filepath.Base(res.Patch)))
	}

	sqlPath := CMaNGOSInstanceSQLPath(s, spec)
	if sqlPath != "" {
		if err := os.MkdirAll(filepath.Dir(sqlPath), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(sqlPath, []byte(CMaNGOSInstanceSQL(spec)), 0o644); err != nil {
			return "", fmt.Errorf("writing the map's instance_template SQL: %w", err)
		}
		log(fmt.Sprintf("Wrote the map's instance_template row to %s: import it into the CMaNGOS world database.", sqlPath))
	}

	if res.Patch == "" && current {
		log("Nothing changed since the last publish, and the CMaNGOS server's map data is newer than the patch: the server was left alone.")
		return sqlPath, nil
	}
	return sqlPath, UpdateCMaNGOSMaps(s, clientRoot, spec.MapID, skipMoveMaps, run, log)
}
