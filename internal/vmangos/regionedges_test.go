package vmangos

import "testing"

func TestEdgeOf(t *testing.T) {
	lattice := make([]float32, LatticeSize*LatticeSize)
	for r := 0; r < LatticeSize; r++ {
		for c := 0; c < LatticeSize; c++ {
			lattice[r*LatticeSize+c] = float32(r*1000 + c)
		}
	}
	last := LatticeSize - 1
	for _, tc := range []struct {
		side string
		at   func(k int) float32
	}{
		{"north", func(k int) float32 { return float32(last*1000 + k) }},
		{"south", func(k int) float32 { return float32(k) }},
		{"west", func(k int) float32 { return float32(k*1000 + last) }},
		{"east", func(k int) float32 { return float32(k * 1000) }},
	} {
		e := edgeOf(lattice, tc.side)
		for _, k := range []int{0, 7, last} {
			if e[k] != tc.at(k) {
				t.Errorf("%s edge[%d] = %v, want %v", tc.side, k, e[k], tc.at(k))
			}
		}
	}
}
