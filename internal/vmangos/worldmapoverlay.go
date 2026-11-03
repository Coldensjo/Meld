package vmangos

import (
	"encoding/binary"
	"fmt"
	"strings"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// A zone's exploration overlays (#219): WorldMapOverlay.dbc rows, each a piece of the zone's world map
// picture that the World Map draws over the base art once the player has explored one of its areas.
// A row is the zone's WorldMapArea row, up to four AreaTable IDs that reveal it, the piece's texture
// name (upper case in the client's, as GOLDSHIRE), its size and offset in the 1002x668 picture, and its
// hit rectangle. The piece's art is at Interface\WorldMap\<Zone>\<Name><n>.blp, cut into 256x256 tiles
// numbered from 1 along each row (WorldMapFrame.lua), the last column and row as wide and tall as the
// power of two (16 or more) past what is left; DXT3 with mips, its alpha soft at the edges.
// Read from the client 2026-10-18: 526 rows of 17 fields; Elwynn's twelve (rows 121 to 132).

// ovCols are WorldMapOverlay.dbc's columns (dbcWorldMapOverlay): the first of its areas (areas of
// them), the name, the size, the offset and the hit rectangle.
type ovCols struct {
	mapArea, area, areas, name, width, height, offsetX, offsetY, hitTop, hitLeft, hitBottom, hitRight int
}

func ovColsOf(l *dbcLayout) ovCols {
	return ovCols{
		mapArea: l.col("MapArea"), area: l.at("Area", 0), areas: l.count("Area"), name: l.col("Name"),
		width: l.col("Width"), height: l.col("Height"), offsetX: l.col("OffsetX"), offsetY: l.col("OffsetY"),
		hitTop: l.col("HitTop"), hitLeft: l.col("HitLeft"), hitBottom: l.col("HitBottom"), hitRight: l.col("HitRight"),
	}
}

// WorldMapOverlay is a WorldMapOverlay.dbc row, and its picture: Width x Height RGBA, row 0 at the
// top. ID 0 is a new row. Read, Pixels is nil when the client's art is missing; written, empty Pixels
// keep the client's art (the row must be one of the zone's). Empty, not only nil: Wails v3's models
// send a null []byte as "", which decodes to an empty slice (#854).
type WorldMapOverlay struct {
	ID        uint32   `json:"id"`
	Areas     []uint32 `json:"areas"`
	Name      string   `json:"name"`
	Width     uint32   `json:"width"`
	Height    uint32   `json:"height"`
	OffsetX   uint32   `json:"offsetX"`
	OffsetY   uint32   `json:"offsetY"`
	HitTop    uint32   `json:"hitTop"`
	HitLeft   uint32   `json:"hitLeft"`
	HitBottom uint32   `json:"hitBottom"`
	HitRight  uint32   `json:"hitRight"`
	Pixels    []byte   `json:"pixels"`
}

// worldOverlayTable reads WorldMapOverlay.dbc, checking it has a layout Meld knows.
func worldOverlayTable(dbc []byte) (*dbcTable, ovCols, error) {
	t, err := parseExact(dbc, dbcWorldMapOverlay)
	if err != nil {
		return nil, ovCols{}, err
	}
	return t, ovColsOf(t.l), nil
}

func worldOverlayAt(t *dbcTable, c ovCols, r int) WorldMapOverlay {
	o := WorldMapOverlay{
		ID: t.u32(r, 0), Name: t.str(r, c.name),
		Width: t.u32(r, c.width), Height: t.u32(r, c.height), OffsetX: t.u32(r, c.offsetX), OffsetY: t.u32(r, c.offsetY),
		HitTop: t.u32(r, c.hitTop), HitLeft: t.u32(r, c.hitLeft), HitBottom: t.u32(r, c.hitBottom), HitRight: t.u32(r, c.hitRight),
	}
	for i := 0; i < c.areas; i++ {
		if a := t.u32(r, c.area+i); a != 0 {
			o.Areas = append(o.Areas, a)
		}
	}
	return o
}

// WorldMapOverlays are the overlay rows of a zone's WorldMapArea row, in the table's order, without
// their pictures.
func WorldMapOverlays(dbc []byte, mapArea uint32) ([]WorldMapOverlay, error) {
	t, c, err := worldOverlayTable(dbc)
	if err != nil {
		return nil, err
	}
	var out []WorldMapOverlay
	for r := 0; r < t.records; r++ {
		if t.u32(r, c.mapArea) == mapArea {
			out = append(out, worldOverlayAt(t, c, r))
		}
	}
	return out, nil
}

// overlayGrid is how a piece w by h is cut: the tiles across and down, and the file size of tile
// (k, j): 256, or for the last column or row the power of two (16 or more) past what is left.
func overlayGrid(w, h int) (cols, rows int, fileSize func(k, j int) (int, int)) {
	cols, rows = (w+worldMapTile-1)/worldMapTile, (h+worldMapTile-1)/worldMapTile
	last := func(n int) int {
		left := n % worldMapTile
		if left == 0 {
			return worldMapTile
		}
		f := 16
		for f < left {
			f *= 2
		}
		return f
	}
	return cols, rows, func(k, j int) (int, int) {
		fw, fh := worldMapTile, worldMapTile
		if k == cols-1 {
			fw = last(w)
		}
		if j == rows-1 {
			fh = last(h)
		}
		return fw, fh
	}
}

func worldOverlayTilePath(zone, name string, i int) string {
	return fmt.Sprintf(`Interface\WorldMap\%s\%s%d.blp`, zone, name, i)
}

// readWorldOverlayPixels stitches a piece's tiles from the client, or nil when one is missing.
func readWorldOverlayPixels(set *mpq.Set, zone string, o WorldMapOverlay) []byte {
	w, h := int(o.Width), int(o.Height)
	if w <= 0 || h <= 0 || w > 4096 || h > 4096 {
		return nil
	}
	cols, rows, fileSize := overlayGrid(w, h)
	pix := make([]byte, w*h*4)
	for j := 0; j < rows; j++ {
		for k := 0; k < cols; k++ {
			raw, err := set.ReadFile(worldOverlayTilePath(zone, o.Name, j*cols+k+1))
			if err != nil {
				return nil
			}
			img, err := wow.DecodeBLP(raw)
			if fw, fh := fileSize(k, j); err != nil || img.W != fw || img.H != fh {
				return nil
			}
			pw, ph := min(worldMapTile, w-k*worldMapTile), min(worldMapTile, h-j*worldMapTile)
			for y := 0; y < ph; y++ {
				copy(pix[((j*worldMapTile+y)*w+k*worldMapTile)*4:], img.Pix[y*img.W*4:(y*img.W+pw)*4])
			}
		}
	}
	return pix
}

// SetWorldMapOverlays returns the table with the zone's overlay rows (those of WorldMapArea row
// mapArea) replaced by overlays: an overlay whose ID is one of the zone's rows keeps it, a new one
// takes the next free ID, and the zone's rows not in the list are dropped. It returns the overlays as
// written, IDs set and pixels left out.
func SetWorldMapOverlays(dbc []byte, mapArea uint32, overlays []WorldMapOverlay) ([]byte, []WorldMapOverlay, error) {
	t, c, err := worldOverlayTable(dbc)
	if err != nil {
		return nil, nil, err
	}
	own := map[uint32]bool{}
	var maxID uint32
	for r := 0; r < t.records; r++ {
		maxID = max(maxID, t.u32(r, 0))
		if t.u32(r, c.mapArea) == mapArea {
			own[t.u32(r, 0)] = true
		}
	}
	names := map[string]bool{}
	written := make([]WorldMapOverlay, len(overlays))
	for i, o := range overlays {
		if len(o.Areas) == 0 || len(o.Areas) > c.areas {
			return nil, nil, fmt.Errorf("overlay %q names %d areas; it needs 1 to %d", o.Name, len(o.Areas), c.areas)
		}
		if !worldMapName.MatchString(o.Name) {
			return nil, nil, fmt.Errorf("the overlay name %q must be letters, digits and _ (it names the art's files)", o.Name)
		}
		if names[strings.ToUpper(o.Name)] {
			return nil, nil, fmt.Errorf("two overlays are named %q", o.Name)
		}
		names[strings.ToUpper(o.Name)] = true
		if o.Width == 0 || o.Height == 0 || o.OffsetX+o.Width > WorldMapWidth || o.OffsetY+o.Height > WorldMapHeight {
			return nil, nil, fmt.Errorf("overlay %q (%dx%d at %d, %d) is not inside the %dx%d picture", o.Name, o.Width, o.Height, o.OffsetX, o.OffsetY, WorldMapWidth, WorldMapHeight)
		}
		if len(o.Pixels) == 0 && !own[o.ID] {
			return nil, nil, fmt.Errorf("overlay %q has no picture and is not one of the zone's rows", o.Name)
		}
		if !own[o.ID] {
			maxID++
			o.ID = maxID
		}
		delete(own, o.ID) // an ID listed twice becomes a new row the second time
		o.Pixels = nil
		written[i] = o
	}
	records := make([]byte, 0, (t.records+len(overlays))*t.recSize)
	strs := append([]byte(nil), t.data[t.strsAt:]...)
	if len(strs) == 0 {
		strs = []byte{0}
	}
	for r := 0; r < t.records; r++ {
		if t.u32(r, c.mapArea) != mapArea {
			records = append(records, t.data[20+r*t.recSize:20+(r+1)*t.recSize]...)
		}
	}
	for _, o := range written {
		rec := make([]byte, t.recSize)
		put := func(f int, v uint32) { binary.LittleEndian.PutUint32(rec[f*4:], v) }
		put(0, o.ID)
		put(c.mapArea, mapArea)
		for i, a := range o.Areas {
			put(c.area+i, a)
		}
		put(c.name, uint32(len(strs)))
		strs = append(append(strs, o.Name...), 0)
		put(c.width, o.Width)
		put(c.height, o.Height)
		put(c.offsetX, o.OffsetX)
		put(c.offsetY, o.OffsetY)
		put(c.hitTop, o.HitTop)
		put(c.hitLeft, o.HitLeft)
		put(c.hitBottom, o.HitBottom)
		put(c.hitRight, o.HitRight)
		records = append(records, rec...)
	}
	out := append([]byte(nil), "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(records)/t.recSize))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.fields))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.recSize))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(strs)))
	out = append(out, records...)
	return append(out, strs...), written, nil
}

// worldOverlayFiles cuts a piece's picture into its tiles, the edge pixels repeated into the part of
// the last column and row's files past the piece (the frame crops them; the filter reads them).
func worldOverlayFiles(zone string, o WorldMapOverlay) ([]mpq.File, error) {
	w, h := int(o.Width), int(o.Height)
	if len(o.Pixels) != w*h*4 {
		return nil, fmt.Errorf("overlay %q's picture is %d bytes, want %d", o.Name, len(o.Pixels), w*h*4)
	}
	cols, rows, fileSize := overlayGrid(w, h)
	var files []mpq.File
	for j := 0; j < rows; j++ {
		for k := 0; k < cols; k++ {
			fw, fh := fileSize(k, j)
			tile := make([]byte, fw*fh*4)
			for y := 0; y < fh; y++ {
				sy := min(j*worldMapTile+y, h-1)
				for x := 0; x < fw; x++ {
					sx := min(k*worldMapTile+x, w-1)
					copy(tile[(y*fw+x)*4:(y*fw+x)*4+4], o.Pixels[(sy*w+sx)*4:])
				}
			}
			blp, err := wow.EncodeOverlayBLP(tile, fw, fh)
			if err != nil {
				return nil, err
			}
			files = append(files, mpq.File{Name: worldOverlayTilePath(zone, o.Name, j*cols+k+1), Data: blp})
		}
	}
	return files, nil
}
