// Package records is what follows an editor's write to the world database's records (creature, game
// object and item templates, spells) and to Meld's patch: the running world server reloading what was
// written (#961), the game's caches forgetting the old rows, and client files waiting for the game to
// close (#365, #661). The app's Save bindings and meldtool's write commands both call it, so the two
// run one code path (#1055, part B of #778); what is particular to each caller (the app's status bar
// and pending watcher, the CLI's report) comes in through Host.
//
// The writes themselves are internal/vmangos's; their dry runs are its Plan functions.
package records

import (
	"errors"
	"fmt"
	goruntime "runtime"
	"strings"

	"Meld/internal/game"
	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// Host is where a save writes and what its caller does around it.
type Host struct {
	// Server is the VMaNGOS server folder ("" for an external database, #856), Data the client's
	// Data folder (needed only by the saves that write client files).
	Server, Data string
	// GameRunning says whether the game holds Meld's patch open, so client files wait for it to
	// close. nil for never.
	GameRunning func() bool
	// Queued is told when client files were left waiting for the game to close (the app tells its
	// status bar and starts its watcher). nil for nothing.
	Queued func()
	// Changed is told after each write to the world database, so the caller has the running world
	// server reload it and the game's caches forget the old rows. nil for nothing.
	Changed func(Change)
}

// Change is one write to the world database.
type Change struct {
	// Save names the write as Reloads takes it: the app binding that makes it (SaveCreature).
	Save string `json:"save"`
	// Entries are the template rows written; Reloads reloads a single one by its row.
	Entries []int `json:"entries,omitempty"`
	// Cached is the kind whose old rows the game's caches may hold ("creature", "object" or
	// "item"), "" for none (a new template, a spell).
	Cached string `json:"cached,omitempty"`
}

func (h Host) changed(c Change) {
	if h.Changed != nil {
		h.Changed(c)
	}
}

// QueueClientFiles writes files into Meld's patch without closing anything: at once when the game
// isn't running, else they wait for it to close (vmangos.AddPending). It says where they go (the
// patch's path) and whether they wait.
func (h Host) QueueClientFiles(files []mpq.File) (patch string, waiting bool, err error) {
	if len(files) == 0 {
		return "", false, nil
	}
	if h.GameRunning != nil && h.GameRunning() {
		if err := vmangos.AddPending(h.Data, files); err != nil {
			return "", false, err
		}
		if h.Queued != nil {
			h.Queued()
		}
		return vmangos.PatchPath(h.Data), true, nil
	}
	patch, err = vmangos.InstallWithPending(h.Data, files)
	return patch, false, err
}

// GameHoldsPatch says whether the game of sess holds Meld's patch open: only Windows locks a file a
// program has open, so elsewhere it never does.
func GameHoldsPatch(sess game.Session) bool {
	return goruntime.GOOS == "windows" && sess.GameRunning()
}

// SaveCreature writes a creature template's changed values (by column) into its row of patch patch
// and returns the SQL it ran.
func SaveCreature(h Host, entry, patch int, values map[string]string) (string, error) {
	sql, err := vmangos.SaveCreature(h.Server, entry, patch, values)
	if err == nil {
		h.changed(Change{Save: "SaveCreature", Entries: []int{entry}, Cached: "creature"})
	}
	return sql, err
}

// CreateCreature adds a creature template named name, a copy of template base (or the defaults for
// 0), and returns its entry.
func CreateCreature(h Host, base int, name string) (int, error) {
	entry, err := vmangos.CreateCreature(h.Server, base, name)
	if err == nil {
		h.changed(Change{Save: "CreateCreature", Entries: []int{entry}})
	}
	return entry, err
}

// SaveObject writes a game object template's changed values (by column) into its row of patch patch
// and returns the SQL it ran.
func SaveObject(h Host, entry, patch int, values map[string]string) (string, error) {
	sql, err := vmangos.SaveObject(h.Server, entry, patch, values)
	if err == nil {
		h.changed(Change{Save: "SaveObject", Entries: []int{entry}, Cached: "object"})
	}
	return sql, err
}

// CreateObject adds a game object template named name, a copy of template base (or a generic object
// for 0), and returns its entry.
func CreateObject(h Host, base int, name string) (int, error) {
	entry, err := vmangos.CreateObject(h.Server, base, name)
	if err == nil {
		h.changed(Change{Save: "CreateObject", Entries: []int{entry}})
	}
	return entry, err
}

// SaveItem writes an item template's changed values (by column) into its row of patch patch and
// returns the SQL it ran (a refused value as a vmangos.ColumnError).
func SaveItem(h Host, entry, patch int, values map[string]string) (string, error) {
	sql, err := vmangos.SaveItem(h.Server, entry, patch, values)
	if err == nil {
		h.changed(Change{Save: "SaveItem", Entries: []int{entry}, Cached: "item"})
	}
	return sql, err
}

// CreateItem adds an item named name, a copy of item base (or a plain junk item for 0), and returns
// its entry.
func CreateItem(h Host, base int, name string) (int, error) {
	entry, err := vmangos.CreateItem(h.Server, base, name)
	if err == nil {
		h.changed(Change{Save: "CreateItem", Entries: []int{entry}})
	}
	return entry, err
}

// CreateItemOfKind adds an item named name of kind k, with the usual basics of that kind's items and
// no stats, and returns its entry.
func CreateItemOfKind(h Host, k vmangos.ItemKind, name string) (int, error) {
	entry, err := vmangos.CreateItemOfKind(h.Server, k, name)
	if err == nil {
		h.changed(Change{Save: "CreateItemOfKind", Entries: []int{entry}})
	}
	return entry, err
}

// ImportItems writes the items of an SQL script into the world database and returns their entries.
func ImportItems(h Host, script string) ([]int, error) {
	entries, err := vmangos.ImportItems(h.Server, script)
	if err == nil {
		h.changed(Change{Save: "ImportItems", Entries: entries, Cached: "item"})
	}
	return entries, err
}

// SaveSpell writes a planned spell save (vmangos.PlanSpellSave): its SQL into the world database,
// then its client files into Meld's patch, at once or once the game has closed (waiting says which).
func SaveSpell(h Host, plan vmangos.SpellSave) (waiting bool, err error) {
	if err := vmangos.SaveSpellSQL(h.Server, plan.SQL); err != nil {
		return false, err
	}
	h.changed(Change{Save: "SaveSpell"})
	_, waiting, err = h.QueueClientFiles(plan.Files)
	vmangos.ForgetSpells()
	if err != nil {
		return false, fmt.Errorf("the spell is saved in the world database, but writing it into the client's patch failed (Save again to retry): %w", err)
	}
	return waiting, nil
}

// CreateSpell writes a planned new spell (vmangos.PlanCreateSpell) as SaveSpell writes a save, and
// returns its entry: 0 when the world database refused it, the plan's when only the patch did.
func CreateSpell(h Host, plan vmangos.SpellCreate) (entry int, waiting bool, err error) {
	if err := vmangos.SaveSpellSQL(h.Server, plan.SQL); err != nil {
		return 0, false, err
	}
	h.changed(Change{Save: "CreateSpell", Entries: []int{plan.Entry}})
	_, waiting, err = h.QueueClientFiles([]mpq.File{plan.File})
	vmangos.ForgetSpells()
	if err != nil {
		return plan.Entry, false, fmt.Errorf("spell %d is made in the world database, but writing it into the client's patch failed (Save it to retry): %w", plan.Entry, err)
	}
	return plan.Entry, waiting, nil
}

// MarkStale notes in s the rows c changed that the game's caches may hold.
func MarkStale(s *game.Stale, c Change) {
	for _, e := range c.Entries {
		switch c.Cached {
		case "creature":
			s.AddCreature(uint32(e))
		case "object":
			s.AddObject(uint32(e))
		case "item":
			s.AddItem(uint32(e))
		}
	}
}

// Reload has the world server of sess, which the caller found running, read again what save wrote
// (Reloads) through its SOAP console, and gives the status line's message ("" for nothing to say)
// with the reload's failure.
func Reload(sess game.Session, save string, entries ...int) (string, error) {
	cmds, restart := Reloads(save, entries...)
	var err error
	if len(cmds) > 0 {
		err = vmangos.ReloadTables(sess.ServerRoot, sess.Login.Account, sess.Login.Password, cmds)
	}
	return ReloadMessage(cmds, restart, err), err
}

// Reloads maps a save to the world database (by the binding that made it) to the `.reload`
// commands that have a running world server read what it wrote (#961), in VMaNGOS's names
// (src/game/Chat/Chat.cpp, the reload subcommands), and says what of the save only a restart takes
// ("" for nothing). entries are the template rows it wrote, where the table reloads by row: one entry
// reloads that row, none or several the whole table. One command a table, never one a row.
func Reloads(save string, entries ...int) (cmds []string, restart string) {
	creature := templateReload("creature_template", entries)
	switch save {
	case "SaveCreature", "CreateCreature":
		return []string{creature}, ""
	case "ImportCreatures":
		return []string{creature, "npc_vendor", "creature_questrelation", "creature_involvedrelation"}, ""
	case "SaveObject", "CreateObject":
		return []string{templateReload("gameobject_template", entries)}, ""
	case "ImportObjects":
		return []string{templateReload("gameobject_template", entries), "gameobject_loot_template", "gameobject_questrelation", "gameobject_involvedrelation"}, ""
	case "SaveObjectLoot":
		return []string{"gameobject_loot_template"}, ""
	case "SavePages":
		return []string{"page_text"}, ""
	case "SaveVendor":
		return []string{"npc_vendor"}, ""
	case "SaveCreatureQuests":
		return []string{"creature_questrelation", "creature_involvedrelation"}, ""
	case "SaveObjectQuests":
		return []string{"gameobject_questrelation", "gameobject_involvedrelation"}, ""
	case "SaveQuest", "CreateQuest":
		return []string{"quest_template"}, ""
	case "ImportQuests":
		return []string{"quest_template", "creature_questrelation", "creature_involvedrelation", "gameobject_questrelation", "gameobject_involvedrelation"}, ""
	case "DeleteQuest":
		// The relations go with the quest; the server marks a quest it no longer reads inactive.
		return []string{"quest_template", "creature_questrelation", "creature_involvedrelation", "gameobject_questrelation", "gameobject_involvedrelation"}, ""
	case "SaveQuestGivers":
		cmds = []string{"creature_questrelation", "creature_involvedrelation", "gameobject_questrelation", "gameobject_involvedrelation"}
		if len(entries) > 0 {
			// The creatures given the Quest giver flag.
			cmds = append(cmds, creature)
		}
		return cmds, ""
	case "SaveGossipOptions", "DeleteConditionText":
		// Either may copy a shared menu first, which the creature's gossip_menu_id then names.
		return []string{"gossip_menu_option", "gossip_menu", creature}, ""
	case "SaveGreeting", "SaveConditionText", "SaveAILine":
		// A changed text is a new broadcast_text row, which VMaNGOS has no reload for: npc_text and
		// the AI's scripts reloaded now would name a text the server doesn't have, and say nothing.
		return nil, "the new text (broadcast_text, which it reads only when it starts)"
	case "SaveCreatureSpells":
		return []string{"creature_spells", creature}, ""
	case "SaveItem", "CreateItem", "CreateItemOfKind", "ImportItems":
		return []string{"item_template"}, ""
	case "DeleteItem":
		// item_template itself is not reloaded: the server drops its item prototypes and reads them
		// again, which a deleted item still carried by a character would be left without.
		cmds = []string{"npc_vendor", "quest_template"}
		for _, t := range []string{"creature", "gameobject", "item", "pickpocketing", "skinning", "fishing", "disenchant", "mail", "reference"} {
			cmds = append(cmds, t+"_loot_template")
		}
		return cmds, "the item itself, which it keeps until it restarts"
	case "SaveWeather":
		return []string{"game_weather"}, ""
	case "SaveGraveyards":
		// The places (WorldSafeLocs.dbc) and facings are read only at the start: SaveGraveyards'
		// result says so when they changed.
		return []string{"game_graveyard_zone"}, ""
	case "SaveSpell", "CreateSpell", "ImportSpells":
		return []string{"spell_template"}, ""
	}
	return nil, ""
}

// templateReload is the reload command of a template table that reloads by row: the row's entry when
// there is one, else the whole table.
func templateReload(table string, entries []int) string {
	if len(entries) == 1 {
		return fmt.Sprintf("%s %d", table, entries[0])
	}
	return table
}

// ReloadMessage is what the status line says once the world server was asked to reload cmds (err
// its failure), with restart what of the save it takes only at its start.
func ReloadMessage(cmds []string, restart string, err error) string {
	names := make([]string, len(cmds))
	for i, c := range cmds {
		names[i], _, _ = strings.Cut(c, " ")
	}
	tables := strings.Join(names, ", ")
	var msg string
	switch {
	case len(cmds) == 0:
	case err == nil:
		msg = "Saved and reloaded on the server (" + tables + "): the running game has it now."
	case errors.Is(err, vmangos.ErrSoapOff):
		msg = "The world server runs with its SOAP console off (SOAP.Enabled in mangosd.conf), so Meld couldn't reload " + tables + ": restart the server, or type .reload <table> for each in the game as a GM."
	default:
		msg = "The world server didn't reload " + tables + " (" + err.Error() + "): restart it, or type .reload <table> for each in the game as a GM."
	}
	if restart != "" {
		if msg != "" {
			msg += " "
		}
		msg += "Restart the world server for " + restart + "."
	}
	return msg
}
