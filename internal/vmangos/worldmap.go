package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"regexp"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// A zone's in-game world map (#181): a WorldMapArea.dbc row (the map, the zone's AreaTable ID, the
// folder its art is in, and its extent in world yards) and the art, a 1002x668 picture cut into twelve
// 256x256 BLPs at Interface\WorldMap\<Name>\<Name>1..12.blp, four a row, three rows, the last column
// and row cropped by the frame.

// WorldMapWidth and WorldMapHeight are the size of a zone's world map picture.
const (
	WorldMapWidth  = 1002
	WorldMapHeight = 668
	worldMapTile   = 256
	worldMapCols   = 4
	worldMapRows   = 3
	worldMapFields = 8
)

// WorldMapRow is a WorldMapArea.dbc row: ID, map, area, the art's folder name, then the extent as the
// client stores it: Left and Right are world Y (west is the larger), Top and Bottom world X (north is
// the larger).
type WorldMapRow struct {
	ID     uint32  `json:"id"`
	MapID  uint32  `json:"mapId"`
	AreaID uint32  `json:"areaId"`
	Name   string  `json:"name"`
	Left   float32 `json:"left"`
	Right  float32 `json:"right"`
	Top    float32 `json:"top"`
	Bottom float32 `json:"bottom"`
}

// WorldMapView is a zone's world map as the client has it: its row, its art stitched into
// WorldMapWidth x WorldMapHeight RGBA (nil when a tile is missing), and its exploration overlays with
// their pictures (worldmapoverlay.go). Row is nil for a zone with no map.
type WorldMapView struct {
	Row      *WorldMapRow      `json:"row"`
	Pixels   []byte            `json:"pixels"`
	Overlays []WorldMapOverlay `json:"overlays"`
}

// WorldMapSpec is what Write World Map puts into the client: the row (ID 0 for a new one), the
// picture, WorldMapWidth x WorldMapHeight RGBA, row 0 at the north edge, and the zone's overlays, all
// of them: the zone's rows not listed are dropped.
type WorldMapSpec struct {
	Row      WorldMapRow       `json:"row"`
	Pixels   []byte            `json:"pixels"`
	Overlays []WorldMapOverlay `json:"overlays"`
}

