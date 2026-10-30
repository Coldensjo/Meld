package main

import (
	"errors"
	"fmt"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// SearchCreatures lists up to 100 creature templates of the world database whose name has text
// in it (or whose entry it is), for placing new creatures.
func (a *App) SearchCreatures(text string) ([]vmangos.CreatureTemplate, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchCreatures(server, text, 100)
}

// ListCreatureTemplates lists every creature template of the world database, dressed for a thumbnail.
func (a *App) ListCreatureTemplates() ([]vmangos.CreatureTemplate, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListCreatureTemplates(server, dataDir)
}

// ListObjectTemplates lists every game object template of the world database with its model.
func (a *App) ListObjectTemplates() ([]vmangos.ObjectTemplate, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListObjectTemplates(server, dataDir)
}

// ReadObject reads a game object template's row (its newest patch) for the game object editor.
func (a *App) ReadObject(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadObject(server, entry)
}

// SaveObject writes a game object template's changed values (by column) into the world database
// and returns the SQL it ran.
func (a *App) SaveObject(entry, patch int, values map[string]string) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.SaveObject(server, entry, patch, values)
	if err == nil {
		a.stale.AddObject(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// CreateObject adds a game object template named name, a copy of template base (or a generic
// object for 0), and returns its entry.
func (a *App) CreateObject(base int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateObject(server, base, name)
}

// ReadObjectLoot reads what game object template entry holds when its loot list is loot: the rows,
// the other objects holding the same list and entry's spawn count, for the Contents tab.
func (a *App) ReadObjectLoot(entry, loot int) (vmangos.ObjectLoot, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.ObjectLoot{}, err
	}
	return vmangos.ReadObjectLoot(server, entry, loot)
}

// SaveObjectLoot replaces game object loot list loot's rows with items and returns the SQL it ran.
func (a *App) SaveObjectLoot(loot int, items []vmangos.LootItem) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveObjectLoot(server, loot, items)
}

// NextObjectLoot is the first loot id no game object uses yet.
func (a *App) NextObjectLoot() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextObjectLoot(server)
}

// ReadObjectPages reads what game object template entry says when its first page is first: the
// pages, what else reads them and the object's spawn count, for the Text tab (#139).
func (a *App) ReadObjectPages(entry, first int) (vmangos.ObjectPages, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.ObjectPages{}, err
	}
	return vmangos.ReadObjectPages(server, entry, first)
}

// SavePages writes texts as the pages of the text starting at page first and returns the SQL it
// ran. The game's page cache forgets the pages it rewrote.
func (a *App) SavePages(first int, texts []string) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	saved, err := vmangos.SavePages(server, first, texts)
	if err != nil {
		return "", err
	}
	if len(saved.Changed) > 0 {
		for _, p := range saved.Changed {
			a.stale.AddPage(uint32(p))
		}
		a.forgetStale()
	}
	return saved.SQL, nil
}

// NextPage is the first page_text entry nothing uses yet.
func (a *App) NextPage() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextPage(server)
}

// ObjectModel is the client model a game object display shows ("" for none), for a spawn whose
// template's display changed.
func (a *App) ObjectModel(display int) (string, error) {
	_, dataDir, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	return vmangos.ObjectModel(dataDir, display)
}

// ReadCreature reads a creature template's row (its newest patch) for the creature editor.
func (a *App) ReadCreature(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadCreature(server, entry)
}

// SaveCreature writes a creature template's changed values (by column) into the world database
// and returns the SQL it ran.
func (a *App) SaveCreature(entry, patch int, values map[string]string) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.SaveCreature(server, entry, patch, values)
	if err == nil {
		a.stale.AddCreature(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// forgetStale takes the saved templates out of the game's caches now when the game is closed, so a
// game started outside Meld asks the server for them too. With the game open it waits: the game
// writes its caches as it exits, and the next start from Meld clears them (game.Session.Start).
func (a *App) forgetStale() {
	sess, err := a.gameSession()
	if err != nil || sess.GameRunning() {
		return
	}
	if err := sess.ForgetStale(); err != nil {
		a.logWarning("The game's cache of changed templates wasn't cleared: " + err.Error())
	}
}

// ReadVendor reads what a creature template sells (npc_vendor), for the creature editor's Shop tab.
func (a *App) ReadVendor(entry int) (vmangos.Vendor, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.Vendor{}, err
	}
	return vmangos.ReadVendor(server, entry)
}

// SaveVendor replaces what a creature template sells with items, in order, and returns the SQL it ran.
func (a *App) SaveVendor(entry int, items []vmangos.VendorItem) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveVendor(server, entry, items)
}

