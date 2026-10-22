package adt

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// Rewrite writes a tile's paint and placements into its root file, and returns the new file. The
// rest of the tile stays as it was: every chunk's sub-chunks the change doesn't touch are copied
// byte for byte, and the file's offsets and counts are worked out again. Heights are written by
// WriteHeights first; the two are applied one after the other.
//
// The layout follows the game's: MVER, MHDR, MCIN, MTEX, the model names and placements, the 256
// MCNK chunks, then any other chunks as they were. Each chunk's references (MCRF) list the models
// it shows, by their index in MDDF or MODF.

// Layer is one texture layer of a chunk to write: its texture path, and for every layer but the
// base its 64x64 sequential alpha, row-major, 0 to 255.
type Layer struct {
	Texture string
	Alpha   []byte
	// Effect is the GroundEffectTexture ID the layer grows (grass tufts); 0 keeps the effect the
	// tile's own layers of that texture had, if any.
	Effect uint32
	// Flags are the layer's look flags (LayerLookFlags: the animation's turn, speed and switch, and
	// overbright); nil keeps what the tile's own layers of that texture had, if any.
	Flags *uint32
}

// ChunkPaint is a chunk's painted layers, the base first, at most four in all.
type ChunkPaint struct {
	Layers []Layer
	// Predominant is the layer that weighs most in each of the 64 cells (row-major), which the game
	// grows that layer's effect on; nil leaves the chunk's own map. See PredominantFromWeights.
	Predominant []uint8
	// NoEffect is one byte per cell row, a bit per cell set where the game is to grow no ground
	// effect doodads; the bits are added to the chunk's own. Nil leaves the chunk's own bits.
	NoEffect []uint8
	// ClientAlpha says Layers are the chunk's own, unpainted (KeepClientAlpha): its layer records and
	// alpha bytes stay as they are, but for a layer's Effect (when not 0) and Flags (when set).
	ClientAlpha bool
}

// Object is a model to place on the tile, in the file's own space: X east, Y up, Z south, with a
// tile's origin at (tileX, tileY) tiles.
type Object struct {
	Kind      Kind
	Name      string
	UID       uint32
	Position  [3]float32
	Rotation  [3]float32
	Scale     float32
	DoodadSet uint16
	NameSet   uint16
	// Min and Max bound the model. Zero means a default around Position, which decides the chunks
	// that list the model.
	Min, Max [3]float32
}

// Changes is what to write into a tile. Empty fields keep the tile's own data.
type Changes struct {
	TileX, TileY int
	// Paint replaces the layers of chunks, by chunk index (y*16 + x).
	Paint map[int]ChunkPaint
	// Remove drops the placements with these unique IDs.
	Remove map[uint32]bool
	// Add places new models.
	Add []Object
	// NextUID, when set, is the unique ID the next added model without one takes, counted up as
	// they are taken (and kept above the tile's own IDs). Tiles written together share it, seeded
	// above every ID of the map, since the client draws only the first loaded placement of
	// an ID and the server's vmaps keep only one spawn an ID a map (#491). Nil numbers added models
	// after the tile's own highest ID, which is unique only within the tile.
	NextUID *uint32
	// Liquids replaces the liquids of the chunks it lists, by chunk index (y*16 + x), with their
	// layers; a chunk listed with none loses its liquid. Chunks not listed keep their own, unless
	// Water is set.
	Liquids map[int][]Liquid
	// Water, when set, puts sea at its level into every cell of every chunk that the ground lies below
	// and no layer of Liquids covers. Nil keeps the tile's own liquids.
	Water *Water
	// Headers sets header fields of the chunks it lists, by chunk index (y*16 + x). Chunks not
	// listed keep their own.
	Headers map[int]ChunkHeader
}

// Water is a map's sea: ocean at Level yards, over the ground below it.
type Water struct {
	Level float32
}

