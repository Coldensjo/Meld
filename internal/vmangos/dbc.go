package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
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

// setRecords returns the DBC with each of rows (a whole record of 32-bit fields, the ID first)
// replacing the record of its ID, or added at the end when the ID is new. The string block is kept,
// so it suits tables whose rows hold no strings (the light tables).
func setRecords(dbc []byte, rows [][]uint32) ([]byte, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.recSize != t.fields*4 {
		return nil, errors.New("DBC records are not all 32-bit fields")
	}
	records := append([]byte(nil), dbc[20:t.strsAt]...)
	added := 0
	for _, row := range rows {
		if len(row) != t.fields {
			return nil, fmt.Errorf("a row of %d fields for a table of %d", len(row), t.fields)
		}
		at := -1
		if r, ok := t.row(row[0]); ok {
			at = r * t.recSize
		} else {
			at = len(records)
			records = append(records, make([]byte, t.recSize)...)
			t.byID[row[0]] = at / t.recSize
			added++
		}
		for f, v := range row {
			binary.LittleEndian.PutUint32(records[at+f*4:], v)
		}
	}
	out := append([]byte(nil), dbc[:20]...)
	binary.LittleEndian.PutUint32(out[4:], uint32(t.records+added))
	out = append(out, records...)
	return append(out, dbc[t.strsAt:]...), nil
}
