package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// A new item can start as a kind of item (#353): a bow, a one-hand sword, a cloth chest, a bag. The
// kinds are the world database's (class, subclass, inventory type) groups, and a new item of one
// takes the basics most items of that kind have: its look, where it is carried, its material, ammo,
// range, speed, durability and stacks. What makes an item good, its damage, armour, stats, binding,
// effects, level and price, is left at nothing for the author to set.

// ItemKind is a kind of item: its class, subclass and inventory type, and how many items of the
// world database are of it.
type ItemKind struct {
	Class    int `json:"class"`
	Subclass int `json:"subclass"`
	InvType  int `json:"invType"`
	Count    int `json:"count"`
}

// minKindItems is how many items a kind needs to be offered: fewer are odd ones out (a test item, a
// mislabelled one) whose basics wouldn't be the usual.
const minKindItems = 3

// kindBasics are the columns a new item of a kind takes from that kind's items, the most usual value
// of each; kindMedians take the middle value instead, since they spread with the items' levels.
var (
	kindBasics  = []string{"display_id", "sheath", "material", "ammo_type", "range_mod", "stackable", "buy_count", "container_slots", "bag_family", "food_type", "page_material"}
	kindMedians = map[string]bool{"delay": true, "max_durability": true}
)

const newestItemRow = "t.patch = (SELECT MAX(patch) FROM item_template WHERE entry = t.entry)"

// ListItemKinds lists the kinds of item the world database has at least a few of, by class,
// subclass and inventory type.
func ListItemKinds(serverRoot string) ([]ItemKind, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT t.class, t.subclass, t.inventory_type, COUNT(*) FROM item_template t WHERE %s "+
		"GROUP BY t.class, t.subclass, t.inventory_type HAVING COUNT(*) >= %d ORDER BY t.class, t.subclass, t.inventory_type", newestItemRow, minKindItems))
	if err != nil {
		return nil, err
	}
	var out []ItemKind
	for _, f := range batchRows(raw, 4) {
		n, ok := atoiAll(f)
		if !ok {
			continue
		}
		out = append(out, ItemKind{Class: n[0], Subclass: n[1], InvType: n[2], Count: n[3]})
	}
	return out, nil
}

// CreateItemOfKind adds an item named name of kind k under the first free entry, with the usual
// basics of the world database's items of that kind and none of their damage, stats or effects,
// and returns the entry.
func CreateItemOfKind(serverRoot string, k ItemKind, name string) (int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return 0, err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return 0, err
	}
	have := map[string]TemplateColumn{}
	for _, c := range cols {
		have[c.Name] = c
	}
	var read []string
	for _, c := range append(append([]string{}, kindBasics...), "delay", "max_durability") {
		if _, ok := have[c]; ok {
			read = append(read, c)
		}
	}
	quoted := make([]string, len(read))
	for i, c := range read {
		quoted[i] = "t.`" + c + "`"
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT %s FROM item_template t WHERE t.class = %d AND t.subclass = %d AND t.inventory_type = %d AND %s",
		strings.Join(quoted, ", "), k.Class, k.Subclass, k.InvType, newestItemRow))
	if err != nil {
		return 0, err
	}
	rows := batchRows(raw, len(read))
	if len(rows) == 0 {
		return 0, fmt.Errorf("the world database has no item of class %d, subclass %d and inventory type %d to start from", k.Class, k.Subclass, k.InvType)
	}
	values := usualItemValues(read, rows)
	entry, err := createTemplate(serverRoot, itemTable, "item", name, func(_ []TemplateColumn, entry int, name string) (string, error) {
		return kindItemSQL(have, entry, k, name, values)
	})
	if err == nil {
		forgetWeapons()
	}
	return entry, err
}

// usualItemValues is, for each column (cols, the rows' order), the value most rows have (the lowest
// of a tie), or for a kindMedians column the middle one.
func usualItemValues(cols []string, rows []batchRow) map[string]string {
	out := make(map[string]string, len(cols))
	for i, c := range cols {
		if kindMedians[c] {
			var nums []float64
			for _, r := range rows {
				if v, err := strconv.ParseFloat(r[i], 64); err == nil {
					nums = append(nums, v)
				}
			}
			if len(nums) > 0 {
				sort.Float64s(nums)
				out[c] = num(nums[len(nums)/2])
			}
			continue
		}
		counts := map[string]int{}
		for _, r := range rows {
			counts[r[i]]++
		}
		best, n := "", -1
		for v, k := range counts {
			if k > n || (k == n && lessNumeric(v, best)) {
				best, n = v, k
			}
		}
		if n > 0 && best != "NULL" {
			out[c] = best
		}
	}
	return out
}

// lessNumeric orders two values as numbers when both are, else as text.
func lessNumeric(a, b string) bool {
	x, err1 := strconv.ParseFloat(a, 64)
	y, err2 := strconv.ParseFloat(b, 64)
	if err1 == nil && err2 == nil {
		return x < y
	}
	return a < b
}

// kindItemSQL is the INSERT that makes item entry named name, of kind k, common, with values (by
// column) checked against the table's columns.
func kindItemSQL(cols map[string]TemplateColumn, entry int, k ItemKind, name string, values map[string]string) (string, error) {
	nameCol, ok := cols["name"]
	if !ok {
		nameCol = TemplateColumn{Name: "name", Kind: "text", MaxLen: 255}
	}
	nameSQL, err := sqlValue(nameCol, name)
	if err != nil {
		return "", err
	}
	names := []string{"`entry`", "`patch`", "`name`", "`class`", "`subclass`", "`inventory_type`", "`quality`"}
	vals := []string{strconv.Itoa(entry), "0", nameSQL, strconv.Itoa(k.Class), strconv.Itoa(k.Subclass), strconv.Itoa(k.InvType), "1"}
	keys := make([]string, 0, len(values))
	for c := range values {
		keys = append(keys, c)
	}
	sort.Strings(keys)
	for _, c := range keys {
		col, ok := cols[c]
		if !ok {
			continue
		}
		v, err := sqlValue(col, values[c])
		if err != nil {
			return "", err
		}
		names = append(names, "`"+c+"`")
		vals = append(vals, v)
	}
	return fmt.Sprintf("INSERT INTO `item_template` (%s) VALUES (%s);", strings.Join(names, ", "), strings.Join(vals, ", ")), nil
}
