package vmangos

import (
	"bytes"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	"WorldEditor/internal/adt"
)

// SpawnEdit is a spawn of a region as the editor has it now, in the region's coordinates.
// Original is what the database had when the region was read, or what the editor first placed
// for a created spawn; Created says the spawn is new and Deleted that it was removed.
type SpawnEdit struct {
	Spawn    WorldSpawn  `json:"spawn"`
	Original *WorldSpawn `json:"original"`
	Created  bool        `json:"created"`
	Deleted  bool        `json:"deleted"`
}

// serverSpawn moves a region spawn back to the server's coordinates (see regionSpawn) on map mapID.
func serverSpawn(w WorldSpawn, mapID, x, y int) Spawn {
	t := float64(adt.TileSize)
	zp := float64(adt.ZeroPoint)
	s := Spawn{
		Kind:           Creature,
		GUID:           w.GUID,
		Entry:          w.Entry,
		Name:           w.Name,
		Map:            mapID,
		X:              zp - float64(w.Z) - float64(y)*t,
		Y:              zp - float64(w.X) - float64(x)*t,
		Z:              float64(w.Y),
		O:              float64(w.Orientation),
		Scale:          float64(w.Scale),
		RespawnMin:     w.RespawnSecs,
		RespawnMax:     w.RespawnMaxSecs,
		MovementType:   w.MovementType,
		WanderDistance: float64(w.WanderDistance),
		Display:        w.Display,
		Equipment:      w.Equipment,
		StandState:     w.StandState,
		EmoteState:     w.EmoteState,
		SheathState:    w.SheathState,
	}
	if w.Kind == KindObject {
		s.Kind = GameObject
	}
	return s
}

// SpawnSQL turns a region's spawn edits into SQL for the server's world database. The region is
// the block of size tiles at (x, y) of map mapName.
func SpawnSQL(serverRoot, mapName string, x, y, size int, edits []SpawnEdit, now time.Time) (Result, error) {
	if err := checkRegion(x, y, size); err != nil {
		return Result{}, err
	}
	mapID, err := serverMapID(serverRoot, mapName)
	if err != nil {
		return Result{}, err
	}
	list := make([]Edit, 0, len(edits))
	for _, e := range edits {
		ed := Edit{Spawn: serverSpawn(e.Spawn, mapID, x, y), Created: e.Created, Deleted: e.Deleted}
		if e.Original != nil {
			o := serverSpawn(*e.Original, mapID, x, y)
			ed.Original = &o
		}
		list = append(list, ed)
	}
	return ExportSQL(list, now), nil
}

// runScript runs an SQL script against the world database through mariadb's input, one
// transaction, since a script of many edits is too long for a command line. It's a variable so
// tests can catch the script.
var runScript = func(db worldDB, script string) error {
	args := db.args("")
	args = args[:len(args)-2] // no -e: the script comes on stdin
	cmd := exec.Command("mariadb", args...)
	cmd.Stdin = strings.NewReader("START TRANSACTION;\n" + script + "\nCOMMIT;\n")
	var errOut bytes.Buffer
	cmd.Stderr = &errOut
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("mariadb: %w: %s", err, strings.TrimSpace(errOut.String()))
	}
	return nil
}

// ApplySQL runs spawn SQL (from SpawnSQL) against the server's world database, starting the
// database first when it is down.
func ApplySQL(serverRoot, script string) error {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return err
	}
	return runScript(db, script)
}

// LookResult is how a creature display looks with some equipment and pose: the model, its look as
// the model endpoint's query (without the animation), the animation, and the display's scale.
type LookResult struct {
	Model        string  `json:"model"`
	Look         string  `json:"look"`
	Anim         int     `json:"anim"`
	DisplayScale float32 `json:"displayScale"`
}

// Model tables loaded once per client data folder: dressing a spawn again after an edit must not
// re-read the client's tables each time.
var (
	tablesMu    sync.Mutex
	tablesCache = map[string]*modelTables{}
)

func cachedModelTables(dataDir string) (*modelTables, error) {
	tablesMu.Lock()
	defer tablesMu.Unlock()
	if m, ok := tablesCache[dataDir]; ok {
		return m, nil
	}
	m, err := loadModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	tablesCache[dataDir] = m
	return m, nil
}

// CreatureLook dresses a creature display with an equipment (creature_equip_template, read from
// the world database when it isn't 0) and a pose, as ReadSpawns does.
func CreatureLook(serverRoot, dataDir string, display, equipment, stand, emote, sheath int) (LookResult, error) {
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return LookResult{}, err
	}
	var weapons [3]heldItem
	if equipment > 0 {
		db, err := worldDatabase(serverRoot)
		if err != nil {
			return LookResult{}, err
		}
		eq, err := readEquipment(db, []spawnRow{{WorldSpawn: WorldSpawn{Kind: KindNPC, Equipment: equipment}}})
		if err != nil {
			return LookResult{}, err
		}
		weapons = eq[equipment]
	}
	d := tables.creatureLook(uint32(max(display, 0)), gear{weapons: weapons, sheath: sheath, stand: stand, emote: emote})
	anim := d.look.Anim
	d.look.Anim = 0
	return LookResult{Model: d.model, Look: d.look.Query(), Anim: anim, DisplayScale: d.scale}, nil
}

// Emote is a client emote (Emotes.dbc): its ID, name such as "STATE_DANCE", and animation.
type Emote struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Anim int    `json:"anim"`
}

// Emotes lists the client's emotes by ID.
func Emotes(dataDir string) ([]Emote, error) {
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	t := tables.emotes
	if t == nil || t.fields < 3 {
		return nil, nil
	}
	out := make([]Emote, 0, t.records)
	for r := 0; r < t.records; r++ {
		out = append(out, Emote{ID: int(t.u32(r, 0)), Name: t.str(r, 1), Anim: int(t.u32(r, 2))})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
