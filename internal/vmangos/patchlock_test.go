package vmangos

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"Meld/internal/mpq"
)

// TestLockFileWaits takes a patch's lock file twice in one process: the second take waits until the
// first lets go (Windows locks per handle, flock per open file).
func TestLockFileWaits(t *testing.T) {
	path := filepath.Join(t.TempDir(), PatchName+LockSuffix)
	first, err := lockFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan error, 1)
	go func() {
		second, err := lockFile(path)
		if err == nil {
			second.unlock()
		}
		got <- err
	}()
	select {
	case err := <-got:
		t.Fatalf("the second lock didn't wait for the first: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	first.unlock()
	select {
	case err := <-got:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the second lock never came")
	}
}

// Environment of patchWriterChild, the test binary run again as one of several processes writing the
// same patch.
const (
	childData  = "MELD_TEST_PATCH_DATA"
	childCache = "MELD_TEST_PATCH_CACHE"
	childID    = "MELD_TEST_PATCH_ID"
)

const childWrites = 6

// childTile is the tile writer id writes in its write n.
func childTile(id, n int) string {
	return fmt.Sprintf(`World\Maps\Azeroth\Azeroth_%d_%d.adt`, 30+id, 40+n)
}

// childWaiting is the file writer id leaves waiting before its write n.
func childWaiting(id, n int) string {
	return fmt.Sprintf(`Interface\Icons\Meld_%d_%d.blp`, id, n)
}

// TestPatchWriterChild is one writer of TestPatchWritesAcrossProcesses: it does nothing unless that
// test started it. Each write leaves a file waiting first, as meldtool does while the game runs, and
// then writes a tile with the waiting files taken along, as a save and the app's watcher do.
func TestPatchWriterChild(t *testing.T) {
	data := os.Getenv(childData)
	if data == "" {
		t.Skip("run by TestPatchWritesAcrossProcesses")
	}
	cache := os.Getenv(childCache)
	pendingRoot = func() string { return cache }
	id, err := strconv.Atoi(os.Getenv(childID))
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < childWrites; n++ {
		if err := AddPending(data, []mpq.File{{Name: childWaiting(id, n), Data: []byte{byte(id), byte(n)}}}); err != nil {
			t.Fatal(err)
		}
		if _, err := InstallWithPending(data, []mpq.File{{Name: childTile(id, n), Data: []byte{byte(id), byte(n)}}}); err != nil {
			t.Fatal(err)
		}
	}
}

// TestPatchWritesAcrossProcesses runs several processes writing the same client's patch and waiting
// files at once, as meldtool's record writes and the app can (#1079): patchMu is per process, so only
// the patch's lock file keeps one from renaming its patch over another's and dropping its files, or
// clearing a waiting file another just saved.
func TestPatchWritesAcrossProcesses(t *testing.T) {
	data, cache := t.TempDir(), t.TempDir()
	const writers = 4
	cmds := make([]*exec.Cmd, writers)
	for id := range cmds {
		cmd := exec.Command(os.Args[0], "-test.run=^TestPatchWriterChild$", "-test.count=1")
		cmd.Env = append(os.Environ(), childData+"="+data, childCache+"="+cache, childID+"="+strconv.Itoa(id))
		cmds[id] = cmd
	}
	outs := make(chan string, writers)
	for _, cmd := range cmds {
		go func(cmd *exec.Cmd) {
			out, err := cmd.CombinedOutput()
			if err != nil {
				outs <- fmt.Sprintf("%v\n%s", err, out)
				return
			}
			outs <- ""
		}(cmd)
	}
	for range cmds {
		if out := <-outs; out != "" {
			t.Error(out)
		}
	}
	if t.Failed() {
		return
	}
	old := pendingRoot
	pendingRoot = func() string { return cache }
	defer func() { pendingRoot = old }()
	a, err := mpq.Open(filepath.Join(data, PatchName))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for id := 0; id < writers; id++ {
		for n := 0; n < childWrites; n++ {
			for _, name := range []string{childTile(id, n), childWaiting(id, n)} {
				if b, err := a.ReadFile(name); err != nil || string(b) != string([]byte{byte(id), byte(n)}) {
					t.Errorf("%s: %q %v", name, b, err)
				}
			}
		}
	}
	if left, err := PendingFiles(data); err != nil || len(left) != 0 {
		t.Errorf("still waiting: %d %v", len(left), err)
	}
}
