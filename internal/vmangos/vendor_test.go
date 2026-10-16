package vmangos

import (
	"strings"
	"testing"
)

func TestVendorSQLNumbersSlotsAndRefusesDuplicates(t *testing.T) {
	sql, err := vendorSQL(66, []VendorItem{{Item: 2512, MaxCount: 0}, {Item: 159, MaxCount: 5, IncrTime: 900}})
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM `npc_vendor` WHERE `entry` = 66;\n" +
		"INSERT INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`, `incrtime`, `itemflags`, `condition_id`) VALUES (66, 0, 2512, 0, 0, 0, 0);\n" +
		"INSERT INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`, `incrtime`, `itemflags`, `condition_id`) VALUES (66, 1, 159, 5, 900, 0, 0);"
	if sql != want {
		t.Fatalf("got\n%s\nwant\n%s", sql, want)
	}
	if _, err := vendorSQL(66, []VendorItem{{Item: 159}, {Item: 159}}); err == nil {
		t.Fatal("an item listed twice was accepted")
	}
	if _, err := vendorSQL(66, []VendorItem{{Item: 159, MaxCount: 300}}); err == nil {
		t.Fatal("a stock over 255 was accepted")
	}
	sql, err = vendorSQL(66, nil)
	if err != nil || strings.Contains(sql, "INSERT") {
		t.Fatalf("an empty shop should only delete: %q %v", sql, err)
	}
}

func TestParseVendorItems(t *testing.T) {
	got := parseVendorItems([]byte("159\tRefreshing Spring Water\t1\t0\t0\t0\t0\n2512\tRough Arrow\t1\t5\t900\t0\t0\n"))
	if len(got) != 2 || got[0].Name != "Refreshing Spring Water" || got[1].MaxCount != 5 || got[1].IncrTime != 900 {
		t.Fatalf("got %+v", got)
	}
}
