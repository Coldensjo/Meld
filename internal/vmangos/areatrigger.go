package vmangos

import (
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/mpq"
)

// AreaTriggerPath is AreaTrigger.dbc's name in the client's archives.
const AreaTriggerPath = `DBFilesClient\AreaTrigger.dbc`

// areaTriggerFields is AreaTrigger.dbc's record in 1.12: ID, map, x, y, z, radius, box length,
// width, height and yaw (Benilla's area_trigger.rs, 0x28 bytes a row).
const areaTriggerFields = 10

// triggerBuild is the client build VMaNGOS loads areatrigger_template rows for (5875 is 1.12.1).
const triggerBuild = 5875

// maxTriggerID is the largest trigger ID: areatrigger_template.id is an unsigned smallint.
const maxTriggerID = 65535

// AreaTrigger is a trigger volume on a map, in the server's coordinates (yards, Z up): a sphere of
// Radius, or with Radius 0 a box of BoxX by BoxY by BoxZ turned BoxYaw radians about Z. The client
// tells the server when a player walks in; the server does what its tables say, here a teleport.
type AreaTrigger struct {
	ID     uint32  `json:"id"`
	MapID  uint32  `json:"mapId"`
	X      float32 `json:"x"`
	Y      float32 `json:"y"`
	Z      float32 `json:"z"`
	Radius float32 `json:"radius"`
	BoxX   float32 `json:"boxX"`
	BoxY   float32 `json:"boxY"`
	BoxZ   float32 `json:"boxZ"`
	BoxYaw float32 `json:"boxYaw"`
	// Name is the server's name for it (areatrigger_template, or the teleport's).
	Name string `json:"name"`
	// Teleport is where it sends a player, or nil when it doesn't.
	Teleport *TriggerTeleport `json:"teleport"`
}

// TriggerTeleport is an areatrigger_teleport row: the target map, position and facing, the level a
// player needs, and the message one below it gets.
type TriggerTeleport struct {
	Map     uint32  `json:"map"`
	X       float32 `json:"x"`
	Y       float32 `json:"y"`
	Z       float32 `json:"z"`
	O       float32 `json:"o"`
	Level   int     `json:"level"`
	Message string  `json:"message"`
}

// LoadAreaTriggerTable reads the client's AreaTrigger.dbc as the game sees it, Meld's patch included.
func LoadAreaTriggerTable(dataDir string) ([]byte, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	return set.ReadFile(AreaTriggerPath)
}

func areaTriggerTable(dbc []byte) (*dbcTable, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields != areaTriggerFields || t.recSize != areaTriggerFields*4 {
		return nil, fmt.Errorf("AreaTrigger.dbc has %d fields of %d bytes a record, not 1.12's %d", t.fields, t.recSize, areaTriggerFields)
	}
	return t, nil
}

// ReadAreaTriggers lists the triggers on map mapID, in the table's order.
func ReadAreaTriggers(dbc []byte, mapID uint32) ([]AreaTrigger, error) {
	t, err := areaTriggerTable(dbc)
	if err != nil {
		return nil, err
	}
	var out []AreaTrigger
	for r := 0; r < t.records; r++ {
		if t.u32(r, 1) != mapID {
			continue
		}
		out = append(out, AreaTrigger{
			ID: t.u32(r, 0), MapID: mapID,
			X: t.f32(r, 2), Y: t.f32(r, 3), Z: t.f32(r, 4), Radius: t.f32(r, 5),
			BoxX: t.f32(r, 6), BoxY: t.f32(r, 7), BoxZ: t.f32(r, 8), BoxYaw: t.f32(r, 9),
		})
	}
	return out, nil
}

// triggerRecord is a trigger as the table's ten fields.
func triggerRecord(a AreaTrigger) []uint32 {
	f := math.Float32bits
	return []uint32{a.ID, a.MapID, f(a.X), f(a.Y), f(a.Z), f(a.Radius), f(a.BoxX), f(a.BoxY), f(a.BoxZ), f(a.BoxYaw)}
}

