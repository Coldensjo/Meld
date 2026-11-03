package vmangos

import (
	"os"
	"os/exec"
	"testing"
	"time"

	"Meld/internal/mpq"
)

// Environment of pendingWriterChild, the test binary run again as another process (meldtool) that
// changes the waiting files.
const (
	outsideData  = "MELD_TEST_PENDING_DATA"
	outsideCache = "MELD_TEST_PENDING_CACHE"
	outsideOp    = "MELD_TEST_PENDING_OP"
)

const outsideName = `DBFilesClient\Spell.dbc`

// TestPendingWriterChild is the other process of TestPendingSeesOtherProcess: it does nothing unless
// that test started it. Its op leaves Spell.dbc waiting with the op's data ("add:<data>"), or drops
// what waits ("drop").
func TestPendingWriterChild(t *testing.T) {
	data := os.Getenv(outsideData)
	if data == "" {
		t.Skip("run by TestPendingSeesOtherProcess")
	}
	cache := os.Getenv(outsideCache)
	pendingRoot = func() string { return cache }
	switch op := os.Getenv(outsideOp); {
	case op == "drop":
		if _, err := DropPendingFiles(data, []string{outsideName}); err != nil {
			t.Fatal(err)
		}
	case len(op) > 4 && op[:4] == "add:":
		if err := AddPending(data, []mpq.File{{Name: outsideName, Data: []byte(op[4:])}}); err != nil {
			t.Fatal(err)
		}
	default:
		t.Fatalf("op %q", op)
	}
}

// forgetting is a ClientReader that notes the files it was told to forget.
type forgetting struct{ forgot []string }

func (*forgetting) Suspend()                 {}
func (*forgetting) Resume() error            { return nil }
func (r *forgetting) Forget(paths ...string) { r.forgot = append(r.forgot, paths...) }

// TestPendingSeesOtherProcess changes the waiting files from another process after this one listed
// them, as meldtool's spell writes do while the app runs (#1080): the app's lookups see the new file,
// its replacement and its removal, the spell tables' generation moves on each time, and Meld's reader
// forgets the file, so the next spell save builds on the CLI's Spell.dbc instead of dropping its spell.
func TestPendingSeesOtherProcess(t *testing.T) {
	data, cache := t.TempDir(), t.TempDir()
	oldRoot, oldRacy := pendingRoot, pendingRacy
	pendingRoot = func() string { return cache }
	// No grace for recent times: the folder's modification time alone must tell each change.
	pendingRacy = 0
	reader := &forgetting{}
	SetClientReader(reader)
	defer func() { pendingRoot, pendingRacy = oldRoot, oldRacy; SetClientReader(nil) }()

	run := func(op string) {
		t.Helper()
		cmd := exec.Command(os.Args[0], "-test.run=^TestPendingWriterChild$", "-test.count=1")
		cmd.Env = append(os.Environ(), outsideData+"="+data, outsideCache+"="+cache, outsideOp+"="+op)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", op, err, out)
		}
	}
	forgot := func() bool {
		defer func() { reader.forgot = nil }()
		for _, p := range reader.forgot {
			if p == "dbfilesclient\\spell.dbc" {
				return true
			}
		}
		return false
	}

	if AnyPending() {
		t.Fatal("nothing waits yet")
	}
	if _, ok := pendingFile(data, outsideName); ok {
		t.Fatal("nothing waits yet")
	}
	gen := pendingGeneration(data)

	steps := []struct {
		op, want string
	}{
		{"add:one", "one"},
		// The same size as the last, so only the file's time tells the two apart.
		{"add:two", "two"},
		{"drop", ""},
	}
	for _, s := range steps {
		// Past the coarsest clock tick (Windows keeps times by its 16 ms tick).
		time.Sleep(50 * time.Millisecond)
		run(s.op)
		if got := pendingGeneration(data); got == gen {
			t.Errorf("%s: the generation stayed %d", s.op, gen)
		} else {
			gen = got
		}
		if !forgot() {
			t.Errorf("%s: the reader wasn't told to forget Spell.dbc", s.op)
		}
		b, ok := pendingFile(data, outsideName)
		if s.want == "" {
			if ok || AnyPending() {
				t.Errorf("%s: still waiting: %q", s.op, b)
			}
			continue
		}
		if !ok || string(b) != s.want {
			t.Errorf("%s: read %q %v", s.op, b, ok)
		}
		if !AnyPending() {
			t.Errorf("%s: AnyPending missed it", s.op)
		}
	}

	// This process's own write is no change from outside: the generation stays.
	time.Sleep(50 * time.Millisecond)
	if err := AddPending(data, []mpq.File{{Name: outsideName, Data: []byte("own")}}); err != nil {
		t.Fatal(err)
	}
	if got := pendingGeneration(data); got != gen {
		t.Errorf("own write moved the generation %d to %d", gen, got)
	}
}
