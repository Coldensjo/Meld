package vmangos

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// A reader for the INSERT and REPLACE statements of an SQL script, as mariadb-dump and the server's
// sql files write them, so the editors can import items (#353) and spells (#357) without running a script they
// haven't looked at: only rows of the one table are taken, and every other statement is counted and
// left out.

// sqlRow is a row read from a script: its values by column, and which of them were NULL.
type sqlRow struct {
	values map[string]string
	null   map[string]bool
}

// sqlLiteral is a value of a VALUES tuple: its text (a string unquoted and unescaped), or NULL.
type sqlLiteral struct {
	text string
	null bool
}

// sqlInsert is an INSERT or REPLACE statement's column list (nil when it names none) and rows.
type sqlInsert struct {
	columns []string
	rows    [][]sqlLiteral
}

// parseInserts reads a script's INSERT and REPLACE statements into table, and counts the other
// statements, which it skips.
func parseInserts(script, table string) ([]sqlInsert, int, error) {
	p := &sqlScanner{s: script}
	var out []sqlInsert
	skipped := 0
	for {
		p.space()
		if p.done() {
			return out, skipped, nil
		}
		if p.peek() == ';' {
			p.i++
			continue
		}
		start := p.i
		ins, ok, err := p.insert(table)
		if err != nil {
			return nil, 0, fmt.Errorf("%w (at %s)", err, p.where(start))
		}
		if ok {
			out = append(out, ins)
			continue
		}
		p.i = start
		if err := p.skipStatement(); err != nil {
			return nil, 0, err
		}
		skipped++
	}
}

// parseDeletes reads a script's DELETE FROM table WHERE key = n statements, the form an export
// writes to clear a list before its rows (#938), and returns their n in the script's order. Every
// other statement, a DELETE of another form too, is left for the other readers to count.
func parseDeletes(script, table, key string) ([]int, error) {
	p := &sqlScanner{s: script}
	var out []int
	for {
		p.space()
		if p.done() {
			return out, nil
		}
		if p.peek() == ';' {
			p.i++
			continue
		}
		start := p.i
		if n, ok := p.deleteOf(table, key); ok {
			out = append(out, n)
			continue
		}
		p.i = start
		if err := p.skipStatement(); err != nil {
			return nil, err
		}
	}
}

// deleteOf reads a DELETE FROM table WHERE key = n statement up to its end, and says n; ok is false
// for any other statement.
func (p *sqlScanner) deleteOf(table, key string) (int, bool) {
	if p.keyword("DELETE") == "" || p.keyword("FROM") == "" {
		return 0, false
	}
	name := p.word()
	if p.expect('.') {
		name = p.word()
	}
	if !strings.EqualFold(name, table) || p.keyword("WHERE") == "" || !strings.EqualFold(p.word(), key) || !p.expect('=') {
		return 0, false
	}
	p.space()
	quote := p.peek() == '\''
	if quote {
		p.i++
	}
	start := p.i
	for !p.done() && p.peek() >= '0' && p.peek() <= '9' {
		p.i++
	}
	n, err := strconv.Atoi(p.s[start:p.i])
	if err != nil || (quote && !p.expect('\'')) {
		return 0, false
	}
	p.space()
	if !p.done() && p.peek() != ';' {
		return 0, false
	}
	return n, true
}

type sqlScanner struct {
	s string
	i int
}

func (p *sqlScanner) done() bool { return p.i >= len(p.s) }

func (p *sqlScanner) peek() byte {
	if p.done() {
		return 0
	}
	return p.s[p.i]
}

// where is a position as "line n".
func (p *sqlScanner) where(i int) string {
	return fmt.Sprintf("line %d", strings.Count(p.s[:min(i, len(p.s))], "\n")+1)
}

// space skips white space and comments (-- to the line end, # to the line end, /* */).
func (p *sqlScanner) space() {
	for !p.done() {
		c := p.s[p.i]
		switch {
		case c == ' ' || c == '\t' || c == '\r' || c == '\n':
			p.i++
		case c == '#' || (c == '-' && strings.HasPrefix(p.s[p.i:], "--") && (p.i+2 == len(p.s) || strings.ContainsRune(" \t\r\n", rune(p.s[p.i+2])))):
			if n := strings.IndexByte(p.s[p.i:], '\n'); n >= 0 {
				p.i += n + 1
			} else {
				p.i = len(p.s)
			}
		case c == '/' && strings.HasPrefix(p.s[p.i:], "/*"):
			if n := strings.Index(p.s[p.i+2:], "*/"); n >= 0 {
				p.i += n + 4
			} else {
				p.i = len(p.s)
			}
		default:
			return
		}
	}
}

// word reads a keyword or a name, bare or in backticks; "" when there is none.
func (p *sqlScanner) word() string {
	p.space()
	if p.peek() == '`' {
		end := strings.IndexByte(p.s[p.i+1:], '`')
		if end < 0 {
			return ""
		}
		w := p.s[p.i+1 : p.i+1+end]
		p.i += end + 2
		return w
	}
	start := p.i
	for !p.done() {
		c := p.s[p.i]
		if c == '_' || c == '$' || (c >= '0' && c <= '9') || (c|0x20 >= 'a' && c|0x20 <= 'z') {
			p.i++
			continue
		}
		break
	}
	return p.s[start:p.i]
}