// checkTrigger refuses a trigger the client or server can't use.
func checkTrigger(a AreaTrigger) error {
	if a.ID == 0 || a.ID > maxTriggerID {
		return fmt.Errorf("trigger %d: the ID must be 1 to %d", a.ID, maxTriggerID)
	}
	for _, v := range []float32{a.X, a.Y, a.Z, a.Radius, a.BoxX, a.BoxY, a.BoxZ, a.BoxYaw} {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return fmt.Errorf("trigger %d has a value that is not a number", a.ID)
		}
	}
	if a.Radius < 0 || a.BoxX < 0 || a.BoxY < 0 || a.BoxZ < 0 {
		return fmt.Errorf("trigger %d: its size can't be negative", a.ID)
	}
	if a.Radius == 0 && (a.BoxX == 0 || a.BoxY == 0 || a.BoxZ == 0) {
		return fmt.Errorf("trigger %d has no size: give it a radius or a box", a.ID)
	}
	if len(a.Name) > 64 {
		return fmt.Errorf("trigger %d: the name is longer than 64 characters", a.ID)
	}
	if t := a.Teleport; t != nil {
		if t.Level < 0 || t.Level > 255 {
			return fmt.Errorf("trigger %d: the required level must be 0 to 255", a.ID)
		}
		if len(t.Message) > 128 {
			return fmt.Errorf("trigger %d: the message is longer than 128 characters", a.ID)
		}
		if t.Map > 65535 {
			return fmt.Errorf("trigger %d: no map %d", a.ID, t.Map)
		}
	}
	return nil
}

// SetAreaTriggers returns AreaTrigger.dbc with rows replacing the records of their IDs (added at the
// end when new) and the records of remove taken out. The table holds no strings.
func SetAreaTriggers(dbc []byte, rows []AreaTrigger, remove []uint32) ([]byte, error) {
	t, err := areaTriggerTable(dbc)
	if err != nil {
		return nil, err
	}
	for _, a := range rows {
		if err := checkTrigger(a); err != nil {
			return nil, err
		}
	}
	gone := map[uint32]bool{}
	for _, id := range remove {
		gone[id] = true
	}
	set := map[uint32][]uint32{}
	var added []uint32
	for _, a := range rows {
		if gone[a.ID] {
			return nil, fmt.Errorf("trigger %d is both saved and removed", a.ID)
		}
		if _, ok := set[a.ID]; ok {
			return nil, fmt.Errorf("trigger %d is listed twice", a.ID)
		}
		set[a.ID] = triggerRecord(a)
		if _, ok := t.row(a.ID); !ok {
			added = append(added, a.ID)
		}
	}
	strs := dbc[t.strsAt:]
	var recs []byte
	n := 0
	put := func(fields []uint32) {
		for _, v := range fields {
			recs = binary.LittleEndian.AppendUint32(recs, v)
		}
		n++
	}
	for r := 0; r < t.records; r++ {
		id := t.u32(r, 0)
		if gone[id] {
			continue
		}
		if f, ok := set[id]; ok {
			put(f)
			continue
		}
		recs = append(recs, dbc[20+r*t.recSize:20+(r+1)*t.recSize]...)
		n++
	}
	for _, id := range added {
		put(set[id])
	}
	out := make([]byte, 20, 20+len(recs)+len(strs))
	copy(out, "WDBC")
	binary.LittleEndian.PutUint32(out[4:], uint32(n))
	binary.LittleEndian.PutUint32(out[8:], areaTriggerFields)
	binary.LittleEndian.PutUint32(out[12:], areaTriggerFields*4)
	binary.LittleEndian.PutUint32(out[16:], uint32(len(strs)))
	out = append(out, recs...)
	return append(out, strs...), nil
}

// NewAreaTriggerID is the first ID above every trigger of the client's table and of the server's
// areatrigger_template (serverMax), for a new trigger.
func NewAreaTriggerID(dbc []byte, serverMax uint32) (uint32, error) {
	t, err := areaTriggerTable(dbc)
	if err != nil {
		return 0, err
	}
	top := serverMax
	for r := 0; r < t.records; r++ {
		top = max(top, t.u32(r, 0))
	}
	if top >= maxTriggerID {
		return 0, fmt.Errorf("no free area trigger ID (the last is %d)", top)
	}
	return top + 1, nil
}

func num32(v float32) string {
	return strconv.FormatFloat(float64(v), 'f', -1, 32)
}