// ReadCreatureQuests reads the quests a creature template starts and ends, for the creature editor's Quests tab.
func (a *App) ReadCreatureQuests(entry int) (vmangos.QuestLists, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestLists{}, err
	}
	return vmangos.ReadCreatureQuests(server, entry)
}

// SaveCreatureQuests replaces the quests a creature template starts and ends, and returns the SQL it ran.
func (a *App) SaveCreatureQuests(entry int, quests vmangos.QuestLists) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveCreatureQuests(server, entry, quests)
}

// ReadObjectQuests reads the quests a game object template starts and ends, for the game object
// editor's Quests tab.
func (a *App) ReadObjectQuests(entry int) (vmangos.QuestLists, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestLists{}, err
	}
	return vmangos.ReadObjectQuests(server, entry)
}

// SaveObjectQuests replaces the quests a game object template starts and ends, and returns the SQL
// it ran. An object that is not of the quest giver type is refused new quests.
func (a *App) SaveObjectQuests(entry int, quests vmangos.QuestLists) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveObjectQuests(server, entry, quests)
}

// SearchQuests lists up to 100 quests whose title has text in it (or whose entry it is).
func (a *App) SearchQuests(text string) ([]vmangos.QuestRef, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchQuests(server, text, 100)
}

// ReadQuest reads a quest's quest_template row (its newest patch) for the quest editor (#259).
func (a *App) ReadQuest(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadQuest(server, entry)
}

// TemplateSaved is what a template's Save did: the SQL it ran, or the value it refused (Refused, with
// a nil error), whose column the editor opens the tab of (#597).
type TemplateSaved struct {
	SQL     string               `json:"sql"`
	Refused *vmangos.ColumnError `json:"refused,omitempty"`
}

// templateSaved is the result of a Save that ran sql or failed with err: a refused value goes in
// Refused, any other failure stays the error.
func templateSaved(sql string, err error) (TemplateSaved, error) {
	if r := vmangos.Refused(err); r != nil {
		return TemplateSaved{Refused: r}, nil
	}
	if err != nil {
		return TemplateSaved{}, err
	}
	return TemplateSaved{SQL: sql}, nil
}

// SaveQuest writes a quest's changed values (by column) into the world database once they pass the
// server's rules and what they name exists, and returns the SQL it ran, or the value it refused.
func (a *App) SaveQuest(entry, patch int, values map[string]string) (TemplateSaved, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return TemplateSaved{}, err
	}
	sql, err := vmangos.SaveQuest(server, dataDir, entry, patch, values)
	if err == nil {
		a.stale.AddQuest(uint32(entry))
		a.forgetStale()
	}
	return templateSaved(sql, err)
}

// CreateQuest adds a quest titled title, a copy of quest base (or a blank level 1 quest for 0), and
// returns its entry.
func (a *App) CreateQuest(base int, title string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateQuest(server, base, title)
}

// PlanQuestDelete lists what deleting quest entry removes and leaves dangling, changing nothing.
func (a *App) PlanQuestDelete(entry int) (vmangos.QuestDeletePlan, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestDeletePlan{}, err
	}
	return vmangos.PlanQuestDelete(server, entry)
}

// DeleteQuest removes quest entry and its relation, script and translation rows, and returns the SQL.
func (a *App) DeleteQuest(entry int) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.DeleteQuest(server, entry)
	if err == nil {
		a.stale.AddQuest(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// ReadQuestGivers reads the creatures and game objects that start and end a quest.
func (a *App) ReadQuestGivers(entry int) (vmangos.QuestGivers, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestGivers{}, err
	}
	return vmangos.ReadQuestGivers(server, entry)
}

// SaveQuestGivers replaces the creatures and game objects that start and end a quest, gives the
// creatures in flag the Quest giver flag, and returns the SQL it ran.
func (a *App) SaveQuestGivers(entry int, givers vmangos.QuestGivers, flag []int) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveQuestGivers(server, entry, givers, flag)
}

// TemplateNames names item, creature, object or quest templates (kind) by entry, for the quest
// editor's references.
func (a *App) TemplateNames(kind string, ids []int) (map[int]vmangos.NamedRef, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.TemplateNames(server, kind, ids)
}

// ObjectTables lists the client's tables the game object editor names data columns from (locks,
// languages, page materials, spell focuses, cinematics, flight paths, auction houses).
func (a *App) ObjectTables() (vmangos.ObjectTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ObjectTables{}, err
	}
	return vmangos.LoadObjectTables(dataDir)
}

