package sessionlog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppendAndRead(t *testing.T) {
	l, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := l.Append([]string{"12:00:00 one", "two\nthree"}); err != nil {
		t.Fatal(err)
	}
	if err := l.Append([]string{"four"}); err != nil {
		t.Fatal(err)
	}
	got, _ := l.Read()
	if want := "12:00:00 one\ntwo three\nfour\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestOpenKeepsNewest(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"20200101-000000", "20200102-000000", "20200103-000000", "20200104-000000", "20200105-000000", "20200106-000000", "20200107-000000", "20200108-000000", "20200109-000000", "20200110-000000", "20200111-000000"} {
		os.WriteFile(filepath.Join(dir, n+".log"), nil, 0o644)
	}
	l, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	names, _ := filepath.Glob(filepath.Join(dir, "*.log"))
	if len(names) != Keep {
		t.Fatalf("%d logs, want %d", len(names), Keep)
	}
	if _, err := os.Stat(filepath.Join(dir, "20200101-000000.log")); err == nil {
		t.Fatal("oldest log kept")
	}
	if !strings.HasSuffix(l.Path, ".log") {
		t.Fatal(l.Path)
	}
}
