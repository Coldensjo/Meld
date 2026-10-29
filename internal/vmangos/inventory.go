package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// A character's equipment and bags (#874), the second part of the Characters and Accounts tool: its
// rows in the character database's character_inventory (where an item is) and item_instance (the
// item itself), as the world server's Player::_LoadInventory reads them. An item at bag 0 is on the
// character: slots 0 to 18 are its equipment, 19 to 22 its bags and 23 to 38 its backpack; an item
// in a bag has that bag item's guid as its bag. The editor names a place by container and slot
// instead: container 0 is the character, 19 to 22 the bag in that slot, so a new bag's contents can
// be placed before the bag has a guid. The bank, keyring and buyback slots are left as they are.

// Where an item can be on the character (Player.h's EquipmentSlots and InventorySlots).
const (
	invEquipEnd  = 19 // 0 to 18: the equipment
	invBagStart  = 19 // 19 to 22: the bags
	invBagEnd    = 23
	invPackEnd   = 39 // 23 to 38: the backpack
	slotMainHand = 15
	slotOffHand  = 16

	// maxEnchantSlots is the 1.12 item's enchantment slots (MAX_ENCHANTMENT_SLOT), each an id, a
	// duration and charges in item_instance.enchantments; slot 0 is the permanent one and slot 1 the
	// temporary one (an oil or a poison).
	maxEnchantSlots = 7
	// maxItemSpells is the spell charges item_instance.charges holds (MAX_ITEM_PROTO_SPELLS).
	maxItemSpells = 5
)

// equipSlotTypes are the inventory types each equipment slot takes (Player::FindEquipSlot): a chest
// takes a robe, the main hand one- and two-handed weapons, the off hand a one-handed weapon (with
// dual wield), a shield or something held, the ranged slot bows, guns, crossbows, wands and thrown
// weapons.
var equipSlotTypes = [invEquipEnd][]int{
	{1}, {2}, {3}, {4}, {5, 20}, {6}, {7}, {8}, {9}, {10}, {11}, {11}, {12}, {12}, {16},
	{13, 17, 21}, {13, 14, 22, 23}, {15, 25, 26}, {19},
}

// InventoryTemplate is what the editor needs of an item's item_template row (its newest patch): to
// draw it, and to tell where it fits and how many a stack holds.
type InventoryTemplate struct {
	Entry          int    `json:"entry"`
	Name           string `json:"name"`
	Quality        int    `json:"quality"`
	DisplayID      int    `json:"displayId"`
	InvType        int    `json:"invType"`
	Class          int    `json:"class"`
	Subclass       int    `json:"subclass"`
	Stackable      int    `json:"stackable"`
	MaxDurability  int    `json:"maxDurability"`
	ContainerSlots int    `json:"containerSlots"`
	BagFamily      int    `json:"bagFamily"`
	RequiredLevel  int    `json:"requiredLevel"`
	AllowableClass int    `json:"allowableClass"`
	AllowableRace  int    `json:"allowableRace"`

	// What a new item_instance row starts with (Item::Create).
	duration int
	charges  [maxItemSpells]int
}

// InventoryItem is one item on the character: where it is, what of it the editor changes, and its
// template. Guid is 0 for an item the editor adds.
type InventoryItem struct {
	Guid       int               `json:"guid"`
	Container  int               `json:"container"`
	Slot       int               `json:"slot"`
	Entry      int               `json:"entry"`
	Count      int               `json:"count"`
	Durability int               `json:"durability"`
	Enchant    int               `json:"enchant"`
	Template   InventoryTemplate `json:"template"`
}

// Inventory is a character's equipment and bags, and how many more items it keeps where the editor
// doesn't reach (the bank, the keyring, the buyback slots).
type Inventory struct {
	Items     []InventoryItem `json:"items"`
	Elsewhere int             `json:"elsewhere"`
}

// invRow is a character_inventory row with its item_instance row, as read.
type invRow struct {
	bag, slot, guid, entry, count, durability, text int
	enchantments                                    string
	// place is the container and slot the editor gives it (placeRows).
	place [2]int
}

