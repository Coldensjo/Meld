package vmangos

import (
	"fmt"
	"strconv"
	"strings"

	"Meld/internal/wow"
)

// The item editor (#353) edits item_template: every column of an item's newest patch row, a new
// item from scratch or as a copy, and items written to and read from an SQL script of REPLACE
// statements, the form of the server's own sql files. What an item looks like comes from the
// client's ItemDisplayInfo.dbc, which the editor only picks from: a new display would be client
// table writing.

const itemTable = "item_template"

// ReadItemTemplate reads item template entry: its newest patch's row, for the item editor.
func ReadItemTemplate(serverRoot string, entry int) (TemplateRecord, error) {
	return readTemplate(serverRoot, itemTable, "item", entry)
}

// SaveItem writes changed values (by column) into item template entry's row of patch patch, and
// returns the SQL it ran.
func SaveItem(serverRoot string, entry, patch int, values map[string]string) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return "", err
	}
	if v, ok := values["name"]; ok && strings.TrimSpace(v) == "" {
		return "", refuse("name", "an item needs a name")
	}
	sql, err := templateUpdateSQL(itemTable, cols, entry, patch, values)
	if err != nil || sql == "" {
		return sql, err
	}
	if err := runScript(db, sql); err != nil {
		return "", err
	}
	forgetWeapons()
	return sql, nil
}

// CreateItem adds an item named name under the first free entry and returns the entry. It copies
// item base (its newest patch) when base is not 0, else it starts as a common junk item that
// stacks to one and has no display.
func CreateItem(serverRoot string, base int, name string) (int, error) {
	entry, err := createTemplate(serverRoot, itemTable, "item", name, func(cols []TemplateColumn, entry int, name string) (string, error) {
		return createItemSQL(cols, entry, base, name)
	})
	if err == nil {
		forgetWeapons()
	}
	return entry, err
}

// createItemSQL is the INSERT that makes item entry named name, a copy of base's newest patch row
// or (base 0) a common junk item.
func createItemSQL(cols []TemplateColumn, entry, base int, name string) (string, error) {
	nameCol := TemplateColumn{Name: "name", Kind: "text", MaxLen: 255}
	for _, c := range cols {
		if c.Name == "name" {
			nameCol = c
		}
	}
	nameSQL, err := sqlValue(nameCol, name)
	if err != nil {
		return "", err
	}
	if base == 0 {
		return fmt.Sprintf("INSERT INTO `item_template` (`entry`, `patch`, `class`, `subclass`, `name`, `quality`, `stackable`, `buy_count`) "+
			"VALUES (%d, 0, 15, 0, %s, 1, 1, 1);", entry, nameSQL), nil
	}
	return copyTemplateSQL(itemTable, cols, entry, base, "name", nameSQL), nil
}

// forgetWeapons drops the cached lists of held items and the displays' uses, after an item was
// saved, made or imported.
func forgetWeapons() {
	weaponsMu.Lock()
	clear(weaponsCache)
	weaponsMu.Unlock()
	forgetItemDisplayUses()
}

// itemLootTables are the loot tables whose rows drop an item by its entry (`item`), unless the row is
// a reference to a reference_loot_template list (a negative mincountOrRef), whose `item` is that
// list's id, not an item.
var itemLootTables = []string{
	"creature_loot_template", "gameobject_loot_template", "item_loot_template", "pickpocketing_loot_template",
	"skinning_loot_template", "fishing_loot_template", "disenchant_loot_template", "mail_loot_template",
	"reference_loot_template",
}

// itemQuestColumns are the quest_template columns that name an item, each with the count column
// beside it: the item a quest hands out at the start, the items it asks for (and drops for it), and
// its rewards.
var itemQuestColumns = [][2]string{
	{"SrcItemId", "SrcItemCount"},
	{"ReqItemId1", "ReqItemCount1"}, {"ReqItemId2", "ReqItemCount2"}, {"ReqItemId3", "ReqItemCount3"}, {"ReqItemId4", "ReqItemCount4"},
	{"ReqSourceId1", "ReqSourceCount1"}, {"ReqSourceId2", "ReqSourceCount2"}, {"ReqSourceId3", "ReqSourceCount3"}, {"ReqSourceId4", "ReqSourceCount4"},
	{"RewItemId1", "RewItemCount1"}, {"RewItemId2", "RewItemCount2"}, {"RewItemId3", "RewItemCount3"}, {"RewItemId4", "RewItemCount4"},
	{"RewChoiceItemId1", "RewChoiceItemCount1"}, {"RewChoiceItemId2", "RewChoiceItemCount2"}, {"RewChoiceItemId3", "RewChoiceItemCount3"},
	{"RewChoiceItemId4", "RewChoiceItemCount4"}, {"RewChoiceItemId5", "RewChoiceItemCount5"}, {"RewChoiceItemId6", "RewChoiceItemCount6"},
}

