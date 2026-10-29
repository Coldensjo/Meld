package vmangos

import (
	"fmt"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// Templates of the test items: a sword, a two-handed axe, a shield, a shirt, plain and special bags,
// arrows and a stack of food.
var invTemplates = map[int]InventoryTemplate{
	25:   {Entry: 25, Name: "Worn Shortsword", InvType: 21, Class: 2, MaxDurability: 20, Stackable: 1},
	2362: {Entry: 2362, Name: "Worn Wooden Shield", InvType: 14, Class: 4, Subclass: 6, MaxDurability: 20, Stackable: 1},
	38:   {Entry: 38, Name: "Recruit's Shirt", InvType: 4, Class: 4, Stackable: 1},
	1:    {Entry: 1, Name: "Two-handed Axe", InvType: 17, Class: 2, Subclass: 1, MaxDurability: 75, Stackable: 1},
	4496: {Entry: 4496, Name: "Small Brown Pouch", InvType: 18, Class: 1, ContainerSlots: 6, Stackable: 1},
	2101: {Entry: 2101, Name: "Light Quiver", InvType: 27, Class: 11, Subclass: 2, ContainerSlots: 8, BagFamily: 1, Stackable: 1},
	2512: {Entry: 2512, Name: "Rough Arrow", InvType: 24, Class: 6, Subclass: 2, BagFamily: 1, Stackable: 200},
	117:  {Entry: 117, Name: "Tough Jerky", Class: 0, Stackable: 20, charges: [maxItemSpells]int{-1}},
	5396: {Entry: 5396, Name: "Key to Searing Gorge", Class: 13, BagFamily: bagFamilyKeys, Stackable: 1},
}

// A character with a sword, a shield, a pouch in the first bag slot holding jerky, jerky in the
// backpack, jerky in the bank, a pouch in the first bank bag slot holding jerky, an item in a
// buyback slot (which the editor doesn't reach) and a key on the keyring.
var invRows = []invRow{
	{bag: 0, slot: 15, guid: 1, entry: 25, count: 1, durability: 20, enchantments: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 "},
	{bag: 0, slot: 16, guid: 6, entry: 2362, count: 1, durability: 20, enchantments: "0 0 0 1234 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 "},
	{bag: 0, slot: 19, guid: 8, entry: 4496, count: 1, enchantments: ""},
	{bag: 8, slot: 2, guid: 9, entry: 117, count: 3, enchantments: "", text: 44},
	{bag: 0, slot: 23, guid: 5, entry: 117, count: 4, enchantments: ""},
	{bag: 0, slot: 40, guid: 10, entry: 117, count: 1},
	{bag: 0, slot: 63, guid: 11, entry: 4496, count: 1},
	{bag: 11, slot: 0, guid: 12, entry: 117, count: 1},
	{bag: 0, slot: 70, guid: 13, entry: 117, count: 1},
	{bag: 0, slot: 81, guid: 14, entry: 5396, count: 1},
}

// invTestRules: one bank bag slot bought, and ItemRandomProperties 6 ("of the Bear") with two
// enchantments.
var invTestRules = invRules{bankBags: 1, props: map[int][3]int{6: {101, 102, 0}}}

func invCur() map[int]invRow {
	cur := map[int]invRow{}
	for g, p := range placeRows(invRows) {
		for _, r := range invRows {
			if r.guid == g {
				r.place = p
				cur[g] = r
			}
		}
	}
	return cur
}

// invItems are the items the editor reads for invRows.
func invItems() []InventoryItem {
	var out []InventoryItem
	cur := invCur()
	for _, r := range invRows {
		if c, ok := cur[r.guid]; ok {
			out = append(out, InventoryItem{Guid: r.guid, Container: c.place[0], Slot: c.place[1], Entry: r.entry, Count: r.count, Durability: r.durability, Enchant: enchantID(r.enchantments, 0), RandomProperty: r.random})
		}
	}
	return out
}

func TestPlaceRowsReachesAllButTheBuybackSlots(t *testing.T) {
	got := placeRows(invRows)
	want := map[int][2]int{1: {0, 15}, 6: {0, 16}, 8: {0, 19}, 9: {19, 2}, 5: {0, 23}, 10: {0, 40}, 11: {0, 63}, 12: {63, 0}, 14: {0, 81}}
	if len(got) != len(want) {
		t.Fatalf("places %v, want %v", got, want)
	}
	for g, p := range want {
		if got[g] != p {
			t.Errorf("item %d at %v, want %v", g, got[g], p)
		}
	}
}

func TestCheckInventoryTakesWhatTheCharacterHas(t *testing.T) {
	if err := checkInventory(invItems(), invCur(), invTemplates, invTestRules); err != nil {
		t.Fatal(err)
	}
}

func TestCheckInventoryRefuses(t *testing.T) {
	type change func([]InventoryItem) []InventoryItem
	at := func(items []InventoryItem, guid int, f func(*InventoryItem)) []InventoryItem {
		for i := range items {
			if items[i].Guid == guid {
				f(&items[i])
			}
		}
		return items
	}
	add := func(it InventoryItem) change {
		return func(items []InventoryItem) []InventoryItem { return append(items, it) }
	}
	cases := map[string]struct {
		change change
		place  string
		msg    string
	}{
		"a shield in the main hand": {func(l []InventoryItem) []InventoryItem {
			return at(l, 6, func(i *InventoryItem) { i.Slot = 15; i.Container = 0 })
		}, "0:15", ""},
		"a shirt on the head":    {add(InventoryItem{Container: 0, Slot: 0, Entry: 38, Count: 1}), "0:0", ""},
		"jerky in a bag slot":    {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Slot = 20 }) }, "0:20", ""},
		"past the pouch's slots": {func(l []InventoryItem) []InventoryItem { return at(l, 9, func(i *InventoryItem) { i.Slot = 6 }) }, "19:6", ""},
		"into a bag slot with no bag": {func(l []InventoryItem) []InventoryItem {
			return at(l, 9, func(i *InventoryItem) { i.Container = 20; i.Slot = 0 })
		}, "20:0", ""},
		"jerky into a quiver": {func(l []InventoryItem) []InventoryItem {
			return at(l, 8, func(i *InventoryItem) { i.Entry = 2101; i.Guid = 0 })
		}, "19:2", ""},
		"too big a stack":                 {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Count = 21 }) }, "0:23", ""},
		"too much durability":             {func(l []InventoryItem) []InventoryItem { return at(l, 1, func(i *InventoryItem) { i.Durability = 21 }) }, "0:15", ""},
		"another item's guid":             {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Guid = 13 }) }, "0:23", ""},
		"a changed entry":                 {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Entry = 2512 }) }, "0:23", ""},
		"two items in one place":          {add(InventoryItem{Container: 0, Slot: 23, Entry: 117, Count: 1}), "0:23", ""},
		"a buyback slot":                  {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Slot = 70 }) }, "0:70", ""},
		"an item the server doesn't have": {add(InventoryItem{Container: 0, Slot: 30, Entry: 999999, Count: 1}), "0:30", ""},
		"an off hand beside a two-hander": {func(l []InventoryItem) []InventoryItem {
			return at(l, 1, func(i *InventoryItem) { i.Entry = 1; i.Guid = 0 })
		}, "0:16", ""},
		"jerky on the keyring":        {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Slot = 82 }) }, "0:82", "not a key"},
		"a quiver in a bank bag slot": {add(InventoryItem{Container: 0, Slot: 64, Entry: 2101, Count: 1}), "0:64", "not a bag"},
		"a bank bag slot not bought":  {add(InventoryItem{Container: 0, Slot: 64, Entry: 4496, Count: 1}), "0:64", "bought 1"},
		"past the bank pouch's slots": {func(l []InventoryItem) []InventoryItem { return at(l, 12, func(i *InventoryItem) { i.Slot = 6 }) }, "63:6", ""},
		"into an empty bank bag slot": {func(l []InventoryItem) []InventoryItem { return at(l, 12, func(i *InventoryItem) { i.Container = 64 }) }, "64:0", "bank bag slot 2"},
		"a random property not in the client": {func(l []InventoryItem) []InventoryItem {
			return at(l, 1, func(i *InventoryItem) { i.RandomProperty = 99 })
		}, "0:15", "random property"},
	}
	for name, c := range cases {
		items := c.change(invItems())
		err := checkInventory(items, invCur(), invTemplates, invTestRules)
		r := Refused(err)
		if r == nil {
			t.Errorf("%s: not refused (%v)", name, err)
			continue
		}
		if r.Column != c.place || !strings.Contains(r.Message, c.msg) {
			t.Errorf("%s: refused at %s (%s), want %s (%s)", name, r.Column, r.Message, c.place, c.msg)
		}
	}
}

