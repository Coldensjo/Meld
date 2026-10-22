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
	return grids(terrain).outer, nil
}

// tileGrids is a tile's heights: outer, LatticeSize squared, and inner, one a cell, (LatticeSize-1)
// squared, rows running south in both.
type tileGrids struct{ outer, inner []float32 }

// grids lays out terrain's heights as tileGrids.
func grids(terrain *adt.Terrain) tileGrids {
	g := tileGrids{make([]float32, LatticeSize*LatticeSize), make([]float32, tileCells*tileCells)}
	for _, c := range terrain.Chunks {
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for col := 0; col <= adt.CellsPerChunk; col++ {
				gr, gc := c.IndexY*adt.CellsPerChunk+r, c.IndexX*adt.CellsPerChunk+col
				g.outer[gr*LatticeSize+gc] = c.Heights[r*17+col]
				if r < adt.CellsPerChunk && col < adt.CellsPerChunk {
					g.inner[gr*tileCells+gc] = c.Heights[r*17+9+col]
				}
			}
		}
	}
	return g
}

// ring is the side of an adt.Ring a neighbour gives the tile it is on side of: its outer line just
// across the border (ringOf) and the inner samples of its cells along the border (#668).
func (g tileGrids) ring(side string) (outer, inner []float32) {
	return ringOf(g.outer, side), lineOf(g.inner, tileCells, side, 0)
}

// edgeOf takes the border a tile on side shares with the block: a tile north of the block gives its
// last row, south its first, west its last column, east its first.
func edgeOf(lattice []float32, side string) []float32 { return lineOf(lattice, LatticeSize, side, 0) }

// ringOf takes the line of a neighbour's lattice just across the border from the tile it is on side
// of: a north neighbour gives its second to last row, south its second, west its second to last
// column, east its second (adt.Ring, #492).
func ringOf(lattice []float32, side string) []float32 { return lineOf(lattice, LatticeSize, side, 1) }

// lineOf takes the row or column in from the border a tile on side shares with its neighbour, as
// edgeOf names the border, from a grid n samples a side.
func lineOf(grid []float32, n int, side string, in int) []float32 {
	out := make([]float32, n)
	last := n - 1 - in
	for k := 0; k < n; k++ {
		switch side {
		case "north":
			out[k] = grid[last*n+k]
		case "south":
			out[k] = grid[in*n+k]
		case "west":
			out[k] = grid[k*n+last]
		case "east":
			out[k] = grid[k*n+in]
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
// block's, side squared, side = size*tileCells+1) put into the neighbour as PatchTileHeights will
// (its inner samples kept or set to their corners' mean), and Was from roots, the tiles the save
// starts from. At the block's border both come from the client's tiles beyond: Now as the client
// reads them now, Was without Meld's patch, as the client's own normals were made against. A side off
// the map, or toward a tile the map doesn't have, stays empty and its normals one-sided.
func blockEdges(set *mpq.Set, mapName string, x, y, size int, heights []float32, roots [][]byte) ([]adt.Edges, error) {
	side := size*tileCells + 1
	// inside holds a tile of the block as the save starts from it (was) and as it will be (now).
	type both struct{ now, was tileGrids }
	inside := make([]*both, len(roots))
	insideOf := func(k int) (*both, error) {
		if inside[k] == nil {
			terrain, err := adt.ParseTerrain(roots[k])
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", x+k%size, y+k/size, err)
			}
			b := &both{was: grids(terrain)}
			patchHeights(terrain, blockTile(heights, side, k%size, k/size))
			b.now = grids(terrain)
			inside[k] = b
		}
		return inside[k], nil
	}
	// outside holds a client tile beyond the block, nil for one the client lacks.
	type beyond struct{ now, was *tileGrids }
	outside := map[[2]int]beyond{}
	outsideOf := func(tx, ty int) (beyond, error) {
		if b, ok := outside[[2]int{tx, ty}]; ok {
			return b, nil
		}
		var b beyond
		read := func(root []byte) (*tileGrids, error) {
			terrain, err := adt.ParseTerrain(root)
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
			}
			g := grids(terrain)
			return &g, nil
		}
		if tx >= 0 && ty >= 0 && tx < MapTiles && ty < MapTiles {
			name := adt.TilePath(mapName, tx, ty, "")
			if root, err := set.ReadFile(name); err == nil {
				if b.now, err = read(root); err != nil {
					return b, err
				}
				if base, err := readUnpatched(set, name); err == nil {
					if b.was, err = read(base); err != nil {
						return b, err
					}
				}
			}
		}
		outside[[2]int{tx, ty}] = b
		return b, nil
	}
	out := make([]adt.Edges, size*size)
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			e := &out[j*size+i]
			for _, s := range []struct {
				side         string
				di, dj       int
				now, was     *[]float32
				nowIn, wasIn *[]float32
			}{
				{"north", 0, -1, &e.Now.North, &e.Was.North, &e.Now.NorthIn, &e.Was.NorthIn},
				{"south", 0, 1, &e.Now.South, &e.Was.South, &e.Now.SouthIn, &e.Was.SouthIn},
				{"west", -1, 0, &e.Now.West, &e.Was.West, &e.Now.WestIn, &e.Was.WestIn},
				{"east", 1, 0, &e.Now.East, &e.Was.East, &e.Now.EastIn, &e.Was.EastIn},
			} {
				ni, nj := i+s.di, j+s.dj
				if ni >= 0 && nj >= 0 && ni < size && nj < size {
					b, err := insideOf(nj*size + ni)
					if err != nil {
						return nil, err
					}
					*s.now, *s.nowIn = b.now.ring(s.side)
					*s.was, *s.wasIn = b.was.ring(s.side)
					continue
				}
				b, err := outsideOf(x+ni, y+nj)
				if err != nil {
					return nil, err
				}
				if b.now != nil {
					*s.now, *s.nowIn = b.now.ring(s.side)
				}
				if b.was != nil {
					*s.was, *s.wasIn = b.was.ring(s.side)
				}
			}
		}
	}
	return out, nil
}

// blockTile is the outer heights of the block's tile (i, j), LatticeSize squared, from the block's
// heights, side samples a side.
func blockTile(heights []float32, side, i, j int) []float32 {
	outer := make([]float32, LatticeSize*LatticeSize)
	for r := 0; r < LatticeSize; r++ {
		row := (j*tileCells+r)*side + i*tileCells
		copy(outer[r*LatticeSize:(r+1)*LatticeSize], heights[row:row+LatticeSize])
	}
	return outer
}
