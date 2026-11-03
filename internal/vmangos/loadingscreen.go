package vmangos

import (
	"encoding/binary"
	"fmt"
	"strings"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// A map's own loading screen (#218): a LoadingScreens.dbc row (ID, name, the picture's path) and the
// picture, which Map.dbc's field 38 names. The 1.12 client's are BLP2 DXT1 at 512x512 under
// Interface\Glues\LoadingScreens\, drawn stretched over the whole screen (surveyed 2026-10-17: all 39
// are 512x512, alpha depth 0, some with mips and some without).

// LoadingScreenSize is the side of a loading screen's picture.
const LoadingScreenSize = 512

// LoadingScreensPath is the loading screens' table in the client.
const LoadingScreensPath = `DBFilesClient\LoadingScreens.dbc`

// LoadingScreen is a row of LoadingScreens.dbc: its ID, name (field 1) and picture (field 2).
type LoadingScreen struct {
	ID   uint32 `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

// LoadingScreenSpec is what Write Loading Screen puts into the client: the map (its Map.dbc ID and
// folder) and the picture, LoadingScreenSize square RGBA, row 0 at the top.
type LoadingScreenSpec struct {
	MapID  uint32 `json:"mapId"`
	Dir    string `json:"dir"`
	Pixels []byte `json:"pixels"`
}

// LoadLoadingScreens lists the client's loading screens, for a map's own.
func LoadLoadingScreens(dataDir string) ([]LoadingScreen, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(LoadingScreensPath)
	if err != nil {
		return nil, err
	}
	return ReadLoadingScreens(b)
}

// ReadLoadingScreens lists a LoadingScreens.dbc's rows in the table's order.
func ReadLoadingScreens(dbc []byte) ([]LoadingScreen, error) {
	t, err := loadingScreenTable(dbc)
	if err != nil {
		return nil, err
	}
	out := make([]LoadingScreen, 0, t.records)
	for r := 0; r < t.records; r++ {
		out = append(out, LoadingScreen{ID: t.u32(r, 0), Name: t.str(r, t.col("Name")), Path: t.str(r, t.col("Path"))})
	}
	return out, nil
}

func loadingScreenTable(dbc []byte) (*dbcTable, error) {
	return parseExact(dbc, dbcLoadingScreen)
}

// LoadingScreenName is the name a map's own loading screen goes by: its folder's letters, digits
// and _ (Map<ID> when none are left).
func LoadingScreenName(mapID uint32, dir string) string {
	var b strings.Builder
	for _, c := range dir {
		if c == '_' || c >= '0' && c <= '9' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' {
			b.WriteRune(c)
		}
	}
	if b.Len() == 0 {
		return fmt.Sprintf("Map%d", mapID)
	}
	return b.String()
}

// LoadingScreenPicture is the path of a map's own loading screen. "Meld" in it keeps it off the
// client's own pictures (a map named Cave would otherwise replace every cave's).
func LoadingScreenPicture(name string) string {
	return `Interface\Glues\LoadingScreens\LoadScreenMeld` + name + `.blp`
}

// SetLoadingScreenRow returns the table with a row for the picture at path: the row that already
// shows it (keeping its ID, renamed to name), or a new one with the next free ID. It returns the row.
func SetLoadingScreenRow(dbc []byte, name, path string) ([]byte, LoadingScreen, error) {
	row := LoadingScreen{Name: name, Path: path}
	if name == "" || path == "" || strings.ContainsRune(name, 0) || strings.ContainsRune(path, 0) {
		return nil, row, fmt.Errorf("a loading screen needs a name and a picture")
	}
	t, err := loadingScreenTable(dbc)
	if err != nil {
		return nil, row, err
	}
	nameCol, pathCol := t.col("Name"), t.col("Path")
	r := -1
	var maxID uint32
	for i := 0; i < t.records; i++ {
		maxID = max(maxID, t.u32(i, 0))
		if strings.EqualFold(t.str(i, pathCol), path) {
			r = i
		}
	}
	out := append([]byte(nil), dbc...)
	str := func(s string, field int) uint32 {
		if r >= 0 && t.str(r, field) == s {
			return t.u32(r, field)
		}
		off := uint32(len(out) - t.strsAt)
		out = append(append(out, s...), 0)
		return off
	}
	nameAt, pathAt := str(name, nameCol), str(path, pathCol)
	binary.LittleEndian.PutUint32(out[16:], uint32(len(out)-t.strsAt))
	if r >= 0 {
		row.ID = t.u32(r, 0)
	} else {
		row.ID = maxID + 1
	}
	rec := make([]uint32, t.fields)
	rec[0], rec[nameCol], rec[pathCol] = row.ID, nameAt, pathAt
	out, err = setRecords(out, [][]uint32{rec})
	return out, row, err
}

// SetMapLoadingScreen returns Map.dbc with the loading screen of mapID's row set, and false (the
// table unchanged) when the map has no row yet: Publish adds it, with the screen from the map's info.
func SetMapLoadingScreen(dbc []byte, mapID, screen uint32) ([]byte, bool, error) {
	t, err := mapTable(dbc)
	if err != nil {
		return nil, false, err
	}
	r, ok := t.row(mapID)
	if !ok {
		return dbc, false, nil
	}
	out := append([]byte(nil), dbc...)
	binary.LittleEndian.PutUint32(out[20+r*t.recSize+t.col("LoadingScreen")*4:], screen)
	return out, true, nil
}

// LoadingScreenFiles are the patch files of a map's own loading screen: the picture as a DXT1 BLP,
// LoadingScreens.dbc read from the client with the map's row set, and Map.dbc with the map's row
// pointing at it when the client has the map already. It returns the row as written.
func LoadingScreenFiles(dataDir string, s LoadingScreenSpec) ([]mpq.File, LoadingScreen, error) {
	if len(s.Pixels) != LoadingScreenSize*LoadingScreenSize*4 {
		return nil, LoadingScreen{}, fmt.Errorf("the loading screen picture is %d bytes, want %d", len(s.Pixels), LoadingScreenSize*LoadingScreenSize*4)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, LoadingScreen{}, err
	}
	screens, err := set.ReadFile(LoadingScreensPath)
	var maps []byte
	if err == nil {
		maps, err = set.ReadFile(dbcMap.file())
	}
	set.Close()
	if err != nil {
		return nil, LoadingScreen{}, err
	}
	name := LoadingScreenName(s.MapID, s.Dir)
	screens, row, err := SetLoadingScreenRow(screens, name, LoadingScreenPicture(name))
	if err != nil {
		return nil, row, err
	}
	blp, err := wow.EncodeMinimapBLP(s.Pixels, LoadingScreenSize, LoadingScreenSize)
	if err != nil {
		return nil, row, err
	}
	files := []mpq.File{{Name: row.Path, Data: blp}, {Name: LoadingScreensPath, Data: screens}}
	maps, ok, err := SetMapLoadingScreen(maps, s.MapID, row.ID)
	if err != nil {
		return nil, row, err
	}
	if ok {
		files = append(files, mpq.File{Name: dbcMap.file(), Data: maps})
	}
	return files, row, nil
}
