package vmangos

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
)

// A creature's equipment is a creature_equip_template row: up to three items (item_template
// entries) in its main hand, off hand and ranged slot. The editor picks an item per slot and the
// spawn then uses the template with those items, made when none has them yet.

// WeaponEntry is an item a creature can hold, as the editor's gear picker lists it: its
// item_template row, and the client model and texture of its display for a thumbnail ("" when the
// display has no model).
type WeaponEntry struct {
	Entry    int    `json:"entry"`
	Name     string `json:"name"`
	Display  int    `json:"display"`
	InvType  int    `json:"invType"`
	Quality  int    `json:"quality"`
	Class    int    `json:"class"`
	Subclass int    `json:"subclass"`
	Model    string `json:"model"`
	Texture  string `json:"texture"`
}

// heldInvTypes are the inventory types a creature can hold: one-hand and two-hand weapons,
// main-hand and off-hand weapons, shields, holdables, and bows, guns and thrown weapons.
const heldInvTypes = "13,14,15,17,21,22,23,25,26"

var (
	weaponsMu    sync.Mutex
	weaponsCache = map[string][]WeaponEntry{}
)

// ListWeapons lists every item of the world database a creature can hold, with its display's model
// and texture from the client. The list is made once per server and client.
func ListWeapons(serverRoot, dataDir string) ([]WeaponEntry, error) {
	key := dataDir + "|" + serverRoot
	weaponsMu.Lock()
	defer weaponsMu.Unlock()
	if w, ok := weaponsCache[key]; ok {
		return w, nil
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, "SELECT i.entry, i.name, i.display_id, i.inventory_type, i.quality, i.class, i.subclass FROM item_template i "+
		"WHERE i.inventory_type IN ("+heldInvTypes+") AND i.patch = (SELECT MAX(patch) FROM item_template WHERE entry = i.entry) ORDER BY i.entry")
	if err != nil {
		return nil, err
	}
	var out []WeaponEntry
	for _, f := range batchRows(raw, 7) {
		entry, err1 := strconv.Atoi(f[0])
		display, err2 := strconv.Atoi(f[2])
		inv, err3 := strconv.Atoi(f[3])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		e := WeaponEntry{Entry: entry, Name: f[1], Display: display, InvType: inv}
		e.Quality, _ = strconv.Atoi(f[4])
		e.Class, _ = strconv.Atoi(f[5])
		e.Subclass, _ = strconv.Atoi(f[6])
		e.Model, e.Texture = tables.heldItemPaths(heldItem{display: uint32(display), invType: inv})
		out = append(out, e)
	}
	weaponsCache[key] = out
	return out, nil
}

// heldItemPaths is the client model and texture of a held item's display, as holdWeapons attaches
// them: weapons from the weapon folder, shields from the shield folder.
func (m *modelTables) heldItemPaths(it heldItem) (model, texture string) {
	row, ok := m.item(it.display)
	if !ok || row < 0 {
		return "", ""
	}
	dir := weaponItems
	if it.invType == invShield {
		dir = shieldItems
	}
	return itemPaths(m.itemDisplay.str(row, 1), dir, m.itemDisplay.str(row, 3))
}

// itemPaths is the client path of an item model named `name` in folder `dir` (a name that already
// has its folder is kept), and of its texture of that name in the same folder.
func itemPaths(name, dir, texture string) (model, tex string) {
	if name == "" {
		return "", ""
	}
	if texture != "" {
		tex = dir + texture + ".blp"
	}
	model = name
	if !strings.HasPrefix(strings.ToLower(name), `item\`) {
		model = dir + name
	}
	return model, tex
}

// EquipmentItems are the items of an equipment template: its likeliest row's main hand, off hand
// and ranged item entries (0 for an empty slot). An unknown template has none.
func EquipmentItems(serverRoot string, id int) ([3]int, error) {
	var items [3]int
	if id <= 0 {
		return items, nil
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return items, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT item1, item2, item3 FROM creature_equip_template WHERE entry = %d ORDER BY probability DESC LIMIT 1", id))
	if err != nil {
		return items, err
	}
	for _, f := range batchRows(raw, 3) {
		if n, ok := atoiAll(f); ok {
			copy(items[:], n)
		}
	}
	return items, nil
}

// EquipmentFor is the equipment template holding exactly these items, made as a new row after the
// highest entry when none does; 0 for no items at all. The spawn's equipment_id then names it.
func EquipmentFor(serverRoot string, items [3]int) (int, error) {
	if items == [3]int{} {
		return 0, nil
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	where := fmt.Sprintf("item1 = %d AND item2 = %d AND item3 = %d", items[0], items[1], items[2])
	find := func() (int, error) {
		raw, err := runSQL(db, "SELECT entry FROM creature_equip_template WHERE "+where+" ORDER BY probability DESC, entry LIMIT 1")
		if err != nil {
			return 0, err
		}
		// No rows is one empty line, which tsvRows gives as a one-field row.
		rows := batchRows(raw, 1)
		if len(rows) == 0 || rows[0][0] == "" {
			return 0, nil
		}
		return strconv.Atoi(rows[0][0])
	}
	if id, err := find(); err != nil || id > 0 {
		return id, err
	}
	if _, err := runSQL(db, fmt.Sprintf("INSERT INTO creature_equip_template (entry, probability, item1, item2, item3, patch_min, patch_max) "+
		"SELECT COALESCE(MAX(entry), 0) + 1, 1, %d, %d, %d, 0, 10 FROM creature_equip_template", items[0], items[1], items[2])); err != nil {
		return 0, err
	}
	id, err := find()
	if err == nil && id == 0 {
		err = fmt.Errorf("the new equipment template was not found after inserting it")
	}
	return id, err
}

// EquipmentDisplays are the display IDs of the held items of each equipment template in ids (its
// likeliest row's main hand, off hand and ranged item, 0 for an empty slot or an unknown item), for
// the pickers' icons (#707). A template the database lacks is left out.
func EquipmentDisplays(serverRoot string, ids []int) (map[int][3]int, error) {
	out := map[int][3]int{}
	if len(ids) == 0 {
		return out, nil
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	display := func(c string) string {
		return "COALESCE((SELECT display_id FROM item_template WHERE entry = e." + c + " ORDER BY patch DESC LIMIT 1), 0)"
	}
	raw, err := runSQL(db, "SELECT e.entry, "+display("item1")+", "+display("item2")+", "+display("item3")+" FROM creature_equip_template e WHERE e.entry IN ("+strings.Join(list, ",")+") ORDER BY e.entry, e.probability DESC")
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 4) {
		n, ok := atoiAll(f)
		if !ok {
			continue
		}
		if _, seen := out[n[0]]; !seen {
			out[n[0]] = [3]int{n[1], n[2], n[3]}
		}
	}
	return out, nil
}
