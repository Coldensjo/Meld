package vmangos

import (
	"fmt"
	"strings"
)

// The rows behind the templates' rows (#975), for File › Check Map's World data group: what the gossip
// menus a template leads to and the loot lists it names refer to in turn. The server drops a gossip
// menu's text row whose text_id has no npc_text or whose script_id has no gossip_scripts, and an option
// whose action_script_id has no gossip_scripts (ObjectMgr::LoadGossipMenu, LoadGossipMenuItems; a menu
// left with no text rows is gone, its options with it); it blanks an npc_text's broadcast text that is
// gone (LoadNpcText), opens nothing of its own for an option's menu that is gone, and drops nothing
// for a loot reference with no reference_loot_template rows (LootTemplate::Process). One query for
// every menu and one for every loot list, never one a template.

// RowFault is a row reached through a template's gossip menu or loot list that names a row that is gone.
type RowFault struct {
	// Kind is the template column's kind: "gossip", or a loot kind ("creature loot", "loot"…).
	Kind string `json:"kind"`
	// Root is the id the template names: its gossip menu or loot list.
	Root int `json:"root"`
	// What is the broken link: "text" (a gossip_menu row's text_id with no npc_text), "menu script"
	// (its script_id with no gossip_scripts), "broadcast" (a BroadcastTextID of its npc_text with no
	// broadcast_text), "option menu" (a gossip option's action_menu_id with no gossip_menu), "option
	// script" (its action_script_id with no gossip_scripts) or "reference" (a loot row's reference
	// with no reference_loot_template rows).
	What string `json:"what"`
	// In is the menu or loot list holding the row: Root, a menu an option opens, or a reference list.
	In int `json:"in"`
	// Option is the gossip option's id, for "option menu" and "option script".
	Option int `json:"option"`
	// Text is the npc_text, for "broadcast", or the text row's text_id, for "menu script".
	Text int `json:"text"`
	// ID is the id that has no row.
	ID int `json:"id"`
}

// gossipFaultNames are gossipFaultsSQL's codes (its second column) by number.
var gossipFaultNames = []string{"text", "menu script", "broadcast", "option menu", "option script"}

// gossipOptionMenu is GOSSIP_OPTION_GOSSIP, the option_id whose action_menu_id is a gossip menu (a
// vendor option's names a vendor list).
const gossipOptionMenu = 1

// npcTextSlots is npc_text's BroadcastTextID0 to 7.
const npcTextSlots = 8

// literalIDs is a derived table of ids as column id (UNION drops repeats), "" for none.
func literalIDs(ids []int) string {
	list := idList(ids)
	if list == "" {
		return ""
	}
	return "SELECT " + strings.ReplaceAll(list, ",", " AS id UNION SELECT ") + " AS id"
}

// gossipFaultsSQL selects the broken links of the gossip menus roots lead to (the menus themselves
// and every menu their options open): rows of root, code (gossipFaultNames), menu, option, text, id.
func gossipFaultsSQL(roots []int) string {
	from := literalIDs(roots)
	if from == "" {
		return ""
	}
	slots := make([]string, npcTextSlots)
	cols := make([]string, npcTextSlots)
	for i := range slots {
		slots[i] = fmt.Sprintf("SELECT %d AS n", i)
		cols[i] = fmt.Sprintf("t.BroadcastTextID%d", i)
	}
	texts := "FROM menus m JOIN gossip_menu g ON g.entry = m.id"
	return fmt.Sprintf("WITH RECURSIVE menus (root, id) AS (SELECT r.id, r.id FROM (%s) r "+
		"UNION SELECT m.root, o.action_menu_id FROM gossip_menu_option o JOIN menus m ON o.menu_id = m.id WHERE o.option_id = %d AND o.action_menu_id > 0) ", from, gossipOptionMenu) +
		"SELECT m.root, 0, g.entry, -1, 0, g.text_id " + texts + " WHERE NOT EXISTS (SELECT 1 FROM npc_text t WHERE t.ID = g.text_id)" +
		" UNION ALL SELECT m.root, 1, g.entry, -1, g.text_id, g.script_id " + texts + " WHERE g.script_id > 0 AND NOT EXISTS (SELECT 1 FROM gossip_scripts s WHERE s.id = g.script_id)" +
		fmt.Sprintf(" UNION ALL SELECT x.root, 2, x.entry, -1, x.text, x.id FROM (SELECT m.root, g.entry, t.ID AS text, CAST(ELT(s.n + 1, %s) AS UNSIGNED) AS id %s JOIN npc_text t ON t.ID = g.text_id JOIN (%s) s) x "+
			"WHERE x.id > 0 AND NOT EXISTS (SELECT 1 FROM broadcast_text b WHERE b.entry = x.id)", strings.Join(cols, ", "), texts, strings.Join(slots, " UNION ALL ")) +
		fmt.Sprintf(" UNION ALL SELECT m.root, 3, o.menu_id, o.id, 0, o.action_menu_id FROM menus m JOIN gossip_menu_option o ON o.menu_id = m.id WHERE o.option_id = %d AND o.action_menu_id > 0 "+
			"AND NOT EXISTS (SELECT 1 FROM gossip_menu g WHERE g.entry = o.action_menu_id)", gossipOptionMenu) +
		" UNION ALL SELECT m.root, 4, o.menu_id, o.id, 0, o.action_script_id FROM menus m JOIN gossip_menu_option o ON o.menu_id = m.id WHERE o.action_script_id > 0 " +
		"AND NOT EXISTS (SELECT 1 FROM gossip_scripts s WHERE s.id = o.action_script_id)" +
		" ORDER BY 1, 2, 3, 4, 6"
}

