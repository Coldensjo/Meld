package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strings"
)

// MapTiles is a map's tile count a side in the WDT: 64 tiles, indexed x + 64*y.
const MapTiles = 64

// BuildWDT returns a map's WDT: the template's header, and the tile table with present tiles marked.
// present(x, y) says whether the tile at (x, y) has a file. The template is a 1.12 WDT, whose
// chunks are MVER, MPHD, MAIN and an empty MWMO (a global building would add its name and placement, which a new map doesn't have).
func BuildWDT(template []byte, present func(x, y int) bool) ([]byte, error) {
	var mphd []byte
	for o := 0; o+8 <= len(template); {
		id := string([]byte{template[o+3], template[o+2], template[o+1], template[o]})
		size := int(binary.LittleEndian.Uint32(template[o+4:]))
		if o+8+size > len(template) {
			return nil, errors.New("wdt: truncated chunk")
		}
		if id == "MPHD" {
			mphd = template[o+8 : o+8+size]
		}
		o += 8 + size
	}
	if mphd == nil {
		return nil, errors.New("wdt: template has no MPHD")
	}
	var out []byte
	add := func(id string, data []byte) {
		var head [8]byte
		head[0], head[1], head[2], head[3] = id[3], id[2], id[1], id[0]
		binary.LittleEndian.PutUint32(head[4:], uint32(len(data)))
		out = append(out, head[:]...)
		out = append(out, data...)
	}
	add("MVER", []byte{18, 0, 0, 0})
	add("MPHD", mphd)
	main := make([]byte, MapTiles*MapTiles*8)
	for y := 0; y < MapTiles; y++ {
		for x := 0; x < MapTiles; x++ {
			if present(x, y) {
				binary.LittleEndian.PutUint32(main[(y*MapTiles+x)*8:], 1) // has a file
			}
		}
	}
	add("MAIN", main)
	// The map extractor wants MWMO after MAIN, empty when the map has no global building.
	add("MWMO", nil)
	return out, nil
}

