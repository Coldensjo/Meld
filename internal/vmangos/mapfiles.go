package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
)

// MapTiles is a map's tile count a side in the WDT: 64 tiles, indexed x + 64*y.
const MapTiles = 64

// BuildWDT returns a map's WDT: the template's header, and the tile table with present tiles marked.
// present(x, y) says whether the tile at (x, y) has a file. The template is a 1.12 WDT, whose
// chunks are MVER, MPHD and MAIN, with MWMO and MODF for a global building, which a new map doesn't have.
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
