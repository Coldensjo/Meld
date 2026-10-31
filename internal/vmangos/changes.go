package vmangos

import (
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strings"

	"Meld/internal/mpq"
)

// What a write will change, listed before it is made (#959): the client files Meld's patch will gain
// or change, and the database rows a spawn save or a publish will run. The Changes window shows them;
// the writes themselves build the same files and SQL, so the list cannot drift from what lands.

// FileChange is a client file a write will put into Meld's patch. Only the name goes across the
// bridge, never the file (#636: a region can be hundreds of tiles).
type FileChange struct {
	Name string `json:"name"`
	// Group is what the file is: "tile", "wdt", "wdl", "dbc", "minimap" or "other".
	Group string `json:"group"`
	// Tile names a map tile as "x_y"; "" for another file.
	Tile string `json:"tile"`
	// Reason says, in a few words, why the file is written.
	Reason string `json:"reason"`
	// New says the patch has no copy of the file yet; else the write replaces the patch's copy.
	New bool `json:"new"`
	// Waiting says the file is already written and waits for the game to close (#661).
	Waiting bool `json:"waiting"`
}

// RowChange is a database row (or a set of rows of one key) a write will add, change or delete.
type RowChange struct {
	Table string `json:"table"`
	// Key names the row: "entry 800".
	Key string `json:"key"`
	// Action is "add", "change", "delete" or "add or change".
	Action string `json:"action"`
	Reason string `json:"reason"`
	// SQL is the statements that make the change, shown on demand.
	SQL string `json:"sql"`
}

// SpawnChange is one spawn a spawn save will add, change or delete, with its SQL.
type SpawnChange struct {
	GUID   int    `json:"guid"`
	Entry  int    `json:"entry"`
	Name   string `json:"name"`
	Object bool   `json:"object"`
	// Action is "add", "change" or "delete".
	Action string `json:"action"`
	// Fields names what changed on a changed spawn ("position", "facing", "path", ...).
	Fields []string `json:"fields"`
	SQL    string   `json:"sql"`
}

// PublishPreview is what Publish will write: the client files that differ from the patch's copies,
// the map's tile count, and the world database's rows.
type PublishPreview struct {
	Files []FileChange `json:"files"`
	Tiles int          `json:"tiles"`
	Rows  []RowChange  `json:"rows"`
}

