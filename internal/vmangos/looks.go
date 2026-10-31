package vmangos

import (
	"strings"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// modelTables are the client's tables that name a spawn's model and dress it: a creature's
// display, the model it uses, a humanoid's hair, face and gear, the items it holds, its pose's
// animation, and a game object's display.
type modelTables struct {
	creatureDisplay, creatureModelData, objectDisplay *dbcTable
	// The rest are optional: a client without one shows less of a humanoid's look.
	creatureExtra, itemDisplay, hairGeosets, facialHair, sections, races, helmVis, emotes *dbcTable
	// components are the body textures of items the client has (Item\TextureComponents\...), by
	// their lower-case paths; nil when the archives list none.
	components map[string]bool
}

// bakedTextures is the client folder of the body textures baked for humanoid NPCs.
const bakedTextures = `Textures\BakedNpcTextures\`

// Client folders of the item models a creature wears and holds.
const (
	headItems     = `Item\ObjectComponents\Head\`
	shoulderItems = `Item\ObjectComponents\Shoulder\`
	weaponItems   = `Item\ObjectComponents\Weapon\`
	shieldItems   = `Item\ObjectComponents\Shield\`
	capeItems     = `Item\ObjectComponents\Cape\`
	// componentTextures is the folder of the items' body textures, lower case.
	componentTextures = `item\texturecomponents\`
)

// loadModelTables reads the model tables from the client's data folder, as the game will have them:
// a table waiting for the game to close (readOverlay) too, such as a display of its own (#723).
func loadModelTables(dataDir string) (*modelTables, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	read := func(name string) (*dbcTable, error) {
		b, err := readOverlay(set, dataDir, `DBFilesClient\`+name)
		if err != nil {
			return nil, err
		}
		return parseDBC(b)
	}
	var m modelTables
	if m.creatureDisplay, err = read("CreatureDisplayInfo.dbc"); err != nil {
		return nil, err
	}
	if m.creatureModelData, err = read("CreatureModelData.dbc"); err != nil {
		return nil, err
	}
	if m.objectDisplay, err = read("GameObjectDisplayInfo.dbc"); err != nil {
		return nil, err
	}
	for _, f := range set.List() {
		if l := strings.ToLower(f); strings.HasPrefix(l, componentTextures) {
			if m.components == nil {
				m.components = map[string]bool{}
			}
			m.components[l] = true
		}
	}
	for _, t := range []struct {
		p    **dbcTable
		name string
	}{
		{&m.creatureExtra, "CreatureDisplayInfoExtra.dbc"},
		{&m.itemDisplay, "ItemDisplayInfo.dbc"},
		{&m.hairGeosets, "CharHairGeosets.dbc"},
		{&m.facialHair, "CharacterFacialHairStyles.dbc"},
		{&m.sections, "CharSections.dbc"},
		{&m.races, "ChrRaces.dbc"},
		{&m.helmVis, "HelmetGeosetVisData.dbc"},
		{&m.emotes, "Emotes.dbc"},
	} {
		*t.p, _ = read(t.name)
	}
	return &m, nil
}

// creatureDisplay is what the display tables say about a creature display: the model, the look
// it is dressed in, and the display's scale (1 when unknown).
type creatureDisplay struct {
	model string
	look  wow.Look
	scale float32
}

// gear is what the world database gives a creature beyond its display: the items in its hands
// (main hand, off hand, ranged; a zero display for none), how it holds them, and its pose.
type gear struct {
	weapons      [3]heldItem
	sheath       int
	stand, emote int
}

// heldItem is an item a creature holds: its display and its inventory type.
type heldItem struct {
	entry   int
	display uint32
	invType int
}

// Inventory types (InventoryType in the server's ItemPrototype.h) that change where an item goes.
const (
	invShield = 14
	invRanged = 15
	invThrown = 25
	invGun    = 26
)

// Sheath states (SheathState): weapons put away, melee weapons out, the ranged weapon out.
const (
	sheathNone   = 0
	sheathMelee  = 1
	sheathRanged = 2
)

// standAnims is the AnimationData loop of each stand state (UnitStandStateType): sitting on the
// ground, in a chair (the low one), sleeping, in a low, medium or high chair, dead, kneeling.
var standAnims = map[int]int{1: 97, 2: 102, 3: 100, 4: 102, 5: 103, 6: 104, 7: 6, 8: 115}

// poseAnim is the animation a creature's pose plays: its looping emote's (Emotes.dbc field 2),
// else its stand state's, else Stand (0).
func (m *modelTables) poseAnim(stand, emote int) int {
	if emote != 0 && m != nil && m.emotes != nil && m.emotes.fields > 2 {
		if r, ok := m.emotes.row(uint32(emote)); ok {
			if a := int(m.emotes.u32(r, 2)); a != 0 {
				return a
			}
		}
	}
	return standAnims[stand]
}

// creatureLook resolves a creature display and dresses it in gear. CreatureDisplayInfo's fields
// are: 1 the model, 3 the extra display (humanoids), 4 the scale, 6-8 the skin names, which are
// .blp files in the model's folder.
func (m *modelTables) creatureLook(display uint32, g gear) creatureDisplay {
	out := creatureDisplay{scale: 1}
	if m == nil || display == 0 {
		return out
	}
	r, ok := m.creatureDisplay.row(display)
	if !ok {
		return out
	}
	out.model = m.creatureModel(display)
	if s := m.creatureDisplay.f32(r, 4); s > 0 {
		out.scale = s
	}
	out.look.Anim = m.poseAnim(g.stand, g.emote)
	dir := out.model[:strings.LastIndex(out.model, `\`)+1]
	for i := 0; i < 3; i++ {
		if name := m.creatureDisplay.str(r, 6+i); name != "" {
			out.setTexture(wow.TexMonster1+i, dir+name+".blp")
		}
	}
	if m.creatureExtra != nil && m.creatureExtra.fields > 18 {
		if er, ok := m.creatureExtra.row(m.creatureDisplay.u32(r, 3)); ok {
			m.dressCharacter(&out, er)
		}
	}
	m.holdWeapons(&out, g)
	return out
}

func (d *creatureDisplay) setTexture(typ int, path string) {
	if d.look.Textures == nil {
		d.look.Textures = map[int]string{}
	}
	d.look.Textures[typ] = path
}

// Geoset groups of a character model: a submesh's ID is group*100 plus a variant, except hair,
// whose styles are IDs 1-99 beside the body's 0.
const (
	geoHair     = 0
	geoFacial1  = 1
	geoFacial2  = 2
	geoFacial3  = 3
	geoGloves   = 4
	geoBoots    = 5
	geoEars     = 7
	geoSleeves  = 8
	geoKneepads = 9
	geoChest    = 10
	geoPants    = 11
	geoTabard   = 12
	geoRobe     = 13
	geoCloak    = 15
)

// The items a humanoid display wears, by index in CreatureDisplayInfoExtra's fields 8-17.
const (
	wearHelm = iota
	wearShoulder
	wearShirt
	wearChest
	wearBelt
	wearLegs
	wearBoots
	wearWrist
	wearGloves
	wearTabard
	wearSlots
)

// dressCharacter dresses a character model from its CreatureDisplayInfoExtra row er. The row's fields are: 1 race, 2 sex, 3 skin colour, 4 face,
// 5 hair style, 6 hair colour, 7 facial hair, 8-17 the worn items' displays (see wearHelm..), 18
// the baked body texture, which already has the face, skin and clothes painted on.
func (m *modelTables) dressCharacter(out *creatureDisplay, er int) {
	var worn [wearSlots]int
	for i := range worn {
		worn[i] = -1
		if row, ok := m.item(m.creatureExtra.u32(er, 8+i)); ok {
			worn[i] = row
		}
	}
	m.dress(out, m.extraLook(er), worn, -1, m.creatureExtra.str(er, 18))
}

// charLook is a character's race, sex (0 male, 1 female), skin colour, face, hair style, hair colour
// and facial hair: a CreatureDisplayInfoExtra row's fields 1-7, or a player's characters row.
type charLook struct {
	race, sex, skin, face, hairStyle, hairColor, facial uint32
}

// extraLook is the CreatureDisplayInfoExtra row er's look.
func (m *modelTables) extraLook(er int) charLook {
	x := m.creatureExtra
	return charLook{x.u32(er, 1), x.u32(er, 2), x.u32(er, 3), x.u32(er, 4), x.u32(er, 5), x.u32(er, 6), x.u32(er, 7)}
}

// dress dresses a character model as cl's race, sex, skin, face and hair, in worn (an ItemDisplayInfo row per wear slot, -1 for none) and the cloak of ItemDisplayInfo
// row cloak (-1 for none). bake is the baked body texture, "" for none: then the body texture is
// built as the game builds a player's (bodyLayers).
func (m *modelTables) dress(out *creatureDisplay, cl charLook, worn [wearSlots]int, cloak int, bake string) {
	race, sex := int(cl.race), cl.sex
	female := sex == 1
	skin, hairStyle, hairColor, facial := cl.skin, cl.hairStyle, cl.hairColor, cl.facial

	if bake != "" {
		out.setTexture(wow.TexBody, bakedTextures+bake)
	}
	// CharSections: 1 race, 2 sex, 3 section (0 skin, 3 hair), 4 variation, 5 colour, 6-8 textures.
	if row, ok := m.section(uint32(race), sex, 0, 0, skin); ok {
		if _, baked := out.look.Textures[wow.TexBody]; !baked {
			body := m.sections.str(row, 6)
			if layers := m.bodyLayers(cl, worn); body != "" && len(layers) > 0 {
				body = wow.ComposedTexture(append([]wow.SkinLayer{{Region: wow.RegionBase, Path: body}}, layers...))
			}
			out.setTexture(wow.TexBody, body)
		}
		if fur := m.sections.str(row, 7); fur != "" {
			out.setTexture(wow.TexFur, fur)
		}
	}
	// The hair texture also dresses the scalp (hair submesh 1) and the beards of the races whose
	// beards are geometry, so a style without one of its own (a bald one) takes variation 1's at the
	// same colour, as the client's binder does (Benilla's CharSections::hair_mesh_texture).
	for _, variation := range []uint32{hairStyle, 1} {
		if row, ok := m.section(uint32(race), sex, 3, variation, hairColor); ok {
			if hair := m.sections.str(row, 6); hair != "" {
				out.setTexture(wow.TexHair, hair)
				break
			}
		}
	}

	// Every group shows its first variant unless an item replaces it; the groups whose first variant
	// the model lacks (sleeves, kneepads, chest, pants, tabard) are simply absent. 1501 is "no cloak":
	// a patch over the upper back that is part of the body without it, so leaving it out opens the
	// shoulder blades. A 1.12 NPC's extra row has no cloak slot, so it is always 1501.
	geo := map[int]int{geoHair: 1, geoGloves: 401, geoBoots: 501, geoEars: 702, geoRobe: 1301, geoCloak: 1501,
		geoFacial1: 101, geoFacial2: 201, geoFacial3: 301}
	// CharHairGeosets: 1 race, 2 sex, 3 variation, 4 the hair's submesh (0 for bald). The client
	// shows at least submesh 1, the scalp: for a bald style, and for a style no row names (orc
	// females have a style more than their rows, goblin females none), so the first row of a
	// repeated key wins (Benilla's CharacterGeosets::visible_geosets, the client's 0x478540).
	if t := m.hairGeosets; t != nil && t.fields > 4 {
		for r := 0; r < t.records; r++ {
			if t.u32(r, 1) == uint32(race) && t.u32(r, 2) == sex && t.u32(r, 3) == hairStyle {
				geo[geoHair] = max(1, int(t.u32(r, 4)))
				break
			}
		}
	}
	// CharacterFacialHairStyles: 0 race, 1 sex, 2 variation, then the variants of geoset groups
	// 1, 3 and 2 in fields 6-8 (the order WoW Model Viewer reads them in).
	if t := m.facialHair; t != nil && t.fields > 8 {
		for r := 0; r < t.records; r++ {
			if t.u32(r, 0) == uint32(race) && t.u32(r, 1) == sex && t.u32(r, 2) == facial {
				for i, group := range []int{geoFacial1, geoFacial3, geoFacial2} {
					geo[group] = group*100 + max(1, int(t.u32(r, 6+i)))
				}
				break
			}
		}
	}

	// ItemDisplayInfo (23 fields in 1.12): 1-2 models, 3-4 their textures, 5 the icon, 6-8 the
	// geoset groups, 9 flags, 10 spell visual, 11 group sound, 12-13 the helmet's HelmetGeosetVisData
	// for a male and a female wearer, 14-21 the body-region textures.
	group := func(slot, i int) int {
		if worn[slot] < 0 {
			return 0
		}
		return int(m.itemDisplay.u32(worn[slot], 6+i))
	}
	for _, slot := range []int{wearShirt, wearChest} {
		if v := group(slot, 0); v > 0 {
			geo[geoSleeves] = 801 + v
		}
		if v := group(slot, 1); v > 0 {
			geo[geoChest] = 1001 + v
		}
	}
	if v := group(wearChest, 2); v > 0 {
		geo[geoRobe] = 1301 + v
	}
	if v := group(wearLegs, 0); v > 0 {
		geo[geoKneepads] = 901 + v
	}
	if v := group(wearLegs, 1); v > 0 {
		geo[geoPants] = 1101 + v
	}
	if v := group(wearLegs, 2); v > 0 {
		geo[geoRobe] = 1301 + v
	}
	// A robe hides the boots' shaft (WoW Model Viewer's WoWItem, CS_BOOTS).
	if v := group(wearBoots, 0); v > 0 && !m.robed(worn) {
		geo[geoBoots] = 501 + v
	}
	if v := group(wearGloves, 0); v > 0 {
		geo[geoGloves] = 401 + v
	}
	if worn[wearTabard] >= 0 {
		geo[geoTabard] = 1201 + max(1, group(wearTabard, 0))
	}
	// A cloak is the back's geoset 1501 plus its first group, skinned with its texture (field 3,
	// in the Cape folder) in the model's cape slot (texture type 2).
	if cloak >= 0 {
		geo[geoCloak] = 1501 + int(m.itemDisplay.u32(cloak, 6))
		if tex := m.itemDisplay.str(cloak, 3); tex != "" {
			out.setTexture(wow.TexItem, capeItems+tex+".blp")
		}
	}

	if row := worn[wearHelm]; row >= 0 {
		if name, prefix := m.itemDisplay.str(row, 1), m.racePrefix(race); name != "" && prefix != "" {
			gender := "M"
			if female {
				gender = "F"
			}
			out.attach(wow.AttachHelm, headItems+trimModelExt(name)+"_"+prefix+gender+".mdx", headItems, m.itemDisplay.str(row, 3))
		}
		vis := m.itemDisplay.u32(row, 12)
		if female {
			vis = m.itemDisplay.u32(row, 13)
		}
		m.hideUnderHelm(geo, vis, race)
	}
	if row := worn[wearShoulder]; row >= 0 {
		out.attach(wow.AttachShoulderLeft, m.itemDisplay.str(row, 1), shoulderItems, m.itemDisplay.str(row, 3))
		out.attach(wow.AttachShoulderRight, m.itemDisplay.str(row, 2), shoulderItems, m.itemDisplay.str(row, 4))
	}

	out.look.Geosets = []int{0}
	for _, id := range geo {
		out.look.Geosets = append(out.look.Geosets, id)
	}
}

// trimModelExt drops a model name's ".mdx" or ".m2".
func trimModelExt(name string) string {
	l := strings.ToLower(name)
	for _, ext := range []string{".mdx", ".m2"} {
		if strings.HasSuffix(l, ext) {
			return name[:len(name)-len(ext)]
		}
	}
	return name
}

// hideUnderHelm hides what a helmet covers. HelmetGeosetVisData's fields 1-5 are race masks
// (bit 1<<race) for the hair, the three facial hair groups and the ears: a race whose bit is set
// has that part put back to its group's first variant under the helmet, the hair to the scalp (1).
func (m *modelTables) hideUnderHelm(geo map[int]int, vis uint32, race int) {
	if m.helmVis == nil || vis == 0 || race <= 0 || race > 31 || m.helmVis.fields < 6 {
		return
	}
	r, ok := m.helmVis.row(vis)
	if !ok {
		return
	}
	bit := uint32(1) << race
	for i, group := range []int{geoHair, geoFacial1, geoFacial2, geoFacial3, geoEars} {
		if m.helmVis.u32(r, 1+i)&bit != 0 {
			geo[group] = group*100 + 1
		}
	}
}

// holdWeapons puts a creature's weapons in its hands as its sheath state has them out: the melee
// weapons (a shield on the shield mount), or the ranged one, or nothing when they are put away.
func (m *modelTables) holdWeapons(out *creatureDisplay, g gear) {
	if g.sheath == sheathNone {
		return
	}
	place := func(it heldItem, point int) {
		row, ok := m.item(it.display)
		if !ok || row < 0 {
			return
		}
		dir := weaponItems
		if it.invType == invShield {
			dir, point = shieldItems, wow.AttachShield
		}
		out.attach(point, m.itemDisplay.str(row, 1), dir, m.itemDisplay.str(row, 3))
	}
	if g.sheath == sheathRanged {
		if r := g.weapons[2]; r.invType == invRanged || r.invType == invThrown || r.invType == invGun {
			place(r, wow.AttachHandLeft)
			return
		}
	}
	place(g.weapons[0], wow.AttachHandRight)
	place(g.weapons[1], wow.AttachHandLeft)
}

// attach holds the item model name, in folder dir, at a point, with the texture of that name from
// the same folder. A slot with no model is skipped.
func (d *creatureDisplay) attach(point int, name, dir, texture string) {
	model, tex := itemPaths(name, dir, texture)
	if model == "" {
		return
	}
	d.look.Attach = append(d.look.Attach, wow.Attachment{Point: point, Model: model, Texture: tex})
}

// item is the ItemDisplayInfo row of a display. ok is false for no item, or a display the
// client doesn't have.
func (m *modelTables) item(display uint32) (int, bool) {
	if display == 0 || m.itemDisplay == nil || m.itemDisplay.fields < 14 {
		return -1, false
	}
	return m.itemDisplay.row(display)
}

// section finds a CharSections row by race, sex, section, variation and colour.
func (m *modelTables) section(race, sex, section, variation, color uint32) (int, bool) {
	t := m.sections
	if t == nil || t.fields < 9 {
		return 0, false
	}
	for r := 0; r < t.records; r++ {
		if t.u32(r, 1) == race && t.u32(r, 2) == sex && t.u32(r, 3) == section && t.u32(r, 4) == variation && t.u32(r, 5) == color {
			return r, true
		}
	}
	return 0, false
}

// racePrefix is a race's short name in item model names (ChrRaces field 6), such as "Hu".
func (m *modelTables) racePrefix(race int) string {
	if m.races == nil || race <= 0 || m.races.fields < 7 {
		return ""
	}
	r, ok := m.races.row(uint32(race))
	if !ok {
		return ""
	}
	return m.races.str(r, 6)
}

// creatureModel is the model path a creature display uses, or "" when the display has none.
// CreatureDisplayInfo's field 1 is the model's ID, and CreatureModelData's field 2 is its path.
func (m *modelTables) creatureModel(display uint32) string {
	if m == nil || display == 0 {
		return ""
	}
	r, ok := m.creatureDisplay.row(display)
	if !ok {
		return ""
	}
	r2, ok := m.creatureModelData.row(m.creatureDisplay.u32(r, 1))
	if !ok {
		return ""
	}
	return m.creatureModelData.str(r2, 2)
}

// objectModel is the model path of a game object display, or "". GameObjectDisplayInfo's field 1
// is the path.
func (m *modelTables) objectModel(display uint32) string {
	if m == nil || display == 0 {
		return ""
	}
	r, ok := m.objectDisplay.row(display)
	if !ok {
		return ""
	}
	return m.objectDisplay.str(r, 1)
}
