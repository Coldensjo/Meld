package wow

import (
	"os"
	"testing"
)

// TestClientWaterfallUVAnim reads Elwynn's tall waterfall, whose two batches scroll their texture down
// at different rates (Benilla's tex_anim.rs test of the same model): both groups carry a translation
// that moves along V over a real loop, and the rates differ. It needs WOW_DIR.
func TestClientWaterfallUVAnim(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.x client to run")
	}
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