// AreaTriggerSQL writes rows into the world database (their geometry into areatrigger_template for
// 1.12.1, where the server checks a trigger a client reports; their teleports into
// areatrigger_teleport) and takes the triggers of remove out of both.
func AreaTriggerSQL(rows []AreaTrigger, remove []uint32) string {
	var b strings.Builder
	ids := append([]uint32{}, remove...)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		fmt.Fprintf(&b, "DELETE FROM `areatrigger_template` WHERE `id` = %d;\nDELETE FROM `areatrigger_teleport` WHERE `id` = %d;\n", id, id)
	}
	for _, a := range rows {
		fmt.Fprintf(&b, "REPLACE INTO `areatrigger_template` (`id`, `build`, `name`, `map_id`, `x`, `y`, `z`, `radius`, `box_x`, `box_y`, `box_z`, `box_orientation`) VALUES (%d, %d, %s, %d, %s, %s, %s, %s, %s, %s, %s, %s);\n",
			a.ID, triggerBuild, sqlQuote(a.Name), a.MapID, num32(a.X), num32(a.Y), num32(a.Z), num32(a.Radius), num32(a.BoxX), num32(a.BoxY), num32(a.BoxZ), num32(a.BoxYaw))
		fmt.Fprintf(&b, "DELETE FROM `areatrigger_teleport` WHERE `id` = %d;\n", a.ID)
		if t := a.Teleport; t != nil {
			fmt.Fprintf(&b, "INSERT INTO `areatrigger_teleport` (`id`, `patch`, `name`, `message`, `required_level`, `target_map`, `target_position_x`, `target_position_y`, `target_position_z`, `target_orientation`) VALUES (%d, 0, %s, %s, %d, %d, %s, %s, %s, %s);\n",
				a.ID, sqlQuote(a.Name), sqlQuote(t.Message), t.Level, t.Map, num32(t.X), num32(t.Y), num32(t.Z), num32(t.O))
		}
	}
	return b.String()
}

// TriggerExtras adds the server's names and teleports to triggers (by ID), and returns the server's
// highest trigger ID, for NewAreaTriggerID.
func TriggerExtras(serverRoot string, triggers []AreaTrigger) (uint32, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return 0, err
	}
	raw, err := runSQL(db, "SELECT COALESCE(MAX(`id`), 0) FROM `areatrigger_template`")
	if err != nil {
		return 0, err
	}
	top, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	if len(triggers) == 0 {
		return uint32(top), nil
	}
	byID := map[uint32]*AreaTrigger{}
	ids := make([]string, len(triggers))
	for i := range triggers {
		byID[triggers[i].ID] = &triggers[i]
		ids[i] = strconv.Itoa(int(triggers[i].ID))
	}
	in := strings.Join(ids, ",")
	raw, err = runSQL(db, fmt.Sprintf("SELECT t.id, COALESCE(t.name, '') FROM areatrigger_template t JOIN (SELECT id, MAX(build) AS build FROM areatrigger_template WHERE build <= %d GROUP BY id) n ON n.id = t.id AND n.build = t.build WHERE t.id IN (%s)", triggerBuild, in))
	if err != nil {
		return 0, err
	}
	for _, f := range batchRows(raw, 2) {
		if a := byID[f.u32(0)]; a != nil {
			a.Name = f[1]
		}
	}
	raw, err = runSQL(db, fmt.Sprintf("SELECT t.id, t.name, t.message, t.required_level, t.target_map, t.target_position_x, t.target_position_y, t.target_position_z, t.target_orientation FROM areatrigger_teleport t "+
		"JOIN (SELECT id, MAX(patch) AS patch FROM areatrigger_teleport GROUP BY id) n ON n.id = t.id AND n.patch = t.patch WHERE t.id IN (%s)", in))
	if err != nil {
		return 0, err
	}
	for _, f := range batchRows(raw, 9) {
		a := byID[f.u32(0)]
		if a == nil {
			continue
		}
		if a.Name == "" {
			a.Name = f[1]
		}
		lvl, _ := strconv.Atoi(f[3])
		a.Teleport = &TriggerTeleport{Message: f[2], Level: lvl, Map: f.u32(4), X: f.f32(5), Y: f.f32(6), Z: f.f32(7), O: f.f32(8)}
	}
	return uint32(top), nil
}
