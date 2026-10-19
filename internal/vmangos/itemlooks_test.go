package vmangos

import (
	"os"
	"strings"
	"testing"

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
	rows := [][]string{{"7", "13", "Blade"}, {"7", "21", "Edge"}, {"7", "13", "Cutter"}, {"9", "20", "Robe"}}
	got := listItemDisplays(itemDisplayDBC(t), rows)
	if len(got) != 4 {
		t.Fatalf("%d displays", len(got))
	}
	sword, robe, helm := got[0], got[2], got[3]
	if sword.Kind != "weapon" || sword.Uses != 3 || sword.Model != "Sword_1H_A" || sword.Icon != "INV_Sword_04" || strings.Join(sword.Names, ",") != "Blade,Edge,Cutter" {
		t.Errorf("sword %+v", sword)
	}
	if robe.Kind != "body" || helm.Kind != "head" || helm.Uses != 0 || got[1].Kind != "weapon" {
		t.Errorf("robe %+v, helm %+v, unused sword %+v", robe, helm, got[1])
	}
}

func TestItemIconDisplay(t *testing.T) {
	tab := itemDisplayDBC(t)
	// Its own icon, and an icon another display already pairs with the same sword: nothing to write.
	for icon, want := range map[string]int{"INV_Sword_04": 7, "inv_sword_05": 8} {
		if id, dbc, err := itemIconDisplay(tab.data, 7, icon); err != nil || id != want || dbc != nil {
			t.Errorf("%s: %d %v %v", icon, id, dbc != nil, err)
		}
	}
	// A new pairing: a row past the last, a copy of the sword with the new icon.
	id, dbc, err := itemIconDisplay(tab.data, 7, "INV_Axe_01")
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
	id, dbc, _ = itemIconDisplay(tab.data, 0, "INV_Misc_Gem_01")
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
	clientDir := os.Getenv("WOW_DIR")
	if clientDir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(clientDir)
	if err != nil {
		t.Fatal(err)
	}
	displays, err := ListItemDisplays(os.Getenv("VMANGOS_DIR"), dataDir)
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
		if d.ID == 8690 && os.Getenv("VMANGOS_DIR") != "" && (d.Kind != "weapon" || d.Icon != "INV_Hammer_15" || len(d.Names) == 0) {
			t.Errorf("Battleworn Hammer's display %+v", d)
		}
	}
	t.Logf("%d displays %v, %d icons", len(displays), kinds, len(icons))
	if id, dbc, err := ItemIconDisplay(dataDir, 8690, "INV_Hammer_15"); err != nil || id != 8690 || dbc != nil {
		t.Errorf("own icon: %d %v", id, err)
	}
}
