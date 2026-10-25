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

// besideTile is a client tile sharing a side with the block whose border normals the block's heights
// one in from its edge move (#666): root is the tile as the client reads it now, and edges the ring
// for adt.WriteHeights, the side toward the block with Now from the block's heights and Was from the
// block's tile its normals were made against, the other sides from the client's tiles there as it
// reads them now (Now and Was the same, so only the chunks along the block are redone).
type besideTile struct {
	x, y  int
	name  string
	root  []byte
	edges adt.Edges
}

// ringSide is the line and inner samples of r on side.
func ringSide(r *adt.Ring, side string) (line, in *[]float32) {
	switch side {
	case "north":
		return &r.North, &r.NorthIn
	case "south":
		return &r.South, &r.SouthIn
	case "west":
		return &r.West, &r.WestIn
	}
	return &r.East, &r.EastIn
}

// sameFloats says whether two lines hold the same samples to the bit.
func sameFloats(a, b []float32) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if a[k] != b[k] {
			return false
		}
	}
	return true
}

// blockEdges is the ring around each of a block's tiles for their normals (adt.Edges, #492), in the
// block's order (row by row, rows running south). Inside the block, Now comes from heights (the
// block's, side squared, side = size*tileCells+1) put into the neighbour as PatchTileHeights will
// (its inner samples kept or set to their corners' mean), and Was from roots, the tiles the save
// starts from. At the block's border both come from the client's tiles beyond: Now as the client
// reads them now, Was without Meld's patch, as the client's own normals were made against. A side off
// the map, or toward a tile the map doesn't have, stays empty and its normals one-sided.
//
// beside is the client's tiles sharing a side with the block whose normals along it the save moves
// (#666), north-west first, row by row: those where the block's line one in from its edge, or the
// inner samples of its cells along it, differ from the block's tile the outside one's normals were
// made against. That is the tile as the client reads it now when Meld's patch holds the outside tile
// (an earlier compile wrote it, and its border normals with it), and the tile without Meld's patch
// when the outside tile is still the client's own. An unedited save gives none.
func blockEdges(set *mpq.Set, mapName string, x, y, size int, heights []float32, roots [][]byte) ([]adt.Edges, []besideTile, error) {
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
						return nil, nil, err
					}
					*s.now, *s.nowIn = b.now.ring(s.side)
					*s.was, *s.wasIn = b.was.ring(s.side)
					continue
				}
				b, err := outsideOf(x+ni, y+nj)
				if err != nil {
					return nil, nil, err
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

	var beside []besideTile
	// The tiles beside the block (#666). current is a block tile as the client reads it now, for an
	// outside tile Meld's patch holds.
	current := make([]*tileGrids, len(roots))
	currentOf := func(k int) (*tileGrids, error) {
		if current[k] == nil {
			b, err := insideOf(k)
			if err != nil {
				return nil, err
			}
			g := b.was
			name := adt.TilePath(mapName, x+k%size, y+k/size, "")
			if patchHolds(set, name) {
				root, err := set.ReadFile(name)
				if err != nil {
					return nil, err
				}
				terrain, err := adt.ParseTerrain(root)
				if err != nil {
					return nil, fmt.Errorf("tile %d_%d: %w", x+k%size, y+k/size, err)
				}
				g = grids(terrain)
			}
			current[k] = &g
		}
		return current[k], nil
	}
	for tj := -1; tj <= size; tj++ {
		for ti := -1; ti <= size; ti++ {
			// toward is the side of the outside tile the block is on, and (i, j) the block's tile there.
			var toward string
			i, j := ti, tj
			switch {
			case ti >= 0 && ti < size && tj == -1:
				toward, j = "south", 0
			case ti >= 0 && ti < size && tj == size:
				toward, j = "north", size-1
			case tj >= 0 && tj < size && ti == -1:
				toward, i = "east", 0
			case tj >= 0 && tj < size && ti == size:
				toward, i = "west", size-1
			default:
				continue
			}
			tx, ty := x+ti, y+tj
			if o, err := outsideOf(tx, ty); err != nil {
				return nil, nil, err
			} else if o.now == nil {
				continue
			}
			name := adt.TilePath(mapName, tx, ty, "")
			b, err := insideOf(j*size + i)
			if err != nil {
				return nil, nil, err
			}
			was := &b.was
			if patchHolds(set, name) {
				if was, err = currentOf(j*size + i); err != nil {
					return nil, nil, err
				}
			}
			var e adt.Edges
			nowLine, nowIn := ringSide(&e.Now, toward)
			wasLine, wasIn := ringSide(&e.Was, toward)
			*nowLine, *nowIn = b.now.ring(toward)
			*wasLine, *wasIn = was.ring(toward)
			if sameFloats(*nowLine, *wasLine) && sameFloats(*nowIn, *wasIn) {
				continue
			}
			// The other sides, for the normals at the corners of the chunks redone: the client's tiles there,
			// never the block's.
			for _, s := range []struct {
				side   string
				di, dj int
			}{{"north", 0, -1}, {"south", 0, 1}, {"west", -1, 0}, {"east", 1, 0}} {
				if s.side == toward {
					continue
				}
				o, err := outsideOf(tx+s.di, ty+s.dj)
				if err != nil {
					return nil, nil, err
				}
				if o.now != nil {
					line, in := ringSide(&e.Now, s.side)
					*line, *in = o.now.ring(s.side)
					line, in = ringSide(&e.Was, s.side)
					*line, *in = o.now.ring(s.side)
				}
			}
			root, err := set.ReadFile(name)
			if err != nil {
				return nil, nil, err
			}
			beside = append(beside, besideTile{x: tx, y: ty, name: name, root: root, edges: e})
		}
	}
	return out, beside, nil
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
