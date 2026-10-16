package wow

import (
	"encoding/binary"
	"testing"
)

// seqTable is a sequence table of the given AnimationData IDs, seqSize bytes each.
func seqTable(ids ...int) reader {
	b := make([]byte, len(ids)*seqSize)
	for i, id := range ids {
		binary.LittleEndian.PutUint16(b[i*seqSize:], uint16(id))
	}
	return reader{b}
}

// TestPickSequence: the asked-for loop, else Stand, else Closed, else the first. A chest such as
// TreasureChest01.mdx lists Open, Opened, Close, Closed and no Stand, so it must play Closed, not
// open over and over (#146).
func TestPickSequence(t *testing.T) {
	cases := []struct {
		ids    []int
		animID int
		want   int
	}{
		{[]int{148, 149, 146, 147, 154, 153}, 0, 3}, // TreasureChest01: Closed
		{[]int{148, 146, 147, 149, 0}, 0, 4},        // Chest01: Stand
		{[]int{0, 4, 69}, 69, 2},                    // the asked-for loop first
		{[]int{4, 5}, 0, 0},                         // neither: the first
		{nil, 0, -1},
	}
	for _, c := range cases {
		r := seqTable(c.ids...)
		if got := pickSequence(r, len(c.ids), 0, c.animID); got != c.want {
			t.Errorf("pickSequence(%v, %d) = %d, want %d", c.ids, c.animID, got, c.want)
		}
	}
}
