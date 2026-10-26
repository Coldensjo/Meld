package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// The item editor's look pickers (#353): every item display of the client (ItemDisplayInfo.dbc) with
// its icon and the items that use it, and every icon the client has. An item takes a display; an icon
// of its own is a display too, so picking another icon for an item's model finds the display that
// already pairs them, or adds one to ItemDisplayInfo.dbc in Meld's patch.

// ItemDisplayPath is ItemDisplayInfo.dbc's name in the client's archives.
const ItemDisplayPath = `DBFilesClient\ItemDisplayInfo.dbc`

// ItemDisplayInfo.dbc in 1.12: 23 fields. These are the ones the pickers read; 1-4 and 14-21 are
// strings (the models, their textures and the body-region textures).
const (
	itemDisplayFields = 23
	idModel           = 1
	idModel2          = 2
	idTexture         = 3
	idIcon            = 5
	// idVisual is the SpellVisual a basic shot of the item plays (the bow's, the crossbow's, the
	// gun's fire clip and missile), which the game takes from the ranged weapon's display.
	idVisual = 10
)

// rangedSubclasses are the weapon subclasses a basic shot fires from: bow, gun, thrown, crossbow, wand.
var rangedSubclasses = map[int]bool{2: true, 3: true, 16: true, 18: true, 19: true}

// itemDisplayStrings are ItemDisplayInfo's string fields.
var itemDisplayStrings = map[int]bool{1: true, 2: true, 3: true, 4: true, 5: true, 14: true, 15: true, 16: true, 17: true, 18: true, 19: true, 20: true, 21: true}

// ItemDisplayEntry is an item display as the look picker lists it: its icon, its model (a name
// without its folder, "" for none), where it goes ("weapon", "shield", "held", "ranged", "head",
// "shoulder", "back", "body", "jewelry" or "other"), and the items of the world database that use
// it, the first few by name.
type ItemDisplayEntry struct {
	ID    int      `json:"id"`
	Icon  string   `json:"icon"`
	Model string   `json:"model"`
	Kind  string   `json:"kind"`
	Uses  int      `json:"uses"`
	Names []string `json:"names"`
	// Path and Skin are the model's client path where its kind keeps it (a helm as a human man's)
	// and the look query that skins it, for a thumbnail; "" for a display without a model.
	Path string `json:"path"`
	Skin string `json:"skin"`
	// Visual is the display's shot visual (field 10), and Shoots the weapon subclass whose items'
	// displays mostly have that visual (2 bow, 3 gun, 16 thrown, 18 crossbow, 19 wand), -1 for none:
	// a bow on a display that shoots like a crossbow is fired like one in the game.
	Visual int `json:"visual"`
	Shoots int `json:"shoots"`
}

var (
	itemDisplaysMu    sync.Mutex
	itemDisplaysCache = map[string][]ItemDisplayEntry{}
	itemIconListCache = map[string][]string{}
)

// invKind is where an item of inventory type t goes, as the look picker groups displays.
func invKind(t int) string {
	switch t {
	case 13, 17, 21, 22:
		return "weapon"
	case 14:
		return "shield"
	case 23:
		return "held"
	case 15, 25, 26:
		return "ranged"
	case 1:
		return "head"
	case 3:
		return "shoulder"
	case 16:
		return "back"
	case 4, 5, 6, 7, 8, 9, 10, 19, 20:
		return "body"
	case 2, 11, 12:
		return "jewelry"
	}
	return "other"
}

