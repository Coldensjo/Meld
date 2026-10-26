package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// itemDisplayDBC is an ItemDisplayInfo table: a sword (7), the same sword with another icon (8), a
// robe that only paints the body (9), and an unused helm (10).
func itemDisplayDBC(t *testing.T) *dbcTable {
	return testDBC(t, itemDisplayFields,
		[]any{7, "Sword_1H_A.mdx", "", "SwordSkin", "", "INV_Sword_04"},
		[]any{8, "Sword_1H_A.mdx", "", "SwordSkin", "", "INV_Sword_05"},
		[]any{9, "", "", "", "", "INV_Chest_Cloth_01", 0, 1, 0, 0, 0, 0, 0, 0, "Robe_TU"},
		[]any{10, "Helm_Plate_A.mdx", "", "HelmSkin", "", "INV_Helmet_01"},
	)
}

func TestListItemDisplays(t *testing.T) {
	rows := []batchRow{{"7", "13", "Blade", "2", "7"}, {"7", "21", "Edge", "2", "7"}, {"7", "13", "Cutter", "2", "7"}, {"9", "20", "Robe", "4", "1"}}
	got := listItemDisplays(itemDisplayDBC(t), rows)
	if len(got) != 4 {
		t.Fatalf("%d displays", len(got))
	}
	sword, robe, helm := got[0], got[2], got[3]
	if sword.Kind != "weapon" || sword.Uses != 3 || sword.Model != "Sword_1H_A" || sword.Icon != "INV_Sword_04" || strings.Join(sword.Names, ",") != "Blade,Edge,Cutter" {
		t.Errorf("sword %+v", sword)
	}
	if sword.Path != `Item\ObjectComponents\Weapon\Sword_1H_A.mdx` || !strings.Contains(sword.Skin, "SwordSkin.blp") {
		t.Errorf("sword's model %q %q", sword.Path, sword.Skin)
	}
	if helm.Path != `Item\ObjectComponents\Head\Helm_Plate_A_HuM.mdx` || robe.Path != "" {
		t.Errorf("helm %q, robe %q", helm.Path, robe.Path)
	}
	if robe.Kind != "body" || helm.Kind != "head" || helm.Uses != 0 || got[1].Kind != "weapon" {
		t.Errorf("robe %+v, helm %+v, unused sword %+v", robe, helm, got[1])
	}
}

func TestItemIconDisplay(t *testing.T) {
	tab := itemDisplayDBC(t)
	// Its own icon, and an icon another display already pairs with the same sword: nothing to write.
	for icon, want := range map[string]int{"INV_Sword_04": 7, "inv_sword_05": 8} {
		if id, dbc, err := itemDisplayVariant(tab.data, 7, icon, -1); err != nil || id != want || dbc != nil {
			t.Errorf("%s: %d %v %v", icon, id, dbc != nil, err)
		}
	}
	// A new pairing: a row past the last, a copy of the sword with the new icon.
	id, dbc, err := itemDisplayVariant(tab.data, 7, "INV_Axe_01", -1)
	if err != nil || id != 11 || dbc == nil {
		t.Fatalf("%d %v", id, err)
	}
	out, err := parseDBC(dbc)
	if err != nil {
		t.Fatal(err)
	}
	r, ok := out.row(11)
	if !ok || out.records != 5 || out.str(r, idIcon) != "INV_Axe_01" || out.str(r, idModel) != "Sword_1H_A.mdx" || out.str(r, idTexture) != "SwordSkin" {
		t.Fatalf("new row: %d records, icon %q model %q", out.records, out.str(r, idIcon), out.str(r, idModel))
	}
	if r7, _ := out.row(7); out.str(r7, idIcon) != "INV_Sword_04" {
		t.Error("the sword's own row changed")
	}
	// No display: a row with the icon alone.
	id, dbc, _ = itemDisplayVariant(tab.data, 0, "INV_Misc_Gem_01", -1)
	out, _ = parseDBC(dbc)
	if r, ok := out.row(uint32(id)); !ok || id != 11 || out.str(r, idModel) != "" || out.str(r, idIcon) != "INV_Misc_Gem_01" {
		t.Fatalf("an icon alone: %d", id)
	}
}

