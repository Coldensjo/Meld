package vmangos

import (
	"fmt"
	"strings"

	"Meld/internal/mpq"
)

// DBCDump is a client DBC table read for inspection (meldtool dbc dump): every record as its
// 32-bit fields.
type DBCDump struct {
	Records, Fields int
	Rows            [][]uint32
	t               *dbcTable
}

// ParseDBCDump reads a DBC table's bytes.
func ParseDBCDump(b []byte) (*DBCDump, error) {
	t, err := parseDBC(b)
	if err != nil {
		return nil, err
	}
	d := &DBCDump{Records: t.records, Fields: t.fields, t: t, Rows: make([][]uint32, t.records)}
	for r := range d.Rows {
		row := make([]uint32, t.fields)
		for f := range row {
			row[f] = t.u32(r, f)
		}
		d.Rows[r] = row
	}
	return d, nil
}

// ReadDBCDump reads DBFilesClient\<name> the way the game will have it: the file waiting for the
// game to close (#365) when there is one, else the topmost archive's.
func ReadDBCDump(dataDir, name string) (*DBCDump, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := readOverlay(set, dataDir, name)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return ParseDBCDump(b)
}

// String returns the string a field points to, when the field is a valid offset into the string
// block: it starts after a terminator, ends at one, and holds printable text.
func (d *DBCDump) String(row, field int) (string, bool) {
	off := int(d.Rows[row][field])
	if off <= 0 || d.t.strsAt+off >= len(d.t.data) || d.t.data[d.t.strsAt+off-1] != 0 {
		return "", false
	}
	s := d.t.str(row, field)
	if s == "" || strings.IndexFunc(s, func(r rune) bool { return r < 32 || r == 0xFFFD }) >= 0 {
		return "", false
	}
	return s, true
}
