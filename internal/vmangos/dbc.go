package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
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
		var at int
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

// putRecord returns the DBC with rec (a whole record of 32-bit fields, the ID first) replacing the
// record of its ID, or added at the end when the ID is new. Each of strs (a field and its text) is
// added to the string block and the field pointed at it, a text used by several fields once; an
// empty text points at the block's leading zero. The old strings stay, so other rows keep theirs.
func putRecord(dbc []byte, rec []uint32, strs map[int]string) ([]byte, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.recSize != t.fields*4 {
		return nil, errors.New("DBC records are not all 32-bit fields")
	}
	if len(rec) != t.fields {
		return nil, fmt.Errorf("a row of %d fields for a table of %d", len(rec), t.fields)
	}
	rec = append([]uint32(nil), rec...)
	block := append([]byte(nil), dbc[t.strsAt:]...)
	if len(block) == 0 {
		block = []byte{0}
	}
	fields := make([]int, 0, len(strs))
	for f := range strs {
		fields = append(fields, f)
	}
	sort.Ints(fields)
	at := map[string]uint32{"": 0}
	for _, f := range fields {
		if f <= 0 || f >= t.fields {
			return nil, fmt.Errorf("string field %d is outside the table's %d fields", f, t.fields)
		}
		s := strs[f]
		off, ok := at[s]
		if !ok {
			off = uint32(len(block))
			block = append(append(block, s...), 0)
			at[s] = off
		}
		rec[f] = off
	}
	records := append([]byte(nil), dbc[20:t.strsAt]...)
	n := t.records
	pos := 0
	if r, ok := t.row(rec[0]); ok {
		pos = r * t.recSize
	} else {
		pos = len(records)
		records = append(records, make([]byte, t.recSize)...)
		n++
	}
	for f, v := range rec {
		binary.LittleEndian.PutUint32(records[pos+f*4:], v)
	}
	out := make([]byte, 0, 20+len(records)+len(block))
	out = append(out, "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(n))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.fields))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.recSize))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(block)))
	out = append(out, records...)
	return append(out, block...), nil
}

// record returns row r's fields.
func (t *dbcTable) record(r int) []uint32 {
	out := make([]uint32, t.fields)
	for f := range out {
		out[f] = t.u32(r, f)
	}
	return out
}