func TestIconNames(t *testing.T) {
	got := iconNames([]string{`Interface\Icons\INV_Sword_04.blp`, `interface\icons\inv_sword_04.BLP`, `Interface\Icons\Sub\X.blp`, `Interface\Glues\a.blp`, `Interface\Icons\Ability_A.blp`})
	if strings.Join(got, ",") != "Ability_A,INV_Sword_04" {
		t.Fatal(got)
	}
}

// TestItemLooksLive lists the client's item displays and icons. It needs WOW_DIR, and VMANGOS_DIR
// (database running) for the displays' items.
func TestItemLooksLive(t *testing.T) {
	clientDir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(clientDir)
	if err != nil {
		t.Fatal(err)
	}
	server := testclient.ServerDirIfAny()
	displays, err := ListItemDisplays(server, dataDir)
	if err != nil || len(displays) < 10000 {
		t.Fatalf("%d displays, %v", len(displays), err)
	}
	icons, err := ListItemIcons(dataDir)
	if err != nil || len(icons) < 2000 {
		t.Fatalf("%d icons, %v", len(icons), err)
	}
	kinds := map[string]int{}
	for _, d := range displays {
		kinds[d.Kind]++
		if d.ID == 8690 && server != "" && (d.Kind != "weapon" || d.Icon != "INV_Hammer_15" || len(d.Names) == 0) {
			t.Errorf("Battleworn Hammer's display %+v", d)
		}
	}
	t.Logf("%d displays %v, %d icons", len(displays), kinds, len(icons))
	if id, dbc, err := ItemDisplayVariant(dataDir, 8690, "INV_Hammer_15", -1); err != nil || id != 8690 || dbc != nil {
		t.Errorf("own icon: %d %v", id, err)
	}
}

// A look's shot visual: what the items using it are, and a variant that fires like another weapon.
func TestShotVisuals(t *testing.T) {
	// 20 a bow (visual 5), 21 a crossbow (743), 22 a bow model with the crossbow's visual that no item uses.
	tab := testDBC(t, itemDisplayFields,
		[]any{20, "Bow_A.mdx", "", "BowSkin", "", "INV_Weapon_Bow_05", 0, 0, 0, 0, 5},
		[]any{21, "Bow_2H_Crossbow_A.mdx", "", "XbowSkin", "", "INV_Weapon_Crossbow_01", 0, 0, 0, 0, 743},
		[]any{22, "Bow_A.mdx", "", "XbowSkin", "", "INV_Weapon_Bow_09", 0, 0, 0, 0, 743},
	)
	rows := []batchRow{{"20", "15", "Shortbow", "2", "2"}, {"21", "26", "Crossbow", "2", "18"}}
	got := listItemDisplays(tab, rows)
	if got[0].Shoots != 2 || got[1].Shoots != 18 || got[2].Shoots != 18 || got[2].Visual != 743 {
		t.Fatalf("shoots %d %d %d", got[0].Shoots, got[1].Shoots, got[2].Shoots)
	}
	// Display 22 made to shoot like a bow: a new row, the same model, texture and icon, visual 5.
	id, dbc, err := itemDisplayVariant(tab.data, 22, "", 5)
	if err != nil || id != 23 || dbc == nil {
		t.Fatalf("%d %v", id, err)
	}
	out, _ := parseDBC(dbc)
	r, _ := out.row(23)
	if out.u32(r, idVisual) != 5 || out.str(r, idIcon) != "INV_Weapon_Bow_09" || out.str(r, idTexture) != "XbowSkin" {
		t.Fatalf("variant: visual %d icon %q texture %q", out.u32(r, idVisual), out.str(r, idIcon), out.str(r, idTexture))
	}
	// The bow already shoots like one: itself, nothing written.
	if id, dbc, _ := itemDisplayVariant(tab.data, 20, "", 5); id != 20 || dbc != nil {
		t.Errorf("bow: %d %v", id, dbc != nil)
	}
}
