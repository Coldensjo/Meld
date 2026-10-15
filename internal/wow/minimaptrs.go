package wow

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"
)

// MinimapIndexPath is the client's minimap index: every minimap tile's name to the file it is stored
// as under textures\Minimap.
const MinimapIndexPath = `textures\Minimap\md5translate.trs`

// MinimapIndex is md5translate.trs read as the client reads it (B-169, after Benilla's
// benilla-formats minimap_translate.rs, MIT/Apache): CRLF text of "dir: <Dir>" headers, each followed
// by its tab-separated rows "<Dir>\<name>.blp<TAB><md5>.blp", where the md5 is that of the stored
// BLP's bytes, so tiles with the same art share a file. Map tiles are "<MapDir>\map<x>_<y>.blp"; WMO
// interiors share the table ("WMO\...\<name>_<group>_<x>_<y>.blp"). Names compare without case, and
// Bytes writes the file as the client's is laid out, so the client's own index comes back byte for
// byte.
type MinimapIndex struct {
	// rows maps a lower-case tile name to its row: the name as written and the stored file.
	rows map[string][2]string
	// dirs holds every folder the file lists, by its upper-cased name: the client lists each folder
	// down to a tile's, a folder holding only folders under a header with no rows.
	dirs map[string]string
}

// ParseMinimapIndex reads md5translate.trs. Lines that are neither a header nor a row are skipped,
// and a later row for a name replaces an earlier one.
func ParseMinimapIndex(raw []byte) *MinimapIndex {
	x := &MinimapIndex{rows: map[string][2]string{}, dirs: map[string]string{}}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" {
			continue
		}
		if d, ok := strings.CutPrefix(line, "dir:"); ok {
			x.addDir(strings.TrimSpace(d))
			continue
		}
		name, file, ok := strings.Cut(line, "\t")
		if !ok {
			continue
		}
		x.Set(strings.TrimSpace(name), strings.TrimSpace(file))
	}
	return x
}

// Len is the number of tiles.
func (x *MinimapIndex) Len() int { return len(x.rows) }

// Lookup is the stored file (under textures\Minimap) of a tile name in any case.
func (x *MinimapIndex) Lookup(name string) (string, bool) {
	r, ok := x.rows[strings.ToLower(name)]
	return r[1], ok
}

// Tile is the stored file of map tile (tx, ty) of the map whose folder is mapDir; false where the
// map has no art there, as over open sea.
func (x *MinimapIndex) Tile(mapDir string, tx, ty int) (string, bool) {
	return x.Lookup(MinimapTileName(mapDir, tx, ty))
}

// Set points a tile name at a stored file, adding the tile (and its folders) or replacing what it had.
func (x *MinimapIndex) Set(name, file string) {
	x.rows[strings.ToLower(name)] = [2]string{name, file}
	if i := strings.LastIndexByte(name, '\\'); i > 0 {
		x.addDir(name[:i])
	}
}

// addDir lists a folder and the folders above it, keeping the name each was first listed under.
func (x *MinimapIndex) addDir(dir string) {
	for dir != "" {
		k := strings.ToUpper(dir)
		if _, ok := x.dirs[k]; ok {
			return
		}
		x.dirs[k] = dir
		i := strings.LastIndexByte(dir, '\\')
		if i < 0 {
			return
		}
		dir = dir[:i]
	}
}

// Each calls fn with every tile name (as written) and its stored file, in no order.
func (x *MinimapIndex) Each(fn func(name, file string)) {
	for _, r := range x.rows {
		fn(r[0], r[1])
	}
}

// Bytes writes the index as the client lays it out: every folder under its "dir:" header followed by
// its rows, folders and rows ordered by their upper-cased names (as an NTFS directory lists them, so
// "GnomeHutTwoStory" comes before "GnomeHut_"), every line ending in CRLF.
func (x *MinimapIndex) Bytes() []byte {
	type row struct{ name, file, key string }
	byDir := map[string][]row{}
	for _, r := range x.rows {
		dir := ""
		if i := strings.LastIndexByte(r[0], '\\'); i >= 0 {
			dir = r[0][:i]
		}
		k := strings.ToUpper(dir)
		byDir[k] = append(byDir[k], row{r[0], r[1], strings.ToUpper(r[0])})
	}
	dirs := make([]string, 0, len(x.dirs))
	for k := range x.dirs {
		dirs = append(dirs, k)
	}
	sort.Strings(dirs)
	var b bytes.Buffer
	for _, k := range dirs {
		rows := byDir[k]
		sort.Slice(rows, func(i, j int) bool { return rows[i].key < rows[j].key })
		b.WriteString("dir: " + x.dirs[k] + "\r\n")
		for _, r := range rows {
			b.WriteString(r.name + "\t" + r.file + "\r\n")
		}
	}
	return b.Bytes()
}

// MinimapTileName is the index's name for map tile (tx, ty) of the map whose folder is mapDir.
func MinimapTileName(mapDir string, tx, ty int) string {
	return mapDir + `\map` + strconv.Itoa(tx) + "_" + strconv.Itoa(ty) + ".blp"
}

// MinimapFileName is the name a minimap BLP is stored under: the md5 of its bytes, as the client's
// own files are named.
func MinimapFileName(blp []byte) string {
	sum := md5.Sum(blp)
	return hex.EncodeToString(sum[:]) + ".blp"
}
