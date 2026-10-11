package vmangos

import (
	"encoding/binary"
	"errors"

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
}

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
	return &m, nil
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
