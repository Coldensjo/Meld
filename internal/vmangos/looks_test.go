package vmangos

import (
	"encoding/binary"
	"slices"
	"strings"
	"testing"

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
	if slices.Contains(geo, 5) {
		t.Errorf("the helmet hides human hair, but geosets %v show hair style 5", geo)
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
