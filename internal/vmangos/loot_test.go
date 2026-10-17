package vmangos

import (
	"strings"
	"testing"
)

func TestLootSQLReplacesTheList(t *testing.T) {
	sql, err := lootSQL(2283, []LootItem{
		{Item: 929, Chance: 25, MinCount: 1, MaxCount: 1, PatchMax: 10},
		{Item: 3358, Chance: 0, Group: 2, MinCount: 2, MaxCount: 8, PatchMax: 10},
		{Item: 99001, Chance: 100, MinCount: -24000, MaxCount: 2, PatchMax: 10},
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	cols := "(`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`, `condition_id`, `patch_min`, `patch_max`)"
	want := "DELETE FROM `gameobject_loot_template` WHERE `entry` = 2283;\n" +
		"INSERT INTO `gameobject_loot_template` " + cols + " VALUES (2283, 929, 25, 0, 1, 1, 0, 0, 10);\n" +
		"INSERT INTO `gameobject_loot_template` " + cols + " VALUES (2283, 3358, 0, 2, 2, 8, 0, 0, 10);\n" +
		"INSERT INTO `gameobject_loot_template` " + cols + " VALUES (2283, 99001, 100, 0, -24000, 2, 0, 0, 10);"
	if sql != want {
		t.Fatalf("got\n%s\nwant\n%s", sql, want)
	}
	// A database without the patch columns gets rows without them.
	sql, err = lootSQL(7, []LootItem{{Item: 929, Chance: -100, MinCount: 1, MaxCount: 1}}, false)
	if err != nil || strings.Contains(sql, "patch_min") || !strings.Contains(sql, "VALUES (7, 929, -100, 0, 1, 1, 0);") {
		t.Fatalf("got %q, %v", sql, err)
	}
	sql, err = lootSQL(7, nil, true)
	if err != nil || strings.Contains(sql, "INSERT") {
		t.Fatalf("an empty list should only delete: %q %v", sql, err)
	}
}

func TestLootSQLRefusesBadRows(t *testing.T) {
	bad := map[string][]LootItem{
		"twice":         {{Item: 929, MinCount: 1, MaxCount: 1}, {Item: 929, MinCount: 1, MaxCount: 1}},
		"no item":       {{Item: 0, MinCount: 1, MaxCount: 1}},
		"chance":        {{Item: 929, Chance: 101, MinCount: 1, MaxCount: 1}},
		"count 0":       {{Item: 929, MinCount: 0, MaxCount: 1}},
		"most < least":  {{Item: 929, MinCount: 3, MaxCount: 2}},
		"most over 255": {{Item: 929, MinCount: 1, MaxCount: 256}},
		"group":         {{Item: 929, Group: 256, MinCount: 1, MaxCount: 1}},
		"patches":       {{Item: 929, MinCount: 1, MaxCount: 1, PatchMin: 5, PatchMax: 2}},
	}
	for name, items := range bad {
		if _, err := lootSQL(7, items, true); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := lootSQL(0, nil, true); err == nil {
		t.Error("loot list 0 accepted")
	}
}

func TestParseLootRows(t *testing.T) {
	items := parseLootItems([]byte("929\tHealing Potion\t1\t15711\t25\t0\t1\t1\t0\t0\t10\n" +
		"99001\t\t0\t0\t100\t0\t-24000\t2\t0\t0\t10\n"))
	if len(items) != 2 || items[0].Name != "Healing Potion" || items[0].Chance != 25 || items[0].DisplayID != 15711 ||
		items[1].MinCount != -24000 || items[1].MaxCount != 2 || items[1].PatchMax != 10 {
		t.Fatalf("got %+v", items)
	}
	users := parseLootUsers([]byte("2855\tSolid Chest\t64\n105570\tAlliance Strongbox\t0\n"))
	if len(users) != 2 || users[0].Entry != 2855 || users[0].Name != "Solid Chest" || users[0].Spawns != 64 || users[1].Spawns != 0 {
		t.Fatalf("got %+v", users)
	}
}

func TestLootUsersSQLLeavesOutTheObjectItself(t *testing.T) {
	sql := lootUsersSQL(2283, 2855)
	for _, want := range []string{"t.type IN (3, 25)", "t.data1 = 2283", "t.entry <> 2855", "MAX(patch)"} {
		if !strings.Contains(sql, want) {
			t.Errorf("%q lacks %q", sql, want)
		}
	}
}
