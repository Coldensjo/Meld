package vmangos

import (
	"reflect"
	"testing"
)

func TestSpawnIDQueries(t *testing.T) {
	if got := guidRowsSQL("creature", []int{5, 0, 3, 5}); got != "SELECT `guid`, `id`, `map` FROM `creature` WHERE `guid` IN (5,3) ORDER BY `guid`" {
		t.Errorf("guid rows SQL: %s", got)
	}
	if guidRowsSQL("creature", []int{0, -1}) != "" || knownEntriesSQL("creature_template", nil) != "" {
		t.Error("no ids should ask nothing")
	}
	rows := parseGUIDRows([]byte("3\t299\t0\r\n5\t6\t1\nbad line\n"))
	if want := []GUIDRow{{3, 299, 0}, {5, 6, 1}}; !reflect.DeepEqual(rows, want) {
		t.Errorf("rows %v, want %v", rows, want)
	}
	if got := missingEntries([]int{1, 2, 3, 2, 0}, []byte("1\r\n3\n")); !reflect.DeepEqual(got, []int{2}) {
		t.Errorf("missing %v, want [2]", got)
	}
}
