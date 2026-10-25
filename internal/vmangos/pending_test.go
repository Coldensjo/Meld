package vmangos

import (
	"errors"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestPendingFiles(t *testing.T) {
	dir := t.TempDir()
	old := pendingRoot
	pendingRoot = func() string { return dir }
	defer func() { pendingRoot = old }()
	const data = `C:\WoW\client\Data`

	if got, err := PendingFiles(data); err != nil || len(got) != 0 {
		t.Fatalf("none yet: %v %v", got, err)
	}
	first := []mpq.File{{Name: SpellPath, Data: []byte("one")}, {Name: SpellIconPath, Data: []byte("icons")}}
	if err := AddPending(data, first); err != nil {
		t.Fatal(err)
	}
	// A later save replaces the file of its name; the name keeps its case.
	if err := AddPending(data, []mpq.File{{Name: SpellPath, Data: []byte("two")}}); err != nil {
		t.Fatal(err)
	}
	got, err := PendingFiles(data)
	if err != nil || len(got) != 2 || got[0].Name != SpellPath || string(got[0].Data) != "two" || string(got[1].Data) != "icons" {
		t.Fatalf("waiting: %+v %v", got, err)
	}
	if b, ok := pendingFile(data, strings.ToUpper(SpellPath)); !ok || string(b) != "two" {
		t.Fatalf("read back: %q %v", b, ok)
	}
	// Another client's folder has its own.
	if other, _ := PendingFiles(`D:\Other\Data`); len(other) != 0 {
		t.Fatalf("another client sees %d", len(other))
	}
	// A file given with the patch write replaces a waiting one of its name.
	all := WithPending(got, []mpq.File{{Name: strings.ToLower(SpellPath), Data: []byte("three")}, {Name: "x", Data: nil}})
	if len(all) != 3 || all[0].Name != SpellIconPath || string(all[1].Data) != "three" {
		t.Fatalf("with pending: %+v", all)
	}
	// Clearing drops only what was written: a file saved again meanwhile waits on.
	written := got
	if err := AddPending(data, []mpq.File{{Name: SpellPath, Data: []byte("four")}}); err != nil {
		t.Fatal(err)
	}
	if err := ClearPending(data, written); err != nil {
		t.Fatal(err)
	}
	left, _ := PendingFiles(data)
	if len(left) != 1 || string(left[0].Data) != "four" {
		t.Fatalf("left: %+v", left)
	}
	if err := ClearPending(data, left); err != nil {
		t.Fatal(err)
	}
	if left, _ := PendingFiles(data); len(left) != 0 {
		t.Fatalf("left after all written: %+v", left)
	}
}

func TestReloadSpells(t *testing.T) {
	old := soapCommand
	defer func() { soapCommand = old }()
	var sent string
	soapCommand = func(c soapConsole, account, password, command string) (string, error) {
		sent = account + ":" + command
		return "", nil
	}
	if err := ReloadSpells(soapServer(t, "SOAP.Enabled = 0\n"), "1", "1"); !errors.Is(err, ErrSoapOff) || sent != "" {
		t.Fatalf("console off: %v, sent %q", err, sent)
	}
	if err := ReloadSpells(soapServer(t, "SOAP.Enabled = 1\n"), "1", "1"); err != nil || sent != "1:reload spell_template" {
		t.Fatalf("console on: %v, sent %q", err, sent)
	}
}

// TestPendingSpellLive queues the Spell.dbc a new spell would write, as a save does while the game
// runs, and reads the spell back through the editor's own reads (search and refs): the waiting file
// comes before the archives. Nothing is written to the client or the database. It needs WOW_DIR and
// VMANGOS_DIR.
func TestPendingSpellLive(t *testing.T) {
	dir, server := testclient.DataDir(t), testclient.ServerDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	old := pendingRoot
	tmp := t.TempDir()
	pendingRoot = func() string { return tmp }
	defer func() { pendingRoot = old; ForgetSpells() }()
	made, err := PlanCreateSpell(server, dataDir, 0, "bolt", "Meld Waiting Bolt")
	if err != nil {
		t.Fatal(err)
	}
	if err := AddPending(dataDir, []mpq.File{made.File}); err != nil {
		t.Fatal(err)
	}
	ForgetSpells()
	refs, err := SpellRefs(dataDir, []int{made.Entry})
	if err != nil || refs[made.Entry].Name != "Meld Waiting Bolt" || !strings.Contains(refs[made.Entry].Text, "10 to 20 Fire damage") {
		t.Fatalf("refs %+v %v", refs, err)
	}
	found, _ := SearchSpells(dataDir, "Meld Waiting Bolt", 5)
	if len(found) != 1 || found[0].ID != made.Entry {
		t.Fatalf("search %+v", found)
	}
}

// The set of waiting names (#485) answers without the disk: AnyPending and pendingFile follow
// AddPending, ClearPending and DropPending, and a file nothing was added for is not looked up.
func TestPendingSet(t *testing.T) {
	dir := t.TempDir()
	old := pendingRoot
	pendingRoot = func() string { return dir }
	defer func() { pendingRoot = old }()
	const data = `C:\WoW\client\Data`

	if AnyPending() {
		t.Fatal("nothing waits yet")
	}
	f := mpq.File{Name: `Interface\Icons\Mine.blp`, Data: []byte("x")}
	if err := AddPending(data, []mpq.File{f}); err != nil {
		t.Fatal(err)
	}
	if !AnyPending() {
		t.Fatal("one waits")
	}
	if _, ok := pendingFile(data, `Interface\Icons\Other.blp`); ok {
		t.Fatal("another name found")
	}
	if b, ok := pendingFile(data, f.Name); !ok || string(b) != "x" {
		t.Fatalf("read back: %q %v", b, ok)
	}
	// A fresh load from disk (as after a restart) sees the same.
	pendingSet.dirs = nil
	if !AnyPending() {
		t.Fatal("not found after reload")
	}
	if err := ClearPending(data, []mpq.File{f}); err != nil {
		t.Fatal(err)
	}
	if AnyPending() {
		t.Fatal("cleared, still waiting")
	}
	_ = AddPending(data, []mpq.File{f})
	_ = DropPending(data)
	if _, ok := pendingFile(data, f.Name); ok || AnyPending() {
		t.Fatal("dropped, still waiting")
	}
}