// ReadInventory reads character guid's equipment and bags.
func ReadInventory(serverRoot string, guid int) (Inventory, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return Inventory{}, err
	}
	if _, err := readCharacter(db, guid); err != nil {
		return Inventory{}, err
	}
	rows, err := readInvRows(db, guid)
	if err != nil {
		return Inventory{}, err
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return Inventory{}, err
	}
	var entries []int
	for _, r := range rows {
		entries = append(entries, r.entry)
	}
	templates, err := inventoryTemplates(world, entries)
	if err != nil {
		return Inventory{}, err
	}
	inv := Inventory{Items: []InventoryItem{}}
	reached := placeRows(rows)
	for _, r := range rows {
		p, ok := reached[r.guid]
		if !ok {
			inv.Elsewhere++
			continue
		}
		inv.Items = append(inv.Items, InventoryItem{Guid: r.guid, Container: p[0], Slot: p[1], Entry: r.entry, Count: r.count, Durability: r.durability,
			Enchant: enchantID(r.enchantments, 0), Template: templates[r.entry]})
	}
	return inv, nil
}

// InventoryItemTemplate reads item entry's template for an item the editor adds.
func InventoryItemTemplate(serverRoot string, entry int) (InventoryTemplate, error) {
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return InventoryTemplate{}, err
	}
	if err := ensureDatabase(world, serverRoot); err != nil {
		return InventoryTemplate{}, err
	}
	t, err := inventoryTemplates(world, []int{entry})
	if err != nil {
		return InventoryTemplate{}, err
	}
	if _, ok := t[entry]; !ok {
		return InventoryTemplate{}, fmt.Errorf("there is no item %d", entry)
	}
	return t[entry], nil
}

func readInvRows(db worldDB, guid int) ([]invRow, error) {
	raw, err := runSQL(db, fmt.Sprintf("SELECT ci.bag, ci.slot, ci.item_guid, ci.item_id, ii.count, ii.durability, ii.text, ii.enchantments FROM character_inventory ci "+
		"JOIN item_instance ii ON ii.guid = ci.item_guid WHERE ci.guid = %d ORDER BY ci.bag, ci.slot", guid))
	if err != nil {
		return nil, err
	}
	var rows []invRow
	for _, f := range batchRows(raw, 8) {
		rows = append(rows, invRow{bag: f.num(0), slot: f.num(1), guid: f.num(2), entry: f.num(3), count: f.num(4), durability: f.num(5), text: f.num(6), enchantments: f[7]})
	}
	return rows, nil
}

// placeRows gives the container and slot of every row the editor reaches, by item guid: the items on
// the character (equipment, bags, backpack) and the items in its bags.
func placeRows(rows []invRow) map[int][2]int {
	out := map[int][2]int{}
	bags := map[int]int{} // a bag's guid: the slot it is in
	for _, r := range rows {
		if r.bag == 0 && r.slot >= 0 && r.slot < invPackEnd {
			out[r.guid] = [2]int{0, r.slot}
			if r.slot >= invBagStart && r.slot < invBagEnd {
				bags[r.guid] = r.slot
			}
		}
	}
	for _, r := range rows {
		if s, ok := bags[r.bag]; ok && r.bag != 0 {
			out[r.guid] = [2]int{s, r.slot}
		}
	}
	return out
}

// inventoryTemplates reads the templates of entries (their newest patch rows) by entry.
func inventoryTemplates(world worldDB, entries []int) (map[int]InventoryTemplate, error) {
	out := map[int]InventoryTemplate{}
	seen := map[int]bool{}
	for _, e := range entries {
		seen[e] = true
	}
	if len(seen) == 0 {
		return out, nil
	}
	raw, err := runSQL(world, "SELECT i.entry, i.name, i.quality, i.display_id, i.inventory_type, i.class, i.subclass, i.stackable, i.max_durability, i.container_slots, "+
		"i.bag_family, i.required_level, i.allowable_class, i.allowable_race, i.duration, i.spellcharges_1, i.spellcharges_2, i.spellcharges_3, i.spellcharges_4, i.spellcharges_5 "+
		"FROM item_template i JOIN (SELECT entry, MAX(patch) AS patch FROM item_template WHERE entry IN ("+intList(seen)+") GROUP BY entry) n ON n.entry = i.entry AND n.patch = i.patch")
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 20) {
		t := InventoryTemplate{Entry: f.num(0), Name: f[1], Quality: f.num(2), DisplayID: f.num(3), InvType: f.num(4), Class: f.num(5), Subclass: f.num(6), Stackable: f.num(7),
			MaxDurability: f.num(8), ContainerSlots: f.num(9), BagFamily: f.num(10), RequiredLevel: f.num(11), AllowableClass: f.num(12), AllowableRace: f.num(13), duration: f.num(14)}
		for i := range t.charges {
			t.charges[i] = f.num(15 + i)
		}
		out[t.Entry] = t
	}
	return out, nil
}