// AddMapRow returns Map.dbc with a row for mapID, named dir (the map's folder), copied from the
// first row so the rest of its fields are a continent's. It fails if the ID is already in the table.
func AddMapRow(dbc []byte, mapID uint32, dir string) ([]byte, error) {
	if len(dbc) < 20 || string(dbc[:4]) != "WDBC" {
		return nil, errors.New("map table: not a DBC")
	}
	records := int(binary.LittleEndian.Uint32(dbc[4:]))
	fields := int(binary.LittleEndian.Uint32(dbc[8:]))
	recordSize := int(binary.LittleEndian.Uint32(dbc[12:]))
	stringSize := int(binary.LittleEndian.Uint32(dbc[16:]))
	if records == 0 || fields < 2 || recordSize != fields*4 {
		return nil, fmt.Errorf("map table: %d fields of %d bytes", fields, recordSize)
	}
	recordsAt := 20
	stringsAt := recordsAt + records*recordSize
	if stringsAt+stringSize > len(dbc) {
		return nil, errors.New("map table: truncated")
	}
	for r := 0; r < records; r++ {
		if binary.LittleEndian.Uint32(dbc[recordsAt+r*recordSize:]) == mapID {
			return nil, fmt.Errorf("map %d is already in the map table", mapID)
		}
	}
	if strings.ContainsAny(dir, "\x00\\/") || dir == "" {
		return nil, fmt.Errorf("map folder %q is not a single name", dir)
	}

	row := append([]byte(nil), dbc[recordsAt:recordsAt+recordSize]...)
	binary.LittleEndian.PutUint32(row[0:], mapID)
	// Field 1 names the map's folder: a string at an offset into the string block.
	binary.LittleEndian.PutUint32(row[4:], uint32(stringSize))

	var out []byte
	out = append(out, "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(records+1))
	out = binary.LittleEndian.AppendUint32(out, uint32(fields))
	out = binary.LittleEndian.AppendUint32(out, uint32(recordSize))
	out = binary.LittleEndian.AppendUint32(out, uint32(stringSize+len(dir)+1))
	out = append(out, dbc[recordsAt:stringsAt]...)
	out = append(out, row...)
	out = append(out, dbc[stringsAt:stringsAt+stringSize]...)
	out = append(out, dir...)
	out = append(out, 0)
	return out, nil
}

// MapRowIDs lists the map IDs in a Map.dbc.
func MapRowIDs(dbc []byte) []uint32 {
	if len(dbc) < 20 {
		return nil
	}
	records := int(binary.LittleEndian.Uint32(dbc[4:]))
	recordSize := int(binary.LittleEndian.Uint32(dbc[12:]))
	var ids []uint32
	for r := 0; r < records; r++ {
		ids = append(ids, binary.LittleEndian.Uint32(dbc[20+r*recordSize:]))
	}
	return ids
}

// MapRowDir returns the folder name a row of Map.dbc gives for mapID, or "".
func MapRowDir(dbc []byte, mapID uint32) string {
	records := int(binary.LittleEndian.Uint32(dbc[4:]))
	fields := int(binary.LittleEndian.Uint32(dbc[8:]))
	recordSize := int(binary.LittleEndian.Uint32(dbc[12:]))
	stringsAt := 20 + records*recordSize
	for r := 0; r < records; r++ {
		row := 20 + r*recordSize
		if binary.LittleEndian.Uint32(dbc[row:]) != mapID || fields < 2 {
			continue
		}
		off := int(binary.LittleEndian.Uint32(dbc[row+4:]))
		end := stringsAt + off
		for end < len(dbc) && dbc[end] != 0 {
			end++
		}
		return string(dbc[stringsAt+off : end])
	}
	return ""
}

// MapInfo is what a map made for the client says about itself besides its folder and ID: the client's
// Map.dbc row (instance type, display name, zone, loading screen; fields checked against the 1.12 table:
// 2 the type, 3 the PvP flag, 4 the English name, 19 the AreaTable ID, 38 the LoadingScreens ID) and the
// server's map_template (type, zone, player limit, reset delay and where a ghost goes back to its corpse).
type MapInfo struct {
	// Type is 0 a world map, 1 a dungeon, 2 a raid, 3 a battleground (the same in both tables).
	Type          uint32 `json:"type"`
	Name          string `json:"name,omitempty"`
	AreaID        uint32 `json:"areaId"`
	LoadingScreen uint32 `json:"loadingScreen"`
	MaxPlayers    uint32 `json:"maxPlayers"`
	// ResetDelay is the days before a dungeon or raid's saved instances reset (map_template.reset_delay,
	// VMaNGOS's MapEntry::resetDelay, scaled by Rate.InstanceResetTime); 0 binds no one to it.
	ResetDelay uint32  `json:"resetDelay"`
	GhostMap   int32   `json:"ghostMap"`
	GhostX     float32 `json:"ghostX"`
	GhostY     float32 `json:"ghostY"`
}

// SetMapRowInfo returns Map.dbc with the row for mapID given the info's type, PvP flag (a
// battleground's), zone, loading screen and, when set, English name (added to the string block).
func SetMapRowInfo(dbc []byte, mapID uint32, info MapInfo) ([]byte, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields < 39 || t.recSize != t.fields*4 {
		return nil, fmt.Errorf("Map.dbc has %d fields, not the 1.12 client's 42", t.fields)
	}
	if info.Type > 3 {
		return nil, fmt.Errorf("map type %d is not one of the client's (0 to 3)", info.Type)
	}
	r, ok := t.row(mapID)
	if !ok {
		return nil, fmt.Errorf("map %d is not in the map table", mapID)
	}
	out := append([]byte(nil), dbc...)
	at := 20 + r*t.recSize
	put := func(f int, v uint32) { binary.LittleEndian.PutUint32(out[at+f*4:], v) }
	put(2, info.Type)
	pvp := uint32(0)
	if info.Type == 3 {
		pvp = 1
	}
	put(3, pvp)
	put(19, info.AreaID)
	put(38, info.LoadingScreen)
	if info.Name != "" && !strings.ContainsRune(info.Name, 0) && t.str(r, 4) != info.Name {
		put(4, uint32(len(dbc)-t.strsAt))
		out = append(out, info.Name...)
		out = append(out, 0)
		binary.LittleEndian.PutUint32(out[16:], uint32(len(out)-t.strsAt))
	}
	return out, nil
}

// GlobalWMO is a WMO-only map's one building, as the WDT's MODF places it: its archive path, position
// and rotation in the file's frame (as a tile's MODF has them), its bounds and its doodad set.
type GlobalWMO struct {
	Name      string
	Position  [3]float32
	Rotation  [3]float32
	Min, Max  [3]float32
	DoodadSet uint16
}

// GlobalUID is the unique ID a WMO-only map's WDT gives its building's placement, in the client's
// files and in BuildWMOOnlyWDT's.
const GlobalUID = 0xffffffff

// ParseGlobalWMO reads a WMO-only map's building from its WDT: ok when MPHD has the global-WMO flag
// (0x1) and MWMO and MODF name and place a building. Such a map has no tiles (#271).
func ParseGlobalWMO(wdt []byte) (w GlobalWMO, ok bool) {
	var flagged, named, placed bool
	for o := 0; o+8 <= len(wdt); {
		id := string([]byte{wdt[o+3], wdt[o+2], wdt[o+1], wdt[o]})
		size := int(binary.LittleEndian.Uint32(wdt[o+4:]))
		if size < 0 || o+8+size > len(wdt) {
			break
		}
		p := wdt[o+8 : o+8+size]
		switch id {
		case "MPHD":
			flagged = len(p) >= 4 && binary.LittleEndian.Uint32(p)&1 != 0
		case "MWMO":
			if end := strings.IndexByte(string(p), 0); end >= 0 {
				p = p[:end]
			}
			w.Name = string(p)
			named = w.Name != ""
		case "MODF":
			if len(p) < 64 {
				break
			}
			get3 := func(at int) (v [3]float32) {
				for k := 0; k < 3; k++ {
					v[k] = math.Float32frombits(binary.LittleEndian.Uint32(p[at+4*k:]))
				}
				return
			}
			w.Position, w.Rotation, w.Min, w.Max = get3(8), get3(20), get3(32), get3(44)
			w.DoodadSet = binary.LittleEndian.Uint16(p[58:])
			placed = true
		}
		o += 8 + size
	}
	return w, flagged && named && placed
}

// BuildWMOOnlyWDT returns the WDT of a map that is one building and no tiles, as the 1.12 client's
// own (Blackfathom Deeps, the Stormwind Stockade): the template's MPHD with flag 0x1 (a global WMO), an
// empty tile table, the WMO's name in MWMO and its placement in MODF with unique ID 0xFFFFFFFF.
func BuildWMOOnlyWDT(template []byte, w GlobalWMO) ([]byte, error) {
	if w.Name == "" || strings.ContainsRune(w.Name, 0) {
		return nil, errors.New("a WMO-only map needs its building's path")
	}
	var mphd []byte
	for o := 0; o+8 <= len(template); {
		id := string([]byte{template[o+3], template[o+2], template[o+1], template[o]})
		size := int(binary.LittleEndian.Uint32(template[o+4:]))
		if o+8+size > len(template) {
			return nil, errors.New("wdt: truncated chunk")
		}
		if id == "MPHD" {
			mphd = append([]byte(nil), template[o+8:o+8+size]...)
		}
		o += 8 + size
	}
	if len(mphd) < 4 {
		return nil, errors.New("wdt: template has no MPHD")
	}
	binary.LittleEndian.PutUint32(mphd, binary.LittleEndian.Uint32(mphd)|1)
	var out []byte
	add := func(id string, data []byte) {
		var head [8]byte
		head[0], head[1], head[2], head[3] = id[3], id[2], id[1], id[0]
		binary.LittleEndian.PutUint32(head[4:], uint32(len(data)))
		out = append(out, head[:]...)
		out = append(out, data...)
	}
	add("MVER", []byte{18, 0, 0, 0})
	add("MPHD", mphd)
	add("MAIN", make([]byte, MapTiles*MapTiles*8))
	add("MWMO", append([]byte(w.Name), 0))
	e := make([]byte, 64)
	binary.LittleEndian.PutUint32(e[4:], 0xffffffff)
	put3 := func(at int, v [3]float32) {
		for k := 0; k < 3; k++ {
			binary.LittleEndian.PutUint32(e[at+4*k:], math.Float32bits(v[k]))
		}
	}
	put3(8, w.Position)
	put3(20, w.Rotation)
	put3(32, w.Min)
	put3(44, w.Max)
	binary.LittleEndian.PutUint16(e[58:], w.DoodadSet)
	add("MODF", e)
	return out, nil
}