// itemDeleteRows are the rows deleting an item removes, by table and the WHERE that finds them: the
// shops that sell it, the loot that drops it, its own contents (item_loot_template's list of the
// item, as for a bag of loot), its translations and target rules, and last its item_template rows.
// The tables are MyISAM, so the script is not one transaction: with the template last, a delete
// that stops part way leaves the item to delete again.
func itemDeleteRows(item int) []struct{ table, where string } {
	rows := []struct{ table, where string }{
		{"npc_vendor", fmt.Sprintf("`item` = %d", item)},
		{"npc_vendor_template", fmt.Sprintf("`item` = %d", item)},
	}
	for _, t := range itemLootTables {
		where := fmt.Sprintf("`item` = %d AND `mincountOrRef` >= 0", item)
		if t == "item_loot_template" {
			where = fmt.Sprintf("`entry` = %d OR (%s)", item, where)
		}
		rows = append(rows, struct{ table, where string }{t, where})
	}
	return append(rows,
		struct{ table, where string }{"item_required_target", fmt.Sprintf("`entry` = %d", item)},
		struct{ table, where string }{"locales_item", fmt.Sprintf("`entry` = %d", item)},
		struct{ table, where string }{itemTable, fmt.Sprintf("`entry` = %d", item)})
}

// itemKeptRows are the rows that name an item which deleting it leaves alone, for the confirmation
// to warn of: a creature's equipment, a new character's starting items, premade characters' gear,
// and the auction house bot's list.
func itemKeptRows(item int) []struct{ table, where string } {
	return []struct{ table, where string }{
		{"creature_equip_template", fmt.Sprintf("%[1]d IN (`item1`, `item2`, `item3`)", item)},
		{"playercreateinfo_item", fmt.Sprintf("`itemid` = %d", item)},
		{"player_premade_item", fmt.Sprintf("`item` = %d", item)},
		{"auctionhousebot", fmt.Sprintf("`item` = %d", item)},
	}
}

// deleteItemSQL deletes item's rows (itemDeleteRows) after clearing the quest columns that name it
// (the item and its count set to 0), so the template goes last.
func deleteItemSQL(item int) string {
	var b strings.Builder
	for _, c := range itemQuestColumns {
		fmt.Fprintf(&b, "UPDATE `quest_template` SET `%[1]s` = 0, `%[2]s` = 0 WHERE `%[1]s` = %[3]d;\n", c[0], c[1], item)
	}
	for _, r := range itemDeleteRows(item) {
		fmt.Fprintf(&b, "DELETE FROM `%s` WHERE %s;\n", r.table, r.where)
	}
	return strings.TrimSuffix(b.String(), "\n")
}

// ItemDeletePlan is what deleting an item removes and leaves dangling, for the confirmation.
type ItemDeletePlan struct {
	Name string `json:"name"`
	// Rows has the tables that lose rows (empty ones left out).
	Rows []QuestDeleteCount `json:"rows"`
	// Quests are the quests that name it; deleting clears those columns (and their counts) to 0.
	Quests []QuestLink `json:"quests"`
	// Kept has the tables whose rows name it and are left alone (itemKeptRows), empty ones left out.
	Kept []QuestDeleteCount `json:"kept"`
	// Characters is how many characters own one (carried, banked or in the mail), whose rows are
	// left alone; -1 when the characters database could not be read.
	Characters int `json:"characters"`
}

