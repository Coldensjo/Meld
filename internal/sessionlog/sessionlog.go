// Package sessionlog keeps each session's status lines in a file in the user cache, so a bug report
// can be traced after Meld has closed (the Log window holds them in memory only).
//
// A session writes <dir>/<session>.log, one line a message, and Open removes all but the newest
// Keep files, so the folder stays small.
package sessionlog

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Keep is how many sessions' logs stay in the folder, this one included.
const Keep = 10

// Log is one session's log file.
type Log struct {
	Path string
	mu   sync.Mutex
}

// Open makes the folder, prunes the older logs and starts this session's file.
func Open(dir string) (*Log, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	prune(dir, Keep-1)
	name := time.Now().Format("20060102-150405") + ".log"
	p := filepath.Join(dir, name)
	for i := 2; ; i++ {
		if _, err := os.Stat(p); err != nil {
			break
		}
		p = filepath.Join(dir, strings.TrimSuffix(name, ".log")+"-"+string(rune('0'+i%10))+".log")
		if i > 9 {
			break
		}
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	_ = f.Close()
	return &Log{Path: p}, nil
}

// prune removes the oldest logs until keep remain. File names sort by start time.
func prune(dir string, keep int) {
	names, err := filepath.Glob(filepath.Join(dir, "*.log"))
	if err != nil || len(names) <= keep {
		return
	}
	sort.Strings(names)
	for _, n := range names[:len(names)-keep] {
		_ = os.Remove(n)
	}
}

// Append writes lines (each without a newline) to the file.
func (l *Log) Append(lines []string) error {
	if len(lines) == 0 {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.OpenFile(l.Path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	var b strings.Builder
	for _, s := range lines {
		b.WriteString(strings.NewReplacer("\r", " ", "\n", " ").Replace(s))
		b.WriteByte('\n')
	}
	_, err = f.WriteString(b.String())
	return err
}

// Read gives the file's text.
func (l *Log) Read() (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, err := os.ReadFile(l.Path)
	return string(b), err
}
