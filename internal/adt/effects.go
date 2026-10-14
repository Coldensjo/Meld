package adt

import (
	"encoding/binary"
	"strings"
)

// Ground effects: each texture layer carries a GroundEffectTexture ID, which names the grass tufts
// and flowers the game scatters on the cells where that layer is on top (the chunk's predominant
// texture map). This file reads a tile's texture-to-effect pairs and builds the per-cell map.

// LayerEffects returns the ground effect each texture of a tile carries: lower-case texture path to
// GroundEffectTexture ID, the first non-zero one a layer of that texture has.
func LayerEffects(root []byte) (map[string]uint32, error) {
	top, err := readTop(root)
	if err != nil {
		return nil, err
	}
	return tileEffects(top), nil
}

// tileEffects collects a parsed tile's texture-to-effect pairs (see LayerEffects).
func tileEffects(top *topLevel) map[string]uint32 {
	names := splitNames(top.mtex)
	effects := map[string]uint32{}
	for _, m := range top.mcnks {
		mcly, ok := subRegion(m, int(binary.LittleEndian.Uint32(m[0x1c:])))
		if !ok {
			continue
		}
		for o := 0; o+16 <= len(mcly); o += 16 {
			id := int(binary.LittleEndian.Uint32(mcly[o:]))
			if id < len(names) {
				key := strings.ToLower(names[id])
				if e := binary.LittleEndian.Uint32(mcly[o+12:]); e != 0 && effects[key] == 0 {
					effects[key] = e
				}
			}
		}
	}
	return effects
}

// mcnkPredTex is where the chunk header keeps the predominant texture map: two bits per cell, 8x8
// cells, the layer that weighs most in each, which the game grows that layer's effect on.
const mcnkPredTex = 0x40

// PredominantFromWeights gives, for each of a chunk's 64 cells (row-major), the layer that weighs most
// over the cell's texels. names has n layers; weights holds n values per texel (then padding to
// four), perSide texels a side.
func PredominantFromWeights(n int, weights []byte, perSide int) []uint8 {
	out := make([]uint8, CellsPerChunk*CellsPerChunk)
	if n <= 1 || perSide < CellsPerChunk {
		return out
	}
	per := perSide / CellsPerChunk
	var sum [4]int
	for cy := 0; cy < CellsPerChunk; cy++ {
		for cx := 0; cx < CellsPerChunk; cx++ {
			sum = [4]int{}
			for y := cy * per; y < (cy+1)*per; y++ {
				for x := cx * per; x < (cx+1)*per; x++ {
					t := (y*perSide + x) * 4
					for k := 0; k < n && k < 4; k++ {
						sum[k] += int(weights[t+k])
					}
				}
			}
			best := 0
			for k := 1; k < n && k < 4; k++ {
				if sum[k] > sum[best] {
					best = k
				}
			}
			out[cy*CellsPerChunk+cx] = uint8(best)
		}
	}
	return out
}

// writePredominant packs a chunk's per-cell layer indices into the header's two-bit map.
func writePredominant(header []byte, pred []uint8) {
	if len(pred) != CellsPerChunk*CellsPerChunk {
		return
	}
	for i := 0; i < 16; i++ {
		header[mcnkPredTex+i] = 0
	}
	for i, layer := range pred {
		bit := i * 2
		header[mcnkPredTex+bit/8] |= (layer & 3) << (bit % 8)
	}
}