// ItemTables lists the client's tables the item editor names columns from (item sets, spell cooldown
// categories, maps).
func (a *App) ItemTables() (vmangos.ItemTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ItemTables{}, err
	}
	return vmangos.LoadItemTables(dataDir)
}

// WorldRefNames names world database rows by number: gossip menus, pages, texts, event scripts or
// loot (kind), for the game object editor's data columns, an item's random enchantments
// ("enchantment", named from the client's ItemRandomProperties) or disenchant loot, and the
// creature editor's lists (vendor, trainer, equipment, loot and spell lists, gossip scripts, map
// points) and conditions ("condition", by what they test).
func (a *App) WorldRefNames(kind string, ids []int) (map[int]string, error) {
	if kind == "enchantment" || kind == "condition" {
		server, dataDir, err := a.serverAndData()
		if err != nil {
			return nil, err
		}
		if kind == "condition" {
			return vmangos.ConditionNames(server, dataDir, ids)
		}
		return vmangos.ItemEnchantmentNames(server, dataDir, ids)
	}
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.WorldRefNames(server, kind, ids)
}

// SearchWorldRefs lists the world database rows of kind (as WorldRefNames) numbered text or whose
// text has it.
func (a *App) SearchWorldRefs(kind, text string) ([]vmangos.NamedID, error) {
	if kind == "enchantment" || kind == "condition" {
		server, dataDir, err := a.serverAndData()
		if err != nil {
			return nil, err
		}
		if kind == "condition" {
			return vmangos.SearchConditions(server, dataDir, text, 60)
		}
		return vmangos.SearchItemEnchantments(server, dataDir, text, 60)
	}
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchWorldRefs(server, kind, text, 60)
}

// QuestTables lists the client's quest sorts, skills and reputation factions, for the quest editor.
func (a *App) QuestTables() (vmangos.QuestTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.QuestTables{}, err
	}
	return vmangos.LoadQuestTables(dataDir)
}

// ReadGossip reads what a creature template says when talked to (its gossip menu), for the Messages tab.
func (a *App) ReadGossip(entry int) (vmangos.Gossip, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.Gossip{}, err
	}
	return vmangos.ReadGossip(server, entry)
}

// SaveGreeting sets what a creature template says when talked to, for a man and a woman player
// (an empty female text uses the male one), and returns its gossip menu now.
func (a *App) SaveGreeting(entry int, male, female string) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.SaveGreeting(server, entry, male, female)
}

// SaveConditionText sets a text a creature template's gossip menu shows under a condition: the row
// showing npc_text textID (0 for a new row) now shows male and female when condition cond holds.
func (a *App) SaveConditionText(entry, textID, cond int, male, female string) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.SaveConditionText(server, entry, textID, cond, male, female)
}

// DeleteConditionText removes the conditioned text row showing npc_text textID from a creature
// template's gossip menu.
func (a *App) DeleteConditionText(entry, textID int) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.DeleteConditionText(server, entry, textID)
}

// SaveAILine sets what one talk line of a creature template's AI says (the Messages tab's "What it
// says on its own", #160): the line event eventID's script scriptID says with broadcast text textID
// now says text. Only this creature's event changes; a shared script is copied first.
func (a *App) SaveAILine(entry, eventID, scriptID, textID int, text string) (vmangos.AILineSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.AILineSaved{}, err
	}
	return vmangos.SaveAILine(server, entry, eventID, scriptID, textID, text)
}

// SaveGossipOptions replaces the options (the lines a player can pick) of a creature template's
// gossip menu, and returns its gossip menu now.
func (a *App) SaveGossipOptions(entry int, options []vmangos.GossipOption) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.SaveGossipOptions(server, entry, options)
}

// Factions lists the client's faction templates with their names and how each treats an Alliance
// and a Horde player, for the creature guide.
func (a *App) Factions() ([]vmangos.FactionInfo, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.Factions(dataDir)
}

// ClassLevelStats reads what the server gives a creature of a unit class at each level from from to
// to (creature_classlevelstats), for the creature guide's stats step.
func (a *App) ClassLevelStats(class, from, to int) ([]vmangos.ClassLevelStats, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadClassLevelStats(server, class, from, to)
}

// ZoneSounds names the client's zone music, intro music, ambience and sound preference rows, each
// with a file to play, for the zone editor (#31).
func (a *App) ZoneSounds() (vmangos.ZoneSoundTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ZoneSoundTables{}, err
	}
	return vmangos.ZoneSounds(dataDir)
}

// SoundEntries lists the client's SoundEntries.dbc rows, each with a file to play, for the game
// object editor's sound picker (#674).
func (a *App) SoundEntries() ([]vmangos.SoundOption, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SoundEntryList(dataDir)
}

