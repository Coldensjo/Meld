// Package mapfile reads and writes Meld map files (*.wmap).
//
// On-disk layout (whole stream gzip-compressed):
//
//	magic      [4]byte  "WMAP"
//	version    uint32   little endian
//	hdrLen     uint32   length of the JSON header
//	header     []byte   JSON-encoded Header
//	heights    []byte   (Size+1)^2 float32 little endian
//	weights    []byte   SplatRes^2 * 4 bytes: four weights per texel, summing to 255 (version 2)
//	chunkSlots []byte   (Size/8)^2 * 4 bytes: four palette indices per 8x8-cell chunk (version 2)
//	holes      []byte   Size^2 bytes: a cell's hole (version 3): 0 none, 1 the whole cell, 2 or 3 one of its two triangles
//	liqLen     uint32   length of the liquids blob (version 4)
//	liquids    []byte   uint32 layer count, then LiquidRecordSize bytes a layer (version 4)
//	areaIds    []byte   (Size/8)^2 uint32: each chunk's AreaTable.dbc ID, 0 for none (version 5)
//	chunkFlags []byte   (Size/8)^2 bytes: each chunk's flags, bit 0 impassable (version 5)
//	noEffect   []byte   Size^2 bytes: 1 where a cell grows no ground effect doodads (version 5)
//	shadowLen  uint32   length of the shadows blob: 0, or ShadowBytes (version 6)
//	shadows    []byte   the baked terrain shadows, a bit per shadow texel (version 6)
//
// The baked shadows (each chunk's MCSH, kept at its resolution) have ShadowTexels texels a cell, so
// Size*ShadowTexels a side; texel i (row-major) is bit i&7 of byte i>>3. An empty blob means the map
// holds none of its own: a region keeps the client's.
//
// A liquid layer (noggit3's liquid_layer) is: uint32 chunk index (8x8-cell chunks, row-major),
// uint8 liquid type (LiquidType.dbc: 1 water, 2 ocean, 3 magma, 4 slime, or a building's row such as
// 21, whose kind the header's LiquidKinds keeps), uint64 cell mask (bit z*8+x), 81 float32 surface
// heights and 81 depth bytes, each 9x9 row-major.
//
// Version 7 adds no blob: it is the first whose header's vmangos may place the map on the client's
// 64x64 tile grid and leave tiles of its square out (TileX, TileY, Tiles, #46). An older Meld refuses
// it rather than publish such a map whole at the grid's corner.
//
// Version 5 has no shadows blob: such a map opens with none of its own. Version 4 has no area IDs, chunk flags or no-effect cells: such a map opens with none, and says so
// (Version < 5), so a region's export can keep the client's own. Version 3 has no liquids: such a map opens with none. Version 2 has no holes blob either.
// Saved again, such a map keeps saying so through the header's HolesUnknown, LiquidsUnknown and ChunkDataUnknown.
//
// Version 1 stored eight global paint layers instead, as splatA and splatB (SplatRes^2 * 4 bytes
// each). It's still read; the frontend converts it to chunks.
//
// Over the Wails bridge the binary blobs travel as base64 strings, which keeps
// the JS side to a single typed-array copy and avoids huge JSON number arrays.
package mapfile

import (
	"bufio"
	"compress/gzip"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	Magic = "WMAP"
	// Version is the format written. Versions 1 to 6 are still read.
	Version = 7
	// ShadowTexels is the baked shadow map's texels per cell side (64 a chunk, as MCSH has them).
	ShadowTexels = 8
	// LiquidRecordSize is the bytes of one liquid layer in the liquids blob.
	LiquidRecordSize = 4 + 1 + 8 + 81*4 + 81
	// ChunkCells is the size of a paint chunk in cells. A map's size is a multiple of it.
	ChunkCells = 8
	// SlotsPerChunk is the number of palette textures a chunk may use.
	SlotsPerChunk = 4
	// MaxPalette is the number of palette entries a map may hold.
	MaxPalette = 255
	// ChunkImpassable is the chunk flag that marks a chunk players can't walk.
	ChunkImpassable = 1
	// TileCells is a 1.12 client tile's side in cells, for a map made for the client (VmangosFolder).
	TileCells = 128
	// GridTiles is the client's map grid's side in tiles.
	GridTiles = 64
)