// PlanItemDelete reads what DeleteItem would remove and leave, changing nothing.
func PlanItemDelete(serverRoot string, entry int) (ItemDeletePlan, error) {
	plan := ItemDeletePlan{Rows: []QuestDeleteCount{}, Quests: []QuestLink{}, Kept: []QuestDeleteCount{}, Characters: -1}
	db, err := openWorld(serverRoot)
	if err != nil {
		return plan, err
	}
	rec, err := ReadItemTemplate(serverRoot, entry)
	if err != nil {
		return plan, err
	}
	plan.Name = rec.Values["name"]
	count := func(rows []struct{ table, where string }, into *[]QuestDeleteCount) error {
		for _, r := range rows {
			raw, err := runSQL(db, fmt.Sprintf("SELECT COUNT(*) FROM `%s` WHERE %s", r.table, r.where))
			if err != nil {
				return err
			}
			if n, _ := strconv.Atoi(strings.TrimSpace(string(raw))); n > 0 {
				*into = append(*into, QuestDeleteCount{r.table, n})
			}
		}
		return nil
	}
	if err := count(itemDeleteRows(entry), &plan.Rows); err != nil {
		return plan, err
	}
	if err := count(itemKeptRows(entry), &plan.Kept); err != nil {
		return plan, err
	}
	var parts []string
	for _, c := range itemQuestColumns {
		parts = append(parts, fmt.Sprintf("SELECT q.`entry`, '%[1]s', COALESCE((SELECT t.`Title` FROM `quest_template` t WHERE t.`entry` = q.`entry` ORDER BY t.`patch` DESC LIMIT 1), '') "+
			"FROM `quest_template` q WHERE q.`%[1]s` = %[2]d", c[0], entry))
	}
	raw, err := runSQL(db, strings.Join(parts, " UNION ")+" ORDER BY 1")
	if err != nil {
		return plan, err
	}
	for _, f := range batchRows(raw, 3) {
		q, _ := strconv.Atoi(f[0])
		if n := len(plan.Quests); n > 0 && plan.Quests[n-1].Quest == q {
			plan.Quests[n-1].Columns = append(plan.Quests[n-1].Columns, f[1])
			continue
		}
		plan.Quests = append(plan.Quests, QuestLink{Quest: q, Title: f[2], Columns: []string{f[1]}})
	}
	if cdb, err := confDatabase(serverRoot, "CharacterDatabase.Info"); err == nil {
		if raw, err := runSQL(cdb, fmt.Sprintf("SELECT COUNT(DISTINCT owner_guid) FROM item_instance WHERE item_id = %d", entry)); err == nil {
			if n, err := strconv.Atoi(strings.TrimSpace(string(raw))); err == nil {
				plan.Characters = n
			}
		}
	}
	return plan, nil
}

// DeleteItem removes item template entry from the world database (every patch row, its
// translations, contents and target rules), the shop and loot rows that name it, and clears the
// quest columns that name it, and returns the SQL. Characters' items are left alone.
func DeleteItem(serverRoot string, entry int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	if have, err := knownEntries(db, itemTable, []int{entry}); err != nil {
		return "", err
	} else if !have[entry] {
		return "", fmt.Errorf("the world database has no item %d", entry)
	}
	sql := deleteItemSQL(entry)
	if err := runScript(db, sql); err != nil {
		return "", err
	}
	forgetWeapons()
	return sql, nil
}

// ExportItems is an SQL script that puts items back as they are now: every patch row of each
// entry, as REPLACE statements that name their columns, so the script loads on a server whose
// table has its columns in another order.
func ExportItems(serverRoot string, entries []int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return "", err
	}
	return exportScript(db, itemScript, cols, entries, nil)
}

// ItemImport is what an SQL script of items would write: its item rows, and what of it is left
// out.
type ItemImport struct {
	Items []ItemImportRow `json:"items"`
	// Skipped is how many statements are not item_template rows (a DELETE, another table), which
	// importing leaves out.
	Skipped int `json:"skipped"`
	// Unknown are columns the script names that this server's item_template lacks, left out.
	Unknown []string `json:"unknown"`
}

