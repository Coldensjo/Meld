package vmangos

import (
	"encoding/binary"
	"net/url"
	"slices"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// testDBC builds a DBC table of rows of the given width. A string field is put in the string
// block; a missing trailing field is zero.
func testDBC(t *testing.T, fields int, rows ...[]any) *dbcTable {
	t.Helper()
	strs := []byte{0}
	var recs []byte
	for _, row := range rows {
		for f := 0; f < fields; f++ {
			var v uint32
			if f < len(row) {
				switch x := row[f].(type) {
				case int:
					v = uint32(int32(x))
				case uint32:
					v = x
				case string:
					v = uint32(len(strs))
					strs = append(append(strs, x...), 0)
				default:
					t.Fatalf("field %d: %T", f, x)
				}
			}
			recs = binary.LittleEndian.AppendUint32(recs, v)
		}
	}
	b := []byte("WDBC")
	for _, n := range []int{len(rows), fields, fields * 4, len(strs)} {
		b = binary.LittleEndian.AppendUint32(b, uint32(n))
	}
	d, err := parseDBC(append(append(b, recs...), strs...))
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// humanTables are the tables for one human male NPC display (10), dressed in a helmet that hides
// human hair, shoulders, a robe with sleeves and gloves, and a few items to hold.
func humanTables(t *testing.T) *modelTables {
	cde := make([]any, 19)
	for i := range cde {
		cde[i] = 0
	}
	// race 1, male, skin 0, face 0, hair style 2, hair colour 1, facial hair 3.
	copy(cde, []any{5, 1, 0, 0, 0, 2, 1, 3})
	cde[8+wearHelm], cde[8+wearShoulder], cde[8+wearChest], cde[8+wearGloves] = 100, 101, 102, 103
	cde[18] = "Bake.blp"
	return &modelTables{
		creatureDisplay:   testDBC(t, 12, []any{10, 1, 0, 5, 0}),
		creatureModelData: testDBC(t, 3, []any{1, 0, `Character\Human\Male\HumanMale.mdx`}),
		objectDisplay:     testDBC(t, 2),
		creatureExtra:     testDBC(t, 19, cde),
		itemDisplay: testDBC(t, 23,
			[]any{100, "Helm_A.mdx", "", "HelmTex", "", "", "", 0, 0, 0, 0, 0, 50, 51},
			[]any{101, "LShoulder_A.mdx", "RShoulder_A.mdx", "ShoulderTex", "ShoulderTex"},
			// 102: a robe with sleeves (geoset groups at 6-8); 103: gloves of variant 2.
			[]any{102, "", "", "", "", "", 1, 0, 1},
			[]any{103, "", "", "", "", "", 2},
			[]any{104, "Sword_A.mdx", "", "SwordTex"},
			[]any{105, "Shield_A.mdx", "", "ShieldTex"},
			[]any{106, "Bow_A.mdx", "", "BowTex"}),
		hairGeosets: testDBC(t, 6, []any{1, 1, 0, 2, 5, 0}),
		facialHair:  testDBC(t, 9, []any{1, 0, 3, 0, 0, 0, 2, 3, 0}),
		sections: testDBC(t, 10,
			[]any{1, 1, 0, 0, 0, 0, "Skin.blp", "", ""},
			[]any{2, 1, 0, 3, 2, 1, "Hair.blp", "", ""}),
		races: testDBC(t, 7, []any{1, 0, 0, 0, 0, 0, "Hu"}),
		// Helmet 50 hides the hair of race 1 (bit 1<<1) and leaves the facial hair and ears alone.
		helmVis: testDBC(t, 6, []any{50, 1 << 1, 0, 0, 0, 0}),
		emotes:  testDBC(t, 7, []any{233, "WORK", 69}),
	}
}

func TestCreatureLookDressesAHumanoid(t *testing.T) {
	m := humanTables(t)
	d := m.creatureLook(10, gear{sheath: sheathMelee})
	if d.model != `Character\Human\Male\HumanMale.mdx` {
		t.Fatalf("model %q", d.model)
	}
	if got := d.look.Textures[wow.TexBody]; got != bakedTextures+"Bake.blp" {
		t.Fatalf("the baked texture must be the body, got %q", got)
	}
	if got := d.look.Textures[wow.TexHair]; got != "Hair.blp" {
		t.Fatalf("hair texture %q, want CharSections' hair for style 2 colour 1", got)
	}
	geo := d.look.Geosets
	for _, want := range []int{0, 802, 1302, 403, 102, 303, 201, 702, 501, 1501} {
		if !slices.Contains(geo, want) {
			t.Errorf("geosets %v lack %d", geo, want)
		}
	}
	if slices.Contains(geo, 5) || !slices.Contains(geo, 1) {
		t.Errorf("the helmet puts human hair back to the scalp (1), but geosets are %v", geo)
	}
	if slices.Contains(geo, 1301) || slices.Contains(geo, 401) {
		t.Errorf("the robe and gloves replace the plain legs and hands: %v", geo)
	}
	want := []wow.Attachment{
		{Point: wow.AttachHelm, Model: headItems + "Helm_A_HuM.mdx", Texture: headItems + "HelmTex.blp"},
		{Point: wow.AttachShoulderLeft, Model: shoulderItems + "LShoulder_A.mdx", Texture: shoulderItems + "ShoulderTex.blp"},
		{Point: wow.AttachShoulderRight, Model: shoulderItems + "RShoulder_A.mdx", Texture: shoulderItems + "ShoulderTex.blp"},
	}
	if !slices.Equal(d.look.Attach, want) {
		t.Fatalf("attachments %+v, want %+v", d.look.Attach, want)
	}
}

func TestCreatureLookShowsHairWithoutAHelmet(t *testing.T) {
	m := humanTables(t)
	m.creatureExtra = testDBC(t, 19, []any{5, 1, 0, 0, 0, 2, 1, 3})
	d := m.creatureLook(10, gear{})
	if !slices.Contains(d.look.Geosets, 5) {
		t.Fatalf("geosets %v lack hair style 5", d.look.Geosets)
	}
	if len(d.look.Attach) != 0 {
		t.Fatalf("nothing worn or held, got %+v", d.look.Attach)
	}
	if d.look.Textures[wow.TexBody] != "Skin.blp" {
		t.Fatalf("without a bake the body is the skin section's texture, got %q", d.look.Textures[wow.TexBody])
	}
}

// hairGeosets are the geosets of a look in the hair group (1-99).
func hairGeosets(geo []int) []int {
	var hair []int
	for _, id := range geo {
		if id > 0 && id < 100 {
			hair = append(hair, id)
		}
	}
	return hair
}

// TestCreatureLookShowsTheScalp checks the hair the client draws where no row names a submesh of
// its own: a bald style (submesh 0) and a style CharHairGeosets lacks both show the scalp (1), and a
// style without a hair texture takes variation 1's at its colour (#965).
func TestCreatureLookShowsTheScalp(t *testing.T) {
	for _, style := range []int{0, 7} {
		m := humanTables(t)
		m.creatureExtra = testDBC(t, 19, []any{5, 1, 0, 0, 0, style, 1, 3})
		m.hairGeosets = testDBC(t, 6, []any{1, 1, 0, 0, 0, 1}, []any{2, 1, 0, 2, 5, 0})
		m.sections = testDBC(t, 10, []any{2, 1, 0, 3, 1, 1, "Hair01.blp", "", ""})
		d := m.creatureLook(10, gear{})
		if got := hairGeosets(d.look.Geosets); !slices.Equal(got, []int{1}) {
			t.Errorf("style %d: hair geosets %v, want the scalp (1)", style, got)
		}
		if got := d.look.Textures[wow.TexHair]; got != "Hair01.blp" {
			t.Errorf("style %d: hair texture %q, want variation 1's", style, got)
		}
	}
}

// TestCreatureLooksLiveShowHair dresses every CreatureDisplayInfoExtra row of the client and checks
// that each shows exactly one hair submesh, and that the rows the client draws with a hair texture
// get one: an orc woman's eighth style (CharHairGeosets lists seven) and a bald human man (#965). It
// needs WOW_DIR.
func TestCreatureLooksLiveShowHair(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	m, err := loadModelTables(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if m.creatureExtra == nil || m.hairGeosets == nil || m.sections == nil {
		t.Fatal("the client lacks a look table")
	}
	none := [wearSlots]int{-1, -1, -1, -1, -1, -1, -1, -1, -1, -1}
	for er := 0; er < m.creatureExtra.records; er++ {
		var d creatureDisplay
		m.dressCharacter(&d, er)
		if hair := hairGeosets(d.look.Geosets); len(hair) != 1 {
			t.Errorf("extra row %d (%+v): hair geosets %v, want one", m.creatureExtra.u32(er, 0), m.extraLook(er), hair)
		}
	}
	for _, cl := range []charLook{{race: 2, sex: 1, hairStyle: 7}, {race: 1, sex: 0, hairStyle: 0}} {
		var d creatureDisplay
		m.dress(&d, cl, none, -1, "")
		if got := hairGeosets(d.look.Geosets); !slices.Equal(got, []int{1}) {
			t.Errorf("%+v: hair geosets %v, want the scalp (1)", cl, got)
		}
		if d.look.Textures[wow.TexHair] == "" {
			t.Errorf("%+v: no hair texture", cl)
		}
	}
}

func TestHoldWeapons(t *testing.T) {
	m := humanTables(t)
	weapons := [3]heldItem{{display: 104, invType: 13}, {display: 105, invType: invShield}, {display: 106, invType: invRanged}}
	cases := []struct {
		sheath int
		want   []wow.Attachment
	}{
		{sheathNone, nil},
		{sheathMelee, []wow.Attachment{
			{Point: wow.AttachHandRight, Model: weaponItems + "Sword_A.mdx", Texture: weaponItems + "SwordTex.blp"},
			{Point: wow.AttachShield, Model: shieldItems + "Shield_A.mdx", Texture: shieldItems + "ShieldTex.blp"},
		}},
		{sheathRanged, []wow.Attachment{
			{Point: wow.AttachHandLeft, Model: weaponItems + "Bow_A.mdx", Texture: weaponItems + "BowTex.blp"},
		}},
	}
	for _, c := range cases {
		var d creatureDisplay
		m.holdWeapons(&d, gear{weapons: weapons, sheath: c.sheath})
		if !slices.Equal(d.look.Attach, c.want) {
			t.Errorf("sheath %d: %+v, want %+v", c.sheath, d.look.Attach, c.want)
		}
	}
}

func TestPoseAnim(t *testing.T) {
	m := humanTables(t)
	for _, c := range []struct{ stand, emote, want int }{{0, 0, 0}, {1, 0, 97}, {3, 0, 100}, {0, 233, 69}, {1, 233, 69}, {0, 9999, 0}} {
		if got := m.poseAnim(c.stand, c.emote); got != c.want {
			t.Errorf("stand %d emote %d: anim %d, want %d", c.stand, c.emote, got, c.want)
		}
	}
}

func TestReadEquipment(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	var queries []string
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		queries = append(queries, sql)
		switch {
		case strings.Contains(sql, "creature_equip_template"):
			// Equipment 7 has two rows; the likelier comes first and wins.
			return []byte("7\t1001\t1002\t0\n7\t9\t9\t9\n8\t1001\t0\t1003\n"), nil
		case strings.Contains(sql, "item_template"):
			return []byte("1001\t500\t13\n1002\t501\t14\n1003\t502\t15\n"), nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	rows := []spawnRow{
		{WorldSpawn: WorldSpawn{Kind: KindMonster, Equipment: 7}},
		{WorldSpawn: WorldSpawn{Kind: KindNPC, Equipment: 8}},
		{WorldSpawn: WorldSpawn{Kind: KindObject, Equipment: 99}},
	}
	got, err := readEquipment(worldDB{}, rows)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(queries[0], "IN (7, 8)") {
		t.Fatalf("an object's equipment must not be read: %s", queries[0])
	}
	if want := [3]heldItem{{1001, 500, 13}, {1002, 501, invShield}, {}}; got[7] != want {
		t.Fatalf("equipment 7: %+v, want %+v", got[7], want)
	}
	if want := [3]heldItem{{1001, 500, 13}, {}, {1003, 502, invRanged}}; got[8] != want {
		t.Fatalf("equipment 8: %+v, want %+v", got[8], want)
	}
}

// TestItemLookPaintsBodyArmour dresses the item editor's stand-in in body armour (#356): its own
// face and underwear and the item's body textures over its skin, the NPC's bake and clothes left
// off, a robe's skirt, and a cloak on the back.
func TestItemLookPaintsBodyArmour(t *testing.T) {
	m := humanTables(t)
	m.sections = testDBC(t, 10,
		[]any{1, 1, 0, 0, 0, 0, "Skin.blp", "", ""},
		[]any{2, 1, 0, 1, 0, 0, "FaceLower.blp", "FaceUpper.blp", ""},
		[]any{3, 1, 0, 4, 0, 0, "Pelvis.blp", "", ""})
	// 110: a robe naming a hand texture its slot doesn't paint; 111: a cloak of variant 2.
	m.itemDisplay = testDBC(t, 23,
		[]any{110, "", "", "", "", "", 1, 0, 1, 0, 0, 0, 0, 0, "Robe_AU", "", "Robe_HA", "Robe_TU", "", "Robe_LU"},
		[]any{111, "", "", "Cape_A", "", "", 2})
	m.components = map[string]bool{}
	for _, p := range []string{`ArmUpperTexture\Robe_AU_U`, `HandTexture\Robe_HA_U`, `TorsoUpperTexture\Robe_TU_M`, `TorsoUpperTexture\Robe_TU_U`, `LegUpperTexture\Robe_LU_F`} {
		m.components[strings.ToLower(`Item\TextureComponents\`+p+".blp")] = true
	}
	look := func(display uint32, invType int) wow.Look {
		l := m.itemModelLook(display, invType, 1, 0)
		if !l.Shown {
			t.Fatalf("display %d isn't shown: %+v", display, l)
		}
		q, err := url.ParseQuery(l.Look)
		if err != nil {
			t.Fatal(err)
		}
		return wow.ParseLook(q)
	}
	robe := look(110, 20)
	want := wow.ComposedTexture([]wow.SkinLayer{
		{Region: wow.RegionBase, Path: "Skin.blp"},
		{Region: wow.RegionFaceLower, Path: "FaceLower.blp"},
		{Region: wow.RegionFaceUpper, Path: "FaceUpper.blp"},
		{Region: wow.RegionLegUpper, Path: "Pelvis.blp"},
		{Region: wow.RegionArmUpper, Path: `Item\TextureComponents\ArmUpperTexture\Robe_AU_U.blp`},
		{Region: wow.RegionTorsoUpper, Path: `Item\TextureComponents\TorsoUpperTexture\Robe_TU_M.blp`},
	})
	if got := robe.Textures[wow.TexBody]; got != want {
		t.Fatalf("body texture\n%s\nwant\n%s", got, want)
	}
	if !slices.Contains(robe.Geosets, 1302) || len(robe.Attach) != 0 {
		t.Fatalf("the robe's skirt and nothing of the NPC's: %+v", robe)
	}
	cloak := look(111, invCloak)
	if cloak.Textures[wow.TexItem] != capeItems+"Cape_A.blp" || !slices.Contains(cloak.Geosets, 1503) || slices.Contains(cloak.Geosets, 1501) {
		t.Fatalf("cloak look %+v", cloak)
	}
	if m.itemModelLook(111, 5, 1, 0).Shown {
		t.Fatal("a display without body textures shows nothing as a chest piece")
	}
}

// TestCharacterModelWearsItsEquipment dresses a player character (#880) in its own look and its
// equipment slots, none of the stand-in NPC's clothes, its melee weapons drawn, or its bow when it
// holds nothing else.
func TestCharacterModelWearsItsEquipment(t *testing.T) {
	m := humanTables(t)
	m.sections = testDBC(t, 10,
		[]any{1, 1, 0, 0, 0, 0, "Skin.blp", "", ""},
		[]any{2, 1, 0, 3, 2, 1, "Hair.blp", "", ""},
		[]any{3, 1, 0, 3, 4, 0, "OtherHair.blp", "", ""})
	m.hairGeosets = testDBC(t, 6, []any{1, 1, 0, 2, 5, 0}, []any{2, 1, 0, 4, 7, 0})
	parse := func(c CharacterModel) wow.Look {
		q, err := url.ParseQuery(c.Look)
		if err != nil {
			t.Fatal(err)
		}
		return wow.ParseLook(q)
	}
	a := CharacterAppearance{Race: 1, Gender: 0, HairStyle: 4, HairColor: 0}
	c := m.characterModel(a, []WornItem{{Slot: 0, Display: 100, InvType: 1}, {Slot: 15, Display: 104, InvType: 13}, {Slot: 16, Display: 105, InvType: invShield}, {Slot: 17, Display: 106, InvType: invRanged}})
	if c.Model != `Character\Human\Male\HumanMale.mdx` {
		t.Fatalf("model %q", c.Model)
	}
	l := parse(c)
	if l.Textures[wow.TexHair] != "OtherHair.blp" || l.Textures[wow.TexBody] != "Skin.blp" {
		t.Fatalf("the character's own hair and skin, not the NPC's bake: %+v", l.Textures)
	}
	want := []wow.Attachment{
		{Point: wow.AttachHelm, Model: headItems + "Helm_A_HuM.mdx", Texture: headItems + "HelmTex.blp"},
		{Point: wow.AttachHandRight, Model: weaponItems + "Sword_A.mdx", Texture: weaponItems + "SwordTex.blp"},
		{Point: wow.AttachShield, Model: shieldItems + "Shield_A.mdx", Texture: shieldItems + "ShieldTex.blp"},
	}
	if !slices.Equal(l.Attach, want) {
		t.Fatalf("attachments %+v, want %+v", l.Attach, want)
	}
	if slices.Contains(l.Geosets, 1302) {
		t.Fatalf("the NPC's robe isn't the character's: %v", l.Geosets)
	}
	hidden := a
	hidden.HideHelm, hidden.HideCloak = true, true
	if h := parse(m.characterModel(hidden, []WornItem{{Slot: 0, Display: 100, InvType: 1}, {Slot: 15, Display: 104, InvType: 13}})); slices.ContainsFunc(h.Attach, func(x wow.Attachment) bool { return x.Point == wow.AttachHelm }) {
		t.Fatalf("Show Helm off leaves the helm off: %+v", h.Attach)
	}
	bow := parse(m.characterModel(a, []WornItem{{Slot: 17, Display: 106, InvType: invRanged}}))
	if len(bow.Attach) != 1 || bow.Attach[0].Point != wow.AttachHandLeft || !slices.Contains(bow.Geosets, 7) {
		t.Fatalf("a bow alone is drawn, and hair style 4 shown: %+v", bow)
	}
}
