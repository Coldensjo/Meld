package vmangos

import (
	"strings"
	"testing"
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
}

// A character with a sword, a shield, a pouch in the first bag slot holding jerky, jerky in the
// backpack, and an item in the bank and one in a bank bag, which the editor doesn't reach.
var invRows = []invRow{
	{bag: 0, slot: 15, guid: 1, entry: 25, count: 1, durability: 20, enchantments: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 "},
	{bag: 0, slot: 16, guid: 6, entry: 2362, count: 1, durability: 20, enchantments: "0 0 0 1234 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 "},
	{bag: 0, slot: 19, guid: 8, entry: 4496, count: 1, enchantments: ""},
	{bag: 8, slot: 2, guid: 9, entry: 117, count: 3, enchantments: "", text: 44},
	{bag: 0, slot: 23, guid: 5, entry: 117, count: 4, enchantments: ""},
	{bag: 0, slot: 40, guid: 10, entry: 117, count: 1},
	{bag: 0, slot: 63, guid: 11, entry: 4496, count: 1},
	{bag: 11, slot: 0, guid: 12, entry: 117, count: 1},
}

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
			out = append(out, InventoryItem{Guid: r.guid, Container: c.place[0], Slot: c.place[1], Entry: r.entry, Count: r.count, Durability: r.durability, Enchant: enchantID(r.enchantments, 0)})
		}
	}
	return out
}

func TestPlaceRowsReachesTheEquipmentAndBagsOnly(t *testing.T) {
	got := placeRows(invRows)
	want := map[int][2]int{1: {0, 15}, 6: {0, 16}, 8: {0, 19}, 9: {19, 2}, 5: {0, 23}}
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
	if err := checkInventory(invItems(), invCur(), invTemplates); err != nil {
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
	}{
		"a shield in the main hand": {func(l []InventoryItem) []InventoryItem {
			return at(l, 6, func(i *InventoryItem) { i.Slot = 15; i.Container = 0 })
		}, "0:15"},
		"a shirt on the head":    {add(InventoryItem{Container: 0, Slot: 0, Entry: 38, Count: 1}), "0:0"},
		"jerky in a bag slot":    {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Slot = 20 }) }, "0:20"},
		"past the pouch's slots": {func(l []InventoryItem) []InventoryItem { return at(l, 9, func(i *InventoryItem) { i.Slot = 6 }) }, "19:6"},
		"into a bag slot with no bag": {func(l []InventoryItem) []InventoryItem {
			return at(l, 9, func(i *InventoryItem) { i.Container = 20; i.Slot = 0 })
		}, "20:0"},
		"jerky into a quiver": {func(l []InventoryItem) []InventoryItem {
			return at(l, 8, func(i *InventoryItem) { i.Entry = 2101; i.Guid = 0 })
		}, "19:2"},
		"too big a stack":                 {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Count = 21 }) }, "0:23"},
		"too much durability":             {func(l []InventoryItem) []InventoryItem { return at(l, 1, func(i *InventoryItem) { i.Durability = 21 }) }, "0:15"},
		"another item's guid":             {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Guid = 10 }) }, "0:23"},
		"a changed entry":                 {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Entry = 2512 }) }, "0:23"},
		"two items in one place":          {add(InventoryItem{Container: 0, Slot: 23, Entry: 117, Count: 1}), "0:23"},
		"the bank":                        {func(l []InventoryItem) []InventoryItem { return at(l, 5, func(i *InventoryItem) { i.Slot = 40 }) }, "0:40"},
		"an item the server doesn't have": {add(InventoryItem{Container: 0, Slot: 30, Entry: 999999, Count: 1}), "0:30"},
		"an off hand beside a two-hander": {func(l []InventoryItem) []InventoryItem {
			return at(l, 1, func(i *InventoryItem) { i.Entry = 1; i.Guid = 0 })
		}, "0:16"},
	}
	for name, c := range cases {
		items := c.change(invItems())
		err := checkInventory(items, invCur(), invTemplates)
		r := Refused(err)
		if r == nil {
			t.Errorf("%s: not refused (%v)", name, err)
			continue
		}
		if r.Column != c.place {
			t.Errorf("%s: refused at %s, want %s (%s)", name, r.Column, c.place, r.Message)
		}
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

func TestInventoryScript(t *testing.T) {
	items := invItems()
	// Take the jerky out of the pouch, move the backpack jerky up a slot and give it 9, enchant the sword,
	// and put a new quiver of arrows in the second bag slot.
	var kept []InventoryItem
	for _, it := range items {
		switch it.Guid {
		case 9:
			continue
		case 5:
			it.Slot, it.Count = 24, 9
		case 1:
			it.Enchant = 41
		}
		kept = append(kept, it)
	}
	kept = append(kept, InventoryItem{Container: 20, Slot: 0, Entry: 2512, Count: 200}, InventoryItem{Container: 0, Slot: 20, Entry: 2101, Count: 1}, InventoryItem{Container: 0, Slot: 24 + 1, Entry: 117, Count: 1})
	if err := checkInventory(kept, invCur(), invTemplates); err != nil {
		t.Fatal(err)
	}
	sql := inventoryScript(7, kept, invCur(), invTemplates, 100)
	for _, want := range []string{
		"DELETE FROM character_inventory WHERE item_guid IN (9);",
		"DELETE FROM item_instance WHERE guid IN (9);",
		"DELETE FROM item_text WHERE id IN (44);",
		"UPDATE character_inventory SET bag = 0, slot = 24 WHERE item_guid = 5;",
		// An unchanged enchantment keeps the string as it was.
		"UPDATE item_instance SET count = 9, durability = 0, enchantments = '' WHERE guid = 5;",
		"UPDATE item_instance SET count = 1, durability = 20, enchantments = '41 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' WHERE guid = 1;",
		// The arrows (100) go into the new quiver (101), which is in bag slot 20; the jerky (102) is new too.
		"(100, 2512, 7, 200, 0, '0 0 0 0 0 ', 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0, 0)",
		"(102, 117, 7, 1, 0, '-1 0 0 0 0 ', 0,",
		"(7, 101, 0, 100, 2512)",
		"(7, 0, 20, 101, 2101)",
		"UPDATE characters SET equipment_cache = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 25 41 2362 80871424 0 0 0 0 4496 0 ' WHERE guid = 7;",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("no %s in\n%s", want, sql)
		}
	}
	for _, not := range []string{"item_guid = 6", "guid = 8;", "IN (10", "IN (11", "IN (12"} {
		if strings.Contains(sql, not) {
			t.Errorf("touched an item it shouldn't (%s):\n%s", not, sql)
		}
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
	if _, err := SaveInventory(root, 4, nil, running); err == nil || !strings.Contains(err.Error(), "in the world") {
		t.Fatalf("saved a character in the world: %v", err)
	}
	online = "0"
	_, err := SaveInventory(root, 4, []InventoryItem{{Container: 0, Slot: 23, Entry: 117, Count: 1}}, running)
	if r := Refused(err); r == nil || r.Column != "0:23" || !strings.Contains(r.Message, "Stop the world server") {
		t.Fatalf("added an item while the world server runs: %v", err)
	}
}
