package vmangos

import (
	"encoding/binary"
	"errors"
	"math"
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