// ItemImportRow is one item row of a script: its entry, patch and name, and whether the world
// database has that row already, which importing replaces.
type ItemImportRow struct {
	Entry  int    `json:"entry"`
	Patch  int    `json:"patch"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
}

// PlanItemImport reads an SQL script of items and says what importing it would write, without
// writing anything.
func PlanItemImport(serverRoot, script string) (ItemImport, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return ItemImport{}, err
	}
	plan, err := readScript(db, itemScript, script)
	if err != nil {
		return ItemImport{}, err
	}
	have, err := existingRows(db, itemScript, plan)
	if err != nil {
		return ItemImport{}, err
	}
	out := ItemImport{Skipped: plan.skipped, Unknown: plan.unknown}
	for _, k := range plan.keys {
		out.Items = append(out.Items, ItemImportRow{Entry: k.entry, Patch: k.key, Name: k.name, Exists: have[rowKey(k.entry, k.key)]})
	}
	return out, nil
}

// ImportItems writes the item rows of an SQL script into the world database, replacing rows of the
// same entry and patch, and returns the entries it wrote. Every row is checked against the table's
// columns first, and nothing is written if one is refused.
func ImportItems(serverRoot, script string) ([]int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return nil, err
	}
	plan, err := importScript(db, itemScript, cols, script)
	if err != nil {
		return nil, err
	}
	forgetWeapons()
	return plan.entries(), nil
}

// ItemLook is how the item editor shows an item: a character of the chosen race and sex holding or
// wearing it, and the item's own model alone. A model is "" when there is none to show.
type ItemLook struct {
	// Model and Look are the character, dressed (wow.Look's query).
	Model string  `json:"model"`
	Look  string  `json:"look"`
	Scale float32 `json:"scale"`
	// Shown says the character shows the item: held in a hand or on the shield arm, worn on the head
	// or shoulders, painted onto the body (#356) or hung on the back as a cloak.
	Shown bool `json:"shown"`
	// Item and ItemLook are the item's own model and the look that skins it.
	Item     string `json:"item"`
	ItemLook string `json:"itemLook"`
}

// Inventory types (INVTYPE_*) the character shows.
const (
	invHead      = 1
	invShoulder  = 3
	invWeapon    = 13
	inv2HWeapon  = 17
	invMainHand  = 21
	invOffHand   = 22
	invHoldable  = 23
	invRangedRgt = 26
	invCloak     = 16
)

// wearSlotOf is the wear slot an item of inventory type t goes in (shirt, chest and robe, waist,
// legs, feet, wrists, hands, tabard, head, shoulders), -1 for one held or not worn.
func wearSlotOf(t int) int {
	switch t {
	case invHead:
		return wearHelm
	case invShoulder:
		return wearShoulder
	case 4:
		return wearShirt
	case 5, 20:
		return wearChest
	case 6:
		return wearBelt
	case 7:
		return wearLegs
	case 8:
		return wearBoots
	case 9:
		return wearWrist
	case 10:
		return wearGloves
	case 19:
		return wearTabard
	}
	return -1
}

// ItemModelLook is an item display shown as inventory type invType has it: on a character of race
// and sex (0 male, 1 female), and alone.
func ItemModelLook(dataDir string, display, invType, race, sex int) (ItemLook, error) {
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return ItemLook{}, err
	}
	return tables.itemModelLook(uint32(max(display, 0)), invType, race, sex), nil
}

func (m *modelTables) itemModelLook(display uint32, invType, race, sex int) ItemLook {
	var out ItemLook
	stand := m.standIn(race, sex)
	it := heldItem{display: display, invType: invType}
	g := gear{sheath: sheathMelee}
	switch invType {
	case invWeapon, inv2HWeapon, invMainHand:
		g.weapons[0] = it
	case invShield, invOffHand, invHoldable:
		g.weapons[1] = it
	case invRanged, invThrown, invRangedRgt:
		g.weapons[2] = it
		g.sheath = sheathRanged
	}
	var worn [wearSlots]int
	for i := range worn {
		worn[i] = -1
	}
	cloak := -1
	row, ok := m.item(display)
	if ok && row >= 0 {
		if slot := wearSlotOf(invType); slot >= 0 {
			worn[slot] = row
		} else if invType == invCloak {
			cloak = row
		}
	}
	look := m.plainLook(stand, worn, cloak, g)
	out.Model, out.Scale = look.model, look.scale
	if ok && row >= 0 {
		// The item alone: the model the character holds or wears.
		for _, a := range look.look.Attach {
			if a.Model == "" || !m.itemAttachment(a, row) {
				continue
			}
			out.Shown = true
			if out.Item == "" {
				out.Item = a.Model
				if a.Texture != "" {
					out.ItemLook = wow.Look{Textures: map[int]string{wow.TexItem: a.Texture}}.Query()
				}
			}
		}
		out.Shown = out.Shown || m.paintsBody(row, wearSlotOf(invType), sex == 1) ||
			cloak >= 0 && m.itemDisplay.str(cloak, idTexture) != ""
	}
	out.Look = look.look.Query()
	return out
}

// paintsBody says the display row, worn in slot, has a body texture the client has for its slot.
func (m *modelTables) paintsBody(row, slot int, female bool) bool {
	if slot < 0 {
		return false
	}
	for i, b := range bodyTextureRegions {
		if 14+i < m.itemDisplay.fields && slotPaints(slot, b.region) && m.componentTexture(b.dir, m.itemDisplay.str(row, 14+i), female) != "" {
			return true
		}
	}
	return false
}

// plainLook is the creature display of a character dressed in worn and cloak alone (see dress), in
// its own skin, face and hair with no baked texture, holding g's weapons: the item editor's
// stand-in, which shows the item and nothing the NPC wears.
func (m *modelTables) plainLook(display uint32, worn [wearSlots]int, cloak int, g gear) creatureDisplay {
	out := m.creatureLook(display, gear{stand: g.stand, emote: g.emote})
	if r, ok := m.creatureDisplay.row(display); ok && display != 0 && m.creatureExtra != nil && m.creatureExtra.fields > 18 {
		if er, ok := m.creatureExtra.row(m.creatureDisplay.u32(r, 3)); ok {
			out.look.Textures, out.look.Attach, out.look.Geosets = nil, nil, nil
			m.dress(&out, m.extraLook(er), worn, cloak, "")
		}
	}
	m.holdWeapons(&out, g)
	return out
}

// itemAttachment says an attachment is display row's model (by its file name), not one the
// stand-in wears of its own.
func (m *modelTables) itemAttachment(a wow.Attachment, row int) bool {
	base := strings.ToLower(trimModelExt(a.Model[strings.LastIndex(a.Model, `\`)+1:]))
	for _, f := range []int{1, 2} {
		n := strings.ToLower(trimModelExt(m.itemDisplay.str(row, f)))
		n = n[strings.LastIndex(n, `\`)+1:]
		if n != "" && strings.HasPrefix(base, n) {
			return true
		}
	}
	return false
}

// standIn is a creature display of a plain character of race and sex for the item editor to dress
// (plainLook, which keeps only its skin, face and hair): the humanoid display
// (CreatureDisplayInfoExtra: 1 race, 2 sex, 8-17 worn items, 18 the baked skin) that wears the
// fewest items, one with hair first (a style the race has a submesh and a texture for), then one with a baked skin, the lowest ID of those. 0 when the client has none.
func (m *modelTables) standIn(race, sex int) uint32 {
	if m == nil || m.creatureExtra == nil || m.creatureExtra.fields <= 18 {
		return 0
	}
	x := m.creatureExtra
	best, bestScore := uint32(0), 1<<30
	t := m.creatureDisplay
	for r := 0; r < t.records; r++ {
		er, ok := x.row(t.u32(r, 3))
		if !ok || int(x.u32(er, 1)) != race || int(x.u32(er, 2)) != sex {
			continue
		}
		score := 0
		for i := 0; i < wearSlots; i++ {
			if x.u32(er, 8+i) != 0 {
				score += 2
			}
		}
		if x.str(er, 18) == "" {
			score++
		}
		if !m.hasHair(race, uint32(sex), x.u32(er, 5), x.u32(er, 6)) {
			score += 100
		}
		id := t.u32(r, 0)
		if score < bestScore || (score == bestScore && id < best) {
			best, bestScore = id, score
		}
	}
	return best
}

// hasHair says a character of race and sex with hair style and colour shows hair: CharHairGeosets
// gives the style a submesh and CharSections a hair texture (a style with neither is bald).
func (m *modelTables) hasHair(race int, sex, style, color uint32) bool {
	t := m.hairGeosets
	if t == nil || t.fields <= 4 {
		return true
	}
	geo := false
	for r := 0; r < t.records; r++ {
		if t.u32(r, 1) == uint32(race) && t.u32(r, 2) == sex && t.u32(r, 3) == style {
			geo = t.u32(r, 4) > 0
			break
		}
	}
	if !geo {
		return false
	}
	row, ok := m.section(uint32(race), sex, 3, style, color)
	return ok && m.sections.str(row, 6) != ""
}
