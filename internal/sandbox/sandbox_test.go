package sandbox

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

func write(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The copy links the archives, copies the patch, and a write of the copy's patch (as InstallPatch
// does it, a new file renamed over it) leaves the real one alone; the next Prepare drops it.
func TestPrepare(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "client", "Data")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(real, "patch.MPQ"), "base")
	write(t, filepath.Join(real, Patch), "meld")
	write(t, filepath.Join(real, "readme.txt"), "not an archive")
	root := filepath.Join(dir, "sandbox")

	data, err := Prepare(real, root)
	if err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(data, "patch.MPQ")); got != "base" {
		t.Fatalf("patch.MPQ = %q", got)
	}
	if _, err := os.Stat(filepath.Join(data, "readme.txt")); !os.IsNotExist(err) {
		t.Fatalf("readme.txt was copied: %v", err)
	}
	ri, _ := os.Stat(filepath.Join(real, "patch.MPQ"))
	di, _ := os.Stat(filepath.Join(data, "patch.MPQ"))
	if !os.SameFile(ri, di) {
		t.Fatal("patch.MPQ is not linked")
	}

	// A probe writes the copy's patch and leaves a backup beside it.
	tmp := filepath.Join(data, Patch+".tmp")
	write(t, tmp, "probe")
	if err := os.Rename(tmp, filepath.Join(data, Patch)); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(data, Patch+".before-meld"), "old")
	if got := read(t, filepath.Join(real, Patch)); got != "meld" {
		t.Fatalf("the real patch changed: %q", got)
	}

	// The real client gains an archive and loses its patch.
	write(t, filepath.Join(real, "patch-2.MPQ"), "two")
	if err := os.Remove(filepath.Join(real, Patch)); err != nil {
		t.Fatal(err)
	}
	if _, err := Prepare(real, root); err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(data, "patch-2.MPQ")); got != "two" {
		t.Fatalf("patch-2.MPQ = %q", got)
	}
	for _, gone := range []string{Patch, Patch + ".before-meld"} {
		if _, err := os.Stat(filepath.Join(data, gone)); !os.IsNotExist(err) {
			t.Fatalf("%s is still in the copy: %v", gone, err)
		}
	}

	// The patch comes back, and a refresh copies it afresh over what the probe wrote.
	write(t, filepath.Join(real, Patch), "meld again")
	if _, err := Prepare(real, root); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(data, Patch+".tmp"), "probe again")
	if err := os.Rename(filepath.Join(data, Patch+".tmp"), filepath.Join(data, Patch)); err != nil {
		t.Fatal(err)
	}
	if _, err := Prepare(real, root); err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(data, Patch)); got != "meld again" {
		t.Fatalf("the copy's patch = %q after a refresh", got)
	}
}

// A 3.3.5a client's patch-3.MPQ is Blizzard's, linked like the rest, and Meld's patch-4.MPQ is the
// one copied (#1065).
func TestPrepareWotLKPatch(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "client", "Data")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"common.MPQ", "lichking.MPQ", "patch-3.MPQ", "patch-4.MPQ"} {
		write(t, filepath.Join(real, n), n)
	}
	data, err := Prepare(real, filepath.Join(dir, "sandbox"))
	if err != nil {
		t.Fatal(err)
	}
	for n, linked := range map[string]bool{"patch-3.MPQ": true, "patch-4.MPQ": false} {
		ri, _ := os.Stat(filepath.Join(real, n))
		di, err := os.Lstat(filepath.Join(data, n))
		if err != nil {
			t.Fatal(err)
		}
		if got := os.SameFile(ri, di) || di.Mode()&os.ModeSymlink != 0; got != linked {
			t.Errorf("%s linked: %v, want %v", n, got, linked)
		}
	}
}

