package mpq

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteRoundTrip(t *testing.T) {
	big := bytes.Repeat([]byte("terrain "), 5000)
	files := []File{
		{Name: `World\Maps\Test\Test_1_2.adt`, Data: big},
		{Name: `Interface/Icons/Small.blp`, Data: []byte{1, 2, 3}},
		{Name: `empty.txt`, Data: nil},
	}
	path := filepath.Join(t.TempDir(), "patch-3.MPQ")
	if err := os.WriteFile(path, Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	for _, f := range files {
		got, err := a.ReadFile(f.Name)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		if !bytes.Equal(got, f.Data) {
			t.Fatalf("%s: got %d bytes, want %d", f.Name, len(got), len(f.Data))
		}
	}
	marker, err := a.ReadFile(MarkerName)
	if err != nil || string(marker) != MarkerText {
		t.Fatalf("marker = %q, %v", marker, err)
	}
	if a.Has(`missing\file.adt`) {
		t.Error("Has reports a file that isn't there")
	}
}

func TestWriteReplacesOwnMarker(t *testing.T) {
	files := []File{{Name: MarkerName, Data: []byte("old")}, {Name: "a.txt", Data: []byte("x")}}
	path := filepath.Join(t.TempDir(), "p.MPQ")
	if err := os.WriteFile(path, Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if got, _ := a.ReadFile(MarkerName); string(got) != MarkerText {
		t.Errorf("marker = %q", got)
	}
}
