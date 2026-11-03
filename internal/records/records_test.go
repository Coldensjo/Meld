package records

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/game"
	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// TestWorldReloads checks the tables each editor's save has the running world server reload (#961):
// a template by its row when one was written, one command a table, and a restart for what VMaNGOS
// can't reload.
func TestWorldReloads(t *testing.T) {
	cases := []struct {
		save    string
		entries []int
		want    string
		restart bool
	}{
		{"SaveCreature", []int{7}, "creature_template 7", false},
		{"ImportCreatures", []int{7, 8}, "creature_template npc_vendor creature_questrelation creature_involvedrelation", false},
		{"SaveObject", []int{9}, "gameobject_template 9", false},
		{"ImportObjects", []int{9, 10}, "gameobject_template gameobject_loot_template gameobject_questrelation gameobject_involvedrelation", false},
		{"SaveQuest", nil, "quest_template", false},
		{"ImportQuests", []int{3, 4}, "quest_template creature_questrelation creature_involvedrelation gameobject_questrelation gameobject_involvedrelation", false},
		{"SaveQuestGivers", nil, "creature_questrelation creature_involvedrelation gameobject_questrelation gameobject_involvedrelation", false},
		{"SaveQuestGivers", []int{3, 4}, "creature_questrelation creature_involvedrelation gameobject_questrelation gameobject_involvedrelation creature_template", false},
		{"SaveItem", nil, "item_template", false},
		{"SaveObjectLoot", nil, "gameobject_loot_template", false},
		{"SaveVendor", nil, "npc_vendor", false},
		{"SaveGossipOptions", []int{5}, "gossip_menu_option gossip_menu creature_template 5", false},
		{"SaveGreeting", []int{5}, "", true},
		{"SaveSpell", nil, "spell_template", false},
		{"SaveWeather", nil, "game_weather", false},
		{"SaveGraveyards", nil, "game_graveyard_zone", false},
		{"SaveMap", nil, "", false},
	}
	for _, c := range cases {
		cmds, restart := Reloads(c.save, c.entries...)
		if got := strings.Join(cmds, " "); got != c.want || (restart != "") != c.restart {
			t.Errorf("%s %v: %q, restart %q", c.save, c.entries, got, restart)
		}
	}
	cmds, restart := Reloads("DeleteItem")
	if restart == "" || strings.Contains(strings.Join(cmds, " "), "item_template") || len(cmds) != 11 {
		t.Errorf("DeleteItem: %q, restart %q", cmds, restart)
	}
}

func TestReloadMessage(t *testing.T) {
	if m := ReloadMessage([]string{"creature_template 7"}, "", nil); !strings.Contains(m, "reloaded on the server (creature_template)") {
		t.Errorf("done: %s", m)
	}
	if m := ReloadMessage([]string{"npc_vendor"}, "", vmangos.ErrSoapOff); !strings.Contains(m, "SOAP.Enabled") || !strings.Contains(m, ".reload") {
		t.Errorf("console off: %s", m)
	}
	if m := ReloadMessage([]string{"npc_vendor"}, "", errors.New("refused")); !strings.Contains(m, "refused") {
		t.Errorf("failed: %s", m)
	}
	if m := ReloadMessage(nil, "the new text", nil); m != "Restart the world server for the new text." {
		t.Errorf("restart only: %s", m)
	}
}

// TestQueueClientFiles follows client files through a Host: with the game closed they go into Meld's
// patch at once, with it running they wait (and Queued is told), and the next write takes them along.
func TestQueueClientFiles(t *testing.T) {
	cache := t.TempDir()
	// os.UserCacheDir, where the waiting files are kept: LocalAppData on Windows, XDG_CACHE_HOME on Linux.
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	data := filepath.Join(t.TempDir(), "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, "base.MPQ"), mpq.Write([]mpq.File{{Name: "base.txt", Data: []byte("base")}}), 0o644); err != nil {
		t.Fatal(err)
	}
	running, queued := false, 0
	h := Host{Data: data, GameRunning: func() bool { return running }, Queued: func() { queued++ }}
	inPatch := func(name string) string {
		t.Helper()
		arch, err := mpq.Open(filepath.Join(data, vmangos.PatchName))
		if err != nil {
			t.Fatal(err)
		}
		defer arch.Close()
		b, _ := arch.ReadFile(name)
		return string(b)
	}

	if _, waiting, err := h.QueueClientFiles([]mpq.File{{Name: "a.txt", Data: []byte("a")}}); err != nil || waiting || inPatch("a.txt") != "a" {
		t.Fatalf("game closed: waiting %v, %v, patch has %q", waiting, err, inPatch("a.txt"))
	}
	running = true
	if _, waiting, err := h.QueueClientFiles([]mpq.File{{Name: "b.txt", Data: []byte("b")}}); err != nil || !waiting || queued != 1 || inPatch("b.txt") != "" {
		t.Fatalf("game running: waiting %v, %v, queued %d, patch has %q", waiting, err, queued, inPatch("b.txt"))
	}
	running = false
	if _, _, err := h.QueueClientFiles([]mpq.File{{Name: "c.txt", Data: []byte("c")}}); err != nil || inPatch("b.txt") != "b" || inPatch("c.txt") != "c" {
		t.Fatalf("next write: %v, patch has %q and %q", err, inPatch("b.txt"), inPatch("c.txt"))
	}
	if n, err := vmangos.PendingCount(data); err != nil || n != 0 {
		t.Fatalf("still waiting: %d, %v", n, err)
	}
}

// TestMarkStale notes a change's rows under its kind, and nothing for a new template.
func TestMarkStale(t *testing.T) {
	var s game.Stale
	MarkStale(&s, Change{Save: "CreateCreature", Entries: []int{5}})
	if !s.Empty() {
		t.Fatal("a new template marked stale")
	}
	MarkStale(&s, Change{Save: "SaveItem", Entries: []int{7}, Cached: "item"})
	if s.Empty() {
		t.Fatal("a saved item not marked stale")
	}
}
