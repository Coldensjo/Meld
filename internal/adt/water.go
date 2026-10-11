package adt

import (
	"encoding/binary"
	"math"
)

// Liquids as the 1.12 client stores them: an MCLQ per chunk, holding the level, each vertex's depth
// and a flag per cell saying whether the liquid covers it. The chunk's MCNK flags say what kind it is.

const (
	// mcnkLiquidMask is the MCNK flags' liquid bits, which a chunk clears before it's given water.
	mcnkLiquidMask = 0x3c
	// liquidWater is the MCNK flag of a water chunk.
	liquidWater = 0x04
	// cellWater is an MCLQ cell's flag where the water covers it; cellNoLiquid where it doesn't.
	cellWater    = 0x04
	cellNoLiquid = 0x0f
	// liquidVerts is the 9x9 vertices an MCLQ holds, at 8 bytes each.
	liquidVerts = 81
	// liquidEntry is the size of one MCLQ: a level pair, the vertices, 64 cell flags, and flow data.
	liquidEntry = 8 + liquidVerts*8 + 64 + 4 + 2*40
)

// waterRecord returns a chunk's MCLQ at a water level: m is its MCNK payload, mcvt its MCVT region
// with the header. It returns nil when the ground under no cell lies below the level.
func waterRecord(m []byte, mcvt []byte, level float32) []byte {
	if len(mcvt) < 8+HeightCount*4 || len(m) < 0x74 {
		return nil
	}
	base := f32(m, 0x70)
	// The ground at outer sample i of the chunk (rows of 17 samples: 9 outer, then 8 inner).
	ground := func(i int) float32 { return base + f32(mcvt, 8+i*4) }

	var cells [CellsPerChunk * CellsPerChunk]bool
	covered := false
	for r := 0; r < CellsPerChunk; r++ {
		for c := 0; c < CellsPerChunk; c++ {
			avg := (ground(r*17+c) + ground(r*17+c+1) + ground((r+1)*17+c) + ground((r+1)*17+c+1)) / 4
			if avg < level {
				cells[r*CellsPerChunk+c] = true
				covered = true
			}
		}
	}
	if !covered {
		return nil
	}

	rec := make([]byte, liquidEntry)
	binary.LittleEndian.PutUint32(rec[0:], math.Float32bits(level))
	binary.LittleEndian.PutUint32(rec[4:], math.Float32bits(level))
	for r := 0; r <= CellsPerChunk; r++ {
		for c := 0; c <= CellsPerChunk; c++ {
			o := 8 + (r*(CellsPerChunk+1)+c)*8
			// The depth is in tenths of a yard, clamped to a byte; it's what shores fade by.
			depth := math.Round(float64(level-ground(r*17+c)) * 10)
			rec[o] = byte(math.Max(0, math.Min(255, depth)))
			binary.LittleEndian.PutUint32(rec[o+4:], math.Float32bits(level))
		}
	}
	flags := 8 + liquidVerts*8
	for i, on := range cells {
		if on {
			rec[flags+i] = cellWater
		} else {
			rec[flags+i] = cellNoLiquid
		}
	}
	return rec
}
