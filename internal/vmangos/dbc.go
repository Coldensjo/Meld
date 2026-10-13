package vmangos

import (
	"encoding/binary"
	"errors"
	"math"
	"strings"

	"WorldEditor/internal/mpq"
)

// dbcTable is a DBC table as the client stores it: a header, fixed-size records of 32-bit fields,
// and a string block that the string fields point into. The first field of each record is its ID.
type dbcTable struct {
	data    []byte
	records int
	fields  int
	recSize int
	strsAt  int
	byID    map[uint32]int
}

// parseDBC reads a DBC table's header and indexes its records by ID.
func parseDBC(b []byte) (*dbcTable, error) {
	if len(b) < 20 || string(b[:4]) != "WDBC" {
		return nil, errors.New("not a DBC table")
	}
	t := &dbcTable{
		data:    b,
		records: int(binary.LittleEndian.Uint32(b[4:])),
		fields:  int(binary.LittleEndian.Uint32(b[8:])),
		recSize: int(binary.LittleEndian.Uint32(b[12:])),
	}
	t.strsAt = 20 + t.records*t.recSize
	if t.strsAt > len(b) || t.fields*4 > t.recSize {
		return nil, errors.New("DBC table is truncated")
	}
	t.byID = make(map[uint32]int, t.records)
	for r := 0; r < t.records; r++ {
		t.byID[t.u32(r, 0)] = r
	}
	return t, nil
}

func (t *dbcTable) u32(row, field int) uint32 {
	return binary.LittleEndian.Uint32(t.data[20+row*t.recSize+field*4:])
}

func (t *dbcTable) f32(row, field int) float32 {
	return math.Float32frombits(t.u32(row, field))
}

// str returns the string a string field points into, or "" for an empty field.
func (t *dbcTable) str(row, field int) string {
	off := int(t.u32(row, field))
	if off == 0 {
		return ""
	}
	start := t.strsAt + off
	if start >= len(t.data) {
		return ""
	}
	end := start
	for end < len(t.data) && t.data[end] != 0 {
		end++
	}
	return string(t.data[start:end])
}

// row returns the record with the given ID.
func (t *dbcTable) row(id uint32) (int, bool) {
	r, ok := t.byID[id]
	return r, ok
}

// modelTables are the client's tables that name a spawn's model: a creature's display, the model
// it uses, and a game object's display.
type modelTables struct {
	creatureDisplay, creatureModelData, objectDisplay *dbcTable
	// creatureExtra names a humanoid NPC's baked body texture; nil when the client has no such table.
	creatureExtra *dbcTable
}

// Where a spawn's model takes the skins the display tables name, by index in WorldSpawn.Skins: the
// three creature skin slots (M2 texture types 11, 12 and 13), then the character body (type 1).
const (
	SkinSlots = 4
	SkinBody  = 3
)

// bakedTextures is the client folder of the body textures baked for humanoid NPCs.
const bakedTextures = `Textures\BakedNpcTextures\`

// loadModelTables reads the model tables from the client's data folder.
func loadModelTables(dataDir string) (*modelTables, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	read := func(name string) (*dbcTable, error) {
		b, err := set.ReadFile(`DBFilesClient\` + name)
		if err != nil {
			return nil, err
		}
		return parseDBC(b)
	}
	var m modelTables
	if m.creatureDisplay, err = read("CreatureDisplayInfo.dbc"); err != nil {
		return nil, err
	}
	if m.creatureModelData, err = read("CreatureModelData.dbc"); err != nil {
		return nil, err
	}
	if m.objectDisplay, err = read("GameObjectDisplayInfo.dbc"); err != nil {
		return nil, err
	}
	// Optional: a client without it shows humanoid NPCs with their model's default skin.
	m.creatureExtra, _ = read("CreatureDisplayInfoExtra.dbc")
	return &m, nil
}

// creatureDisplay is what the display tables say about a creature display: the model, the skins it
// shows (see SkinSlots) and the display's scale (1 when unknown).
type creatureDisplay struct {
	model string
	skins []string
	scale float32
}

// creatureLook resolves a creature display ID. CreatureDisplayInfo's fields are: 1 the model, 3 the
// extra display (humanoids), 4 the scale, 6-8 the skin names, which are .blp files in the model's
// folder. CreatureDisplayInfoExtra's field 18 is the baked body texture's file name.
func (m *modelTables) creatureLook(display uint32) creatureDisplay {
	out := creatureDisplay{scale: 1}
	if m == nil || display == 0 {
		return out
	}
	r, ok := m.creatureDisplay.row(display)
	if !ok {
		return out
	}
	out.model = m.creatureModel(display)
	if s := m.creatureDisplay.f32(r, 4); s > 0 {
		out.scale = s
	}
	dir := out.model[:strings.LastIndex(out.model, `\`)+1]
	skins := make([]string, SkinSlots)
	for i := 0; i < 3; i++ {
		if name := m.creatureDisplay.str(r, 6+i); name != "" {
			skins[i] = dir + name + ".blp"
		}
	}
	if m.creatureExtra != nil {
		if er, ok := m.creatureExtra.row(m.creatureDisplay.u32(r, 3)); ok && m.creatureExtra.fields > 18 {
			if bake := m.creatureExtra.str(er, 18); bake != "" {
				skins[SkinBody] = bakedTextures + bake
			}
		}
	}
	for _, s := range skins {
		if s != "" {
			out.skins = skins
			break
		}
	}
	return out
}

// creatureModel is the model path a creature display uses, or "" when the display has none.
// CreatureDisplayInfo's field 1 is the model's ID, and CreatureModelData's field 2 is its path.
func (m *modelTables) creatureModel(display uint32) string {
	if m == nil || display == 0 {
		return ""
	}
	r, ok := m.creatureDisplay.row(display)
	if !ok {
		return ""
	}
	r2, ok := m.creatureModelData.row(m.creatureDisplay.u32(r, 1))
	if !ok {
		return ""
	}
	return m.creatureModelData.str(r2, 2)
}

// objectModel is the model path of a game object display, or "". GameObjectDisplayInfo's field 1
// is the path.
func (m *modelTables) objectModel(display uint32) string {
	if m == nil || display == 0 {
		return ""
	}
	r, ok := m.objectDisplay.row(display)
	if !ok {
		return ""
	}
	return m.objectDisplay.str(r, 1)
}