// fileGroup sorts a client file into the Changes window's groups.
func fileGroup(name string) string {
	lower := strings.ToLower(strings.ReplaceAll(name, "/", `\`))
	switch {
	case strings.HasPrefix(lower, `textures\minimap\`):
		return "minimap"
	case strings.HasSuffix(lower, ".adt"):
		return "tile"
	case strings.HasSuffix(lower, ".wdt"):
		return "wdt"
	case strings.HasSuffix(lower, ".wdl"):
		return "wdl"
	case strings.HasSuffix(lower, ".dbc"):
		return "dbc"
	}
	return "other"
}

// DescribeFiles lists files as the Changes window shows them: each with its group, the reason
// reason gives it (nil for none) and whether the patch in dataDir has a copy yet. The list is sorted
// by group, then name.
func DescribeFiles(dataDir string, files []mpq.File, reason func(name string) string) []FileChange {
	var patch *mpq.Archive
	if a, err := mpq.Open(filepath.Join(dataDir, PatchName)); err == nil {
		patch = a
		defer a.Close()
	}
	out := make([]FileChange, 0, len(files))
	for _, f := range files {
		c := FileChange{Name: f.Name, Group: fileGroup(f.Name), Tile: fileTileName(f.Name), New: true}
		if patch != nil {
			_, has := patch.Size(f.Name)
			c.New = !has
		}
		if reason != nil {
			c.Reason = reason(f.Name)
		}
		out = append(out, c)
	}
	sortChanges(out)
	return out
}

// groupOrder is the order of the Changes window's groups.
var groupOrder = map[string]int{"tile": 0, "wdt": 1, "wdl": 2, "dbc": 3, "minimap": 4, "other": 5}

func sortChanges(c []FileChange) {
	sort.SliceStable(c, func(i, j int) bool {
		if gi, gj := groupOrder[c[i].Group], groupOrder[c[j].Group]; gi != gj {
			return gi < gj
		}
		return strings.ToLower(c[i].Name) < strings.ToLower(c[j].Name)
	})
}

// RegionFileReason says why a region compile writes a file: a tile of the block was edited in it, a
// tile beside it lists a model by its edge (#647), the WDL is the map's far horizon redrawn for the
// block, and a building map's WDT places its building.
func RegionFileReason(e RegionEdit) func(string) string {
	return func(name string) string {
		switch fileGroup(name) {
		case "tile":
			if regionTile(name, e) {
				return "changed in the region"
			}
			return "beside the region: it lists a model by the region's edge"
		case "wdl":
			return "the far horizon, redrawn for the region"
		case "wdt":
			return "the map's layout (a building map's building)"
		}
		return ""
	}
}

// PreviewPublish is what ExportMap would write for map m and Publish would run in the world database,
// without writing anything: readDir is the client's Data folder the templates come from, and patchDir
// holds the patch the files are compared with.
func PreviewPublish(readDir, patchDir string, m MapSpec) (PublishPreview, error) {
	files, _, newRow, err := buildMap(readDir, m)
	if err != nil {
		return PublishPreview{}, err
	}
	if files, err = ChangedFiles(patchDir, files); err != nil {
		return PublishPreview{}, err
	}
	reason := func(name string) string {
		switch fileGroup(name) {
		case "tile":
			return "a tile of the map"
		case "wdt":
			if m.Global != nil {
				return "places the map's building"
			}
			return "the map's layout: which tiles it has"
		case "wdl":
			return "the far horizon"
		case "dbc":
			if newRow {
				return fmt.Sprintf("adds the row of map %d (%s)", m.MapID, m.Dir)
			}
			return fmt.Sprintf("updates the row of map %d (%s)", m.MapID, m.Dir)
		}
		return ""
	}
	p := PublishPreview{Files: DescribeFiles(patchDir, files, reason), Tiles: len(m.Tiles)}
	row := RowChange{Table: "map_template", Key: fmt.Sprintf("entry %d", m.MapID), SQL: templateSQL(m)}
	if m.Info == nil {
		row.Action, row.Reason = "add", "the map's row for the world server, when it has none yet"
	} else {
		row.Action, row.Reason = "add or change", "the map's row for the world server, with its type, zone, player limit and ghost entrance"
	}
	p.Rows = append(p.Rows, row)
	return p, nil
}

// WaitingFiles lists the client files already written that wait in dataDir's queue for the game to
// close (#365, #661): the next write goes on top of them.
func WaitingFiles(dataDir string) ([]FileChange, error) {
	files, err := PendingFiles(dataDir)
	if err != nil {
		return nil, err
	}
	out := make([]FileChange, 0, len(files))
	for _, f := range files {
		out = append(out, FileChange{Name: f.Name, Group: fileGroup(f.Name), Tile: fileTileName(f.Name), Reason: "written earlier, waiting for the game to close", Waiting: true})
	}
	sortChanges(out)
	return out, nil
}

// spawnFields names what changed between a spawn's original and its edit, for the Changes window.
func spawnFields(s Spawn, o *Spawn) []string {
	if o == nil {
		return nil
	}
	var out []string
	add := func(changed bool, name string) {
		if changed {
			out = append(out, name)
		}
	}
	far := func(a, b, eps float64) bool { return math.Abs(a-b) > eps }
	add(s.Entry != o.Entry, "entry")
	add(s.Map != o.Map || far(s.X, o.X, 1e-3) || far(s.Y, o.Y, 1e-3) || far(s.Z, o.Z, 1e-3), "position")
	q, r := quaternion(s), quaternion(*o)
	add(far(s.O, o.O, 1e-4) || far(q[0], r[0], 1e-4) || far(q[1], r[1], 1e-4), "facing")
	add(far(s.Scale, o.Scale, 1e-3), "scale")
	lo, hi := respawn(s)
	olo, ohi := respawn(*o)
	add(lo != olo || hi != ohi, "respawn")
	add(s.MovementType != o.MovementType || far(s.WanderDistance, o.WanderDistance, 1e-3), "movement")
	add(!samePath(s.Path, o.Path), "path")
	add(s.Display != o.Display, "display")
	add(s.Equipment != o.Equipment, "equipment")
	add(s.StandState != o.StandState || s.EmoteState != o.EmoteState || s.SheathState != o.SheathState, "pose")
	add(formationChanged(s, o), "formation")
	add(s.Pool != o.Pool || s.PoolLimit != o.PoolLimit || s.PoolName != o.PoolName || far(s.PoolChance, o.PoolChance, 1e-3) ||
		s.MotherPool != o.MotherPool || s.MotherLimit != o.MotherLimit, "pool")
	return out
}