const (
	mcnkLayers      = 0x0c
	mcnkDoodadRefs  = 0x10
	mcnkMapObjRefs  = 0x38
	mcnkHeaderLen   = 0x80
	mcnkSoundOfs    = 0x58
	mcnkSoundCount  = 0x5c
	mcnkLiquidOfs   = 0x60
	mcnkLiquidSize  = 0x64
	mddfSize        = 36
	modfSize        = 64
	alphaBytes4     = 64 * 64 / 2
	chunkWidth      = TileSize / ChunksPerTile
	defaultM2Reach  = 16.0
	defaultWMOReach = 64.0
)

// Sub-chunks an MCNK header points at, with the offset field that holds each one's payload.
var subFields = []struct {
	id  string
	ofs int
}{
	{"MCVT", 0x14}, {"MCNR", 0x18}, {"MCLY", 0x1c}, {"MCRF", 0x20}, {"MCAL", 0x24},
	{"MCSH", 0x2c}, {"MCSE", mcnkSoundOfs}, {"MCLQ", mcnkLiquidOfs},
}

// topLevel holds a root file's chunks, by kind.
type topLevel struct {
	mver, mhdr, mcin, mtex, mmdx, mmid, mwmo, mwid, mddf, modf []byte
	mcnks                                                      [][]byte
	others                                                     []topChunk
}

type topChunk struct {
	id   string
	data []byte
}