// modelKind guesses where a display no item uses goes, from its model's name.
func modelKind(model string, bodyTextures bool) string {
	m := strings.ToLower(model)
	switch {
	case strings.HasPrefix(m, "helm_"):
		return "head"
	case strings.HasPrefix(m, "lshoulder_"), strings.HasPrefix(m, "rshoulder_"):
		return "shoulder"
	case strings.HasPrefix(m, "shield_"), strings.HasPrefix(m, "buckler_"):
		return "shield"
	case strings.HasPrefix(m, "bow_"), strings.HasPrefix(m, "firearm_"), strings.HasPrefix(m, "crossbow_"), strings.HasPrefix(m, "thrown_"):
		return "ranged"
	case m == "" && bodyTextures:
		return "body"
	case m == "":
		return "other"
	}
	for _, w := range []string{"sword_", "axe_", "mace_", "hammer_", "staff_", "polearm_", "knife_", "dagger_", "glaive_", "spear_", "wand_", "fist_", "claw_", "stave_"} {
		if strings.HasPrefix(m, w) {
			return "weapon"
		}
	}
	return "other"
}

// ListItemDisplays lists every item display of the client with the items that use it (when the
// world database can be read). The list is made once per client and server.
func ListItemDisplays(serverRoot, dataDir string) ([]ItemDisplayEntry, error) {
	key := dataDir + "|" + serverRoot
	itemDisplaysMu.Lock()
	defer itemDisplaysMu.Unlock()
	if d, ok := itemDisplaysCache[key]; ok {
		return d, nil
	}
	b, err := readClientFile(dataDir, ItemDisplayPath)
	if err != nil {
		return nil, err
	}
	t, err := parseDBC(b)
	if err != nil {
		return nil, err
	}
	if t.fields < itemDisplayFields-1 {
		return nil, fmt.Errorf("ItemDisplayInfo.dbc has %d fields, not 1.12's %d", t.fields, itemDisplayFields)
	}
	var rows []batchRow
	if serverRoot != "" {
		if db, err := worldDatabase(serverRoot); err == nil && ensureDatabase(db, serverRoot) == nil {
			raw, err := runSQL(db, "SELECT i.display_id, i.inventory_type, i.name, i.class, i.subclass FROM item_template i "+
				"WHERE i.display_id <> 0 AND i.patch = (SELECT MAX(patch) FROM item_template WHERE entry = i.entry) ORDER BY i.name")
			if err == nil {
				rows = batchRows(raw, 5)
			}
		}
	}
	out := listItemDisplays(t, rows)
	itemDisplaysCache[key] = out
	return out, nil
}