// ObjectDisplaySounds reads a game object display's ten sound slots (#674), as the game will have
// them once the files waiting for it to close are written.
func (a *App) ObjectDisplaySounds(display int) (vmangos.ObjectDisplaySounds, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ObjectDisplaySounds{}, err
	}
	return vmangos.ReadObjectDisplaySounds(dataDir, uint32(display))
}

// SoundsSaved is what SaveObjectDisplaySounds did: whether it changed anything, and whether the
// patch waits for the game to close.
type SoundsSaved struct {
	Changed bool `json:"changed"`
	Waiting bool `json:"waiting"`
}

// SaveObjectDisplaySounds sets a game object display's ten sound slots in the client's
// GameObjectDisplayInfo.dbc, in Meld's patch without closing anything (#661): at once, or once the
// game has closed. Every object of that display plays them from the game's next start.
func (a *App) SaveObjectDisplaySounds(display int, sounds []int) (SoundsSaved, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return SoundsSaved{}, err
	}
	ids := make([]uint32, len(sounds))
	for i, s := range sounds {
		if s < 0 {
			return SoundsSaved{}, fmt.Errorf("sound slot %d: %d is not a sound", i, s)
		}
		ids[i] = uint32(s)
	}
	files, err := vmangos.ObjectSoundFiles(dataDir, uint32(display), ids)
	if err != nil || len(files) == 0 {
		return SoundsSaved{}, err
	}
	_, waiting, err := a.queueClientFiles(dataDir, files)
	return SoundsSaved{Changed: err == nil, Waiting: waiting}, err
}

// OwnDisplay is what OwnObjectDisplay made: the new display, whether the client's row waits for the
// game to close, whether the server's copy of the table has it, and whether the world server runs
// (it reads the table at its start).
type OwnDisplay struct {
	Display int  `json:"display"`
	Waiting bool `json:"waiting"`
	Server  bool `json:"server"`
	Restart bool `json:"restart"`
}

// errExternalDisplay is OwnObjectDisplay's errExternal: the external server's copy of the table is out of reach.
var errExternalDisplay = errors.New("a display of its own goes into the server folder's data, which is off while Meld is connected to an external database (File › Disconnect External Database)")

// OwnObjectDisplay copies game object display display to a new one (#723), so one object's sounds
// can change without every object of that display: the new GameObjectDisplayInfo.dbc row goes into
// Meld's patch (at once, or once the game has closed) and, with a server folder set, into the
// server's copy of the table, which it checks a template's display against. The template is not
// changed: the game object editor points it at the new display, saved with Save object.
func (a *App) OwnObjectDisplay(display int) (OwnDisplay, error) {
	if externalOn() {
		return OwnDisplay{}, errExternalDisplay
	}
	if display <= 0 {
		return OwnDisplay{}, fmt.Errorf("%d is not a game object display", display)
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return OwnDisplay{}, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if a.sandboxed() {
		// The probes' throwaway client: the server's tables are the real ones, so they are left alone.
		server = ""
	}
	made, err := vmangos.CopyObjectDisplay(dataDir, server, uint32(display))
	if err != nil {
		return OwnDisplay{}, err
	}
	res := OwnDisplay{Display: int(made.Display)}
	var also func() error
	if made.Server != nil {
		also = func() error {
			if _, err := vmangos.InstallServerObjectDisplays(server, made.Server); err != nil {
				return fmt.Errorf("display %d is in the client's patch, but writing it into the server's data failed: %w", made.Display, err)
			}
			res.Server = true
			res.Restart = a.worldRunning()
			return nil
		}
	}
	_, res.Waiting, err = a.installClient(dataDir, []mpq.File{made.Client}, also)
	vmangos.ForgetObjectDisplays()
	return res, err
}

// CreateCreature adds a creature template named name, a copy of template base (or the defaults
// for 0), and returns its entry.
func (a *App) CreateCreature(base int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateCreature(server, base, name)
}

// ListDisplays lists every creature display, dressed, with the creatures that use it, for the
// creature editor's display picker. The world database is optional: without it the displays come
// without their creatures.
func (a *App) ListDisplays() ([]vmangos.DisplayEntry, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListDisplays(server, dataDir)
}

// ListObjectDisplays lists every game object display with a model and the objects that use it, for
// the game object editor's display picker. The world database is optional, as for ListDisplays.
func (a *App) ListObjectDisplays() ([]vmangos.DisplayEntry, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListObjectDisplays(server, dataDir)
}
