package vmangos

import (
	"testing"

	"Meld/internal/testclient"
)

// EquipmentItemsOf reads the items of several equipment templates at once as EquipmentItems reads
// one, for the CMaNGOS spawn SQL (#1042), and leaves out a template the database lacks.
func TestEquipmentItemsOfLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	db, err := worldDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := runSQL(db, "SELECT entry FROM creature_equip_template WHERE item1 <> 0 OR item2 <> 0 OR item3 <> 0 GROUP BY entry ORDER BY entry LIMIT 3")
	if err != nil {
		t.Fatal(err)
	}
	var ids []int
	for _, f := range batchRows(raw, 1) {
		if n, ok := atoiAll(f); ok {
			ids = append(ids, n[0])
		}
	}
	if len(ids) < 2 {
		t.Fatalf("the world database has %d equipment templates", len(ids))
	}
	got, err := EquipmentItemsOf(dir, append(ids, 16777215))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(ids) {
		t.Errorf("%d templates read of %v: %v", len(got), ids, got)
	}
	for _, id := range ids {
		want, err := EquipmentItems(dir, id)
		if err != nil || got[id] != want || want == [3]int{} {
			t.Errorf("template %d: %v, want %v (%v)", id, got[id], want, err)
		}
	}
}
