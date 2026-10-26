package vmangos

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// The game object types whose data1 names a gameobject_loot_template list: a chest (which veins and
// herbs are too) and a fishing hole.
const (
	objectTypeChest       = 3
	objectTypeFishingHole = 25
)

// lootTable is where a chest's contents are: rows keyed by (entry, item), entry being the loot id a
// template's data1 names.
const lootTable = "gameobject_loot_template"

// LootItem is one row of a loot list. Chance is ChanceOrQuestChance: a percentage, negative for an
// item that drops only for a player on a quest that needs it; in a group (Group above 0) one item
// of the group drops, those with chance 0 sharing what the others leave. MinCount is mincountOrRef:
// a negative one makes the row a reference to reference_loot_template list -MinCount, rolled
// MaxCount times, and Item is then only the row's key. PatchMin and PatchMax are the content
// patches the row loads in (0 and 10 for every one).
type LootItem struct {
	Item      int     `json:"item"`
	Name      string  `json:"name"`
	Quality   int     `json:"quality"`
	DisplayID int     `json:"displayId"`
	Chance    float64 `json:"chance"`
	Group     int     `json:"group"`
	MinCount  int     `json:"minCount"`
	MaxCount  int     `json:"maxCount"`
	Condition int     `json:"condition"`
	PatchMin  int     `json:"patchMin"`
	PatchMax  int     `json:"patchMax"`
}

// LootUser is a game object template other than the one being edited whose loot is the same list,
// with how many spawns it has in the world.
type LootUser struct {
	Entry  int    `json:"entry"`
	Name   string `json:"name"`
	Spawns int    `json:"spawns"`
}

// ObjectLoot is what a game object holds: its loot list's rows, the other object templates that hold
// the same list (so a change reaches them too), and how many spawns the object itself has.
type ObjectLoot struct {
	Loot   int        `json:"loot"`
	Items  []LootItem `json:"items"`
	Users  []LootUser `json:"users"`
	Spawns int        `json:"spawns"`
}

// newestObjects is gameobject_template's newest patch row of each entry, as `t`.
const newestObjects = "(SELECT g.* FROM gameobject_template g JOIN (SELECT entry, MAX(patch) AS patch FROM gameobject_template GROUP BY entry) n " +
	"ON n.entry = g.entry AND n.patch = g.patch) t"

// lootRowsSQL selects loot list loot's rows with their item names, references last.
func lootRowsSQL(loot int, patches bool) string {
	p := "0, 10"
	if patches {
		p = "v.patch_min, v.patch_max"
	}
	return fmt.Sprintf("SELECT v.item, COALESCE(it.name, ''), COALESCE(it.quality, 0), COALESCE(it.display_id, 0), v.ChanceOrQuestChance, v.groupid, "+
		"v.mincountOrRef, v.maxcount, v.condition_id, %s FROM `%s` v %s WHERE v.entry = %d ORDER BY v.mincountOrRef < 0, v.groupid, v.item",
		p, lootTable, itemNamesJoin, loot)
}

// parseLootItems reads lootRowsSQL's output.
func parseLootItems(raw []byte) []LootItem {
	var out []LootItem
	for _, f := range batchRows(raw, 11) {
		chance, _ := strconv.ParseFloat(f[4], 64)
		out = append(out, LootItem{
			Item: f.num(0), Name: f[1], Quality: f.num(2), DisplayID: f.num(3), Chance: chance, Group: f.num(5),
			MinCount: f.num(6), MaxCount: f.num(7), Condition: f.num(8), PatchMin: f.num(9), PatchMax: f.num(10),
		})
	}
	return out
}

// lootUsersSQL lists the game object templates (newest patch) other than entry that hold loot list
// loot, with their spawn counts.
func lootUsersSQL(loot, entry int) string {
	return fmt.Sprintf("SELECT t.entry, t.name, (SELECT COUNT(*) FROM gameobject s WHERE s.id = t.entry) FROM %s "+
		"WHERE t.type IN (%d, %d) AND t.data1 = %d AND t.entry <> %d ORDER BY t.name, t.entry",
		newestObjects, objectTypeChest, objectTypeFishingHole, loot, entry)
}

// parseLootUsers reads lootUsersSQL's output.
func parseLootUsers(raw []byte) []LootUser {
	var out []LootUser
	for _, f := range batchRows(raw, 3) {
		e, _ := strconv.Atoi(f[0])
		s, _ := strconv.Atoi(f[2])
		out = append(out, LootUser{Entry: e, Name: f[1], Spawns: s})
	}
	return out
}

// lootHasPatches says whether the world database's loot table has the patch_min and patch_max
// columns (VMaNGOS added them; an older database lacks them).
func lootHasPatches(db worldDB) (bool, error) {
	raw, err := runSQL(db, "SHOW COLUMNS FROM `"+lootTable+"` LIKE 'patch_m%'")
	if err != nil {
		return false, err
	}
	return strings.Count(string(raw), "patch_m") == 2, nil
}

