package vmangos

import (
	"fmt"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// File › Check Map (#195): the client's heights just across an open region's border. Neighbouring
// tiles share their edge vertices, so a tile outside the block holds the same border row the block's
// edge has; where the editor changed the block's edge, the two differ and the game shows a seam.

// EdgeSegment is one neighbouring tile's border row along the block: Side is "north", "south",
// "west" or "east", Offset the vertex along the block's edge it starts at (from the west or north
// end), and Heights the LatticeSize heights of the tile's row or column on the shared border.
type EdgeSegment struct {
	Side    string    `json:"side"`
	Offset  int       `json:"offset"`
	Heights []float32 `json:"heights"`
}

// tileLattice is a tile's outer heights, LatticeSize squared, rows running south.
func tileLattice(root []byte) ([]float32, error) {
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		return nil, err
	}
	out := make([]float32, LatticeSize*LatticeSize)
	for _, c := range terrain.Chunks {
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for col := 0; col <= adt.CellsPerChunk; col++ {
				gr, gc := c.IndexY*adt.CellsPerChunk+r, c.IndexX*adt.CellsPerChunk+col
				out[gr*LatticeSize+gc] = c.Heights[r*17+col]
			}
		}
	}
	return out, nil
}

// edgeOf takes the border a tile on side shares with the block: a tile north of the block gives its
// last row, south its first, west its last column, east its first.
func edgeOf(lattice []float32, side string) []float32 {
	out := make([]float32, LatticeSize)
	last := LatticeSize - 1
	for k := 0; k < LatticeSize; k++ {
		switch side {
		case "north":
			out[k] = lattice[last*LatticeSize+k]
		case "south":
			out[k] = lattice[k]
		case "west":
			out[k] = lattice[k*LatticeSize+last]
		case "east":
			out[k] = lattice[k*LatticeSize]
		}
	}
	return out
}

// ReadRegionEdges reads the border rows of the client's tiles around the block of size tiles at
// (x, y). A side off the map, or a tile the map doesn't have, gives no segment.
func ReadRegionEdges(dataDir, mapName string, x, y, size int) ([]EdgeSegment, error) {
	if err := checkRegion(x, y, size); err != nil {
		return nil, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	out := []EdgeSegment{}
	add := func(side string, tx, ty, offset int) error {
		if tx < 0 || ty < 0 || tx >= MapTiles || ty >= MapTiles {
			return nil
		}
		root, err := set.ReadFile(adt.TilePath(mapName, tx, ty, ""))
		if err != nil {
			return nil // no tile there: nothing to meet
		}
		lattice, err := tileLattice(root)
		if err != nil {
			return fmt.Errorf("tile %d_%d: %w", tx, ty, err)
		}
		out = append(out, EdgeSegment{Side: side, Offset: offset, Heights: edgeOf(lattice, side)})
		return nil
	}
	for i := 0; i < size; i++ {
		off := i * tileCells
		for _, s := range []struct {
			side   string
			tx, ty int
		}{
			{"north", x + i, y - 1},
			{"south", x + i, y + size},
			{"west", x - 1, y + i},
			{"east", x + size, y + i},
		} {
			if err := add(s.side, s.tx, s.ty, off); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}