func readTop(root []byte) (*topLevel, error) {
	t := &topLevel{}
	err := eachChunk(root, 0, len(root), func(c chunk) error {
		data := root[c.start:c.end]
		switch c.id {
		case "MVER":
			t.mver = data
		case "MHDR":
			t.mhdr = data
		case "MCIN":
			t.mcin = data
		case "MTEX":
			t.mtex = data
		case "MMDX":
			t.mmdx = data
		case "MMID":
			t.mmid = data
		case "MWMO":
			t.mwmo = data
		case "MWID":
			t.mwid = data
		case "MDDF":
			t.mddf = data
		case "MODF":
			t.modf = data
		case "MCNK":
			t.mcnks = append(t.mcnks, data)
		default:
			t.others = append(t.others, topChunk{id: c.id, data: data})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if t.mhdr == nil || len(t.mcnks) != ChunkCount {
		return nil, fmt.Errorf("adt: not a whole tile (%d chunks)", len(t.mcnks))
	}
	return t, nil
}

// nameList is a table of unique names, in the order they were added. Lookups ignore case.
type nameList struct {
	names []string
	index map[string]int
}

func newNameList(orig []string) *nameList {
	n := &nameList{index: map[string]int{}}
	for _, s := range orig {
		n.names = append(n.names, s)
		key := strings.ToLower(s)
		if _, ok := n.index[key]; !ok {
			n.index[key] = len(n.names) - 1
		}
	}
	return n
}

func (n *nameList) of(name string) int {
	key := strings.ToLower(name)
	if i, ok := n.index[key]; ok {
		return i
	}
	n.names = append(n.names, name)
	n.index[key] = len(n.names) - 1
	return len(n.names) - 1
}

// stringTable encodes names as zero-terminated text and the offset of each.
func stringTable(names []string) (text, offsets []byte) {
	for _, s := range names {
		offsets = binary.LittleEndian.AppendUint32(offsets, uint32(len(text)))
		text = append(text, s...)
		text = append(text, 0)
	}
	return text, offsets
}

// nameTable reads a names chunk and its offsets chunk, as ID-indexed names.
func nameTable(text, offsets []byte) []string {
	var out []string
	for o := 0; o+4 <= len(offsets); o += 4 {
		out = append(out, cstring(text, binary.LittleEndian.Uint32(offsets[o:])))
	}
	return out
}

// Rewrite writes ch into root. See the package notes on what is kept.
func Rewrite(root []byte, ch Changes) ([]byte, error) {
	top, err := readTop(root)
	if err != nil {
		return nil, err
	}

	// Textures: the tile's own names keep their indices, and new ones go after them.
	texNames := newNameList(splitNames(top.mtex))
	// Ground effects by texture: a layer without one of its own keeps the effect its texture had
	// in this tile.
	effects := tileEffects(top)
	// The same for the look flags (animation, overbright), which a rewritten chunk would otherwise lose.
	looks := tileLayerFlags(top)

	// Models: the kept ones keep their order and their names' indices, the added ones follow.
	m2Names := newNameList(nameTable(top.mmdx, top.mmid))
	wmoNames := newNameList(nameTable(top.mwmo, top.mwid))
	oldM2 := nameTable(top.mmdx, top.mmid)
	oldWMO := nameTable(top.mwmo, top.mwid)
	var m2Entries, wmoEntries [][]byte
	m2Map := map[int]int{}
	wmoMap := map[int]int{}
	var uidMax uint32
	keep := func(entries []byte, size int, names []string, into *nameList, out *[][]byte, mapping map[int]int) {
		for o, i := 0, 0; o+size <= len(entries); o, i = o+size, i+1 {
			uid := binary.LittleEndian.Uint32(entries[o+4:])
			if uid > uidMax {
				uidMax = uid
			}
			if ch.Remove[uid] {
				continue
			}
			e := append([]byte(nil), entries[o:o+size]...)
			old := int(binary.LittleEndian.Uint32(e))
			name := ""
			if old < len(names) {
				name = names[old]
			}
			binary.LittleEndian.PutUint32(e, uint32(into.of(name)))
			mapping[i] = len(*out)
			*out = append(*out, e)
		}
	}
	keep(top.mddf, mddfSize, oldM2, m2Names, &m2Entries, m2Map)
	keep(top.modf, modfSize, oldWMO, wmoNames, &wmoEntries, wmoMap)

	// Added models, and the chunks each one lists.
	added := make([]struct{ m2, wmo []int }, ChunksPerTile*ChunksPerTile)
	for _, o := range ch.Add {
		wmo := o.Kind == WMO
		uid := o.UID
		if uid == 0 {
			uid = uidMax + 1
			if ch.NextUID != nil {
				uid = max(uid, *ch.NextUID)
				*ch.NextUID = uid + 1
			}
			uidMax = uid
		}
		size := mddfSize
		if wmo {
			size = modfSize
		}
		e := make([]byte, size)
		names := m2Names
		if wmo {
			names = wmoNames
		}
		binary.LittleEndian.PutUint32(e, uint32(names.of(o.Name)))
		binary.LittleEndian.PutUint32(e[4:], uid)
		putVec(e[8:], o.Position)
		putVec(e[20:], o.Rotation)
		if wmo {
			lo, hi := o.Bounds()
			putVec(e[32:], lo)
			putVec(e[44:], hi)
			binary.LittleEndian.PutUint16(e[58:], o.DoodadSet)
			binary.LittleEndian.PutUint16(e[60:], o.NameSet)
		} else {
			scale := o.Scale
			if scale == 0 {
				scale = 1
			}
			binary.LittleEndian.PutUint16(e[32:], uint16(math.Max(1, math.Min(65535, math.Round(float64(scale)*1024)))))
		}
		var index int
		lo, hi := o.Bounds()
		if wmo {
			index = len(wmoEntries)
			wmoEntries = append(wmoEntries, e)
		} else {
			index = len(m2Entries)
			m2Entries = append(m2Entries, e)
		}
		for cy := 0; cy < ChunksPerTile; cy++ {
			for cx := 0; cx < ChunksPerTile; cx++ {
				left := float32(ch.TileX)*TileSize + float32(cx)*chunkWidth
				top := float32(ch.TileY)*TileSize + float32(cy)*chunkWidth
				if hi[0] < left || lo[0] > left+chunkWidth || hi[2] < top || lo[2] > top+chunkWidth {
					continue
				}
				c := &added[cy*ChunksPerTile+cx]
				if wmo {
					c.wmo = append(c.wmo, index)
				} else {
					c.m2 = append(c.m2, index)
				}
			}
		}
	}

	// Model names as the file names them now (the chunks may add textures, written after them).
	mmdxText, mmidOffsets := stringTable(m2Names.names)
	mwmoText, mwidOffsets := stringTable(wmoNames.names)

	// Chunks.
	type builtChunk struct {
		cx, cy int
		data   []byte
	}
	built := make([]builtChunk, 0, len(top.mcnks))
	for _, m := range top.mcnks {
		cx := int(binary.LittleEndian.Uint32(m[0x04:]))
		cy := int(binary.LittleEndian.Uint32(m[0x08:]))
		if cx >= ChunksPerTile || cy >= ChunksPerTile {
			return nil, fmt.Errorf("adt: chunk index %d,%d outside the tile", cx, cy)
		}
		idx := cy*ChunksPerTile + cx
		data, err := rebuildChunk(m, idx, ch, texNames, effects, looks, m2Map, wmoMap, &added[idx])
		if err != nil {
			return nil, fmt.Errorf("chunk %d,%d: %w", cx, cy, err)
		}
		built = append(built, builtChunk{cx: cx, cy: cy, data: data})
	}
	sort.SliceStable(built, func(i, j int) bool {
		return built[i].cy*ChunksPerTile+built[i].cx < built[j].cy*ChunksPerTile+built[j].cx
	})
	mtexText, _ := stringTable(texNames.names)

	// The file, in the game's order.
	var out bytes.Buffer
	writeChunk := func(id string, data []byte) int {
		at := out.Len()
		var head [8]byte
		head[0], head[1], head[2], head[3] = id[3], id[2], id[1], id[0]
		binary.LittleEndian.PutUint32(head[4:], uint32(len(data)))
		out.Write(head[:])
		out.Write(data)
		return at
	}
	if top.mver != nil {
		writeChunk("MVER", top.mver)
	} else {
		writeChunk("MVER", []byte{18, 0, 0, 0})
	}
	mhdr := append([]byte(nil), top.mhdr...)
	mhdrAt := writeChunk("MHDR", mhdr)
	mcin := make([]byte, ChunkCount*16)
	mcinAt := writeChunk("MCIN", mcin)
	positions := map[string]int{"MCIN": mcinAt}
	positions["MTEX"] = writeChunk("MTEX", mtexText)
	positions["MMDX"] = writeChunk("MMDX", mmdxText)
	positions["MMID"] = writeChunk("MMID", mmidOffsets)
	positions["MWMO"] = writeChunk("MWMO", mwmoText)
	positions["MWID"] = writeChunk("MWID", mwidOffsets)
	positions["MDDF"] = writeChunk("MDDF", bytes.Join(m2Entries, nil))
	positions["MODF"] = writeChunk("MODF", bytes.Join(wmoEntries, nil))
	for _, c := range top.others {
		writeChunk(c.id, c.data)
	}
	// The MCNK chunks, then MCIN's entries for them and MHDR's offsets to the chunks above.
	for _, b := range built {
		at := writeChunk("MCNK", b.data)
		i := b.cy*ChunksPerTile + b.cx
		binary.LittleEndian.PutUint32(mcin[i*16:], uint32(at))
		binary.LittleEndian.PutUint32(mcin[i*16+4:], uint32(len(b.data)+8))
		if orig := origMCIN(top.mcin, i); orig != nil {
			copy(mcin[i*16+8:i*16+16], orig[8:16])
		}
	}
	copy(out.Bytes()[mcinAt+8:], mcin)
	// MHDR's offsets: from its own data to each chunk's header.
	names := []string{"MCIN", "MTEX", "MMDX", "MMID", "MWMO", "MWID", "MDDF", "MODF"}
	for k, id := range names {
		binary.LittleEndian.PutUint32(mhdr[4+k*4:], uint32(positions[id]-(mhdrAt+8)))
	}
	copy(out.Bytes()[mhdrAt+8:], mhdr)
	return out.Bytes(), nil
}

func origMCIN(mcin []byte, i int) []byte {
	if len(mcin) < (i+1)*16 {
		return nil
	}
	return mcin[i*16 : i*16+16]
}

// m2Reach and wmoReach are the default half-sizes of a model's bounds, in yards.
func m2Reach(o Object) (lo, hi [3]float32) {
	return around(o.Position, defaultM2Reach)
}

func wmoReach(o Object) (lo, hi [3]float32) {
	return around(o.Position, defaultWMOReach)
}

func around(p [3]float32, r float32) (lo, hi [3]float32) {
	for k := 0; k < 3; k++ {
		lo[k] = p[k] - r
		hi[k] = p[k] + r
	}
	return lo, hi
}

// Bounds is the object's bounds as the writer uses them to pick the chunks that list it: its own Min
// and Max, or the default around its position for its kind.
func (o Object) Bounds() (lo, hi [3]float32) {
	if o.Kind == WMO {
		return bounds(o, wmoReach)
	}
	return bounds(o, m2Reach)
}

// bounds returns an object's bounds: its own, or the default around its position.
func bounds(o Object, reach func(Object) (lo, hi [3]float32)) (lo, hi [3]float32) {
	if o.Min != ([3]float32{}) || o.Max != ([3]float32{}) {
		return o.Min, o.Max
	}
	return reach(o)
}

func putVec(b []byte, v [3]float32) {
	for k := 0; k < 3; k++ {
		binary.LittleEndian.PutUint32(b[k*4:], math.Float32bits(v[k]))
	}
}

// subRegion returns the bytes of the sub-chunk payload at payload offset ofs of an MCNK payload,
// as far as its own size says. ofs 0 means none.
func subRegion(m []byte, ofs int) ([]byte, bool) {
	if ofs == 0 || ofs < 8 || ofs > len(m) {
		return nil, false
	}
	size := int(binary.LittleEndian.Uint32(m[ofs-4:]))
	if ofs+size > len(m) {
		return nil, false
	}
	return m[ofs : ofs+size], true
}

// rebuildChunk writes one MCNK: its header with new offsets and counts, and its sub-chunks, kept
// or rebuilt.
func rebuildChunk(m []byte, idx int, ch Changes, texNames *nameList, effects, looks map[string]uint32,
	m2Map, wmoMap map[int]int, added *struct{ m2, wmo []int }) ([]byte, error) {
	if len(m) < mcnkHeaderLen {
		return nil, errTruncated
	}
	// Each sub-chunk the header names, by where its header starts (payload offset minus 8).
	type region struct {
		id         string
		start, end int
	}
	var regions []region
	for _, f := range subFields {
		ofs := int(binary.LittleEndian.Uint32(m[f.ofs:]))
		if ofs == 0 {
			continue
		}
		if ofs < mcnkHeaderLen+8 || ofs > len(m) {
			return nil, fmt.Errorf("%s offset %d is out of place", f.id, ofs)
		}
		regions = append(regions, region{id: f.id, start: ofs - 8})
	}
	sort.Slice(regions, func(i, j int) bool { return regions[i].start < regions[j].start })
	for i := range regions {
		if i+1 < len(regions) {
			regions[i].end = regions[i+1].start
		} else {
			regions[i].end = len(m)
		}
	}
	raw := map[string][]byte{}
	for _, r := range regions {
		raw[r.id] = m[r.start:r.end]
	}

	// The paint: the chunk's new layers, or its own.
	layersRaw := raw["MCLY"]
	alphaRaw := raw["MCAL"]
	flags := binary.LittleEndian.Uint32(m[0:])
	var mcly, mcal []byte
	nLayers := binary.LittleEndian.Uint32(m[mcnkLayers:])
	paint, painted := ch.Paint[idx]
	painted = painted && len(paint.Layers) > 0
	if painted && paint.ClientAlpha {
		if own := ownLayers(layersRaw, paint.Layers); own != nil {
			layersRaw = own
			painted = false
		}
	}
	if painted {
		if len(paint.Layers) > 4 {
			return nil, errors.New("more than four layers")
		}
		mcly = make([]byte, 16*len(paint.Layers))
		for l, layer := range paint.Layers {
			id := texNames.of(layer.Texture)
			binary.LittleEndian.PutUint32(mcly[l*16:], uint32(id))
			var f uint32
			var alphaOfs uint32
			if l > 0 {
				f = layerUseAlpha
				alphaOfs = uint32((l - 1) * alphaBytes4)
				if len(layer.Alpha) != 64*64 {
					return nil, fmt.Errorf("layer %d alpha is %d bytes, want 4096", l, len(layer.Alpha))
				}
				mcal = append(mcal, encode4Bit(layer.Alpha)...)
			}
			if layer.Flags != nil {
				f |= *layer.Flags & LayerLookFlags
			} else {
				f |= looks[strings.ToLower(layer.Texture)]
			}
			binary.LittleEndian.PutUint32(mcly[l*16+4:], f)
			binary.LittleEndian.PutUint32(mcly[l*16+8:], alphaOfs)
			effect := layer.Effect
			if effect == 0 {
				effect = effects[strings.ToLower(layer.Texture)]
			}
			binary.LittleEndian.PutUint32(mcly[l*16+12:], effect)
		}
		nLayers = uint32(len(paint.Layers))
		if len(paint.Layers) > 1 {
			// The alpha maps are 64x64, so the game must not repeat their last row and column.
			flags |= mcnkFlagNoFix
		}
		layersRaw = mcly
		alphaRaw = mcal
	}

	// The model references: the kept ones renumbered, then the added ones.
	nDoodads := int(binary.LittleEndian.Uint32(m[mcnkDoodadRefs:]))
	nObjects := int(binary.LittleEndian.Uint32(m[mcnkMapObjRefs:]))
	var m2Refs, wmoRefs []uint32
	if region := raw["MCRF"]; len(region) >= 8 {
		refs := region[8:] // the payload, past the sub-chunk's own header
		for k := 0; k < nDoodads && (k+1)*4 <= len(refs); k++ {
			if n, found := m2Map[int(binary.LittleEndian.Uint32(refs[k*4:]))]; found {
				m2Refs = append(m2Refs, uint32(n))
			}
		}
		for k := 0; k < nObjects && (nDoodads+k+1)*4 <= len(refs); k++ {
			if n, found := wmoMap[int(binary.LittleEndian.Uint32(refs[(nDoodads+k)*4:]))]; found {
				wmoRefs = append(wmoRefs, uint32(n))
			}
		}
	}
	for _, i := range added.m2 {
		m2Refs = append(m2Refs, uint32(i))
	}
	for _, i := range added.wmo {
		wmoRefs = append(wmoRefs, uint32(i))
	}
	refs := make([]byte, 0, 4*(len(m2Refs)+len(wmoRefs)))
	for _, r := range append(m2Refs, wmoRefs...) {
		refs = binary.LittleEndian.AppendUint32(refs, r)
	}

	// Liquids: the chunk's new layers, plus the sea in the cells they leave that the ground lies
	// below. Either replaces the tile's own liquid.
	var liquid []byte
	layers, replace := ch.Liquids[idx]
	if ch.Water != nil {
		if sea := seaLayer(m, raw["MCVT"], ch.Water.Level, layers); sea != nil {
			layers = append(append([]Liquid(nil), layers...), *sea)
		}
		replace = true
	}
	if replace {
		var kinds uint32
		liquid, kinds = liquidRecords(layers)
		flags = flags&^mcnkLiquidMask | kinds
	}

	// Liquid and sound emitters, kept as they are; their size fields are the game's own.
	header := append([]byte(nil), m[:mcnkHeaderLen]...)
	if paint, ok := ch.Paint[idx]; ok && len(paint.Layers) > 0 {
		if paint.Predominant != nil {
			writePredominant(header, paint.Predominant)
		}
		if paint.NoEffect != nil {
			writeNoEffect(header, paint.NoEffect)
		}
	}
	var shadow []byte
	if h, ok := ch.Headers[idx]; ok {
		flags = h.apply(header, flags)
		if h.Shadow != nil {
			shadow, flags = shadowPiece(h.Shadow, flags)
			binary.LittleEndian.PutUint32(header[mcnkShadowSize:], ShadowBytes)
		}
	}
	binary.LittleEndian.PutUint32(header[0:], flags)
	binary.LittleEndian.PutUint32(header[mcnkLayers:], nLayers)
	binary.LittleEndian.PutUint32(header[mcnkDoodadRefs:], uint32(len(m2Refs)))
	binary.LittleEndian.PutUint32(header[mcnkMapObjRefs:], uint32(len(wmoRefs)))
	if replace {
		binary.LittleEndian.PutUint32(header[mcnkLiquidOfs:], 0)
		binary.LittleEndian.PutUint32(header[mcnkLiquidSize:], 0)
	}

	type piece struct {
		id    string
		data  []byte // whole chunk: header and payload
		fresh bool   // built here, so its size field in the header is set here too
	}
	pieces := []piece{}
	add := func(id string, data []byte, raw bool) {
		if raw {
			pieces = append(pieces, piece{id: id, data: data})
			return
		}
		var head [8]byte
		head[0], head[1], head[2], head[3] = id[3], id[2], id[1], id[0]
		binary.LittleEndian.PutUint32(head[4:], uint32(len(data)))
		pieces = append(pieces, piece{id: id, data: append(head[:], data...), fresh: true})
	}
	add("MCVT", raw["MCVT"], true)
	add("MCNR", raw["MCNR"], true)
	if layersRaw != nil {
		if mcly != nil {
			add("MCLY", mcly, false)
		} else {
			add("MCLY", layersRaw, true)
		}
	}
	add("MCRF", refs, false)
	if alphaRaw != nil {
		if mcal != nil {
			add("MCAL", mcal, false)
		} else {
			add("MCAL", alphaRaw, true)
		}
	}
	for _, id := range []string{"MCSH", "MCSE", "MCLQ"} {
		if id == "MCLQ" && replace {
			continue // replaced by the liquids above
		}
		if id == "MCSH" && shadow != nil {
			add("MCSH", shadow, false)
			continue
		}
		if r, ok := raw[id]; ok {
			add(id, r, true)
		}
	}
	if liquid != nil {
		add("MCLQ", liquid, false)
	}

	// Lay the pieces out after the header, and point the header at each one's payload.
	// A field whose piece is not written is zeroed first, so it doesn't keep the old chunk's offset
	// and size: a chunk repainted to one layer has no MCAL, and its 0x8000 flag (the alpha maps'
	// layout) and the shadow flag go with their pieces (#496).
	shadowSize := binary.LittleEndian.Uint32(header[mcnkShadowSize:])
	soundCount := binary.LittleEndian.Uint32(header[mcnkSoundCount:])
	for _, f := range []int{0x24, 0x28, 0x2c, mcnkShadowSize, mcnkSoundOfs, mcnkSoundCount} {
		binary.LittleEndian.PutUint32(header[f:], 0)
	}
	written := map[string]bool{}
	for _, p := range pieces {
		if p.data != nil {
			written[p.id] = true
		}
	}
	if !written["MCAL"] {
		flags &^= mcnkFlagNoFix
	}
	if !written["MCSH"] {
		flags &^= mcnkFlagShadow
	}
	binary.LittleEndian.PutUint32(header[0:], flags)

	body := []byte{}
	at := mcnkHeaderLen
	for _, p := range pieces {
		if p.data == nil {
			continue
		}
		ofs := uint32(at + 8)
		switch p.id {
		case "MCVT":
			binary.LittleEndian.PutUint32(header[0x14:], ofs)
		case "MCNR":
			binary.LittleEndian.PutUint32(header[0x18:], ofs)
		case "MCLY":
			binary.LittleEndian.PutUint32(header[0x1c:], ofs)
		case "MCRF":
			binary.LittleEndian.PutUint32(header[0x20:], ofs)
		case "MCAL":
			binary.LittleEndian.PutUint32(header[0x24:], ofs)
			binary.LittleEndian.PutUint32(header[0x28:], uint32(len(p.data)-8+8))
		case "MCSH":
			binary.LittleEndian.PutUint32(header[0x2c:], ofs)
			binary.LittleEndian.PutUint32(header[mcnkShadowSize:], shadowSize)
		case "MCSE":
			binary.LittleEndian.PutUint32(header[mcnkSoundOfs:], ofs)
			binary.LittleEndian.PutUint32(header[mcnkSoundCount:], soundCount)
		case "MCLQ":
			binary.LittleEndian.PutUint32(header[mcnkLiquidOfs:], ofs)
			if p.fresh {
				// The header holds the liquid's size with its own header, as the game's files do.
				binary.LittleEndian.PutUint32(header[mcnkLiquidSize:], uint32(len(p.data)))
			}
		}
		body = append(body, p.data...)
		at += len(p.data)
	}
	// MCRF's and MCVT's raw regions include their own headers; the offsets above assume that.
	return append(header, body...), nil
}

// encode4Bit packs a 64x64 alpha map at four bits a texel, two a byte, low nibble first.
func encode4Bit(alpha []byte) []byte {
	out := make([]byte, alphaBytes4)
	for t := 0; t < len(out)*2; t += 2 {
		lo := min(15, (int(alpha[t])+8)/17)
		hi := min(15, (int(alpha[t+1])+8)/17)
		out[t/2] = byte(lo | hi<<4)
	}
	return out
}

// SequentialAlpha turns per-layer weights (layers 1 and up, each 64x64, 0 to 255) into the alpha
// the game blends with: each layer shows its weight of what the layers above it leave.
func SequentialAlpha(weights [][]byte) [][]byte {
	out := make([][]byte, len(weights))
	for i := range out {
		out[i] = make([]byte, len(weights[i]))
	}
	if len(weights) == 0 {
		return out
	}
	for t := range weights[0] {
		above := 0.0
		for i := len(weights) - 1; i >= 0; i-- {
			w := float64(weights[i][t]) / 255
			left := 1 - above
			if left > 1e-3 {
				out[i][t] = uint8(math.Round(math.Min(1, w/left) * 255))
			}
			above += w
		}
	}
	return out
}

// LayersFromWeights turns a chunk's texel weights into the layers to write. weights holds four
// weights per texel (perSide texels a side, row-major), for the textures in names, which are the
// chunk's slots in order. Texels are upscaled to the game's 64x64 alpha.
func LayersFromWeights(names []string, weights []byte, perSide int) []Layer {
	n := len(names)
	const alphaSide = 64
	scale := alphaSide / perSide
	maps := make([][]byte, n)
	for k := range maps {
		maps[k] = make([]byte, alphaSide*alphaSide)
	}
	for y := 0; y < alphaSide; y++ {
		for x := 0; x < alphaSide; x++ {
			t := (y/scale*perSide + x/scale) * 4
			for k := 0; k < n; k++ {
				maps[k][y*alphaSide+x] = weights[t+k]
			}
		}
	}
	layers := make([]Layer, n)
	for k, name := range names {
		layers[k].Texture = name
	}
	if n > 1 {
		seq := SequentialAlpha(maps[1:])
		for k := 1; k < n; k++ {
			layers[k].Alpha = seq[k-1]
		}
	}
	return layers
}
