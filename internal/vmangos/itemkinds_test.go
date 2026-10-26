package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
)

func TestUsualItemValues(t *testing.T) {
	cols := []string{"display_id", "sheath", "delay", "max_durability"}
	rows := []batchRow{
		{"8106", "0", "2300", "20"},
		{"8106", "0", "3000", "30"},
		{"20722", "1", "2800", "65"},
		{"20722", "0", "2900", "90"},
	}
	got := usualItemValues(cols, rows)
	// A tie (8106 and 20722 twice each) takes the lower; delay and durability take the middle value.
	if got["display_id"] != "8106" || got["sheath"] != "0" || got["delay"] != "2900" || got["max_durability"] != "65" {
		t.Fatalf("%v", got)
	}
	sql, err := kindItemSQL(map[string]TemplateColumn{
		"name":       {Name: "name", Kind: "text", MaxLen: 255},
		"display_id": {Name: "display_id", Kind: "uint", Max: 1<<24 - 1},
		"sheath":     {Name: "sheath", Kind: "uint", Max: 255},
		"delay":      {Name: "delay", Kind: "uint", Max: 65535},
	}, 90001, ItemKind{Class: 2, Subclass: 2, InvType: 15}, "New Bow", got)
	want := "INSERT INTO `item_template` (`entry`, `patch`, `name`, `class`, `subclass`, `inventory_type`, `quality`, `delay`, `display_id`, `sheath`) " +
		"VALUES (90001, 0, 'New Bow', 2, 2, 15, 1, 2900, 8106, 0);"
	if err != nil || sql != want {
		t.Fatalf("%s\n%v", sql, err)
	}
}

// TestItemKindsLive lists the world database's kinds of item and works out a bow's basics. It needs
// VMANGOS_DIR (database running) and writes nothing.
func TestItemKindsLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	kinds, err := ListItemKinds(dir)
	if err != nil || len(kinds) < 50 {
		t.Fatalf("%d kinds, %v", len(kinds), err)
	}
	found := false
	for _, k := range kinds {
		found = found || (k.Class == 2 && k.Subclass == 2 && k.InvType == 15 && k.Count > 100)
	}
	if !found {
		t.Fatal("no bows")
	}
	db, _ := openWorld(dir)
	raw, err := runSQL(db, "SELECT t.display_id, t.sheath, t.ammo_type, t.range_mod, t.delay, t.max_durability, t.material FROM item_template t WHERE t.class = 2 AND t.subclass = 2 AND t.inventory_type = 15 AND "+newestItemRow)
	if err != nil {
		t.Fatal(err)
	}
	got := usualItemValues([]string{"display_id", "sheath", "ammo_type", "range_mod", "delay", "max_durability", "material"}, batchRows(raw, 7))
	t.Logf("%d kinds; a bow's basics: %v", len(kinds), got)
	if got["ammo_type"] != "2" || got["range_mod"] != "100" || got["sheath"] != "0" || got["material"] != "2" || !strings.HasPrefix(got["delay"], "2") && !strings.HasPrefix(got["delay"], "3") {
		t.Fatalf("bow basics %v", got)
	}
}