// enchantID is enchantment slot i's id in an item_instance.enchantments string, 0 when it has none.
func enchantID(enchantments string, i int) int {
	f := strings.Fields(enchantments)
	if 3*i >= len(f) {
		return 0
	}
	n, _ := strconv.Atoi(f[3*i])
	return n
}

// withEnchant is enchantments with the permanent enchantment's id set to id, every slot written
// (the 21 numbers, each with a space after it, as Item::SaveToDB writes them).
func withEnchant(enchantments string, id int) string {
	f := strings.Fields(enchantments)
	var b strings.Builder
	for i := 0; i < 3*maxEnchantSlots; i++ {
		v := "0"
		if i < len(f) {
			v = f[i]
		}
		if i == 0 {
			v = strconv.Itoa(id)
		}
		b.WriteString(v + " ")
	}
	return b.String()
}

// fitsBag says whether an item of template t can go into bag b (ItemCanGoIntoBag): a plain bag takes
// anything, a special bag only its kind (soul shards, herbs, enchanting supplies, arrows, bullets) and
// no bag.
func fitsBag(t, b InventoryTemplate) bool {
	if b.BagFamily != 0 && t.ContainerSlots != 0 {
		return false
	}
	switch b.Class {
	case 1: // a container
		switch b.Subclass {
		case 0:
			return true
		case 1:
			return t.BagFamily == 3
		case 2:
			return t.BagFamily == 6
		case 3:
			return t.BagFamily == 7
		}
	case 11: // a quiver or an ammo pouch
		switch b.Subclass {
		case 2:
			return t.BagFamily == 1
		case 3:
			return t.BagFamily == 2
		}
	}
	return false
}

// invPlace names a place for a refusal, as the editor's ColumnError column: "container:slot".
func invPlace(container, slot int) string {
	return fmt.Sprintf("%d:%d", container, slot)
}

// checkInventory checks items (the whole of the equipment and bags as the editor wants them) against
// what the server loads: every place is one the character has, holds one item, and takes that item;
// an item already on the character keeps its entry; a stack, its durability and its enchantment are
// in range. cur are the items on the character now, by guid, and templates the items' templates.
func checkInventory(items []InventoryItem, cur map[int]invRow, templates map[int]InventoryTemplate) error {
	at := map[[2]int]InventoryItem{}
	taken := map[[2]int]int{}
	guids := map[int]bool{}
	for _, it := range items {
		at[[2]int{it.Container, it.Slot}] = it
		taken[[2]int{it.Container, it.Slot}]++
	}
	for _, it := range items {
		place := invPlace(it.Container, it.Slot)
		if it.Guid != 0 {
			r, ok := cur[it.Guid]
			if !ok {
				return refuse(place, "Item %d is not this character's", it.Guid)
			}
			if guids[it.Guid] {
				return refuse(place, "Item %d is in two places", it.Guid)
			}
			guids[it.Guid] = true
			if r.entry != it.Entry {
				return refuse(place, "Item %d is a %d, not a %d: take it out and add the other item instead", it.Guid, r.entry, it.Entry)
			}
		}
		if taken[[2]int{it.Container, it.Slot}] > 1 {
			return refuse(place, "Two items are in the same place")
		}
		t, known := templates[it.Entry]
		if !known {
			if it.Guid == 0 {
				return refuse(place, "There is no item %d in the world database", it.Entry)
			}
			// An item whose template is gone may stay where it is; the server deletes it at login.
			if cur[it.Guid].place == [2]int{it.Container, it.Slot} {
				continue
			}
			return refuse(place, "Item %d has no template in the world database: take it out", it.Entry)
		}
		switch {
		case it.Container == 0 && it.Slot >= 0 && it.Slot < invEquipEnd:
			if !containsInt(equipSlotTypes[it.Slot], t.InvType) {
				return refuse(place, "%s doesn't go in that slot", t.Name)
			}
			if it.Slot == slotOffHand {
				if mh, ok := at[[2]int{0, slotMainHand}]; ok && templates[mh.Entry].InvType == inv2HWeapon {
					return refuse(place, "The main hand holds a two-handed weapon, so the off hand stays empty")
				}
			}
		case it.Container == 0 && it.Slot >= invBagStart && it.Slot < invBagEnd:
			if (t.InvType != 18 && t.InvType != 27) || t.ContainerSlots <= 0 {
				return refuse(place, "%s is not a bag", t.Name)
			}
		case it.Container == 0 && it.Slot >= invBagEnd && it.Slot < invPackEnd:
		case it.Container >= invBagStart && it.Container < invBagEnd:
			bag, ok := at[[2]int{0, it.Container}]
			if !ok {
				return refuse(place, "There is no bag in bag slot %d", it.Container-invBagStart+1)
			}
			b := templates[bag.Entry]
			if it.Slot < 0 || it.Slot >= b.ContainerSlots {
				return refuse(place, "%s has %d slots", b.Name, b.ContainerSlots)
			}
			if !fitsBag(t, b) {
				return refuse(place, "%s doesn't go into %s", t.Name, b.Name)
			}
		default:
			return refuse(place, "The editor places items only in the equipment, the bags and the backpack")
		}
		if top := max(t.Stackable, 1); it.Count < 1 || it.Count > top {
			return refuse(place, "A stack of %s holds 1 to %d", t.Name, top)
		}
		if it.Durability < 0 || it.Durability > t.MaxDurability {
			return refuse(place, "The durability of %s is 0 to %d", t.Name, t.MaxDurability)
		}
		if it.Enchant < 0 || it.Enchant > 0xFFFF {
			return refuse(place, "%d is no enchantment", it.Enchant)
		}
	}
	return nil
}