// ReadObjectLoot reads what game object template entry holds when its loot list is loot: the list's
// rows, the other templates that hold the same list, and the spawns of entry. A loot of 0 (no list)
// has no rows and no other users.
func ReadObjectLoot(serverRoot string, entry, loot int) (ObjectLoot, error) {
	out := ObjectLoot{Loot: loot}
	db, err := openWorld(serverRoot)
	if err != nil {
		return out, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT COUNT(*) FROM gameobject WHERE id = %d", entry))
	if err != nil {
		return out, err
	}
	out.Spawns, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
	if loot <= 0 {
		return out, nil
	}
	patches, err := lootHasPatches(db)
	if err != nil {
		return out, err
	}
	if raw, err = runSQL(db, lootRowsSQL(loot, patches)); err != nil {
		return out, err
	}
	out.Items = parseLootItems(raw)
	if raw, err = runSQL(db, lootUsersSQL(loot, entry)); err != nil {
		return out, err
	}
	out.Users = parseLootUsers(raw)
	return out, nil
}

// lootSQL replaces loot list loot's rows with items. An item listed twice is refused (the table's
// key is (entry, item)), and so is a value the columns can't hold.
func lootSQL(loot int, items []LootItem, patches bool) (string, error) {
	if loot <= 0 || loot > 0xFFFFFF {
		return "", fmt.Errorf("loot list %d is not one the table can hold", loot)
	}
	cols := "`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`, `condition_id`"
	if patches {
		cols += ", `patch_min`, `patch_max`"
	}
	seen := map[int]bool{}
	var b strings.Builder
	fmt.Fprintf(&b, "DELETE FROM `%s` WHERE `entry` = %d;", lootTable, loot)
	for _, it := range items {
		if it.Item <= 0 || it.Item > 0xFFFFFF {
			return "", fmt.Errorf("the contents have an item with no entry")
		}
		if seen[it.Item] {
			return "", fmt.Errorf("item %d is in the contents twice", it.Item)
		}
		seen[it.Item] = true
		if math.IsNaN(it.Chance) || it.Chance < -100 || it.Chance > 100 {
			return "", fmt.Errorf("item %d: the chance must be -100 to 100%%", it.Item)
		}
		if it.Group < 0 || it.Group > 255 {
			return "", fmt.Errorf("item %d: the group must be 0 to 255", it.Item)
		}
		if it.MinCount == 0 || it.MinCount < -0x7FFFFF || it.MinCount > 255 {
			return "", fmt.Errorf("item %d: the count must be 1 to 255 (or negative for a reference)", it.Item)
		}
		if it.MaxCount < 1 || it.MaxCount > 255 || (it.MinCount > 0 && it.MaxCount < it.MinCount) {
			return "", fmt.Errorf("item %d: the most must be from the least to 255", it.Item)
		}
		if it.Condition < 0 || it.Condition > 0xFFFFFF {
			return "", fmt.Errorf("item %d: the condition can't be negative", it.Item)
		}
		vals := fmt.Sprintf("%d, %d, %s, %d, %d, %d, %d", loot, it.Item, num(it.Chance), it.Group, it.MinCount, it.MaxCount, it.Condition)
		if patches {
			if it.PatchMin < 0 || it.PatchMax > 255 || it.PatchMin > it.PatchMax {
				return "", fmt.Errorf("item %d: the patches must run from the first to the last", it.Item)
			}
			vals += fmt.Sprintf(", %d, %d", it.PatchMin, it.PatchMax)
		}
		fmt.Fprintf(&b, "\nINSERT INTO `%s` (%s) VALUES (%s);", lootTable, cols, vals)
	}
	return b.String(), nil
}

// missingItem names the first of ids item_template has no row for, or returns "" when it has them
// all.
func missingItem(db worldDB, ids []int) (string, error) {
	if len(ids) == 0 {
		return "", nil
	}
	known, err := knownEntries(db, itemTable, ids)
	if err != nil {
		return "", err
	}
	for _, id := range ids {
		if !known[id] {
			return strconv.Itoa(id), nil
		}
	}
	return "", nil
}

// SaveObjectLoot replaces loot list loot's rows with items and returns the SQL it ran. Every item
// that isn't a reference must exist in item_template.
func SaveObjectLoot(serverRoot string, loot int, items []LootItem) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	var ids []int
	for _, it := range items {
		if it.MinCount > 0 {
			ids = append(ids, it.Item)
		}
	}
	if id, err := missingItem(db, ids); err != nil || id != "" {
		if err == nil {
			err = fmt.Errorf("the world database has no item %s", id)
		}
		return "", err
	}
	patches, err := lootHasPatches(db)
	if err != nil {
		return "", err
	}
	sql, err := lootSQL(loot, items, patches)
	if err != nil {
		return "", err
	}
	return sql, runScript(db, sql)
}

// nextLootSQL is the first loot id neither the loot table nor any chest or fishing hole uses.
var nextLootSQL = fmt.Sprintf("SELECT GREATEST((SELECT COALESCE(MAX(entry), 0) FROM `%s`), "+
	"(SELECT COALESCE(MAX(data1), 0) FROM gameobject_template WHERE type IN (%d, %d))) + 1", lootTable, objectTypeChest, objectTypeFishingHole)

// NextObjectLoot is the first loot id no game object uses yet, for an object made a chest or given
// its own copy of a shared list.
func NextObjectLoot(serverRoot string) (int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return 0, err
	}
	raw, err := runSQL(db, nextLootSQL)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(raw)))
}
