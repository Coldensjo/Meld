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
func edgeOf(lattice []float32, side string) []float32 { return lineOf(lattice, side, 0) }

// ringOf takes the line of a neighbour's lattice just across the border from the tile it is on side
// of: a north neighbour gives its second to last row, south its second, west its second to last
// column, east its second (adt.Ring, #492).
func ringOf(lattice []float32, side string) []float32 { return lineOf(lattice, side, 1) }

// lineOf takes the row or column in from the border a tile on side shares with its neighbour, as
// edgeOf names the border.
func lineOf(lattice []float32, side string, in int) []float32 {
	out := make([]float32, LatticeSize)
	last := LatticeSize - 1 - in
	for k := 0; k < LatticeSize; k++ {
		switch side {
		case "north":
			out[k] = lattice[last*LatticeSize+k]
		case "south":
			out[k] = lattice[in*LatticeSize+k]
		case "west":
			out[k] = lattice[k*LatticeSize+last]
		case "east":
			out[k] = lattice[k*LatticeSize+in]
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

// blockEdges is the ring around each of a block's tiles for their normals (adt.Edges, #492), in the
// block's order (row by row, rows running south). Inside the block, Now comes from heights (the
// block's, side squared, side = size*tileCells+1) and Was from roots, the tiles the save starts from.
// At the block's border both come from the client's tiles beyond: Now as the client reads them now,
// Was without Meld's patch, as the client's own normals were made against. A side off the map, or
// toward a tile the map doesn't have, stays empty and its normals one-sided.
func blockEdges(set *mpq.Set, mapName string, x, y, size int, heights []float32, roots [][]byte) ([]adt.Edges, error) {
	side := size*tileCells + 1
	inner := make([][]float32, len(roots))
	innerOf := func(k int) ([]float32, error) {
		if inner[k] == nil {
			lattice, err := tileLattice(roots[k])
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", x+k%size, y+k/size, err)
			}
			inner[k] = lattice
		}
		return inner[k], nil
	}
	type beyond struct{ now, was []float32 }
	outside := map[[2]int]beyond{}
	outsideOf := func(tx, ty int) (beyond, error) {
		if b, ok := outside[[2]int{tx, ty}]; ok {
			return b, nil
		}
		var b beyond
		if tx >= 0 && ty >= 0 && tx < MapTiles && ty < MapTiles {
			name := adt.TilePath(mapName, tx, ty, "")
			if root, err := set.ReadFile(name); err == nil {
				if b.now, err = tileLattice(root); err != nil {
					return b, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
				}
				if base, err := readUnpatched(set, name); err == nil {
					if b.was, err = tileLattice(base); err != nil {
						return b, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
					}
				}
			}
		}
		outside[[2]int{tx, ty}] = b
		return b, nil
	}
	// line reads LatticeSize of the block's heights from (r, c), a step of (dr, dc) apart.
	line := func(r, c, dr, dc int) []float32 {
		out := make([]float32, LatticeSize)
		for k := range out {
			out[k] = heights[(r+k*dr)*side+c+k*dc]
		}
		return out
	}
	out := make([]adt.Edges, size*size)
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			e := &out[j*size+i]
			r0, c0 := j*tileCells, i*tileCells
			for _, s := range []struct {
				side     string
				di, dj   int
				r, c     int
				dr, dc   int
				now, was *[]float32
			}{
				{"north", 0, -1, r0 - 1, c0, 0, 1, &e.Now.North, &e.Was.North},
				{"south", 0, 1, r0 + tileCells + 1, c0, 0, 1, &e.Now.South, &e.Was.South},
				{"west", -1, 0, r0, c0 - 1, 1, 0, &e.Now.West, &e.Was.West},
				{"east", 1, 0, r0, c0 + tileCells + 1, 1, 0, &e.Now.East, &e.Was.East},
			} {
				ni, nj := i+s.di, j+s.dj
				if ni >= 0 && nj >= 0 && ni < size && nj < size {
					was, err := innerOf(nj*size + ni)
					if err != nil {
						return nil, err
					}
					*s.now, *s.was = line(s.r, s.c, s.dr, s.dc), ringOf(was, s.side)
					continue
				}
				b, err := outsideOf(x+ni, y+nj)
				if err != nil {
					return nil, err
				}
				if b.now != nil {
					*s.now = ringOf(b.now, s.side)
				}
				if b.was != nil {
					*s.was = ringOf(b.was, s.side)
				}
			}
		}
	}
	return out, nil
}