// PlacedObject is a model instance placed in the world. Objects with a Parent
// are attached to it: X/YOff/Z/RotY are then local to the parent's transform.
type PlacedObject struct {
	ID     int     `json:"id,omitempty"`
	Parent int     `json:"parent,omitempty"`
	Type   string  `json:"type"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	YOff   float64 `json:"yOff"`
	RotY   float64 `json:"rotY"`
	Scale  float64 `json:"scale"`
	// UID is the model's unique ID in the client's files, for a model imported from a client region.
	UID uint32 `json:"uid,omitempty"`
	// TiltX and TiltZ are the model's tilt forward and back, and side to side, in radians. Zero when upright.
	TiltX float64 `json:"tiltX,omitempty"`
	TiltZ float64 `json:"tiltZ,omitempty"`
	// Group is the selection group the model is in (a click on one selects them all); 0 for none.
	Group int `json:"group,omitempty"`
}

// Header is the JSON metadata section of a map file.
type Header struct {
	Name         string         `json:"name"`
	Size         int            `json:"size"`     // terrain cells per side
	CellSize     float64        `json:"cellSize"` // world units per cell
	SplatRes     int            `json:"splatRes"` // splat texture resolution per side
	WaterLevel   float64        `json:"waterLevel"`
	WaterEnabled bool           `json:"waterEnabled"`
	Objects      []PlacedObject `json:"objects"`
	// Palette is the texture for each palette index: a WoW tileset path, or a '#rrggbb' colour.
	// Version 2 only.
	Palette []string `json:"palette,omitempty"`
	// LayerTextures are the eight global paint layers of version 1: a WoW tileset path, or "" for
	// the built-in procedural texture.
	LayerTextures []string `json:"layerTextures,omitempty"`
	// Region is the block of client tiles the map was opened from, which saves go back to. Optional.
	Region *ClientRegion `json:"region,omitempty"`
	// Vmangos is the server folder map this map publishes under. Optional.
	Vmangos *VmangosFolder `json:"vmangos,omitempty"`
	// Roles names the palette entries that play the rock and the dirt (-1 for none), which the
	// Sculpt tool paints by slope. Optional; a map without them guesses from its texture names.
	Roles *TextureRoles `json:"roles,omitempty"`
	// TextureEffects is the ground effect (GroundEffectTexture ID) a texture grows, by texture path,
	// where the map says so itself; other textures grow what the client's tiles give them. Optional.
	TextureEffects map[string]uint32 `json:"textureEffects,omitempty"`
	// TextureLooks is a texture's look flags (the MCLY animation and overbright bits), by texture path,
	// where the map sets them; other textures keep what the client's tiles give them. Optional.
	TextureLooks map[string]uint32 `json:"textureLooks,omitempty"`
	// ZoneEffects and TileEffects are ground effect choices per texture path for one zone (by AreaTable
	// ID) or one tile of the map ("x,y"), over the map's own. Optional.
	ZoneEffects map[string]map[string]uint32 `json:"zoneEffects,omitempty"`
	TileEffects map[string]map[string]uint32 `json:"tileEffects,omitempty"`
	// Reference is the author's reference image laid over the map (#184): its path, never its
	// pixels, and where it lies. Optional; older readers ignore it.
	Reference *ReferenceImage `json:"reference,omitempty"`
	// Paths are the roads, rivers and fences drawn along a curve with the Path tool (#167), kept so they can be moved and
	// applied again; what an apply wrote is in the heights and paint. Never exported. Optional; older
	// readers ignore it.
	Paths []MapPath `json:"paths,omitempty"`
	// LiquidsUnknown says the liquids blob is not all of the region's liquids: the map was opened from a
	// file older than version 4, which kept none, so it holds only what was drawn since, and a region's
	// export leaves the client's other liquids alone. ChunkDataUnknown says the same of the area IDs,
	// chunk flags and no-effect cells (a file older than version 5), whose export then keeps the
	// client's chunk headers. HolesUnknown says it of the holes (a file older than version 3), whose
	// export then adds the map's holes to the client's rather than replacing them (#663). Without them
	// a version 6 file would read an empty blob as "none" (#525). Optional; older readers ignore them.
	HolesUnknown     bool `json:"holesUnknown,omitempty"`
	LiquidsUnknown   bool `json:"liquidsUnknown,omitempty"`
	ChunkDataUnknown bool `json:"chunkDataUnknown,omitempty"`
	// LiquidKinds is the kind ("river", "ocean", "magma" or "slime") of each liquid ID past the base
	// four that the liquids blob uses, by ID ("21"), so a layer of a row the client's table lacks (or
	// a map opened before the table is read) still draws and exports as its kind (#540). Optional;
	// older readers ignore it, and the frontend checks it.
	LiquidKinds map[string]string `json:"liquidKinds,omitempty"`
}

// PathPoint is a path's control point, in world units.
type PathPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// MapPath is a path of the Path tool (frontend terrain/paths.ts): its control points and what its
// apply does.
type MapPath struct {
	ID     int         `json:"id"`
	Name   string      `json:"name"`
	Kind   string      `json:"kind"`
	Points []PathPoint `json:"points"`
	// Width is the levelled and painted part's full width, Falloff the yards over which the ground
	// blends back at each side, and Edge the yards over which the paint fades (0 is hard), all in yards.
	Width   float64 `json:"width"`
	Falloff float64 `json:"falloff"`
	Edge    float64 `json:"edge"`
	// Grade is the steepest the path climbs along its length, in percent; 0 for no limit.
	Grade float64 `json:"grade"`
	// Texture is the palette texture painted along it; "" for none.
	Texture string `json:"texture"`
	// Depth is how deep a river's bed is carved below its surface, yards, and Liquid its liquid
	// (LiquidType.dbc ID).
	Depth  float64 `json:"depth"`
	Liquid int     `json:"liquid"`
	// Model is a fence's object type (m2: or wmo: and the client path), Spacing the yards between its
	// models (0 for the model's own length) and Turn their extra turn in degrees.
	Model   string  `json:"model,omitempty"`
	Spacing float64 `json:"spacing"`
	Turn    float64 `json:"turn"`
}

// ReferenceImage is a picture the author traces the map from (View › Reference Image): a file of
// theirs, kept by path, draped over the ground or shown over the top-down view.
type ReferenceImage struct {
	Path string `json:"path"`
	// Mode is "ground" (draped over the terrain) or "screen" (over the top-down view, fixed to it).
	Mode    string  `json:"mode"`
	Opacity float64 `json:"opacity"`
	Shown   bool    `json:"shown"`
	// X and Z are the image's centre on the ground, W and H its size there, in world units, and
	// Turn its turn about the centre in radians.
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
	W    float64 `json:"w"`
	H    float64 `json:"h"`
	Turn float64 `json:"turn"`
}

// TextureRoles are palette indices for the textures sculpting paints by slope.
type TextureRoles struct {
	Rock int `json:"rock"`
	Dirt int `json:"dirt"`
}

// MapData is the bridge representation exchanged with the frontend.
type MapData struct {
	Header
	// Version is the format the map was read from. Set by Read; Write always writes Version.
	Version    int    `json:"version,omitempty"`
	Heights    string `json:"heights"`              // base64 float32 LE
	Weights    string `json:"weights,omitempty"`    // base64 RGBA8, version 2
	ChunkSlots string `json:"chunkSlots,omitempty"` // base64 RGBA8 per chunk, version 2
	// Holes is one byte per cell (0 none, 1 the whole cell, 2 or 3 one of its triangles), version 3. Empty means no holes: an older map, or
	// a writer that sends none.
	Holes string `json:"holes,omitempty"`
	// Liquids is the liquids blob, version 4: a layer count, then the layers. Empty means none.
	Liquids string `json:"liquids,omitempty"`
	// AreaIDs is a uint32 per chunk (row-major), version 5: the chunk's AreaTable.dbc ID, 0 for none.
	// ChunkFlags is a byte per chunk (bit 0 impassable) and NoEffect a byte per cell (1 where no
	// ground effect doodads grow), also version 5. Empty means all zero.
	AreaIDs    string `json:"areaIds,omitempty"`
	ChunkFlags string `json:"chunkFlags,omitempty"`
	NoEffect   string `json:"noEffect,omitempty"`
	// Shadows is the baked shadows' bits (version 6, ShadowBytes); empty means none of the map's own.
	Shadows string `json:"shadows,omitempty"`
	SplatA  string `json:"splatA,omitempty"` // base64 RGBA8, version 1
	SplatB  string `json:"splatB,omitempty"` // base64 RGBA8, version 1
}

func (h *Header) validate() error {
	if h.Size < 16 || h.Size > 2048 {
		return fmt.Errorf("invalid terrain size %d", h.Size)
	}
	if h.SplatRes < 16 || h.SplatRes > 4096 {
		return fmt.Errorf("invalid splat resolution %d", h.SplatRes)
	}
	if h.CellSize <= 0 {
		return fmt.Errorf("invalid cell size %v", h.CellSize)
	}
	if h.Size%ChunkCells != 0 {
		return fmt.Errorf("terrain size %d is not a multiple of %d", h.Size, ChunkCells)
	}
	if len(h.Palette) > MaxPalette {
		return fmt.Errorf("palette has %d entries, at most %d allowed", len(h.Palette), MaxPalette)
	}
	if v := h.Vmangos; v != nil && (v.TileX != 0 || v.TileY != 0 || v.Tiles != "") {
		return v.validate(h.Size)
	}
	return nil
}

// validate checks a map's place on the tile grid against its square of size cells: the square on the
// grid, and a mask of one '0' or '1' a tile with at least one present.
func (v *VmangosFolder) validate(size int) error {
	if size%TileCells != 0 {
		return fmt.Errorf("vmangos tiles: a map of %d cells is not whole tiles", size)
	}
	n := size / TileCells
	if v.TileX < 0 || v.TileY < 0 || v.TileX+n > GridTiles || v.TileY+n > GridTiles {
		return fmt.Errorf("vmangos tiles: %d tiles from %d,%d leave the %dx%d grid", n, v.TileX, v.TileY, GridTiles, GridTiles)
	}
	if v.Tiles == "" {
		return nil
	}
	if len(v.Tiles) != n*n {
		return fmt.Errorf("vmangos tiles: mask of %d tiles, want %d", len(v.Tiles), n*n)
	}
	if strings.Trim(v.Tiles, "01") != "" {
		return errors.New("vmangos tiles: the mask holds only 0 and 1")
	}
	if !strings.Contains(v.Tiles, "1") {
		return errors.New("vmangos tiles: the mask has no tile")
	}
	return nil
}

func (h *Header) heightBytes() int { return (h.Size + 1) * (h.Size + 1) * 4 }

// splatBytes is the size of a per-texel blob: version 2 weights, or a version 1 splat.
func (h *Header) splatBytes() int { return h.SplatRes * h.SplatRes * 4 }

// chunkBytes is the size of the per-chunk slot table.
func (h *Header) chunkBytes() int {
	c := h.Size / ChunkCells
	return c * c * SlotsPerChunk
}

// holeBytes is the size of a per-cell blob: the holes, or the no-effect cells.
func (h *Header) holeBytes() int { return h.Size * h.Size }

// ShadowBytes is the size of the baked shadows' bits: a bit per texel, ShadowTexels a cell side.
func (h *Header) ShadowBytes() int {
	side := h.Size * ShadowTexels
	return side * side / 8
}

// chunkCount is the number of paint chunks.
func (h *Header) chunkCount() int {
	c := h.Size / ChunkCells
	return c * c
}

// checkLiquids rejects a liquids blob whose length doesn't match its count, or whose layers lie off
// the map.
func (h *Header) checkLiquids(b []byte) error {
	if len(b) == 0 {
		return nil
	}
	if len(b) < 4 {
		return errors.New("liquids: truncated")
	}
	n := int(binary.LittleEndian.Uint32(b))
	if len(b) != 4+n*LiquidRecordSize {
		return fmt.Errorf("liquids: %d bytes for %d layers", len(b), n)
	}
	chunks := (h.Size / ChunkCells) * (h.Size / ChunkCells)
	for i := 0; i < n; i++ {
		if c := int(binary.LittleEndian.Uint32(b[4+i*LiquidRecordSize:])); c >= chunks {
			return fmt.Errorf("liquids: layer %d is in chunk %d of %d", i, c, chunks)
		}
	}
	return nil
}

// Write encodes m to w in the current version.
func Write(w io.Writer, m *MapData) error {
	if err := m.validate(); err != nil {
		return err
	}
	type blob struct {
		name string
		s    string
		want int
		// optional blobs may be left empty, which writes zeros.
		optional bool
	}
	fixed := func(list []blob) ([][]byte, error) {
		out := make([][]byte, 0, len(list))
		for _, b := range list {
			if b.optional && b.s == "" {
				out = append(out, make([]byte, b.want))
				continue
			}
			raw, err := base64.StdEncoding.DecodeString(b.s)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", b.name, err)
			}
			if len(raw) != b.want {
				return nil, fmt.Errorf("%s: got %d bytes, want %d", b.name, len(raw), b.want)
			}
			out = append(out, raw)
		}
		return out, nil
	}
	blobs, err := fixed([]blob{
		{"heights", m.Heights, m.heightBytes(), false},
		{"weights", m.Weights, m.splatBytes(), false},
		{"chunkSlots", m.ChunkSlots, m.chunkBytes(), false},
		{"holes", m.Holes, m.holeBytes(), true},
	})
	if err != nil {
		return err
	}
	liquids, err := base64.StdEncoding.DecodeString(m.Liquids)
	if err != nil {
		return fmt.Errorf("liquids: %w", err)
	}
	if err := m.checkLiquids(liquids); err != nil {
		return err
	}
	var liqLen [4]byte
	binary.LittleEndian.PutUint32(liqLen[:], uint32(len(liquids)))
	blobs = append(blobs, liqLen[:], liquids)
	tail, err := fixed([]blob{
		{"areaIds", m.AreaIDs, m.chunkCount() * 4, true},
		{"chunkFlags", m.ChunkFlags, m.chunkCount(), true},
		{"noEffect", m.NoEffect, m.holeBytes(), true},
	})
	if err != nil {
		return err
	}
	blobs = append(blobs, tail...)
	shadows, err := base64.StdEncoding.DecodeString(m.Shadows)
	if err != nil {
		return fmt.Errorf("shadows: %w", err)
	}
	if len(shadows) != 0 && len(shadows) != m.ShadowBytes() {
		return fmt.Errorf("shadows: %d bytes, want %d", len(shadows), m.ShadowBytes())
	}
	var shadowLen [4]byte
	binary.LittleEndian.PutUint32(shadowLen[:], uint32(len(shadows)))
	blobs = append(blobs, shadowLen[:], shadows)

	hdr, err := json.Marshal(&m.Header)
	if err != nil {
		return err
	}

	gz, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
	if err != nil {
		return err
	}
	var pre [12]byte
	copy(pre[:4], Magic)
	binary.LittleEndian.PutUint32(pre[4:8], Version)
	binary.LittleEndian.PutUint32(pre[8:12], uint32(len(hdr)))
	if _, err := gz.Write(pre[:]); err != nil {
		return err
	}
	if _, err := gz.Write(hdr); err != nil {
		return err
	}
	for _, b := range blobs {
		if _, err := gz.Write(b); err != nil {
			return err
		}
	}
	return gz.Close()
}

// Read decodes a map from r. Versions 1 to 7 are all accepted.
func Read(r io.Reader) (*MapData, error) {
	gz, err := gzip.NewReader(bufio.NewReader(r))
	if err != nil {
		return nil, fmt.Errorf("not a Meld map: %w", err)
	}
	defer gz.Close()

	var pre [12]byte
	if _, err := io.ReadFull(gz, pre[:]); err != nil {
		return nil, err
	}
	if string(pre[:4]) != Magic {
		return nil, errors.New("not a Meld map: bad magic")
	}
	v := binary.LittleEndian.Uint32(pre[4:8])
	if v < 1 || v > Version {
		return nil, fmt.Errorf("unsupported map version %d", v)
	}
	hdrLen := binary.LittleEndian.Uint32(pre[8:12])
	if hdrLen > 64<<20 {
		return nil, errors.New("header too large")
	}
	hdr := make([]byte, hdrLen)
	if _, err := io.ReadFull(gz, hdr); err != nil {
		return nil, err
	}
	m := &MapData{Version: int(v)}
	if err := json.Unmarshal(hdr, &m.Header); err != nil {
		return nil, fmt.Errorf("header: %w", err)
	}
	if v == 1 {
		// Version 1 maps predate the chunk rules, so their size isn't checked against them.
		if m.Size < 16 || m.Size > 2048 || m.SplatRes < 16 || m.SplatRes > 4096 || m.CellSize <= 0 {
			return nil, errors.New("invalid version 1 header")
		}
	} else if err := m.validate(); err != nil {
		return nil, err
	}
	read := func(n int) (string, error) {
		buf := make([]byte, n)
		if _, err := io.ReadFull(gz, buf); err != nil {
			return "", err
		}
		return base64.StdEncoding.EncodeToString(buf), nil
	}
	if m.Heights, err = read(m.heightBytes()); err != nil {
		return nil, fmt.Errorf("heights: %w", err)
	}
	if v == 1 {
		if m.SplatA, err = read(m.splatBytes()); err != nil {
			return nil, fmt.Errorf("splatA: %w", err)
		}
		if m.SplatB, err = read(m.splatBytes()); err != nil {
			return nil, fmt.Errorf("splatB: %w", err)
		}
	} else {
		if m.Weights, err = read(m.splatBytes()); err != nil {
			return nil, fmt.Errorf("weights: %w", err)
		}
		if m.ChunkSlots, err = read(m.chunkBytes()); err != nil {
			return nil, fmt.Errorf("chunkSlots: %w", err)
		}
		if v >= 3 {
			if m.Holes, err = read(m.holeBytes()); err != nil {
				return nil, fmt.Errorf("holes: %w", err)
			}
		}
		if v >= 4 {
			var n [4]byte
			if _, err := io.ReadFull(gz, n[:]); err != nil {
				return nil, fmt.Errorf("liquids: %w", err)
			}
			size := binary.LittleEndian.Uint32(n[:])
			if size > 1<<30 {
				return nil, errors.New("liquids: too large")
			}
			buf := make([]byte, size)
			if _, err := io.ReadFull(gz, buf); err != nil {
				return nil, fmt.Errorf("liquids: %w", err)
			}
			if err := m.checkLiquids(buf); err != nil {
				return nil, err
			}
			m.Liquids = base64.StdEncoding.EncodeToString(buf)
		}
		if v >= 5 {
			if m.AreaIDs, err = read(m.chunkCount() * 4); err != nil {
				return nil, fmt.Errorf("areaIds: %w", err)
			}
			if m.ChunkFlags, err = read(m.chunkCount()); err != nil {
				return nil, fmt.Errorf("chunkFlags: %w", err)
			}
			if m.NoEffect, err = read(m.holeBytes()); err != nil {
				return nil, fmt.Errorf("noEffect: %w", err)
			}
		}
		if v >= 6 {
			var n [4]byte
			if _, err := io.ReadFull(gz, n[:]); err != nil {
				return nil, fmt.Errorf("shadows: %w", err)
			}
			switch size := int(binary.LittleEndian.Uint32(n[:])); size {
			case 0:
			case m.ShadowBytes():
				if m.Shadows, err = read(size); err != nil {
					return nil, fmt.Errorf("shadows: %w", err)
				}
			default:
				return nil, fmt.Errorf("shadows: %d bytes, want %d", size, m.ShadowBytes())
			}
		}
	}
	if m.Objects == nil {
		m.Objects = []PlacedObject{}
	}
	return m, nil
}

// Save writes m to path atomically: to a temp file beside it, synced to disk before the rename so
// a crash or power loss can't leave the map replaced by a partial file. The temp file is removed
// whenever the save fails, the rename included (the map open in another program on Windows).
func Save(path string, m *MapData) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("save %s: %w", path, err)
	}
	fail := func(err error) error {
		_ = f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("save %s: %w", path, err)
	}
	bw := bufio.NewWriterSize(f, 1<<20)
	if err := Write(bw, m); err != nil {
		return fail(err)
	}
	if err := bw.Flush(); err != nil {
		return fail(err)
	}
	if err := f.Sync(); err != nil {
		return fail(err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("save %s: %w", path, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("save %s: %w", path, err)
	}
	return nil
}

// Load reads a map from path.
func Load(path string) (*MapData, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Read(f)
}

// ClientRegion is a square block of a 1.12 map's tiles in the client: the tile it starts at, and
// how many tiles a side.
type ClientRegion struct {
	MapName string `json:"mapName"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Size    int    `json:"size"`
}

// VmangosFolder is a map made for the 1.12 client: its folder under World\Maps, and its map ID.
type VmangosFolder struct {
	Dir   string `json:"dir"`
	MapID int    `json:"mapId"`
	// Info is the map's own Map.dbc and map_template facts (vmangos.MapInfo's fields), kept opaque
	// here (an object to the frontend, not the byte array a RawMessage would generate); absent for a
	// map that hasn't set them.
	Info json.RawMessage `json:"info,omitempty" ts_type:"object"`
	// TileX and TileY are the client tile at the map's north-west corner on the 64x64 grid, where
	// publish puts it (version 7, #46); 0,0 for a map made before, which sat at the grid's corner.
	TileX int `json:"tileX,omitempty"`
	TileY int `json:"tileY,omitempty"`
	// Tiles is which tiles of the map's square are the map's, one byte a tile, row by row from the
	// north-west: '1' a tile that is drawn and published, '0' one left out, whose ground stays in the
	// file. Empty for every tile (version 7, #46).
	Tiles string `json:"tiles,omitempty"`
}
