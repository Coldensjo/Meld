package vmangos

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// NpcFlagVendor is creature_template.npc_flags' vendor bit (UNIT_NPC_FLAG_VENDOR in 1.12): without
// it the server opens no shop, whatever npc_vendor lists.
const NpcFlagVendor = 0x4

// VendorItem is one row of a creature's shop (npc_vendor): the item it sells, with the item's name
// and quality from item_template, how many it has in stock (0 for unlimited), the seconds before a
// sold-out stock comes back, the row's item flags and its condition.
type VendorItem struct {
	Item      int    `json:"item"`
	Name      string `json:"name"`
	Quality   int    `json:"quality"`
	DisplayID int    `json:"displayId"`
	MaxCount  int    `json:"maxCount"`
	IncrTime  int    `json:"incrTime"`
	ItemFlags int    `json:"itemFlags"`
	Condition int    `json:"condition"`
}

// Vendor is a creature's shop: its own npc_vendor rows in slot order, and the shared list it also
// sells from when its template names one (creature_template.vendor_id, npc_vendor_template), which
// the editor shows but doesn't change.
type Vendor struct {
	Items      []VendorItem `json:"items"`
	TemplateID int          `json:"templateId"`
	Template   []VendorItem `json:"template"`
}

// ItemRef is an item template by entry, with its name and quality, for picking an item.
type ItemRef struct {
	Entry     int    `json:"entry"`
	Name      string `json:"name"`
	Quality   int    `json:"quality"`
	DisplayID int    `json:"displayId"`
	// ItemLevel and RequiredLevel are filled in by SearchItems only.
	ItemLevel     int `json:"itemLevel,omitempty"`
	RequiredLevel int `json:"requiredLevel,omitempty"`
}

// itemNamesJoin joins each row's item to the newest patch of its item_template row, as `it`.
const itemNamesJoin = "LEFT JOIN (SELECT i.entry, i.name, i.quality, i.display_id FROM item_template i JOIN " +
	"(SELECT entry, MAX(patch) AS patch FROM item_template GROUP BY entry) n ON n.entry = i.entry AND n.patch = i.patch) it ON it.entry = v.item"

// vendorRowsSQL selects a vendor table's rows of entry, in slot order, with their item names.
func vendorRowsSQL(table string, entry int) string {
	return fmt.Sprintf("SELECT v.item, COALESCE(it.name, ''), COALESCE(it.quality, 0), COALESCE(it.display_id, 0), v.maxcount, v.incrtime, v.itemflags, v.condition_id "+
		"FROM `%s` v %s WHERE v.entry = %d ORDER BY v.slot, v.item", table, itemNamesJoin, entry)
}

// parseVendorItems reads vendorRowsSQL's output.
func parseVendorItems(raw []byte) []VendorItem {
	var items []VendorItem
	for _, f := range batchRows(raw, 8) {
		items = append(items, VendorItem{Item: f.num(0), Name: f[1], Quality: f.num(2), DisplayID: f.num(3), MaxCount: f.num(4), IncrTime: f.num(5), ItemFlags: f.num(6), Condition: f.num(7)})
	}
	return items
}

// ReadVendor reads creature template entry's shop.
func ReadVendor(serverRoot string, entry int) (Vendor, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return Vendor{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return Vendor{}, err
	}
	raw, err := runSQL(db, vendorRowsSQL("npc_vendor", entry))
	if err != nil {
		return Vendor{}, err
	}
	v := Vendor{Items: parseVendorItems(raw)}
	raw, err = runSQL(db, fmt.Sprintf("SELECT `vendor_id` FROM `creature_template` WHERE `entry` = %d ORDER BY `patch` DESC LIMIT 1", entry))
	if err != nil {
		return Vendor{}, err
	}
	v.TemplateID, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
	if v.TemplateID > 0 {
		raw, err = runSQL(db, vendorRowsSQL("npc_vendor_template", v.TemplateID))
		if err != nil {
			return Vendor{}, err
		}
		v.Template = parseVendorItems(raw)
	}
	return v, nil
}

// vendorSQL replaces creature entry's npc_vendor rows with items, numbered by slot in their order.
// An item listed twice is refused, as the table's key is (entry, item).
func vendorSQL(entry int, items []VendorItem) (string, error) {
	seen := map[int]bool{}
	var b strings.Builder
	fmt.Fprintf(&b, "DELETE FROM `npc_vendor` WHERE `entry` = %d;", entry)
	for slot, it := range items {
		if it.Item <= 0 {
			return "", fmt.Errorf("the shop has an item with no entry")
		}
		if seen[it.Item] {
			return "", fmt.Errorf("item %d is in the shop twice", it.Item)
		}
		seen[it.Item] = true
		if it.MaxCount < 0 || it.MaxCount > 255 {
			return "", fmt.Errorf("item %d: the stock must be 0 (unlimited) to 255", it.Item)
		}
		if it.IncrTime < 0 || it.ItemFlags < 0 || it.Condition < 0 {
			return "", fmt.Errorf("item %d: the restock time, flags and condition can't be negative", it.Item)
		}
		fmt.Fprintf(&b, "\nINSERT INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`, `incrtime`, `itemflags`, `condition_id`) VALUES (%d, %d, %d, %d, %d, %d, %d);",
			entry, slot, it.Item, it.MaxCount, it.IncrTime, it.ItemFlags, it.Condition)
	}
	return b.String(), nil
}