// worldMapName is a folder name the art may have: the client builds paths from it.
var worldMapName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,47}$`)

func worldMapTilePath(name string, i int) string {
	return fmt.Sprintf(`Interface\WorldMap\%s\%s%d.blp`, name, name, i)
}

func worldMapRowAt(t *dbcTable, r int) WorldMapRow {
	return WorldMapRow{ID: t.u32(r, 0), MapID: t.u32(r, 1), AreaID: t.u32(r, 2), Name: t.str(r, 3), Left: t.f32(r, 4), Right: t.f32(r, 5), Top: t.f32(r, 6), Bottom: t.f32(r, 7)}
}

// worldMapTable reads WorldMapArea.dbc, checking it has 1.12's layout.
func worldMapTable(dbc []byte) (*dbcTable, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields != worldMapFields || t.recSize != worldMapFields*4 {
		return nil, fmt.Errorf("WorldMapArea.dbc has %d fields, not 1.12's %d", t.fields, worldMapFields)
	}
	return t, nil
}

// FindWorldMapRow is the row of the map's zone, or nil.
func FindWorldMapRow(dbc []byte, mapID, areaID uint32) (*WorldMapRow, error) {
	t, err := worldMapTable(dbc)
	if err != nil {
		return nil, err
	}
	for r := 0; r < t.records; r++ {
		if t.u32(r, 1) == mapID && t.u32(r, 2) == areaID {
			row := worldMapRowAt(t, r)
			return &row, nil
		}
	}
	return nil, nil
}

// SetWorldMapRow returns the table with row in it: replacing the row of its map and area (keeping
// that row's ID), or added with the next free ID. It returns the row as written.
func SetWorldMapRow(dbc []byte, row WorldMapRow) ([]byte, WorldMapRow, error) {
	t, err := worldMapTable(dbc)
	if err != nil {
		return nil, row, err
	}
	if !worldMapName.MatchString(row.Name) {
		return nil, row, fmt.Errorf("the world map's name %q must be letters, digits and _ (it names the art's folder)", row.Name)
	}
	for _, v := range []float32{row.Left, row.Right, row.Top, row.Bottom} {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return nil, row, errors.New("the world map's extent is not a number")
		}
	}
	if row.Left <= row.Right || row.Top <= row.Bottom {
		return nil, row, errors.New("the world map's extent is empty: its west edge must be past its east, and its north past its south")
	}
	records := append([]byte(nil), dbc[20:t.strsAt]...)
	strs := append([]byte(nil), dbc[t.strsAt:]...)
	at := -1
	var maxID uint32
	for r := 0; r < t.records; r++ {
		maxID = max(maxID, t.u32(r, 0))
		if t.u32(r, 1) == row.MapID && t.u32(r, 2) == row.AreaID {
			at = r * t.recSize
			row.ID = t.u32(r, 0)
		}
	}
	added := 0
	if at < 0 {
		row.ID = maxID + 1
		at = len(records)
		records = append(records, make([]byte, t.recSize)...)
		added = 1
	}
	put := func(f int, v uint32) { binary.LittleEndian.PutUint32(records[at+f*4:], v) }
	if at/t.recSize >= t.records || t.str(at/t.recSize, 3) != row.Name {
		put(3, uint32(len(strs)))
		strs = append(strs, row.Name...)
		strs = append(strs, 0)
	}
	put(0, row.ID)
	put(1, row.MapID)
	put(2, row.AreaID)
	put(4, math.Float32bits(row.Left))
	put(5, math.Float32bits(row.Right))
	put(6, math.Float32bits(row.Top))
	put(7, math.Float32bits(row.Bottom))
	out := append([]byte(nil), "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(t.records+added))
	out = binary.LittleEndian.AppendUint32(out, worldMapFields)
	out = binary.LittleEndian.AppendUint32(out, worldMapFields*4)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(strs)))
	out = append(out, records...)
	return append(out, strs...), row, nil
}

// ReadWorldMap reads the client's world map of a zone: its row and art, or a view with no row.
func ReadWorldMap(dataDir string, mapID, areaID uint32) (*WorldMapView, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	dbc, err := set.ReadFile(`DBFilesClient\WorldMapArea.dbc`)
	if err != nil {
		return nil, err
	}
	row, err := FindWorldMapRow(dbc, mapID, areaID)
	if err != nil || row == nil {
		return &WorldMapView{}, err
	}
	view := &WorldMapView{Row: row}
	if odbc, err := set.ReadFile(`DBFilesClient\WorldMapOverlay.dbc`); err == nil {
		if view.Overlays, err = WorldMapOverlays(odbc, row.ID); err != nil {
			return nil, err
		}
		for i := range view.Overlays {
			view.Overlays[i].Pixels = readWorldOverlayPixels(set, row.Name, view.Overlays[i])
		}
	}
	pix := make([]byte, WorldMapWidth*WorldMapHeight*4)
	for i := 0; i < worldMapCols*worldMapRows; i++ {
		raw, err := set.ReadFile(worldMapTilePath(row.Name, i+1))
		if err != nil {
			return view, nil
		}
		img, err := wow.DecodeBLP(raw)
		if err != nil || img.W != worldMapTile || img.H != worldMapTile {
			return view, nil
		}
		ox, oy := (i%worldMapCols)*worldMapTile, (i/worldMapCols)*worldMapTile
		for y := 0; y < worldMapTile && oy+y < WorldMapHeight; y++ {
			w := min(worldMapTile, WorldMapWidth-ox)
			copy(pix[((oy+y)*WorldMapWidth+ox)*4:], img.Pix[y*worldMapTile*4:(y*worldMapTile+w)*4])
		}
	}
	view.Pixels = pix
	return view, nil
}

// WorldMapFiles are the patch files of a zone's world map: the twelve tiles, the picture's edge
// pixels repeated past it (the frame crops them, and a black edge would show in the filtered seams),
// WorldMapArea.dbc read from the client with the row set, the tiles of the overlays that come with a
// picture, and WorldMapOverlay.dbc with the zone's overlay rows replaced. It returns the row and the
// overlays as written.
func WorldMapFiles(dataDir string, s WorldMapSpec) ([]mpq.File, WorldMapRow, []WorldMapOverlay, error) {
	if len(s.Pixels) != WorldMapWidth*WorldMapHeight*4 {
		return nil, s.Row, nil, fmt.Errorf("the world map picture is %d bytes, want %d", len(s.Pixels), WorldMapWidth*WorldMapHeight*4)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, s.Row, nil, err
	}
	dbc, err := set.ReadFile(`DBFilesClient\WorldMapArea.dbc`)
	if err != nil {
		set.Close()
		return nil, s.Row, nil, err
	}
	odbc, err := set.ReadFile(`DBFilesClient\WorldMapOverlay.dbc`)
	set.Close()
	if err != nil {
		return nil, s.Row, nil, err
	}
	dbc, row, err := SetWorldMapRow(dbc, s.Row)
	if err != nil {
		return nil, s.Row, nil, err
	}
	odbc, overlays, err := SetWorldMapOverlays(odbc, row.ID, s.Overlays)
	if err != nil {
		return nil, row, nil, err
	}
	var files []mpq.File
	for _, o := range s.Overlays {
		if len(o.Pixels) == 0 { // the client's art stays
			continue
		}
		of, err := worldOverlayFiles(row.Name, o)
		if err != nil {
			return nil, row, nil, err
		}
		files = append(files, of...)
	}
	tile := make([]byte, worldMapTile*worldMapTile*4)
	for i := 0; i < worldMapCols*worldMapRows; i++ {
		ox, oy := (i%worldMapCols)*worldMapTile, (i/worldMapCols)*worldMapTile
		for y := 0; y < worldMapTile; y++ {
			sy := min(oy+y, WorldMapHeight-1)
			for x := 0; x < worldMapTile; x++ {
				sx := min(ox+x, WorldMapWidth-1)
				copy(tile[(y*worldMapTile+x)*4:(y*worldMapTile+x)*4+4], s.Pixels[(sy*WorldMapWidth+sx)*4:])
			}
		}
		blp, err := wow.EncodeMinimapBLP(tile, worldMapTile, worldMapTile)
		if err != nil {
			return nil, row, nil, err
		}
		files = append(files, mpq.File{Name: worldMapTilePath(row.Name, i+1), Data: blp})
	}
	files = append(files, mpq.File{Name: `DBFilesClient\WorldMapArea.dbc`, Data: dbc}, mpq.File{Name: `DBFilesClient\WorldMapOverlay.dbc`, Data: odbc})
	return files, row, overlays, nil
}
