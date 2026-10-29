package vmangos

// The Characters tool's picture of a character (#880): the character's own model in its look (race,
// gender, skin, face and hair from its characters row) wearing its equipment, dressed as the Items
// editor dresses its stand-in (plainLook), so a change of gear or look can be seen before logging in.

// CharacterAppearance is a character's look as its characters row has it.
type CharacterAppearance struct {
	Race       int `json:"race"`
	Gender     int `json:"gender"`
	Skin       int `json:"skin"`
	Face       int `json:"face"`
	HairStyle  int `json:"hairStyle"`
	HairColor  int `json:"hairColor"`
	FacialHair int `json:"facialHair"`
	// HideHelm and HideCloak are the character's Show Helm and Show Cloak turned off (character_flags
	// CHARACTER_FLAG_HIDE_HELM and CHARACTER_FLAG_HIDE_CLOAK, #888): the picture leaves them off.
	HideHelm  bool `json:"hideHelm"`
	HideCloak bool `json:"hideCloak"`
}

// WornItem is an item in one of a character's equipment slots (0 to 18): its display and inventory type.
type WornItem struct {
	Slot    int `json:"slot"`
	Display int `json:"display"`
	InvType int `json:"invType"`
}

// CharacterModel is a character's model dressed in its look and equipment (wow.Look's query).
type CharacterModel struct {
	Model string  `json:"model"`
	Look  string  `json:"look"`
	Scale float32 `json:"scale"`
}

// Equipment slots (EquipmentSlots in the server's Player.h) the character shows, beside the hands'
// slotMainHand and slotOffHand.
const (
	slotHead     = 0
	slotShoulder = 2
	slotShirt    = 3
	slotChest    = 4
	slotWaist    = 5
	slotLegs     = 6
	slotFeet     = 7
	slotWrists   = 8
	slotHands    = 9
	slotBack     = 14
	slotRanged   = 17
	slotTabard   = 18
)

// wearSlotOfEquip is the wear slot an equipment slot's armour goes in, -1 for one not worn on the body.
func wearSlotOfEquip(slot int) int {
	switch slot {
	case slotHead:
		return wearHelm
	case slotShoulder:
		return wearShoulder
	case slotShirt:
		return wearShirt
	case slotChest:
		return wearChest
	case slotWaist:
		return wearBelt
	case slotLegs:
		return wearLegs
	case slotFeet:
		return wearBoots
	case slotWrists:
		return wearWrist
	case slotHands:
		return wearGloves
	case slotTabard:
		return wearTabard
	}
	return -1
}

// CharacterModelLook is a character of look a wearing items (its equipment slots), its melee weapons
// drawn, or its ranged weapon when it holds no melee one.
func CharacterModelLook(dataDir string, a CharacterAppearance, items []WornItem) (CharacterModel, error) {
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return CharacterModel{}, err
	}
	return tables.characterModel(a, items), nil
}

func (m *modelTables) characterModel(a CharacterAppearance, items []WornItem) CharacterModel {
	stand := m.standIn(a.Race, a.Gender)
	look := m.creatureLook(stand, gear{})
	out := CharacterModel{Model: look.model, Scale: look.scale}
	if out.Model == "" {
		return out
	}
	var worn [wearSlots]int
	for i := range worn {
		worn[i] = -1
	}
	cloak := -1
	g := gear{sheath: sheathMelee}
	for _, it := range items {
		row, ok := m.item(uint32(max(it.Display, 0)))
		if !ok || row < 0 {
			continue
		}
		held := heldItem{display: uint32(it.Display), invType: it.InvType}
		switch {
		case it.Slot == slotHead && a.HideHelm:
		case it.Slot == slotBack && a.HideCloak:
		case wearSlotOfEquip(it.Slot) >= 0:
			worn[wearSlotOfEquip(it.Slot)] = row
		case it.Slot == slotBack:
			cloak = row
		case it.Slot == slotMainHand:
			g.weapons[0] = held
		case it.Slot == slotOffHand:
			g.weapons[1] = held
		case it.Slot == slotRanged:
			g.weapons[2] = held
		}
	}
	if g.weapons[0].display == 0 && g.weapons[1].display == 0 && g.weapons[2].display != 0 {
		g.sheath = sheathRanged
	}
	look.look.Textures, look.look.Attach, look.look.Geosets = nil, nil, nil
	cl := charLook{uint32(max(a.Race, 0)), uint32(max(a.Gender, 0)), uint32(max(a.Skin, 0)), uint32(max(a.Face, 0)),
		uint32(max(a.HairStyle, 0)), uint32(max(a.HairColor, 0)), uint32(max(a.FacialHair, 0))}
	m.dress(&look, cl, worn, cloak, "")
	m.holdWeapons(&look, g)
	out.Look = look.look.Query()
	return out
}