// SaveVendor replaces creature template entry's shop with items (in slot order) and returns the
// SQL it ran. Every item must exist in item_template.
func SaveVendor(serverRoot string, entry int, items []VendorItem) (string, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return "", err
	}
	ids := make([]int, len(items))
	for i, it := range items {
		ids[i] = it.Item
	}
	known, err := knownEntries(db, itemTable, ids)
	if err != nil {
		return "", err
	}
	for _, it := range items {
		if !known[it.Item] {
			return "", fmt.Errorf("the world database has no item %d", it.Item)
		}
	}
	sql, err := vendorSQL(entry, items)
	if err != nil {
		return "", err
	}
	return sql, runScript(db, sql)
}

// SearchItems lists the item templates whose name has text in it, or whose entry is text, by
// name, at most limit of them.
func SearchItems(serverRoot, text string, limit int) ([]ItemRef, error) {
	return SearchItemsSorted(serverRoot, text, "name", false, limit)
}

// itemSorts maps the sort keys SearchItemsSorted takes to their item_template columns.
var itemSorts = map[string]string{
	"name":          "i.name",
	"entry":         "i.entry",
	"quality":       "i.quality",
	"itemLevel":     "i.item_level",
	"requiredLevel": "i.required_level",
}

// itemOrder builds SearchItemsSorted's ORDER BY clause from a whitelisted key (an unknown one
// sorts by name), with the name and the entry breaking ties.
func itemOrder(sort string, desc bool) string {
	col, ok := itemSorts[sort]
	if !ok {
		col = "i.name"
	}
	dir := ""
	if desc {
		dir = " DESC"
	}
	order := col + dir
	if col != "i.name" && col != "i.entry" {
		order += ", i.name"
	}
	if col != "i.entry" {
		order += ", i.entry"
	}
	return order
}

// SearchItemsSorted is SearchItems with the matches ordered by sort (a key of itemSorts) before
// the limit, so a broad search gives the best or highest items, not only the first by name.
func SearchItemsSorted(serverRoot, text, sort string, desc bool, limit int) ([]ItemRef, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	match := "i.name LIKE " + likePattern(text)
	if n, err := strconv.Atoi(text); err == nil {
		match = fmt.Sprintf("(%s OR i.entry = %d)", match, n)
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT i.entry, i.name, i.quality, i.display_id, i.item_level, i.required_level FROM item_template i JOIN "+
		"(SELECT entry, MAX(patch) AS patch FROM item_template GROUP BY entry) n ON n.entry = i.entry AND n.patch = i.patch "+
		"WHERE %s ORDER BY %s LIMIT %d", match, itemOrder(sort, desc), max(limit, 1)))
	if err != nil {
		return nil, err
	}
	var out []ItemRef
	for _, f := range batchRows(raw, 6) {
		out = append(out, ItemRef{Entry: f.num(0), Name: f[1], Quality: f.num(2), DisplayID: f.num(3), ItemLevel: f.num(4), RequiredLevel: f.num(5)})
	}
	return out, nil
}

// ReadItem reads item template entry's newest patch row, every column by name (the columns differ
// between VMaNGOS versions), for the Shop tab's tooltips.
func ReadItem(serverRoot string, entry int) (map[string]string, error) {
	rec, err := ReadItemTemplate(serverRoot, entry)
	if err != nil {
		return nil, err
	}
	rec.Values["entry"] = strconv.Itoa(rec.Entry)
	rec.Values["patch"] = strconv.Itoa(rec.Patch)
	return rec.Values, nil
}

// itemIcons is ItemDisplayInfo.dbc's icon name by display, read once per client data folder.
var itemIcons struct {
	sync.Mutex
	dir   string
	icons map[int]string
}

// ItemIcons gives the inventory icon of each display (ItemDisplayInfo.dbc field 5, a name under
// Interface\Icons), leaving out displays the client doesn't have or that have no icon.
func ItemIcons(dataDir string, displays []int) (map[int]string, error) {
	itemIcons.Lock()
	defer itemIcons.Unlock()
	if itemIcons.icons == nil || itemIcons.dir != dataDir {
		set, err := mpq.OpenDataDir(dataDir)
		if err != nil {
			return nil, err
		}
		b, err := set.ReadFile(`DBFilesClient\ItemDisplayInfo.dbc`)
		set.Close()
		if err != nil {
			return nil, err
		}
		t, err := parseDBC(b)
		if err != nil {
			return nil, err
		}
		icons := make(map[int]string, t.records)
		if t.fields > 5 {
			for r := 0; r < t.records; r++ {
				if name := t.str(r, 5); name != "" {
					icons[int(t.u32(r, 0))] = name
				}
			}
		}
		itemIcons.dir, itemIcons.icons = dataDir, icons
	}
	out := make(map[int]string, len(displays))
	for _, d := range displays {
		if name, ok := itemIcons.icons[d]; ok {
			out[d] = name
		}
	}
	return out, nil
}