// A random property already on an item stays when the client's tables don't name it (or aren't read).
func TestCheckInventoryKeepsARandomPropertyItHas(t *testing.T) {
	cur := invCur()
	r := cur[1]
	r.random = 99
	cur[1] = r
	items := invItems()
	for i := range items {
		if items[i].Guid == 1 {
			items[i].RandomProperty = 99
		}
	}
	if err := checkInventory(items, cur, invTemplates, invRules{bankBags: 1}); err != nil {
		t.Fatal(err)
	}
	if newRandomProperty(items, cur) {
		t.Fatal("a kept random property needs the client's tables")
	}
}

func TestArrowsGoIntoAQuiver(t *testing.T) {
	if !fitsBag(invTemplates[2512], invTemplates[2101]) || fitsBag(invTemplates[117], invTemplates[2101]) || !fitsBag(invTemplates[117], invTemplates[4496]) {
		t.Fatal("fitsBag")
	}
	if fitsBag(invTemplates[4496], invTemplates[2101]) {
		t.Fatal("a bag went into a quiver")
	}
}

// The cache the server wrote for a character in a shirt, trousers, boots, a sword and a shield.
func TestEquipmentCacheAsTheServerWritesIt(t *testing.T) {
	items := []InventoryItem{{Slot: 3, Entry: 38}, {Slot: 6, Entry: 39}, {Slot: 7, Entry: 40}, {Slot: 15, Entry: 25}, {Slot: 16, Entry: 2362}, {Slot: 23, Entry: 117}}
	want := "0 0 0 0 0 0 38 0 0 0 0 0 39 0 40 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 25 0 2362 0 0 0 0 0 0 0 "
	if got := equipmentCache(items, nil); got != want {
		t.Fatalf("cache\n%q, want\n%q", got, want)
	}
	items = []InventoryItem{{Guid: 6, Slot: 16, Entry: 2362, Enchant: 41}, {Slot: 19, Entry: 4496}}
	got := strings.Fields(equipmentCache(items, map[int]string{6: "41 0 0 1234 0 0 "}))
	if got[33] != "80871465" || got[38] != "4496" || got[39] != "0" { // 41 | 1234 << 16
		t.Fatalf("cache %v", got)
	}
}

