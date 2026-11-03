package vmangos

import (
	"fmt"
	"strconv"
	"strings"

	"Meld/internal/clientbuild"
)

// A DBC table's columns move from one client build to the next: a localized string alone is 9
// columns in 1.12 (8 locales and a flags column) and 17 in 2.4.3 and 3.3.5a, and later builds add
// and drop columns. So Meld reads and writes every table through a layout per build that names its
// columns (#1064, groundwork of #1060), never through column numbers written at the call site.
//
// A layout is written as a spec: the table's fields in column order, separated by spaces, each a
// name with an optional type and an optional array length:
//
//	ID MapID Pos:f[3] Name:loc Flags Texture:s _[2]
//
// The types are u32 (the default), i (int32), f (float32), s (a string: an offset into the string
// block) and loc (a localized string: one string column per locale, then the locales' flags
// column). A name of _ holds columns Meld does not read. The layouts are Meld's own, written from
// the client's tables; WoWDBDefs (CC BY-SA 4.0) is consulted for the meaning of a column but not
// copied or generated from.
//
// A reader resolves the names it needs once per table (t.col, t.at), outside its row loop, and
// reads the rows by column number as before. A table's layout is picked by its width (so no build
// is passed around), which makes two layouts of one width a mistake. A localized string reads and
// writes the client's locale slot: slot 0 (enUS) in every build for now, as Meld always read it.
// The ID is column 0 in every build, the column parseDBC indexes the rows by.

// dbcKind is how a field is stored.
type dbcKind uint8

const (
	dbcU32 dbcKind = iota
	dbcI32
	dbcF32
	dbcStr
	dbcLoc
)

// dbcField is one named field of a layout: its first column, its type and its array length.
type dbcField struct {
	name  string
	kind  dbcKind
	at    int
	count int
}

// dbcLayout is a table's columns in one client build.
type dbcLayout struct {
	table   string
	build   clientbuild.Build
	columns int
	locales int // the string columns of a localized string
	slot    int // the locale slot a localized string is read from and written to
	fields  []dbcField
	byName  map[string]int
	strs    []int  // the string fields' columns (not the localized strings'), in order
	isStr   []bool // by column: whether it is one of strs
}

// dbcSchema is one table's layouts, one per build Meld reads it in.
type dbcSchema struct {
	name    string
	layouts []*dbcLayout
}

// dbcSchemas holds every table's schema by name, for the tests that check the layouts against the
// client's tables.
var dbcSchemas = map[string]*dbcSchema{}

// dbcLocales is the number of string columns a localized string has in a build.
func dbcLocales(b clientbuild.Build) int {
	if b == clientbuild.TBC || b == clientbuild.WotLK {
		return 16
	}
	return 8
}

// newDBCSchema reads a table's layout specs, one per build. A spec that cannot be read is a mistake
// in Meld's code, so it panics when the package loads. Each schema needs a 1.12 layout, the one an
// unknown build and a table of no known width read with, and no two of its layouts may have the same
// width, since a table's layout is picked by its width (dbcSchema.layout).
func newDBCSchema(name string, specs map[clientbuild.Build]string) *dbcSchema {
	if _, ok := dbcSchemas[name]; ok {
		panic("DBC schema " + name + " defined twice")
	}
	s := &dbcSchema{name: name}
	for _, b := range []clientbuild.Build{clientbuild.Vanilla, clientbuild.TBC, clientbuild.WotLK} {
		spec, ok := specs[b]
		if !ok {
			continue
		}
		l, err := parseDBCLayout(name, b, spec)
		if err != nil {
			panic(err)
		}
		for _, o := range s.layouts {
			if o.columns == l.columns {
				panic(fmt.Sprintf("%s.dbc has two layouts %d columns wide (%s and %s)", name, l.columns, o.build.Version(), b.Version()))
			}
		}
		s.layouts = append(s.layouts, l)
	}
	if len(s.layouts) != len(specs) {
		panic("DBC schema " + name + " has a layout for a build Meld does not read")
	}
	if len(s.layouts) == 0 || s.layouts[0].build != clientbuild.Vanilla {
		panic("DBC schema " + name + " has no 1.12 layout")
	}
	dbcSchemas[name] = s
	return s
}

// parseDBCLayout reads one layout spec.
func parseDBCLayout(table string, b clientbuild.Build, spec string) (*dbcLayout, error) {
	l := &dbcLayout{table: table, build: b, locales: dbcLocales(b), byName: map[string]int{}}
	for _, tok := range strings.Fields(spec) {
		name, count := tok, 1
		if i := strings.IndexByte(tok, '['); i >= 0 {
			if !strings.HasSuffix(tok, "]") {
				return nil, fmt.Errorf("%s.dbc layout: bad field %q", table, tok)
			}
			n, err := strconv.Atoi(tok[i+1 : len(tok)-1])
			if err != nil || n < 1 {
				return nil, fmt.Errorf("%s.dbc layout: bad array length in %q", table, tok)
			}
			name, count = tok[:i], n
		}
		kind := dbcU32
		if i := strings.IndexByte(name, ':'); i >= 0 {
			switch name[i+1:] {
			case "u32":
			case "i":
				kind = dbcI32
			case "f":
				kind = dbcF32
			case "s":
				kind = dbcStr
			case "loc":
				kind = dbcLoc
			default:
				return nil, fmt.Errorf("%s.dbc layout: bad type in %q", table, tok)
			}
			name = name[:i]
		}
		if name == "" {
			return nil, fmt.Errorf("%s.dbc layout: a field with no name, %q", table, tok)
		}
		width := 1
		if kind == dbcLoc {
			width = l.locales + 1
		}
		if name != "_" {
			if _, dup := l.byName[name]; dup {
				return nil, fmt.Errorf("%s.dbc layout: field %s named twice", table, name)
			}
			l.byName[name] = len(l.fields)
			l.fields = append(l.fields, dbcField{name: name, kind: kind, at: l.columns, count: count})
		}
		if kind == dbcStr {
			for i := 0; i < count; i++ {
				l.strs = append(l.strs, l.columns+i)
			}
		}
		l.columns += width * count
	}
	l.isStr = make([]bool, l.columns)
	for _, c := range l.strs {
		l.isStr[c] = true
	}
	if len(l.fields) == 0 || l.fields[0].at != 0 {
		return nil, fmt.Errorf("%s.dbc layout: the first column has no name", table)
	}
	return l, nil
}

