package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"text/tabwriter"

	"Meld/internal/vmangos"
)

// dbcRow is one record of dbc dump: its fields as 32-bit numbers, and the fields that are a valid
// offset into the string block with their text.
type dbcRow struct {
	Fields  []uint32       `json:"fields"`
	Strings map[int]string `json:"strings,omitempty"`
}

type dbcOut struct {
	File    string   `json:"file"`
	Records int      `json:"records"`
	Fields  int      `json:"fields"`
	Matched int      `json:"matched"`
	Rows    []dbcRow `json:"rows"`
}

type fieldFilter struct {
	field int
	value uint32
}

// whereFlag collects --where field=value, a field index and a number.
type whereFlag []fieldFilter

func (w *whereFlag) String() string { return "" }
func (w *whereFlag) Set(s string) error {
	f, v, ok := strings.Cut(s, "=")
	fi, err1 := strconv.Atoi(f)
	vi, err2 := strconv.ParseInt(v, 0, 64)
	if !ok || err1 != nil || err2 != nil || fi < 0 {
		return fmt.Errorf("--where wants field=value (a field index and a number), not %q", s)
	}
	*w = append(*w, fieldFilter{fi, uint32(vi)})
	return nil
}

// dbcDump prints the rows of a client DBC table (or a .dbc file on disk) as uint32 fields.
func dbcDump(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("dbc dump", flag.ContinueOnError)
	clientDir := fs.String("client", "", "client folder or its Data folder")
	limit := fs.Int("limit", 0, "the most rows listed (0: all)")
	table := fs.Bool("table", false, "print a table for people instead of JSON")
	var where whereFlag
	fs.Var(&where, "where", "keep rows whose field (index from 0) equals value; repeatable")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 {
		return fmt.Errorf("%w: dbc dump takes one table", errUsage)
	}
	name := pos[0]
	var d *vmangos.DBCDump
	if b, rerr := os.ReadFile(name); rerr == nil {
		d, err = vmangos.ParseDBCDump(b)
	} else if !errors.Is(rerr, os.ErrNotExist) {
		return rerr
	} else {
		if !strings.ContainsAny(name, `\/`) {
			name = `DBFilesClient\` + name
		}
		if !strings.HasSuffix(strings.ToLower(name), ".dbc") {
			name += ".dbc"
		}
		data, derr := clientDataDir(*clientDir)
		if derr != nil {
			return derr
		}
		d, err = vmangos.ReadDBCDump(data, strings.ReplaceAll(name, "/", `\`))
	}
	if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	for _, w := range where {
		if w.field >= d.Fields {
			return fmt.Errorf("%w: --where field %d, but the table has %d fields", errUsage, w.field, d.Fields)
		}
	}
	res := &dbcOut{File: name, Records: d.Records, Fields: d.Fields, Rows: []dbcRow{}}
rows:
	for i, row := range d.Rows {
		for _, w := range where {
			if row[w.field] != w.value {
				continue rows
			}
		}
		res.Matched++
		if *limit > 0 && len(res.Rows) >= *limit {
			continue
		}
		r := dbcRow{Fields: row}
		for f := 1; f < len(row); f++ { // field 0 is the ID, never a string
			if s, ok := d.String(i, f); ok {
				if r.Strings == nil {
					r.Strings = map[int]string{}
				}
				r.Strings[f] = s
			}
		}
		res.Rows = append(res.Rows, r)
	}
	if !*table {
		return writeJSON(out, res)
	}
	tw := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	for _, r := range res.Rows {
		cells := make([]string, len(r.Fields))
		for f, v := range r.Fields {
			cells[f] = strconv.FormatUint(uint64(v), 10)
			if s, ok := r.Strings[f]; ok {
				cells[f] = strconv.Quote(s)
			}
		}
		fmt.Fprintln(tw, strings.Join(cells, "\t"))
	}
	return tw.Flush()
}