func TestWithEnchant(t *testing.T) {
	if got := withEnchant("", 41); got != "41 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 " {
		t.Fatalf("%q", got)
	}
	if got := withEnchant("0 0 0 1234 600 0", 0); !strings.HasPrefix(got, "0 0 0 1234 600 0 0 ") || len(strings.Fields(got)) != 21 {
		t.Fatalf("%q", got)
	}
}

func TestWithRandomProperty(t *testing.T) {
	if got := withRandomProperty("41 0 0 0 0 0 0 0 0 7 5 5 ", [3]int{101, 102, 0}); got != "41 0 0 0 0 0 0 0 0 101 0 0 102 0 0 0 0 0 0 0 0 " {
		t.Fatalf("%q", got)
	}
	if got := withRandomProperty("41 0 0 0 0 0 0 0 0 101 0 0 102 0 0 0 0 0 0 0 0 ", [3]int{}); got != "41 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 " {
		t.Fatalf("%q", got)
	}
}

// changedItems are invItems with the jerky taken out of the pouch, the backpack jerky moved up a
// slot as 9, the sword enchanted and given a random property, the bank jerky moved into the bank's
// pouch, and new items: a quiver of arrows in the second bag slot, jerky in the backpack, a key on
// the keyring and a sword "of the Bear" in the bank.
func changedItems() []InventoryItem {
	var kept []InventoryItem
	for _, it := range invItems() {
		switch it.Guid {
		case 9:
			continue
		case 5:
			it.Slot, it.Count = 24, 9
		case 1:
			it.Enchant, it.RandomProperty = 41, 6
		case 10:
			it.Container, it.Slot = 63, 1
		}
		kept = append(kept, it)
	}
	return append(kept, InventoryItem{Container: 20, Slot: 0, Entry: 2512, Count: 200}, InventoryItem{Container: 0, Slot: 20, Entry: 2101, Count: 1},
		InventoryItem{Container: 0, Slot: 25, Entry: 117, Count: 1}, InventoryItem{Container: 0, Slot: 82, Entry: 5396, Count: 1},
		InventoryItem{Container: 0, Slot: 41, Entry: 25, Count: 1, Durability: 20, RandomProperty: 6})
}