// layout is the schema's layout for a table of the given width: the build's whose width it is, else
// the 1.12 one (a table of no known width is read as 1.12, as an unknown build is, and as Meld read
// every table before #1064: the tests' small synthetic tables are such tables).
func (s *dbcSchema) layout(fields int) *dbcLayout {
	for _, l := range s.layouts {
		if l.columns == fields {
			return l
		}
	}
	return s.layouts[0]
}

// forBuild is the schema's layout for a build, for a table made from nothing; an unknown build, or one
// the table has no layout for, gets the 1.12 one.
func (s *dbcSchema) forBuild(b clientbuild.Build) *dbcLayout {
	for _, l := range s.layouts {
		if l.build == b {
			return l
		}
	}
	return s.layouts[0]
}

// file is the table's path in the client's archives.
func (s *dbcSchema) file() string { return `DBFilesClient\` + s.name + `.dbc` }

// field is the named field, panicking on a name the layout lacks: a mistake in Meld's code.
func (l *dbcLayout) field(name string) dbcField {
	i, ok := l.byName[name]
	if !ok {
		panic(fmt.Sprintf("%s.dbc (%s) has no field %s", l.table, l.build.Version(), name))
	}
	return l.fields[i]
}

// has reports whether the layout names the field.
func (l *dbcLayout) has(name string) bool {
	_, ok := l.byName[name]
	return ok
}

// col is the column of a single field. For a localized string it is the client's locale slot.
func (l *dbcLayout) col(name string) int {
	f := l.field(name)
	if f.count != 1 {
		panic(fmt.Sprintf("%s.dbc field %s is an array of %d; read it with at", l.table, name, f.count))
	}
	if f.kind == dbcLoc {
		return f.at + l.slot
	}
	return f.at
}

// at is the column of element i of an array field (of a localized string array, its locale slot).
func (l *dbcLayout) at(name string, i int) int {
	f := l.field(name)
	if i < 0 || i >= f.count {
		panic(fmt.Sprintf("%s.dbc field %s has %d elements, not %d", l.table, name, f.count, i+1))
	}
	if f.kind == dbcLoc {
		return f.at + i*(l.locales+1) + l.slot
	}
	return f.at + i
}

// count is an array field's length.
func (l *dbcLayout) count(name string) int { return l.field(name).count }

// mask is the locales' flags column of a localized string.
func (l *dbcLayout) mask(name string) int {
	f := l.field(name)
	if f.kind != dbcLoc || f.count != 1 {
		panic(fmt.Sprintf("%s.dbc field %s is not a localized string", l.table, name))
	}
	return f.at + l.locales
}

// locs is every string column of a localized string, its locale slots in order.
func (l *dbcLayout) locs(name string) []int {
	f := l.field(name)
	if f.kind != dbcLoc || f.count != 1 {
		panic(fmt.Sprintf("%s.dbc field %s is not a localized string", l.table, name))
	}
	out := make([]int, l.locales)
	for i := range out {
		out[i] = f.at + i
	}
	return out
}

// parseTable reads a DBC table and picks its schema's layout for the table's width.
func parseTable(b []byte, s *dbcSchema) (*dbcTable, error) {
	t, err := parseDBC(b)
	if err != nil {
		return nil, err
	}
	t.l = s.layout(t.fields)
	return t, nil
}

// parseExact is parseTable for a table that must be one of its layouts' widths, with a record
// of 32-bit fields: a reader that rewrites whole records, or that a narrower table would mislead.
func parseExact(b []byte, s *dbcSchema) (*dbcTable, error) {
	t, err := parseTable(b, s)
	if err != nil {
		return nil, fmt.Errorf("%s.dbc: %w", s.name, err)
	}
	if t.fields != t.l.columns || t.recSize != t.fields*4 {
		return nil, fmt.Errorf("%s.dbc has %d fields of %d bytes a record, not 1.12's %d", s.name, t.fields, t.recSize, s.layouts[0].columns)
	}
	return t, nil
}

// col, at and mask resolve a field through the table's layout (parseTable).
func (t *dbcTable) col(name string) int       { return t.l.col(name) }
func (t *dbcTable) at(name string, i int) int { return t.l.at(name, i) }
func (t *dbcTable) mask(name string) int      { return t.l.mask(name) }
