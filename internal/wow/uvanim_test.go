package wow

import (
	"testing"

	"Meld/internal/testclient"
)

// TestClientWaterfallUVAnim reads Elwynn's tall waterfall, whose two batches scroll their texture down
// at different rates (Benilla's tex_anim.rs test of the same model): both groups carry a translation
// that moves along V over a real loop, and the rates differ. It needs WOW_DIR.
func TestClientWaterfallUVAnim(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	m, err := c.m2Mesh(`World\Azeroth\Elwynn\PassiveDoodads\Waterfall\ElwynnTallWaterfall01.m2`, nil)
	if err != nil {
		t.Fatal(err)
	}
	var ends []float32
	for _, g := range m.Groups {
		if g.UV == nil || g.UV.T == nil {
			continue
		}
		tr := g.UV.T
		if tr.Loop < 1000 || len(tr.Times) < 2 {
			t.Fatalf("a loop of %d ms with %d keys", tr.Loop, len(tr.Times))
		}
		first, last := tr.Values[1], tr.Values[len(tr.Values)-2]
		if d := last - first; d > -0.01 && d < 0.01 {
			t.Fatalf("V doesn't move: %v", tr.Values)
		}
		ends = append(ends, last)
	}
	if len(ends) != 2 {
		t.Fatalf("%d groups scroll, want the waterfall's 2", len(ends))
	}
	if d := ends[0] - ends[1]; d < 0.5 && d > -0.5 {
		t.Fatalf("both layers scroll alike: %v", ends)
	}
	t.Logf("V scroll per loop: %v", ends)
}

// TestClientColorAnim follows Benilla's mat_anim.rs tests: the Stormwind mage portal's shimmer is a
// transparency weight that changes over the loop, within 0 to 1; and Tanaris's troll gate holds an
// intact gate and its burnt twin, whose colour alpha hides the twin (-1, a signed decode) in the loop
// played while the gate shows. It needs WOW_DIR.
func TestClientColorAnim(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	portal, err := c.m2Mesh(`World\generic\activedoodads\mageportals\StormwindMagePortal01.m2`, nil)
	if err != nil {
		t.Fatal(err)
	}
	shimmer := false
	for _, g := range portal.Groups {
		if g.Color == nil || g.Color.Weight == nil || len(g.Color.Weight.Times) < 2 {
			continue
		}
		lo, hi := float32(2), float32(-2)
		for _, v := range g.Color.Weight.Values {
			lo, hi = min(lo, v), max(hi, v)
		}
		if lo < 0 || hi > 1 {
			t.Fatalf("a weight outside 0 to 1: %v", g.Color.Weight.Values)
		}
		shimmer = shimmer || hi-lo > 1e-3
	}
	if !shimmer {
		t.Fatal("the portal's shimmer has no changing weight")
	}
	gate, err := c.m2Mesh(`World\Kalimdor\Tanaris\ActiveDoodads\TrollGate\TanarisTrollGate.m2`, nil)
	if err != nil {
		t.Fatal(err)
	}
	hidden, shown := 0, 0
	for _, g := range gate.Groups {
		// A group drawn throughout has no alpha track (it holds 1) or a positive one.
		if g.Color != nil && g.Color.Alpha != nil && g.Color.Alpha.Values[0] <= 0 {
			hidden++
		} else {
			shown++
		}
	}
	if hidden == 0 || shown == 0 {
		t.Fatalf("troll gate: %d groups hidden by their alpha, %d shown", hidden, shown)
	}
	t.Logf("troll gate: %d groups hidden, %d shown by alpha", hidden, shown)
}