func TestInventoryScript(t *testing.T) {
	kept := changedItems()
	if err := checkInventory(kept, invCur(), invTemplates, invTestRules); err != nil {
		t.Fatal(err)
	}
	if !newRandomProperty(kept, invCur()) {
		t.Fatal("new random properties not seen")
	}
	sql := inventoryScript(7, kept, invCur(), invTemplates, invTestRules.props, 100)
	for _, want := range []string{
		"DELETE FROM character_inventory WHERE item_guid IN (9);",
		"DELETE FROM item_instance WHERE guid IN (9);",
		"DELETE FROM item_text WHERE id IN (44);",
		"UPDATE character_inventory SET bag = 0, slot = 24 WHERE item_guid = 5;",
		// An unchanged enchantment keeps the string as it was.
		"UPDATE item_instance SET count = 9, durability = 0, enchantments = '', random_property_id = 0 WHERE guid = 5;",
		// A random property fills enchantment slots 3 to 5 from ItemRandomProperties.dbc.
		"UPDATE item_instance SET count = 1, durability = 20, enchantments = '41 0 0 0 0 0 0 0 0 101 0 0 102 0 0 0 0 0 0 0 0 ', random_property_id = 6 WHERE guid = 1;",
		// The bank jerky goes into the bank's pouch (guid 11).
		"UPDATE character_inventory SET bag = 11, slot = 1 WHERE item_guid = 10;",
		// The arrows (100) go into the new quiver (101), which is in bag slot 20; the jerky (102) is new too.
		"(100, 2512, 7, 200, 0, '0 0 0 0 0 ', 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0, 0)",
		"(102, 117, 7, 1, 0, '-1 0 0 0 0 ', 0,",
		"(7, 101, 0, 100, 2512)",
		"(7, 0, 20, 101, 2101)",
		"(7, 0, 82, 103, 5396)",
		"(104, 25, 7, 1, 0, '0 0 0 0 0 ', 0, '0 0 0 0 0 0 0 0 0 101 0 0 102 0 0 0 0 0 0 0 0 ', 6, 20, 0, 0)",
		"(7, 0, 41, 104, 25)",
		"UPDATE characters SET equipment_cache = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 25 41 2362 80871424 0 0 0 0 4496 0 ' WHERE guid = 7;",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("no %s in\n%s", want, sql)
		}
	}
	for _, not := range []string{"item_guid = 6", "guid = 8;", "guid = 11;", "guid = 12;", "guid = 13;", "(13", "guid = 14;"} {
		if strings.Contains(sql, not) {
			t.Errorf("touched an item it shouldn't (%s):\n%s", not, sql)
		}
	}
}

