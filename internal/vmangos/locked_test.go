package vmangos

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"Meld/internal/mpq"
)

func TestInUseRecognisesLockedErrors(t *testing.T) {
	if !inUse(&fs.PathError{Op: "open", Err: fs.ErrPermission}) {
		t.Error("access denied is not treated as in use")
	}
	if !inUse(&fs.PathError{Op: "open", Err: sharingViolation}) {
		t.Error("a sharing violation is not treated as in use")
	}
	if inUse(errors.New("disk full")) {
		t.Error("an unrelated error is treated as in use")
	}
}

// A read-only file stands in for one the game has open: both refuse writes.
func TestLockedPatchIsRefusedUntouched(t *testing.T) {
	if runtime.GOOS != "windows" && os.Geteuid() == 0 {
		t.Skip("root ignores file permissions, so a 0444 file does not refuse writes here")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, PatchName)
	orig := mpq.Write([]mpq.File{{Name: `keep\me.txt`, Data: []byte("original")}})
	if err := os.WriteFile(path, orig, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o444); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(path, 0o644)

	_, err := InstallPatch(dir, tileFiles)
	if err == nil {
		t.Fatal("a locked patch was replaced")
	}
	if !strings.Contains(err.Error(), "in use") || !strings.Contains(err.Error(), "Close World of Warcraft") {
		t.Fatalf("error does not say what to do: %v", err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, orig) {
		t.Fatal("the locked patch changed")
	}
	if _, err := os.Stat(path + ".tmp"); err == nil {
		t.Fatal("a temporary patch was left behind")
	}
}

func TestWriteSyncedReplacesAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.tmp")
	if err := os.WriteFile(path, []byte("old longer content"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeSynced(path, []byte("new")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != "new" {
		t.Errorf("file holds %q, want %q", b, "new")
	}
	// A path that can't be created fails and leaves nothing behind.
	bad := filepath.Join(dir, "missing", "b.tmp")
	if err := writeSynced(bad, []byte("x")); err == nil {
		t.Error("writing into a missing folder did not fail")
	}
	if _, err := os.Stat(bad); err == nil {
		t.Error("a failed write left its file")
	}
}
