package vmangos

import (
	"strings"
	"testing"
)

func TestParseSpellTarget(t *testing.T) {
	got := parseSpellTarget([]byte("0\t-9003.46\t870.031\t29.6206\t5.28\n"))
	if got == nil || got.Map != 0 || got.X != -9003.46 || got.Y != 870.031 || got.Z != 29.6206 || got.O != 5.28 {
		t.Fatalf("parseSpellTarget = %+v", got)
	}
	if parseSpellTarget([]byte("")) != nil {
		t.Fatal("an empty result should give no destination")
	}
}

func TestTeleportSpellSQL(t *testing.T) {
	q := teleportSpellSQL(176296)
	for _, want := range []string{"WHEN 22 THEN data0", "WHEN 10 THEN data10", "entry = 176296", "ORDER BY patch DESC"} {
		if !strings.Contains(q, want) {
			t.Errorf("teleportSpellSQL lacks %q: %s", want, q)
		}
	}
	if q := spellTargetSQL(17334); !strings.Contains(q, "id = 17334") || !strings.Contains(q, "build_min <= 5875") {
		t.Errorf("spellTargetSQL = %s", q)
	}
}