// TestInventoryScriptLive runs inventoryScript in a scratch test_meld_inventory database (the
// character tables' structure copied from the server's) and reads the items back as the editor does.
func TestInventoryScriptLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	chars, err := confDatabase(dir, "CharacterDatabase.Info")
	if err != nil {
		t.Fatal(err)
	}
	const scratch = "test_meld_inventory"
	if _, err := runSQL(chars, "DROP DATABASE IF EXISTS "+scratch+"; CREATE DATABASE "+scratch); err != nil {
		t.Skip("no scratch database: " + err.Error())
	}
	defer func() { _, _ = runSQL(chars, "DROP DATABASE IF EXISTS "+scratch) }()
	db := chars
	db.name = scratch
	var setup strings.Builder
	setup.WriteString("SET SESSION sql_mode = '';\n")
	for _, tb := range []string{"characters", "item_instance", "character_inventory", "character_gifts", "item_loot", "item_text"} {
		fmt.Fprintf(&setup, "CREATE TABLE `%s` LIKE `%s`.`%s`;\n", tb, chars.name, tb)
	}
	setup.WriteString("INSERT INTO characters (guid, account, name, bank_bag_slots) VALUES (7, 900, 'Inv', 1);\n")
	for _, r := range invRows {
		fmt.Fprintf(&setup, "INSERT INTO item_instance (guid, item_id, owner_guid, count, durability, text, enchantments, random_property_id) VALUES (%d, %d, 7, %d, %d, %d, %s, %d);\n",
			r.guid, r.entry, r.count, r.durability, r.text, sqlQuote(r.enchantments), r.random)
		fmt.Fprintf(&setup, "INSERT INTO character_inventory (guid, bag, slot, item_guid, item_id) VALUES (7, %d, %d, %d, %d);\n", r.bag, r.slot, r.guid, r.entry)
	}
	if err := runScript(db, setup.String()); err != nil {
		t.Fatal(err)
	}
	if n, err := readBankBagSlots(db, 7); err != nil || n != 1 {
		t.Fatalf("bank bag slots %d, %v", n, err)
	}
	if err := runScript(db, inventoryScript(7, changedItems(), invCur(), invTemplates, invTestRules.props, 100)); err != nil {
		t.Fatal(err)
	}
	rows, err := readInvRows(db, 7)
	if err != nil {
		t.Fatal(err)
	}
	places := placeRows(rows)
	want := map[int][2]int{1: {0, 15}, 6: {0, 16}, 8: {0, 19}, 5: {0, 24}, 10: {63, 1}, 11: {0, 63}, 12: {63, 0}, 14: {0, 81},
		100: {20, 0}, 101: {0, 20}, 102: {0, 25}, 103: {0, 82}, 104: {0, 41}}
	if len(places) != len(want) {
		t.Errorf("places %v, want %v", places, want)
	}
	for g, p := range want {
		if places[g] != p {
			t.Errorf("item %d at %v, want %v", g, places[g], p)
		}
	}
	for _, r := range rows {
		switch r.guid {
		case 1, 104:
			if r.random != 6 || enchantID(r.enchantments, propEnchantSlot) != 101 || enchantID(r.enchantments, propEnchantSlot+1) != 102 {
				t.Errorf("item %d: random property %d, enchantments %q", r.guid, r.random, r.enchantments)
			}
		}
	}
	// The buyback item is left as it was.
	if out, err := runSQL(db, "SELECT bag, slot FROM character_inventory WHERE item_guid = 13"); err != nil || strings.TrimSpace(string(out)) != "0\t70" {
		t.Errorf("buyback item: %q, %v", out, err)
	}
}

func TestSaveInventoryRefuses(t *testing.T) {
	root := characterServer(t)
	old := runSQL
	defer func() { runSQL = old }()
	online := "1"
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case sql == "SELECT 1":
			return []byte("1\n"), nil
		case strings.HasPrefix(sql, "SELECT name, race"):
			return characterRow(online), nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	running := func() bool { return true }
	if _, err := SaveInventory(root, "", 4, nil, running); err == nil || !strings.Contains(err.Error(), "in the world") {
		t.Fatalf("saved a character in the world: %v", err)
	}
	online = "0"
	_, err := SaveInventory(root, "", 4, []InventoryItem{{Container: 0, Slot: 23, Entry: 117, Count: 1}}, running)
	if r := Refused(err); r == nil || r.Column != "0:23" || !strings.Contains(r.Message, "Stop the world server") {
		t.Fatalf("added an item while the world server runs: %v", err)
	}
}
