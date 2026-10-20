package vmangos

import (
	"sort"
	"strings"

	"Meld/internal/wow"
)

// A character without a baked body texture has its body texture built as the game builds a
// player's (#356): the skin, the face, facial hair and scalp, the underwear, then each worn item's
// body textures (ItemDisplayInfo fields 14-21) over their regions. Ported from the behaviour of WoW
// Model Viewer (CharDetails, WoWItem): the regions each slot paints and the order the slots go in.

// bodyTextureRegions are the folders (under Item\TextureComponents) and regions of ItemDisplayInfo's
// body textures, fields 14-21.
var bodyTextureRegions = [8]struct {
	dir    string
	region int
}{
	{"ArmUpperTexture", wow.RegionArmUpper},
	{"ArmLowerTexture", wow.RegionArmLower},
	{"HandTexture", wow.RegionHand},
	{"TorsoUpperTexture", wow.RegionTorsoUpper},
	{"TorsoLowerTexture", wow.RegionTorsoLower},
	{"LegUpperTexture", wow.RegionLegUpper},
	{"LegLowerTexture", wow.RegionLegLower},
	{"FootTexture", wow.RegionFoot},
}

// slotLayers is the order the worn slots are painted in, low first (WoW Model Viewer's SLOT_LAYERS):
// a shirt and trousers under the boots, the chest over those, then the tabard, belt, bracers and
// gloves.
var slotLayers = [wearSlots]int{wearShirt: 10, wearLegs: 10, wearBoots: 11, wearChest: 13, wearTabard: 17, wearBelt: 18, wearWrist: 19, wearGloves: 20}

// slotPaints says which body regions a worn slot paints: a few displays name textures for regions
// their slot doesn't cover, which the game leaves out.
func slotPaints(slot, region int) bool {
	switch slot {
	case wearShirt, wearChest:
		return region != wow.RegionHand && region != wow.RegionFoot
	case wearBelt:
		return region == wow.RegionTorsoLower || region == wow.RegionLegUpper
	case wearLegs:
		return region == wow.RegionLegUpper || region == wow.RegionLegLower
	case wearBoots:
		return region == wow.RegionLegLower || region == wow.RegionFoot
	case wearWrist:
		return region == wow.RegionArmLower
	case wearGloves:
		return region == wow.RegionArmLower || region == wow.RegionHand
	case wearTabard:
		return region == wow.RegionTorsoUpper || region == wow.RegionTorsoLower
	}
	return false
}

// robed says the chest or the legs worn show a robe's skirt (their display's third geoset group).
func (m *modelTables) robed(worn [wearSlots]int) bool {
	for _, slot := range []int{wearChest, wearLegs} {
		if worn[slot] >= 0 && m.itemDisplay.u32(worn[slot], 8) > 0 {
			return true
		}
	}
	return false
}

// bodyLayers are the layers painted over the skin of the CreatureDisplayInfoExtra row er's
// character in worn: its face (CharSections section 1, by face and skin colour), underwear (4, by
// skin colour), facial hair (2, by style and hair colour) and scalp (3, the hair style's second and
// third textures), then the worn items' body textures by slotLayers.
func (m *modelTables) bodyLayers(er int, worn [wearSlots]int) []wow.SkinLayer {
	x := m.creatureExtra
	race, sex := x.u32(er, 1), x.u32(er, 2)
	skin, face, hairStyle, hairColor, facial := x.u32(er, 3), x.u32(er, 4), x.u32(er, 5), x.u32(er, 6), x.u32(er, 7)
	var out []wow.SkinLayer
	add := func(region int, path string) {
		if path != "" {
			out = append(out, wow.SkinLayer{Region: region, Path: path})
		}
	}
	for _, s := range []struct {
		section, variation, color uint32
		first                     int
		regions                   []int
	}{
		{1, face, skin, 6, []int{wow.RegionFaceLower, wow.RegionFaceUpper}},
		{4, 0, skin, 6, []int{wow.RegionLegUpper, wow.RegionTorsoUpper}},
		{2, facial, hairColor, 6, []int{wow.RegionFaceLower, wow.RegionFaceUpper}},
		{3, hairStyle, hairColor, 7, []int{wow.RegionFaceLower, wow.RegionFaceUpper}},
	} {
		if row, ok := m.section(race, sex, s.section, s.variation, s.color); ok {
			for i, region := range s.regions {
				add(region, m.sections.str(row, s.first+i))
			}
		}
	}

	slots := make([]int, 0, wearSlots)
	for slot := range worn {
		if worn[slot] >= 0 && slotLayers[slot] > 0 {
			slots = append(slots, slot)
		}
	}
	layer := func(slot int) int {
		// Gloves without a cuff of their own go under a robe's sleeves.
		if slot == wearGloves && m.robed(worn) && m.itemDisplay.u32(worn[slot], 6) == 0 {
			return slotLayers[wearChest] - 1
		}
		return slotLayers[slot]
	}
	sort.SliceStable(slots, func(i, j int) bool { return layer(slots[i]) < layer(slots[j]) })
	female := sex == 1
	for _, slot := range slots {
		row := worn[slot]
		for i, b := range bodyTextureRegions {
			if 14+i >= m.itemDisplay.fields || !slotPaints(slot, b.region) {
				continue
			}
			add(b.region, m.componentTexture(b.dir, m.itemDisplay.str(row, 14+i), female))
		}
	}
	return out
}

// componentTexture is the client path of an item's body texture name in a folder for a wearer of
// that sex: the name with _F or _M where the client has that one, else _U (for either). "" when
// the client has neither, or for no name.
func (m *modelTables) componentTexture(dir, name string, female bool) string {
	if name == "" {
		return ""
	}
	base := `Item\TextureComponents\` + dir + `\` + name
	gender := "_M.blp"
	if female {
		gender = "_F.blp"
	}
	if m.components == nil {
		return base + "_U.blp"
	}
	for _, suffix := range []string{gender, "_U.blp"} {
		if m.components[strings.ToLower(base+suffix)] {
			return base + suffix
		}
	}
	return ""
}
