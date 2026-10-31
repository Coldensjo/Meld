package main

import (
	"errors"
	"fmt"
	"strings"

	"Meld/internal/vmangos"
)

// worldReloads maps a save to the world database (by the binding that made it) to the `.reload`
// commands that have a running world server read what it wrote (#961), in VMaNGOS's names
// (src/game/Chat/Chat.cpp, the reload subcommands), and says what of the save only a restart takes
// ("" for nothing). entries are the template rows it wrote, where the table reloads by row: one entry
// reloads that row, none or several the whole table. One command a table, never one a row.
func worldReloads(save string, entries ...int) (cmds []string, restart string) {
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

// reloadWorld has the world server, when it runs, read again what save wrote into the world database
// (worldReloads), through its SOAP console, so the change is in the running game without a restart.
// It runs beside the save's reply (a console that doesn't answer takes seconds) and says in the
// status line what it did, or what makes the change take effect; with the server down it says
// nothing, since the server reads it all when it starts.
func (a *App) reloadWorld(save string, entries ...int) {
	cmds, restart := worldReloads(save, entries...)
	if len(cmds) == 0 && restart == "" {
		return
	}
	if externalOn() {
		// The local world server doesn't read the external database (#856).
		return
	}
	sess, err := a.gameSession()
	if err != nil || !sess.WorldRunning() {
		return
	}
	go func() {
		var err error
		if len(cmds) > 0 {
			err = vmangos.ReloadTables(sess.ServerRoot, sess.Login.Account, sess.Login.Password, cmds)
		}
		msg := reloadMessage(cmds, restart, err)
		if err != nil {
			a.logInfo(msg)
		}
		a.emit("server:reloaded", msg)
	}()
}

// reloadMessage is what the status line says once the world server was asked to reload cmds (err
// its failure), with restart what of the save it takes only at its start.
func reloadMessage(cmds []string, restart string, err error) string {
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
