package vmangos

import (
	"reflect"
	"testing"
)

// TestParseSpawnEvents: mariadb's rows become each guid's events in order, a negative event (the
// spawn leaves while it runs) kept as is, and a malformed row or event 0 dropped.
func TestParseSpawnEvents(t *testing.T) {
	raw := []byte("10\t2\n10\t-4\n11\t17\nx\t3\n12\t0\n")
	got := parseSpawnEvents(raw)
	want := map[int][]int{10: {2, -4}, 11: {17}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseSpawnEvents = %v, want %v", got, want)
	}
}

func TestParseGameEvents(t *testing.T) {
	got := parseGameEvents([]byte("2\tFeast of Winter Veil\n4\tDarkmoon Faire (Elwynn)\r\n"))
	want := []GameEvent{{2, "Feast of Winter Veil"}, {4, "Darkmoon Faire (Elwynn)"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseGameEvents = %v, want %v", got, want)
	}
}