// listItemDisplays makes the display list from the table and the items' rows (display, inventory
// type, name, class, subclass, by name), by ID.
func listItemDisplays(t *dbcTable, rows []batchRow) []ItemDisplayEntry {
	shoots := shotSubclasses(t, rows)
	type use struct {
		kinds map[string]int
		names []string
	}
	uses := map[int]*use{}
	for _, f := range rows {
		d, err1 := strconv.Atoi(f[0])
		inv, err2 := strconv.Atoi(f[1])
		if err1 != nil || err2 != nil {
			continue
		}
		u := uses[d]
		if u == nil {
			u = &use{kinds: map[string]int{}}
			uses[d] = u
		}
		u.kinds[invKind(inv)]++
		u.names = append(u.names, f[2])
	}
	out := make([]ItemDisplayEntry, 0, t.records)
	for r := 0; r < t.records; r++ {
		e := ItemDisplayEntry{ID: int(t.u32(r, 0)), Icon: t.str(r, idIcon), Model: trimModelExt(t.str(r, idModel)), Shoots: -1}
		if t.fields > idVisual {
			e.Visual = int(t.u32(r, idVisual))
			if sub, ok := shoots[e.Visual]; ok && e.Visual != 0 {
				e.Shoots = sub
			}
		}
		bodyTextures := false
		for f := 14; f <= 21 && f < t.fields; f++ {
			bodyTextures = bodyTextures || t.str(r, f) != ""
		}
		if u := uses[e.ID]; u != nil {
			best := -1
			for k, n := range u.kinds {
				if n > best || (n == best && k < e.Kind) {
					e.Kind, best = k, n
				}
			}
			e.Uses = len(u.names)
			e.Names = u.names
			if len(e.Names) > 5 {
				e.Names = e.Names[:5]
			}
		} else {
			e.Kind = modelKind(e.Model, bodyTextures)
		}
		e.Path, e.Skin = displayModel(e.Kind, t.str(r, idModel), t.str(r, idTexture))
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// shotSubclasses gives each shot visual the ranged weapon subclass whose items' displays have it
// most, from the world database's items (rows as listItemDisplays reads them).
func shotSubclasses(t *dbcTable, rows []batchRow) map[int]int {
	votes := map[int]map[int]int{}
	for _, f := range rows {
		if len(f) < 5 || f[3] != "2" {
			continue
		}
		d, err1 := strconv.Atoi(f[0])
		sub, err2 := strconv.Atoi(f[4])
		if err1 != nil || err2 != nil || !rangedSubclasses[sub] {
			continue
		}
		r, ok := t.row(uint32(d))
		if !ok || t.fields <= idVisual {
			continue
		}
		v := int(t.u32(r, idVisual))
		if votes[v] == nil {
			votes[v] = map[int]int{}
		}
		votes[v][sub]++
	}
	out := map[int]int{}
	for v, by := range votes {
		best := -1
		for sub, n := range by {
			if n > best || (n == best && sub < out[v]) {
				out[v], best = sub, n
			}
		}
	}
	return out
}

// displayModel is the client path of a display's model by where it goes, and the look query that
// skins it. A helm is the human man's of its models; body armour and the rest have no model to show.
func displayModel(kind, name, texture string) (string, string) {
	if name == "" {
		return "", ""
	}
	dir := weaponItems
	switch kind {
	case "shield":
		dir = shieldItems
	case "shoulder":
		dir = shoulderItems
	case "head":
		dir = headItems
		name = trimModelExt(name[strings.LastIndex(name, `\`)+1:]) + "_HuM.mdx"
	case "weapon", "ranged", "held":
	default:
		return "", ""
	}
	model, tex := itemPaths(name, dir, texture)
	if tex == "" {
		return model, ""
	}
	return model, wow.Look{Textures: map[int]string{wow.TexItem: tex}}.Query()
}

// ListItemIcons lists the icons the client has (the names under Interface\Icons, without the
// folder and .blp), by name. The list is made once per client.
func ListItemIcons(dataDir string) ([]string, error) {
	itemDisplaysMu.Lock()
	defer itemDisplaysMu.Unlock()
	if l, ok := itemIconListCache[dataDir]; ok {
		return l, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	// The icons added while the game ran (#364) are listed before the patch has them.
	out := iconNames(append(set.List(), pendingFileNames(dataDir)...))
	if len(out) == 0 {
		return nil, errors.New("the client's archives list no icons")
	}
	itemIconListCache[dataDir] = out
	return out, nil
}

// iconNames picks the icons from a listing of the client's files.
func iconNames(files []string) []string {
	const dir = `interface\icons\`
	seen := map[string]bool{}
	var out []string
	for _, f := range files {
		l := strings.ToLower(f)
		if !strings.HasPrefix(l, dir) || !strings.HasSuffix(l, ".blp") || strings.Contains(l[len(dir):], `\`) {
			continue
		}
		name := f[len(dir) : len(f)-len(".blp")]
		if k := strings.ToLower(name); !seen[k] {
			seen[k] = true
			out = append(out, name)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	return out
}

// readClientFile reads a file of the client as the game sees it, Meld's patch and the files waiting
// for the game to close (readOverlay) included.
func readClientFile(dataDir, name string) ([]byte, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	return readOverlay(set, dataDir, name)
}

// IconDisplay is the display ItemDisplayVariant settled on, and whether it was added to the patch.
type IconDisplay struct {
	ID    int  `json:"id"`
	Added bool `json:"added"`
}

// ItemDisplayVariant is the display that shows display's model with icon ("" keeps its own) and
// shot visual visual (-1 keeps its own): display itself when it has them already, else a display that
// pairs the same model, textures and the rest with them, else a new one. For a new one it also
// returns ItemDisplayInfo.dbc with the row added, for the caller to write into the patch; nil when
// nothing is to be written.
func ItemDisplayVariant(dataDir string, display int, icon string, visual int) (int, []byte, error) {
	icon = strings.TrimSpace(icon)
	if strings.ContainsAny(icon, "\x00\\/") {
		return 0, nil, fmt.Errorf("%q is not an icon name", icon)
	}
	b, err := readClientFile(dataDir, ItemDisplayPath)
	if err != nil {
		return 0, nil, err
	}
	return itemDisplayVariant(b, uint32(max(display, 0)), icon, visual)
}

func itemDisplayVariant(dbc []byte, display uint32, icon string, visual int) (int, []byte, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return 0, nil, err
	}
	if t.fields <= idVisual || t.recSize != t.fields*4 {
		return 0, nil, errors.New("ItemDisplayInfo.dbc is not a table of 32-bit fields")
	}
	base, hasBase := t.row(display)
	if icon == "" && hasBase {
		icon = t.str(base, idIcon)
	}
	if icon == "" {
		return 0, nil, errors.New("a look without a display needs an icon")
	}
	wantVisual := uint32(0)
	if visual >= 0 {
		wantVisual = uint32(visual)
	} else if hasBase {
		wantVisual = t.u32(base, idVisual)
	}
	same := func(r int) bool {
		if !strings.EqualFold(t.str(r, idIcon), icon) || t.u32(r, idVisual) != wantVisual {
			return false
		}
		for f := 1; f < t.fields; f++ {
			if f == idIcon || f == idVisual {
				continue
			}
			if itemDisplayStrings[f] {
				if hasBase && !strings.EqualFold(t.str(r, f), t.str(base, f)) || !hasBase && t.str(r, f) != "" {
					return false
				}
			} else if hasBase && t.u32(r, f) != t.u32(base, f) || !hasBase && t.u32(r, f) != 0 {
				return false
			}
		}
		return true
	}
	if hasBase && same(base) {
		return int(display), nil, nil
	}
	maxID := uint32(0)
	for r := 0; r < t.records; r++ {
		if same(r) {
			return int(t.u32(r, 0)), nil, nil
		}
		maxID = max(maxID, t.u32(r, 0))
	}
	// A new row: the base's fields (its string offsets stay valid, the block is kept), the new ID,
	// the visual, and the icon's name added to the string block.
	rec := make([]byte, t.recSize)
	if hasBase {
		copy(rec, t.data[20+base*t.recSize:20+(base+1)*t.recSize])
	}
	strs := append([]byte(nil), t.data[t.strsAt:]...)
	if len(strs) == 0 {
		strs = []byte{0}
	}
	id := maxID + 1
	binary.LittleEndian.PutUint32(rec[0:], id)
	binary.LittleEndian.PutUint32(rec[idVisual*4:], wantVisual)
	binary.LittleEndian.PutUint32(rec[idIcon*4:], uint32(len(strs)))
	strs = append(append(strs, icon...), 0)
	out := make([]byte, 0, len(dbc)+len(rec)+len(icon)+1)
	out = append(out, "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(t.records+1))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.fields))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.recSize))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(strs)))
	out = append(out, t.data[20:t.strsAt]...)
	out = append(out, rec...)
	return int(id), append(out, strs...), nil
}

// ForgetItemDisplays drops what was read of ItemDisplayInfo.dbc (the model tables, the icons by
// display, the display list), after a display was added to the patch.
func ForgetItemDisplays() {
	tablesMu.Lock()
	clear(tablesCache)
	tablesMu.Unlock()
	itemIcons.Lock()
	itemIcons.icons = nil
	itemIcons.Unlock()
	itemDisplaysMu.Lock()
	clear(itemDisplaysCache)
	itemDisplaysMu.Unlock()
}

// forgetItemDisplayUses drops the display list, whose "used by" changed after an item was saved.
func forgetItemDisplayUses() {
	itemDisplaysMu.Lock()
	clear(itemDisplaysCache)
	itemDisplaysMu.Unlock()
}
