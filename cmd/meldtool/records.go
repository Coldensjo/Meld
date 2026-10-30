package main

import (
	"flag"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
	"text/tabwriter"

	"Meld/internal/vmangos"
)

// The record commands read the world database's creature, game object and item templates and the
// spells, through the same internal/vmangos functions the editors use. They write nothing; like the
// app, they start the server folder's database when it is down.

// recordKinds are the kinds the record commands take, with the reader of one record and the search.
var recordKinds = map[string]struct {
	get    func(server, data string, entry int) (any, error)
	search func(server, data, text string, limit int) (any, error)
	// needs says which folders a call needs: the server's (s) and the client's (c), for get and
	// for search.
	getNeeds, searchNeeds string
}{
	"creature": {
		get:      func(s, _ string, e int) (any, error) { return vmangos.ReadCreature(s, e) },
		search:   func(s, _, t string, n int) (any, error) { return vmangos.SearchCreatures(s, t, n) },
		getNeeds: "s", searchNeeds: "s",
	},
	"object": {
		get:      func(s, _ string, e int) (any, error) { return vmangos.ReadObject(s, e) },
		search:   searchObjects,
		getNeeds: "s", searchNeeds: "sc",
	},
	"item": {
		get:      func(s, _ string, e int) (any, error) { return vmangos.ReadItemTemplate(s, e) },
		search:   func(s, _, t string, n int) (any, error) { return vmangos.SearchItems(s, t, n) },
		getNeeds: "s", searchNeeds: "s",
	},
	"spell": {
		get:      func(s, d string, e int) (any, error) { return vmangos.ReadSpell(s, d, e) },
		search:   func(_, d, t string, n int) (any, error) { return vmangos.SearchSpells(d, t, n) },
		getNeeds: "sc", searchNeeds: "c",
	},
}

// searchObjects lists the game object templates whose name has text in it (any case), or whose
// entry is text, by name: there is no search of its own, so it filters the object list the asset
// browser shows.
func searchObjects(server, data, text string, limit int) (any, error) {
	text = strings.TrimSpace(text)
	all, err := vmangos.ListObjectTemplates(server, data)
	if err != nil {
		return nil, err
	}
	entry, byEntry := strconv.Atoi(text)
	lower := strings.ToLower(text)
	out := []vmangos.ObjectTemplate{}
	for _, o := range all {
		if (byEntry == nil && o.Entry == entry) || (text != "" && strings.Contains(strings.ToLower(o.Name), lower)) {
			out = append(out, o)
			if len(out) == limit {
				break
			}
		}
	}
	return out, nil
}

// record runs `<kind> get <entry>` or `<kind> search <text>`.
func record(kind, sub string, args []string, out io.Writer) error {
	k := recordKinds[kind]
	fs := flag.NewFlagSet(kind+" "+sub, flag.ContinueOnError)
	serverFlag := fs.String("server", "", "VMaNGOS server folder")
	clientFlag := fs.String("client", "", "client folder or its Data folder")
	table := fs.Bool("table", false, "print a table for people instead of JSON")
	limit := fs.Int("limit", 100, "the most results a search lists")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	needs := k.getNeeds
	if sub == "search" {
		needs = k.searchNeeds
		if len(pos) == 0 {
			return fmt.Errorf("%w: %s search takes a name or entry", errUsage, kind)
		}
	} else if len(pos) != 1 {
		return fmt.Errorf("%w: %s get takes one entry", errUsage, kind)
	}
	var server, data string
	if strings.Contains(needs, "s") {
		if server, err = serverDir(*serverFlag); err != nil {
			return err
		}
	}
	if strings.Contains(needs, "c") {
		if data, err = clientDataDir(*clientFlag); err != nil {
			return err
		}
	}
	var v any
	if sub == "search" {
		v, err = k.search(server, data, strings.Join(pos, " "), max(*limit, 1))
	} else {
		entry, perr := strconv.Atoi(pos[0])
		if perr != nil {
			return fmt.Errorf("%w: %q is not an entry", errUsage, pos[0])
		}
		v, err = k.get(server, data, entry)
	}
	if err != nil {
		return err
	}
	if *table {
		return writeTable(out, v)
	}
	if rv := reflect.ValueOf(v); rv.Kind() == reflect.Slice && rv.IsNil() {
		v = []struct{}{}
	}
	return writeJSON(out, v)
}

// writeTable prints a record (its columns and values, one a line) or a list of rows (one a line,
// under a header of their fields) as aligned text.
func writeTable(out io.Writer, v any) error {
	tw := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	switch r := v.(type) {
	case vmangos.TemplateRecord:
		fmt.Fprintf(tw, "entry\t%d\npatch\t%d\n", r.Entry, r.Patch)
		recordLines(tw, r.Columns, r.Values)
	case vmangos.SpellRecord:
		fmt.Fprintf(tw, "entry\t%d\nbuild\t%d\n", r.Entry, r.Build)
		recordLines(tw, r.Columns, r.Values)
	default:
		rv := reflect.ValueOf(v)
		if rv.Kind() != reflect.Slice || rv.Type().Elem().Kind() != reflect.Struct {
			return writeJSON(out, v)
		}
		t := rv.Type().Elem()
		var fields []int
		var names []string
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
			switch f.Type.Kind() {
			case reflect.String, reflect.Int, reflect.Int64, reflect.Float32, reflect.Float64, reflect.Bool:
			default:
				continue
			}
			if !f.IsExported() || name == "-" {
				continue
			}
			if name == "" {
				name = f.Name
			}
			fields, names = append(fields, i), append(names, name)
		}
		fmt.Fprintln(tw, strings.Join(names, "\t"))
		for i := 0; i < rv.Len(); i++ {
			cells := make([]string, len(fields))
			for j, f := range fields {
				cell := []rune(strings.ReplaceAll(fmt.Sprint(rv.Index(i).Field(f).Interface()), "\n", " "))
				if len(cell) > 60 {
					cell = append(cell[:59], '…')
				}
				cells[j] = string(cell)
			}
			fmt.Fprintln(tw, strings.Join(cells, "\t"))
		}
	}
	return tw.Flush()
}

func recordLines(w io.Writer, cols []vmangos.TemplateColumn, values map[string]string) {
	for _, c := range cols {
		fmt.Fprintf(w, "%s\t%s\n", c.Name, strings.ReplaceAll(values[c.Name], "\n", `\n`))
	}
}