// keyword reads one of words (any case) and says which, or "" leaving the position as it was.
func (p *sqlScanner) keyword(words ...string) string {
	save := p.i
	w := p.word()
	for _, k := range words {
		if strings.EqualFold(w, k) {
			return k
		}
	}
	p.i = save
	return ""
}

// expect reads the byte c after any space.
func (p *sqlScanner) expect(c byte) bool {
	p.space()
	if p.peek() != c {
		return false
	}
	p.i++
	return true
}

// insert reads an INSERT [IGNORE] INTO or REPLACE [INTO] statement into table. ok is false, with
// no error, for any other statement.
func (p *sqlScanner) insert(table string) (sqlInsert, bool, error) {
	var ins sqlInsert
	switch p.keyword("INSERT", "REPLACE") {
	case "INSERT":
		p.keyword("LOW_PRIORITY", "DELAYED", "HIGH_PRIORITY")
		p.keyword("IGNORE")
		if p.keyword("INTO") == "" {
			return ins, false, nil
		}
	case "REPLACE":
		p.keyword("LOW_PRIORITY", "DELAYED")
		p.keyword("INTO")
	default:
		return ins, false, nil
	}
	name := p.word()
	if p.expect('.') {
		name = p.word()
	}
	if !strings.EqualFold(name, table) {
		return ins, false, nil
	}
	if p.expect('(') {
		for {
			c := p.word()
			if c == "" {
				return ins, false, errors.New("a column list with something that isn't a column name")
			}
			ins.columns = append(ins.columns, c)
			if p.expect(')') {
				break
			}
			if !p.expect(',') {
				return ins, false, errors.New("a column list that doesn't end")
			}
		}
	}
	if p.keyword("VALUES", "VALUE") == "" {
		return ins, false, errors.New("an INSERT into " + table + " without VALUES (INSERT ... SELECT can't be imported)")
	}
	for {
		if !p.expect('(') {
			return ins, false, errors.New("VALUES without a ( row")
		}
		var row []sqlLiteral
		for {
			v, err := p.literal()
			if err != nil {
				return ins, false, err
			}
			row = append(row, v)
			if p.expect(')') {
				break
			}
			if !p.expect(',') {
				return ins, false, errors.New("a row of values that doesn't end")
			}
		}
		ins.rows = append(ins.rows, row)
		if !p.expect(',') {
			break
		}
	}
	p.space()
	if !p.done() && p.peek() != ';' {
		if p.keyword("ON") != "" {
			return ins, false, errors.New("ON DUPLICATE KEY UPDATE can't be imported")
		}
		return ins, false, errors.New("something after the rows of values")
	}
	return ins, true, nil
}

// literal reads a value: a quoted string, NULL, or a bare number.
func (p *sqlScanner) literal() (sqlLiteral, error) {
	p.space()
	if c := p.peek(); c == '\'' || c == '"' {
		s, err := p.quoted(c)
		return sqlLiteral{text: s}, err
	}
	start := p.i
	for !p.done() && !strings.ContainsRune(",) \t\r\n", rune(p.s[p.i])) {
		p.i++
	}
	t := p.s[start:p.i]
	if t == "" {
		return sqlLiteral{}, errors.New("a missing value")
	}
	if strings.EqualFold(t, "NULL") {
		return sqlLiteral{null: true}, nil
	}
	return sqlLiteral{text: t}, nil
}

// quoted reads a string in quotes q, undoing its escapes: a backslash escape or a doubled quote.
func (p *sqlScanner) quoted(q byte) (string, error) {
	p.i++
	var b strings.Builder
	for !p.done() {
		c := p.s[p.i]
		switch {
		case c == '\\' && p.i+1 < len(p.s):
			p.i += 2
			switch e := p.s[p.i-1]; e {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'r':
				b.WriteByte('\r')
			case '0':
				b.WriteByte(0)
			case 'Z':
				b.WriteByte(26)
			case 'b':
				b.WriteByte('\b')
			default:
				b.WriteByte(e)
			}
		case c == q && p.i+1 < len(p.s) && p.s[p.i+1] == q:
			b.WriteByte(q)
			p.i += 2
		case c == q:
			p.i++
			return b.String(), nil
		default:
			b.WriteByte(c)
			p.i++
		}
	}
	return "", errors.New("a string that doesn't end")
}

// skipStatement moves past the next ; that isn't in a string, a name or a comment.
func (p *sqlScanner) skipStatement() error {
	for {
		p.space()
		if p.done() {
			return nil
		}
		switch c := p.s[p.i]; c {
		case ';':
			p.i++
			return nil
		case '\'', '"':
			if _, err := p.quoted(c); err != nil {
				return err
			}
		case '`':
			if p.word() == "" {
				return errors.New("a name in backticks that doesn't end")
			}
		default:
			p.i++
		}
	}
}