// A 3.3.5a client's locale folder comes along as links, so the copy has the client's tables, and a
// refresh follows the real folder: an archive it gained is linked, and what does not belong goes (#1066).
func TestPrepareWotLKLocale(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "client", "Data")
	locale := filepath.Join(real, "enUS")
	if err := os.MkdirAll(locale, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"common.MPQ", "lichking.MPQ", "patch-4.MPQ"} {
		write(t, filepath.Join(real, n), n)
	}
	for _, n := range []string{"locale-enUS.MPQ", "patch-enUS-3.MPQ"} {
		write(t, filepath.Join(locale, n), n)
	}
	write(t, filepath.Join(locale, "realmlist.wtf"), "set realmlist localhost")
	// A folder that is no locale (no locale-<name>.MPQ in it) is left out.
	if err := os.MkdirAll(filepath.Join(real, "Cache"), 0o755); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(dir, "sandbox")

	data, err := Prepare(real, root)
	if err != nil {
		t.Fatal(err)
	}
	linked := func(name string) bool {
		ri, _ := os.Stat(filepath.Join(real, name))
		di, err := os.Lstat(filepath.Join(data, name))
		if err != nil {
			t.Fatalf("%s is not in the copy: %v", name, err)
		}
		return os.SameFile(ri, di) || di.Mode()&os.ModeSymlink != 0
	}
	for _, n := range []string{"enUS/locale-enUS.MPQ", "enUS/patch-enUS-3.MPQ"} {
		if !linked(n) {
			t.Errorf("%s is not linked", n)
		}
		if got := read(t, filepath.Join(data, n)); got != filepath.Base(n) {
			t.Errorf("%s reads %q", n, got)
		}
	}
	for _, gone := range []string{"enUS/realmlist.wtf", "Cache"} {
		if _, err := os.Stat(filepath.Join(data, gone)); !os.IsNotExist(err) {
			t.Errorf("%s was copied: %v", gone, err)
		}
	}
	if linked("patch-4.MPQ") {
		t.Error("Meld's patch-4.MPQ is linked, not copied")
	}

	// A probe leaves a file in the copy's locale folder; the real one gains an archive and loses one.
	write(t, filepath.Join(data, "enUS", "left-by-a-probe.MPQ"), "probe")
	write(t, filepath.Join(locale, "patch-enUS-4.MPQ"), "four")
	if err := os.Remove(filepath.Join(locale, "patch-enUS-3.MPQ")); err != nil {
		t.Fatal(err)
	}
	if _, err := Prepare(real, root); err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(data, "enUS", "patch-enUS-4.MPQ")); got != "four" {
		t.Errorf("patch-enUS-4.MPQ = %q", got)
	}
	for _, gone := range []string{"left-by-a-probe.MPQ", "patch-enUS-3.MPQ"} {
		if _, err := os.Lstat(filepath.Join(data, "enUS", gone)); !os.IsNotExist(err) {
			t.Errorf("enUS/%s is still in the copy: %v", gone, err)
		}
	}
	if got := read(t, filepath.Join(locale, "locale-enUS.MPQ")); got != "locale-enUS.MPQ" {
		t.Errorf("the real locale archive changed: %q", got)
	}
}

// The copy of a real 3.3.5a client reads as that client does: the same build, Meld's patch-4.MPQ, and
// a table that only the locale folder's archives hold (#1066). Skipped without such a client.
func TestPrepareWotLKClient(t *testing.T) {
	real := testclient.WotLKDir(t)
	if st, err := os.Stat(filepath.Join(real, "Data")); err == nil && st.IsDir() {
		real = filepath.Join(real, "Data")
	}
	before := StampOf(filepath.Join(real, clientbuild.PatchFor(real)))
	data, err := Prepare(real, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(data)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	if set.Build() != clientbuild.WotLK || set.PatchName() != "patch-4.MPQ" {
		t.Errorf("the copy reads as %s with Meld's patch %s; want 3.3.5a and patch-4.MPQ", set.Build(), set.PatchName())
	}
	if clientbuild.Locale(data) != clientbuild.Locale(real) {
		t.Errorf("the copy's locale is %q, the client's %q", clientbuild.Locale(data), clientbuild.Locale(real))
	}
	for _, name := range []string{`DBFilesClient\Map.dbc`, `World\Maps\Northrend\Northrend.wdt`} {
		if b, err := set.ReadFile(name); err != nil || len(b) == 0 {
			t.Errorf("%s from the copy: %d bytes, %v", name, len(b), err)
		}
	}
	if after := StampOf(filepath.Join(real, clientbuild.PatchFor(real))); after != before {
		t.Errorf("the real client's patch changed: %+v, was %+v", after, before)
	}
}

func TestPrepareNoArchives(t *testing.T) {
	dir := t.TempDir()
	if _, err := Prepare(dir, filepath.Join(dir, "sandbox")); err == nil {
		t.Fatal("a folder without archives was taken")
	}
}

// A failure that goes away on its own is retried on Windows and returned at once elsewhere (#384).
func TestRetry(t *testing.T) {
	oldWait := retryWait
	retryWait = time.Millisecond
	defer func() { retryWait = oldWait }()
	calls := 0
	err := retry(func() error {
		calls++
		if calls < 3 {
			return errors.New("in use")
		}
		return nil
	})
	if runtime.GOOS == "windows" {
		if err != nil || calls != 3 {
			t.Fatalf("err %v after %d calls, want success after 3", err, calls)
		}
	} else if err == nil || calls != 1 {
		t.Fatalf("err %v after %d calls, want the first failure", err, calls)
	}
	calls = 0
	if err := retry(func() error { calls++; return os.ErrNotExist }); err == nil || calls != 1 {
		t.Fatalf("a missing file was retried %d times", calls)
	}
}