// parseGossipFaults reads gossipFaultsSQL's output.
func parseGossipFaults(raw []byte) []RowFault {
	var out []RowFault
	for _, f := range batchRows(raw, 6) {
		code := f.num(1)
		if code < 0 || code >= len(gossipFaultNames) {
			continue
		}
		out = append(out, RowFault{Kind: "gossip", Root: f.num(0), What: gossipFaultNames[code], In: f.num(2), Option: f.num(3), Text: f.num(4), ID: f.num(5)})
	}
	return out
}

// lootKinds are the template kinds that name a loot list whose rows may refer to reference_loot_template.
var lootKinds = []string{"creature loot", "pickpocket loot", "skinning loot", "loot"}

// lootFaultsSQL selects the references with no reference_loot_template rows that the loot lists of
// roots (by lootKinds' kind) reach, directly or through other references: rows of kind (lootKinds'
// index), list, the list holding the reference, and the reference.
func lootFaultsSQL(roots map[string][]int) string {
	var anchors []string
	for i, kind := range lootKinds {
		list := idList(roots[kind])
		if list == "" {
			continue
		}
		table, _, _ := strings.Cut(refTargets[kind][0], ".")
		anchors = append(anchors, fmt.Sprintf("SELECT %d, entry, entry, -mincountOrRef FROM `%s` WHERE entry IN (%s) AND mincountOrRef < 0", i, table, list))
	}
	if len(anchors) == 0 {
		return ""
	}
	return "WITH RECURSIVE refs (k, root, list, ref) AS (" + strings.Join(anchors, " UNION ") +
		" UNION SELECT r.k, r.root, x.entry, -x.mincountOrRef FROM reference_loot_template x JOIN refs r ON x.entry = r.ref WHERE x.mincountOrRef < 0) " +
		"SELECT k, root, list, ref FROM refs WHERE NOT EXISTS (SELECT 1 FROM reference_loot_template t WHERE t.entry = refs.ref) ORDER BY k, root, list, ref"
}

// parseLootFaults reads lootFaultsSQL's output.
func parseLootFaults(raw []byte) []RowFault {
	var out []RowFault
	for _, f := range batchRows(raw, 4) {
		k := f.num(0)
		if k < 0 || k >= len(lootKinds) {
			continue
		}
		out = append(out, RowFault{Kind: lootKinds[k], Root: f.num(1), What: "reference", In: f.num(2), Option: -1, ID: f.num(3)})
	}
	return out
}

// rowFaults is the broken links behind the asked ids: the gossip menus' and the loot lists'.
func rowFaults(read func(table, sql string) ([]byte, error), asked map[string][]int) ([]RowFault, error) {
	out := []RowFault{}
	raw, err := read("gossip_menu", gossipFaultsSQL(asked["gossip"]))
	if err != nil {
		return out, err
	}
	out = append(out, parseGossipFaults(raw)...)
	if raw, err = read("reference_loot_template", lootFaultsSQL(asked)); err != nil {
		return out, err
	}
	return append(out, parseLootFaults(raw)...), nil
}
