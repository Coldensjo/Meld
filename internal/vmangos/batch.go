package vmangos

import (
	"strconv"
	"strings"
)

// batchRow is one row of mariadb's batch output (`-B -N`), its fields unescaped.
type batchRow []string

// batchLines splits mariadb's batch output into rows of tab-separated fields, of any width, and
// undoes the escapes in every field (unescapeBatch). Empty output has no rows. Only line ends are
// trimmed: an empty last column leaves a trailing tab that is a field.
func batchLines(raw []byte) []batchRow {
	s := strings.TrimRight(string(raw), "\r\n")
	if s == "" {
		return nil
	}
	lines := strings.Split(s, "\n")
	out := make([]batchRow, 0, len(lines))
	for _, line := range lines {
		f := strings.Split(strings.TrimRight(line, "\r"), "\t")
		for i, v := range f {
			f[i] = unescapeBatch(v)
		}
		out = append(out, f)
	}
	return out
}

// batchRows is batchLines' rows of n fields, skipping rows of another width.
func batchRows(raw []byte, n int) []batchRow {
	all := batchLines(raw)
	out := all[:0]
	for _, f := range all {
		if len(f) == n {
			out = append(out, f)
		}
	}
	return out
}

// num reads field i as an integer, 0 when it is missing or not one.
func (r batchRow) num(i int) int {
	if i >= len(r) {
		return 0
	}
	v, _ := strconv.Atoi(r[i])
	return v
}

// u32 reads field i as an unsigned integer, 0 when it is missing or not one.
func (r batchRow) u32(i int) uint32 {
	if i >= len(r) {
		return 0
	}
	return atou(r[i])
}

// f32 reads field i as a float, 0 when it is missing or not one.
func (r batchRow) f32(i int) float32 {
	if i >= len(r) {
		return 0
	}
	v, _ := strconv.ParseFloat(strings.TrimSpace(r[i]), 32)
	return float32(v)
}

func atou(s string) uint32 {
	v, _ := strconv.ParseUint(strings.TrimSpace(s), 10, 32)
	return uint32(v)
}

// unescapeBatch undoes mariadb's batch output escapes (\t, \n, \\, \0) in a field.
func unescapeBatch(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' || i+1 == len(s) {
			b.WriteByte(s[i])
			continue
		}
		i++
		switch s[i] {
		case 't':
			b.WriteByte('\t')
		case 'n':
			b.WriteByte('\n')
		case '0':
			b.WriteByte(0)
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}
