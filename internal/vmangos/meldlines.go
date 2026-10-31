package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// A client row in an exported SQL script (#942): the server's tables are the script's statements, and
// the client's own rows they go with (an AreaTable.dbc row a zone's area_template row is written from)
// are carried as "-- meld <kind> <fields>" comment lines, which the server ignores, so the script
// still runs on a server alone and Import in Meld writes the client half too. The spell script's
// icons and visuals (#381, spelllooks.go) came first and keep their own reader; zones (#942), portals
// (#943) and flight paths (#944) write their rows through these.
//
// A field is a number as written (an integer, or a float in Go's shortest form) or text quoted as a
// Go string literal, so a name keeps its spaces, quotes and any other character.

// meldLine is one "-- meld" line of a client row of kind: each field an integer, a float32, a
// float64 or a string (quoted).
func meldLine(kind string, fields ...any) string {
	parts := make([]string, 0, len(fields)+2)
	parts = append(parts, "-- meld", kind)
	for _, f := range fields {
		switch v := f.(type) {
		case string:
			parts = append(parts, strconv.Quote(v))
		case float32:
			parts = append(parts, strconv.FormatFloat(float64(v), 'g', -1, 32))
		case float64:
			parts = append(parts, strconv.FormatFloat(v, 'g', -1, 64))
		default:
			parts = append(parts, fmt.Sprint(v))
		}
	}
	return strings.Join(parts, " ") + "\n"
}

// meldRow is a "-- meld" line read back: its fields (a quoted one unquoted) and its line number.
type meldRow struct {
	line   int
	fields []string
}

// readMeldLines reads a script's "-- meld <kind>" lines, in the script's order. A line of that kind
// whose fields can't be read (a quote left open) is an error naming its line; lines of other kinds
// are left for their own readers.
func readMeldLines(script, kind string) ([]meldRow, error) {
	var out []meldRow
	for i, line := range strings.Split(script, "\n") {
		rest, ok := strings.CutPrefix(strings.TrimSpace(line), "-- meld ")
		if !ok {
			continue
		}
		k, rest, _ := strings.Cut(strings.TrimSpace(rest), " ")
		if k != kind {
			continue
		}
		fields, err := meldFields(rest)
		if err != nil {
			return nil, fmt.Errorf("line %d (-- meld %s): %w", i+1, kind, err)
		}
		out = append(out, meldRow{line: i + 1, fields: fields})
	}
	return out, nil
}

// meldFields splits a "-- meld" line's fields at spaces, a Go-quoted field read whole.
func meldFields(s string) ([]string, error) {
	var out []string
	for {
		s = strings.TrimLeft(s, " \t\r")
		if s == "" {
			return out, nil
		}
		if s[0] == '"' {
			q, err := strconv.QuotedPrefix(s)
			if err != nil {
				return nil, fmt.Errorf("a quoted field is not closed")
			}
			v, err := strconv.Unquote(q)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
			s = s[len(q):]
			continue
		}
		end := strings.IndexAny(s, " \t\r")
		if end < 0 {
			end = len(s)
		}
		out = append(out, s[:end])
		s = s[end:]
	}
}

// meldUints reads fields as unsigned 32-bit numbers, naming the first that isn't one.
func meldUints(fields []string, names ...string) ([]uint32, error) {
	out := make([]uint32, len(fields))
	for i, f := range fields {
		n, err := strconv.ParseUint(f, 10, 32)
		if err != nil {
			name := fmt.Sprintf("field %d", i+1)
			if i < len(names) {
				name = names[i]
			}
			return nil, fmt.Errorf("%s %q is not a whole number", name, f)
		}
		out[i] = uint32(n)
	}
	return out, nil
}