func containsInt(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// equipmentCache is characters.equipment_cache for items, what the character select screen shows
// (Player::SaveToDB): each equipment slot's entry and its enchantments (the permanent one in the low
// 16 bits, the temporary one in the high), then the first bag slot's entry and 0, each number with a
// space after it. enchantments are the items' enchantments strings by guid, for the temporary one.
func equipmentCache(items []InventoryItem, enchantments map[int]string) string {
	var slots [invEquipEnd + 1]InventoryItem
	for _, it := range items {
		if it.Container == 0 && it.Slot >= 0 && it.Slot <= invBagStart {
			slots[it.Slot] = it
		}
	}
	var b strings.Builder
	for i, it := range slots {
		ench := 0
		if i < invEquipEnd && it.Entry != 0 {
			ench = it.Enchant&0xFFFF | (enchantID(enchantments[it.Guid], 1)&0xFFFF)<<16
		}
		fmt.Fprintf(&b, "%d %d ", it.Entry, ench)
	}
	return b.String()
}

// inventoryScript is the SQL that turns character guid's equipment and bags from cur (by guid) into
// items: it deletes the items that are gone (with their gift wrapping, loot and text, as
// Item::SaveToDB does), moves and changes the ones that stay, inserts the new ones (numbered from
// next, as Item::Create makes them) and writes the character select screen's equipment_cache.
func inventoryScript(guid int, items []InventoryItem, cur map[int]invRow, templates map[int]InventoryTemplate, next int) string {
	items = append([]InventoryItem(nil), items...)
	for i := range items {
		if items[i].Guid == 0 {
			items[i].Guid = next
			next++
		}
	}
	bagGuid := map[int]int{}
	for _, it := range items {
		if it.Container == 0 && it.Slot >= invBagStart && it.Slot < invBagEnd {
			bagGuid[it.Slot] = it.Guid
		}
	}
	bagOf := func(it InventoryItem) int {
		if it.Container == 0 {
			return 0
		}
		return bagGuid[it.Container]
	}
	var sql []string
	kept := map[int]bool{}
	for _, it := range items {
		kept[it.Guid] = true
	}
	gone, texts := map[int]bool{}, map[int]bool{}
	for g, r := range cur {
		if !kept[g] {
			gone[g] = true
			if r.text > 0 {
				texts[r.text] = true
			}
		}
	}
	if len(gone) > 0 {
		list := intList(gone)
		sql = append(sql,
			"DELETE FROM character_inventory WHERE item_guid IN ("+list+");",
			"DELETE FROM item_instance WHERE guid IN ("+list+");",
			"DELETE FROM character_gifts WHERE item_guid IN ("+list+");",
			"DELETE FROM item_loot WHERE guid IN ("+list+");")
		if len(texts) > 0 {
			sql = append(sql, "DELETE FROM item_text WHERE id IN ("+intList(texts)+");")
		}
	}
	enchantments := map[int]string{}
	var inserts, places []string
	sort.SliceStable(items, func(i, j int) bool { return items[i].Guid < items[j].Guid })
	for _, it := range items {
		r, old := cur[it.Guid]
		if !old {
			t := templates[it.Entry]
			charges := make([]string, maxItemSpells)
			for i, c := range t.charges {
				charges[i] = strconv.Itoa(c)
			}
			ench := withEnchant("", it.Enchant)
			enchantments[it.Guid] = ench
			inserts = append(inserts, fmt.Sprintf("(%d, %d, %d, %d, %d, %s, 0, %s, 0, %d, 0, 0)", it.Guid, it.Entry, guid, it.Count, t.duration, sqlQuote(strings.Join(charges, " ")+" "), sqlQuote(ench), it.Durability))
			places = append(places, fmt.Sprintf("(%d, %d, %d, %d, %d)", guid, bagOf(it), it.Slot, it.Guid, it.Entry))
			continue
		}
		enchantments[it.Guid] = r.enchantments
		if bag := bagOf(it); bag != r.bag || it.Slot != r.slot {
			sql = append(sql, fmt.Sprintf("UPDATE character_inventory SET bag = %d, slot = %d WHERE item_guid = %d;", bag, it.Slot, it.Guid))
		}
		if it.Count != r.count || it.Durability != r.durability || it.Enchant != enchantID(r.enchantments, 0) {
			ench := r.enchantments
			if it.Enchant != enchantID(r.enchantments, 0) {
				ench = withEnchant(r.enchantments, it.Enchant)
			}
			enchantments[it.Guid] = ench
			sql = append(sql, fmt.Sprintf("UPDATE item_instance SET count = %d, durability = %d, enchantments = %s WHERE guid = %d;", it.Count, it.Durability, sqlQuote(ench), it.Guid))
		}
	}
	if len(inserts) > 0 {
		sql = append(sql,
			"INSERT INTO item_instance (guid, item_id, owner_guid, count, duration, charges, flags, enchantments, random_property_id, durability, text, generated_loot) VALUES\n"+strings.Join(inserts, ",\n")+";",
			"INSERT INTO character_inventory (guid, bag, slot, item_guid, item_id) VALUES\n"+strings.Join(places, ",\n")+";")
	}
	sql = append(sql, fmt.Sprintf("UPDATE characters SET equipment_cache = %s WHERE guid = %d;", sqlQuote(equipmentCache(items, enchantments)), guid))
	return strings.Join(sql, "\n")
}

// SaveInventory makes character guid's equipment and bags items, and returns the SQL it ran, or a
// ColumnError (its column the place, "container:slot") for an item the server would not load there.
// The character must be out of the world while the world server runs (worldRunning), as for
// SaveCharacter; a new item needs the world server stopped, since it numbers new items on from the
// highest number it read at start and would give this one's number to another.
func SaveInventory(serverRoot string, guid int, items []InventoryItem, worldRunning func() bool) (string, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	ch, err := readCharacter(db, guid)
	if err != nil {
		return "", err
	}
	running := worldRunning()
	if ch.Online && running {
		return "", fmt.Errorf("%s is in the world: log out of the game first (the world server writes the character's items over their rows when it logs out)", ch.Values["name"])
	}
	for _, it := range items {
		if it.Guid == 0 && running {
			return "", refuse(invPlace(it.Container, it.Slot), "Stop the world server to add items: it numbers new items on from the highest number it read at start, and would give this one's number to another item")
		}
	}
	rows, err := readInvRows(db, guid)
	if err != nil {
		return "", err
	}
	reached := placeRows(rows)
	cur := map[int]invRow{}
	for _, r := range rows {
		if p, ok := reached[r.guid]; ok {
			r.place = p
			cur[r.guid] = r
		}
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	var entries []int
	news := 0
	for _, it := range items {
		entries = append(entries, it.Entry)
		if it.Guid == 0 {
			news++
		}
	}
	templates, err := inventoryTemplates(world, entries)
	if err != nil {
		return "", err
	}
	if err := checkInventory(items, cur, templates); err != nil {
		return "", err
	}
	next := 0
	if news > 0 {
		out, err := runSQL(db, "SELECT GREATEST(COALESCE((SELECT MAX(guid) FROM item_instance), 0), COALESCE((SELECT MAX(item_guid) FROM character_inventory), 0))")
		if err != nil {
			return "", err
		}
		top, err := strconv.Atoi(strings.TrimSpace(string(out)))
		if err != nil {
			return "", fmt.Errorf("the highest item number was not read: %q", out)
		}
		next = top + 1
	}
	sql := inventoryScript(guid, items, cur, templates, next)
	return sql, runScript(db, sql)
}
