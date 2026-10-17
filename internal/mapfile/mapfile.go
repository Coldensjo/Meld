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
// uint8 liquid type (LiquidType.dbc: 1 water, 2 ocean, 3 magma, 4 slime), uint64 cell mask (bit
// z*8+x), 81 float32 surface heights and 81 depth bytes, each 9x9 row-major.
//
// Version 5 has no shadows blob: such a map opens with none of its own. Version 4 has no area IDs, chunk flags or no-effect cells: such a map opens with none, and says so
// (Version < 5), so a region's export can keep the client's own. Version 3 has no liquids: such a map opens with none. Version 2 has no holes blob either.
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
)

const (
	Magic = "WMAP"
	// Version is the format written. Versions 1 to 5 are still read.
	Version = 6
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

// Read decodes a map from r. Versions 1 to 6 are all accepted.
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

// Save writes m to path atomically (temp file + rename).
func Save(path string, m *MapData) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(f, 1<<20)
	if err := Write(bw, m); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := bw.Flush(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
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
	// here; absent for a map that hasn't set them.
	Info json.RawMessage `json:"info,omitempty"`
}
