package vmangos

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/testclient"
)

// objectModelRecordBytes is one temp_gameobject_models record: display, name and a box from lo to hi
// on every axis.
func objectModelRecordBytes(display uint32, name string, lo, hi float32) []byte {
	b := binary.LittleEndian.AppendUint32(nil, display)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(name)))
	b = append(b, name...)
	for _, v := range []float32{lo, lo, lo, hi, hi, hi} {
		b = binary.LittleEndian.AppendUint32(b, math.Float32bits(v))
	}
	return b
}

// TestCopyObjectModel copies a display's record under a new ID at the list's end, replaces a record
// the new ID had, leaves the others as they were, and leaves a display without a record alone.
func TestCopyObjectModel(t *testing.T) {
	chest := objectModelRecordBytes(1, "Chest02.m2", -1, 1)
	tower := objectModelRecordBytes(3, "Trollwatchtower.m2", -5, 5)
	stale := objectModelRecordBytes(9, "Old.m2", 0, 2)
	list := bytes.Join([][]byte{chest, stale, tower}, nil)

	out, found, err := copyObjectModel(list, 3, 9)
	if err != nil || !found {
		t.Fatalf("copy: found %v, %v", found, err)
	}
	want := bytes.Join([][]byte{chest, tower, objectModelRecordBytes(9, "Trollwatchtower.m2", -5, 5)}, nil)
	if !bytes.Equal(out, want) {
		t.Fatalf("the list is\n%x\nnot\n%x", out, want)
	}
	recs, err := objectModelRecords(out)
	if err != nil || len(recs) != 3 || recs[2].display != 9 {
		t.Fatalf("the written list reads back as %+v, %v", recs, err)
	}

	out, found, err = copyObjectModel(list, 2, 10)
	if err != nil || found || !bytes.Equal(out, list) {
		t.Fatalf("a display without a record: found %v, changed %v, %v", found, !bytes.Equal(out, list), err)
	}
	if _, _, err := copyObjectModel(list[:len(list)-3], 3, 9); err == nil {
		t.Fatal("a cut list was read")
	}
}

// TestInstallServerObjectModel writes the copy into a server folder's vmaps and keeps the first list
// as a backup, and does nothing for a server without vmaps.
func TestInstallServerObjectModel(t *testing.T) {
	dir := t.TempDir()
	vmaps := filepath.Join(dir, "data", "vmaps")
	if err := os.MkdirAll(filepath.Join(dir, "run"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "run", "mangosd.conf"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if ok, err := InstallServerObjectModel(dir, 1, 7); ok || err != nil {
		t.Fatalf("a server without vmaps: %v, %v", ok, err)
	}
	if err := os.MkdirAll(vmaps, 0o755); err != nil {
		t.Fatal(err)
	}
	list := objectModelRecordBytes(1, "Chest02.m2", -1, 1)
	path := filepath.Join(vmaps, "temp_gameobject_models")
	if err := os.WriteFile(path, list, 0o644); err != nil {
		t.Fatal(err)
	}
	if ok, err := InstallServerObjectModel(dir, 1, 7); !ok || err != nil {
		t.Fatalf("install: %v, %v", ok, err)
	}
	if ok, err := InstallServerObjectModel(dir, 1, 8); !ok || err != nil {
		t.Fatalf("second install: %v, %v", ok, err)
	}
	got, _ := os.ReadFile(path)
	want := bytes.Join([][]byte{list, objectModelRecordBytes(7, "Chest02.m2", -1, 1), objectModelRecordBytes(8, "Chest02.m2", -1, 1)}, nil)
	if !bytes.Equal(got, want) {
		t.Fatalf("the server's list is %x", got)
	}
	if b, _ := os.ReadFile(path + BackupSuffix); !bytes.Equal(b, list) {
		t.Fatal("the backup is not the first list")
	}
}

// TestServerObjectModels reads the server's own temp_gameobject_models whole, so the record layout
// matches what its vmap extractor writes.
func TestServerObjectModels(t *testing.T) {
	list, err := os.ReadFile(serverObjectModelsPath(testclient.ServerFolder(t)))
	if err != nil {
		t.Skip(err)
	}
	recs, err := objectModelRecords(list)
	if err != nil || len(recs) == 0 {
		t.Fatalf("%d records, %v", len(recs), err)
	}
	if recs[len(recs)-1].end != len(list) {
		t.Fatal("the records stop before the list's end")
	}
}
