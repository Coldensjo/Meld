// Package worldfile reads and writes 3dgame's cube worlds (*.world), the format the game's server
// and client load. The layout is written down in the repository's docs/world-format.md and the Rust
// side is crates/world/src/format.rs; change the three together (a format change needs the owner's
// approval, a new version and a new fixture).
//
// In short: a 12-byte header (magic "3DGWORLD", version), then records, each a u16 tag, u16 flags
// (bit 0 required) and a u32 length, so a reader can skip what it does not know. The world's bounds
// come first, then its SPAWN point, its MONSTERS' spawn points, its NPCS, its PROPS and its MOODS
// regions if it has them (optional records) and any optional record it does not know, kept as read (World.Kept), then its JOINS (groups of joined cubes), OBJECTS (doors, windows, levers, buttons) and OBJECT_STATE if it has any, then one
// CHUNK record per stored chunk with the chunk's own records inside (its CUBES, its PAINT when
// a cube of it has a face painted with a texture, and its BLEND when an edge of a cube's face blends
// into the texture beside it), then an END record. Numbers are little-endian; a mixed chunk's cubes
// are a zlib stream of three 256-byte planes (kinds, shapes, rotations), and its paint and blend of
// six each (one byte per cube for each face).
//
// The package only parses and writes: what a cube means and how it is edited is the frontend's.
package worldfile

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"unicode/utf8"
)

const (
	// Magic is the first eight bytes of every world file.
	Magic = "3DGWORLD"
	// Version is the format version written, and the newest read.
	Version = 1
	// FlagRequired marks a record a reader must understand: one that does not know its tag refuses
	// the file instead of skipping it.
	FlagRequired = 1

	// ChunkSize is the cubes a chunk has a side; a chunk is one layer high.
	ChunkSize = 16
	// ChunkArea is the cubes in a chunk.
	ChunkArea = ChunkSize * ChunkSize
	// PlanesLen is a chunk's cubes as planes: the 256 kinds, then the 256 shapes, then the 256
	// rotations, each in index order (z*16 + x).
	PlanesLen = 3 * ChunkArea
	// PaintLen is a chunk's paint as planes: for each face in face id order (north, east, south,
	// west, up, down), the texture id painted on that face of each of the 256 cubes, in index
	// order; 0 is none, the kind's own texture. An id is 16 bits (3dgame #217), so a world imported
	// from a Tibia map can paint its item ids (internal/otbm).
	PaintLen = FaceCount * ChunkArea
	// BlendLen is a chunk's blend as planes, laid out as its paint: for each face, a byte per cube
	// with bit f set when the face's edge towards face f blends into the texture beside it (#84).
	// The bits of the face itself and its opposite, and bits 6 and 7, are never set.
	BlendLen = FaceCount * ChunkArea
	// BottomLayer is the lowest layer; layers run from 0 (top) to it.
	BottomLayer = 30

	// KindCount, ShapeCount and RotationCount are how many ids crates/world knows (KINDS, SHAPES,
	// Rotation::COUNT). An id at or past them is refused.
	KindCount     = 8
	ShapeCount    = 66
	RotationCount = 8
	// ObjectKindCount, FaceCount and StateCount are how many object kinds (OBJECT_KINDS: door,
	// window, lever, button, teleporter, torch), faces (Face: north, east, south, west, up, down) and object states
	// (off, on) crates/world knows.
	ObjectKindCount = 6
	FaceCount       = 6
	StateCount      = 2
	// FireColourCount is how many fire colours (FireColour: orange, green, blue, purple) a torch
	// can burn.
	FireColourCount = 4
	// TextureCount is how many textures crates/world knows (TEXTURES, from 0 "default" to 28
	// "snow").
	TextureCount = 29

	// maxRecordLen is the longest record read into memory, as the Rust reader's limit. Records that
	// are skipped may be longer.
	maxRecordLen = 16 << 20
)

// Top-level record tags.
const (
	TagEnd    = 0
	TagBounds = 1
	TagChunk  = 2
	// TagSpawn is the cube a player starts in, written without the required flag, so readers that
	// do not know it skip it.
	TagSpawn = 3
	// TagJoins is the world's groups of joined cubes.
	TagJoins = 4
	// TagObjects is the objects attached to cubes.
	TagObjects = 5
	// TagObjectState is the objects' states, one byte each in the order of the OBJECTS record.
	TagObjectState = 6
	// TagMonsters is where the world's monsters spawn, a kind's name and a cube each, written without
	// the required flag as TagSpawn is.
	TagMonsters = 7
	// TagNpcs is where the world's NPCs stand and walk, a name, a cube and a route of cubes each,
	// written without the required flag as TagSpawn is.
	TagNpcs = 8
	// TagProps is the models standing in the world (props, #133): a model's name, a place in metres,
	// a turn and a scale each, written without the required flag as TagSpawn is.
	TagProps = 9
	// TagMoods is the places with a mood of their own (mood regions, #143): a box of cubes and a
	// mood's name each, written without the required flag as TagSpawn is.
	TagMoods = 10
	// TagTextureHints is a name and a colour for texture ids the game does not have yet, which the
	// editor draws a face painted with one in (3dgame #218: a Tibia map's item ids, internal/otbm);
	// written without the required flag, so the game skips it.
	TagTextureHints = 11
	// TagTextureImages is a picture (a PNG) for texture ids the game does not have yet, which the editor
	// draws a face painted with one with (3dgame #224: a Tibia map's item sprites); written without the
	// required flag, so the game skips it.
	TagTextureImages = 12
)

// Record tags inside a chunk.
const (
	ChunkTagCubes = 1
	// ChunkTagPaint is the textures painted on the chunk's cubes, written only when one is.
	ChunkTagPaint = 2
	// ChunkTagBlend is which edges of the chunk's cubes' faces blend into the texture beside them,
	// written only when one does.
	ChunkTagBlend = 3
	// ChunkTagOverlay is the texture drawn over the top of the chunk's cubes, see-through where its
	// picture is (a Tibia map's borders, 3dgame #226), written only when one has one, without the
	// required flag: the game skips it.
	ChunkTagOverlay = 4
)

// OverlayLen is a chunk's overlay: a texture id for the top face of each of its 256 cubes, in index
// order; 0 is none.
const OverlayLen = ChunkArea

// Encodings of a CUBES, PAINT or BLEND record, its first byte. A PAINT record whose ids all fit in a
// byte is written as before (EncodingUniform, EncodingZlibPlanes), so the game still reads it; one
// with a larger id takes the wide encodings, two bytes an id, little-endian (3dgame #217).
const (
	EncodingUniform        = 0
	EncodingZlibPlanes     = 1
	EncodingUniformWide    = 2
	EncodingZlibPlanesWide = 3
)

// shapeTurns and shapeFlips say, per shape id, whether quarter turns and turning upside down change
// the shape (crates/world/src/shape.rs, SHAPES: turns, flips). Normalizing drops the parts that
// do not, as Cube::shaped does.
var (
	shapeTurns = [ShapeCount]bool{
		false, false, true, true, true, false, true, true, true, // full to window
		true, true, true, true, true, true, false, // wall to wall_middle_cross
		true, true, true, true, true, false, // wall_half to floor_slab
		true, true, true, true, true, true, true, // wall_diagonal to wall_diagonal_outer_mirrored
		true, true, true, true, true, true, // wall_shallow_near to wall_shallow_post_mirrored
		true, true, true, // thin_stairs to corner_stairs_mirrored
		true, true, true, false, false, true, // wall_round_outer to wall_octagon_window
		true, true, true, true, true, // slope_steep_low to roof_steep_high_thin
		true, true, true, true, true, true, // slope_outer to ridge_steep
		true, true, true, true, true, true, // gable to gable_steep_high_mirrored
		false, false, true, true, true, // spire_pyramid to wall_arch_pointed
	}
	shapeFlips = [ShapeCount]bool{
		false, true, true, true, true, false, false, true, false, // full to window
		false, false, false, false, false, false, false, // wall to wall_middle_cross
		true, true, true, false, false, true, // wall_half to floor_slab
		false, true, false, false, false, false, false, // wall_diagonal to wall_diagonal_outer_mirrored
		false, false, false, false, false, false, // wall_shallow_near to wall_shallow_post_mirrored
		true, true, true, // thin_stairs to corner_stairs_mirrored
		false, false, true, false, false, false, // wall_round_outer to wall_octagon_window
		true, true, true, true, true, // slope_steep_low to roof_steep_high_thin
		true, true, true, true, true, true, // slope_outer to ridge_steep
		true, true, true, true, true, true, // gable to gable_steep_high_mirrored
		true, true, true, true, true, // spire_pyramid to wall_arch_pointed
	}
)

// kindTexture is each kind's own texture id (crates/world/src/cube.rs, KINDS: texture): a face
// painted with it is not painted.
var kindTexture = [KindCount]uint16{0, 2, 4, 7, 5, 8, 9, 10}

// World is a cube world as stored: its bounds in chunks, where a player starts (nil when the world
// does not say), where its monsters spawn, where its NPCs stand and walk, its props, its mood regions, its groups of joined
// cubes, its objects and its chunks that are not all empty; and the optional records it does not
// know (Kept), so a world saved again loses nothing.
type World struct {
	ChunksX  uint32
	ChunksZ  uint32
	Spawn    *CubePos
	Monsters []MonsterSpawn
	Npcs     []Npc
	Props    []Prop
	Moods    []MoodRegion
	Hints    []TextureHint
	Images   []TextureImage
	Joins    []Join
	Objects  []Object
	Chunks   []Chunk
	// Kept is the optional top-level records whose tags this package does not know (#147), in file
	// order, as read: Read keeps them and Write writes them back unchanged right after MOODS.
	Kept []Record
}

// Record is a top-level record kept as raw bytes: its tag, its flags and its body.
type Record struct {
	Tag   uint16
	Flags uint16
	Body  []byte
}

// knownTag says whether tag is a top-level record this package reads itself.
func knownTag(tag uint16) bool {
	return tag <= TagTextureImages
}

// TextureImage is a picture for a texture id the game does not have yet, a PNG, as a Tibia map's item
// sprite (3dgame #224): the editor draws a face painted with the id with it. An id has at most one, and
// a picture is at most 1 MiB.
type TextureImage struct {
	ID  uint16
	PNG []byte
}

// TextureHint is a name and a colour (0xRRGGBB, sRGB) for a texture id the game does not have yet, as
// a world imported from a Tibia map gives each item id it paints (3dgame #218): the editor draws a face
// painted with the id in the colour and names it in Edit > Textures in This World. The name is UTF-8 of
// at most 65535 bytes; an id is hinted at most once.
type TextureHint struct {
	ID     uint16
	Colour uint32
	Name   string
}

// MoodRegion is a place with a mood of its own (crates/world MoodRegion, #143): the box of cubes
// from Min to Max, both held, Min no further than Max along x, z or the layer (the top layer is the
// least), both inside the world, and its mood's name (the game's moods,
// crates/gameplay/moods.toml; the file does not check it), UTF-8 of at most 65535 bytes.
type MoodRegion struct {
	Mood     string
	Min, Max CubePos
}

// Prop is a model standing in the world (crates/world Prop): its model's name (its path under the
// repository's assets/models without .glb, "nature/pine_1"; the file does not check it), UTF-8 of
// at most 65535 bytes, where its origin stands in metres (y 0 at the ground layer's bottom), its
// turn in radians about the vertical (counter-clockwise seen from above) and its scale, above 0.
// Every number is finite.
type Prop struct {
	Model   string
	X, Y, Z float32
	Turn    float32
	Scale   float32
}

// MonsterSpawn is where a monster spawns: its kind's name (the game's monster kinds,
// crates/gameplay/monsters.toml; the file does not check it), UTF-8 of at most 65535 bytes, and the
// cube it stands in.
type MonsterSpawn struct {
	Kind string
	Pos  CubePos
}

// Npc is where an NPC stands and walks: its name (the game's NPCs, crates/gameplay/npcs.toml; the
// file does not check it), UTF-8 of at most 65535 bytes, the cube it starts in and the cubes it
// walks to in turn (none when it stands).
type Npc struct {
	Name  string
	Pos   CubePos
	Route []CubePos
}

// Join is a group of cubes that act as one object (a wall): its id, unique in the world, and two
// cubes or more. A cube is in at most one group.
type Join struct {
	ID    uint32
	Cubes []CubePos
}

// Object is an object attached to a cube's face for a player to use: its id, unique in the world;
// its kind (0 door, 1 window, 2 lever, 3 button, 4 teleporter, 5 torch); the face (0 north, 1 east, 2 south, 3 west, 4 up,
// 5 down) of the cube at Pos it is on; the ids of the objects it acts on; its state (0 off or
// closed, 1 on or open), which the file keeps in a record of its own; and, for a torch, the colour
// its fire burns (FireColour: 0 orange, 1 green, 2 blue, 3 purple; 0 for the other kinds).
type Object struct {
	ID      uint32
	Kind    uint8
	Face    uint8
	Pos     CubePos
	Targets []uint32
	State   uint8
	Colour  uint8
}

// CubePos is a cube's position: x and z in cubes from the world's corner, and its layer.
type CubePos struct {
	X, Z  int32
	Layer uint8
}

// inside says whether p lies in a world of chunksX by chunksZ chunks.
func (p CubePos) inside(chunksX, chunksZ uint32) bool {
	return p.X >= 0 && p.Z >= 0 && int64(p.X) < int64(chunksX)*ChunkSize && int64(p.Z) < int64(chunksZ)*ChunkSize && p.Layer <= BottomLayer
}

// Chunk is one stored chunk: where it is, its cubes as planes (PlanesLen bytes), the textures
// painted on their faces as planes (PaintLen ids), nil when none is, and the edges of their
// faces that blend as planes (BlendLen bytes), nil when none does.
type Chunk struct {
	CX, CZ int32
	Layer  uint8
	Cubes  []byte
	Paint  []uint16
	Blend  []byte
	// Overlay is the texture over each cube's top face (OverlayLen ids), nil when none has one
	// (3dgame #226).
	Overlay []uint16
}

// ErrNotAWorld is returned for a file that does not start with Magic.
var ErrNotAWorld = errors.New("not a world file")

// ErrTruncated is returned for a file that ends before its END record.
var ErrTruncated = errors.New("the world file is cut short")

// Normalize returns the cube (kind, shape, rotation) as Cube::shaped keeps it: an empty cube has
// the full shape and no rotation, and the parts of the rotation that do not change the shape are
// dropped. The ids must be known.
func Normalize(kind, shape, rotation byte) (byte, byte, byte) {
	if kind == 0 {
		return 0, 0, 0
	}
	var r byte
	if shapeTurns[shape] {
		r |= rotation & 3
	}
	if shapeFlips[shape] {
		r |= rotation & 4
	}
	return kind, shape, r
}

// normalizePaint clears, in place, the paint of empty cubes and of faces painted with their cube's
// own texture, as Cube::painted does, and returns paint, or nil when nothing is left painted. The
// ids must be known, and cubes normalized planes.
func normalizePaint(cubes []byte, paint []uint16) []uint16 {
	if paint == nil {
		return nil
	}
	painted := false
	for f := range FaceCount {
		for i := range ChunkArea {
			p := &paint[f*ChunkArea+i]
			if k := cubes[i]; k == 0 || *p == kindTexture[k] {
				*p = 0
			}
			painted = painted || *p != 0
		}
	}
	if !painted {
		return nil
	}
	return paint
}

// normalizeBlend clears, in place, the blend of empty cubes, as Cube::blended does, and returns
// blend, or nil when nothing is left blending. cubes must be normalized planes.
func normalizeBlend(cubes, blend []byte) []byte {
	if blend == nil {
		return nil
	}
	blends := false
	for f := range FaceCount {
		for i := range ChunkArea {
			b := &blend[f*ChunkArea+i]
			if cubes[i] == 0 {
				*b = 0
			}
			blends = blends || *b != 0
		}
	}
	if !blends {
		return nil
	}
	return blend
}

// checkBlend refuses a blend with a bit that is no edge of its face: the face's own, its
// opposite's (faces pair up as 0-2, 1-3 and 4-5), or one past the six faces.
func checkBlend(blend []byte) error {
	for i, b := range blend {
		f := i / ChunkArea
		if b&^0x3f != 0 || b&(1<<f) != 0 || b&(1<<oppositeFace(f)) != 0 {
			return fmt.Errorf("a blend of no edge %#x on face %d", b, f)
		}
	}
	return nil
}

// oppositeFace is the face on the other side of the cube from face f (Face::opposite).
func oppositeFace(f int) int {
	if f >= 4 {
		return 9 - f
	}
	return (f + 2) % 4
}

func checkCube(kind, shape, rotation byte) error {
	if kind >= KindCount {
		return fmt.Errorf("unknown kind %d", kind)
	}
	if shape >= ShapeCount {
		return fmt.Errorf("unknown shape %d", shape)
	}
	if rotation >= RotationCount {
		return fmt.Errorf("unknown rotation %d", rotation)
	}
	return nil
}

// Load reads the world at path.
func Load(path string) (*World, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	w, err := Read(bufio.NewReaderSize(f, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", path, err)
	}
	return w, nil
}

// Save writes w to path, through a temporary file beside it, so a failed save leaves the old file
// whole.
func Save(path string, w *World) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("save %s: %w", path, err)
	}
	fail := func(err error) error {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("save %s: %w", path, err)
	}
	bw := bufio.NewWriterSize(f, 1<<20)
	if err := Write(bw, w); err != nil {
		return fail(err)
	}
	if err := bw.Flush(); err != nil {
		return fail(err)
	}
	if err := f.Sync(); err != nil {
		return fail(err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("save %s: %w", path, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("save %s: %w", path, err)
	}
	return nil
}

// Read reads a world. It stops at the END record, so r may go on after it.
func Read(r io.Reader) (*World, error) {
	var magic [8]byte
	if _, err := io.ReadFull(r, magic[:]); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, ErrNotAWorld
		}
		return nil, err
	}
	if string(magic[:]) != Magic {
		return nil, ErrNotAWorld
	}
	var version uint32
	if err := binary.Read(r, binary.LittleEndian, &version); err != nil {
		return nil, eof(err)
	}
	if version < 1 || version > Version {
		return nil, fmt.Errorf("world format version %d is not supported (this build reads 1 to %d)", version, Version)
	}

	var w *World
	type pos struct {
		cx, cz int32
		layer  uint8
	}
	seen := map[pos]bool{}
	var monstersSeen, npcsSeen, propsSeen, moodsSeen, hintsSeen, imagesSeen, joinsSeen, objectsSeen, statesSeen bool
	var kept []Record
	for {
		tag, flags, n, err := readHeader(r)
		if err != nil {
			return nil, err
		}
		switch tag {
		case TagEnd:
			if w == nil {
				return nil, invalid("no bounds record")
			}
			if err := checkJoinsAndObjects(w); err != nil {
				return nil, invalid(err.Error())
			}
			w.Kept = kept
			return w, nil
		case TagBounds:
			if w != nil {
				return nil, invalid("more than one bounds record")
			}
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if len(body) < 8 {
				return nil, ErrTruncated
			}
			w = &World{ChunksX: binary.LittleEndian.Uint32(body), ChunksZ: binary.LittleEndian.Uint32(body[4:])}
		case TagSpawn:
			if w == nil {
				return nil, invalid("the spawn point comes before the bounds")
			}
			if w.Spawn != nil {
				return nil, invalid("more than one spawn record")
			}
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if len(body) < 12 {
				return nil, invalid("a record ends before its contents do")
			}
			p := CubePos{X: int32(binary.LittleEndian.Uint32(body)), Z: int32(binary.LittleEndian.Uint32(body[4:])), Layer: body[8]}
			if p.Layer > BottomLayer {
				return nil, invalid(fmt.Sprintf("spawn layer %d does not exist", p.Layer))
			}
			if !p.inside(w.ChunksX, w.ChunksZ) {
				return nil, invalid(fmt.Sprintf("the spawn point (%d, %d, layer %d) is outside the world", p.X, p.Z, p.Layer))
			}
			w.Spawn = &p
		case TagMonsters:
			if w == nil {
				return nil, invalid("the monster spawn points come before the bounds")
			}
			if monstersSeen {
				return nil, invalid("more than one monsters record")
			}
			monstersSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Monsters, err = readMonsters(body); err != nil {
				return nil, err
			}
			if err := checkMonsters(w); err != nil {
				return nil, invalid(err.Error())
			}
		case TagNpcs:
			if w == nil {
				return nil, invalid("the NPCs come before the bounds")
			}
			if npcsSeen {
				return nil, invalid("more than one NPCs record")
			}
			npcsSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Npcs, err = readNpcs(body); err != nil {
				return nil, err
			}
			if err := checkNpcs(w); err != nil {
				return nil, invalid(err.Error())
			}
		case TagProps:
			if w == nil {
				return nil, invalid("the props come before the bounds")
			}
			if propsSeen {
				return nil, invalid("more than one props record")
			}
			propsSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Props, err = readProps(body); err != nil {
				return nil, err
			}
			if err := checkProps(w); err != nil {
				return nil, invalid(err.Error())
			}
		case TagMoods:
			if w == nil {
				return nil, invalid("the mood regions come before the bounds")
			}
			if moodsSeen {
				return nil, invalid("more than one moods record")
			}
			moodsSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Moods, err = readMoods(body); err != nil {
				return nil, err
			}
			if err := checkMoods(w); err != nil {
				return nil, invalid(err.Error())
			}
		case TagTextureHints:
			if w == nil {
				return nil, invalid("the texture hints come before the bounds")
			}
			if hintsSeen {
				return nil, invalid("more than one texture hints record")
			}
			hintsSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Hints, err = readHints(body); err != nil {
				return nil, err
			}
			if err := checkHints(w.Hints); err != nil {
				return nil, invalid(err.Error())
			}
		case TagTextureImages:
			if w == nil {
				return nil, invalid("the texture images come before the bounds")
			}
			if imagesSeen {
				return nil, invalid("more than one texture images record")
			}
			imagesSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Images, err = readImages(body); err != nil {
				return nil, err
			}
			if err := checkImages(w.Images); err != nil {
				return nil, invalid(err.Error())
			}
		case TagJoins:
			if w == nil {
				return nil, invalid("the joined cubes come before the bounds")
			}
			if joinsSeen {
				return nil, invalid("more than one joins record")
			}
			joinsSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Joins, err = readJoins(body); err != nil {
				return nil, err
			}
		case TagObjects:
			if w == nil {
				return nil, invalid("the objects come before the bounds")
			}
			if objectsSeen {
				return nil, invalid("more than one objects record")
			}
			objectsSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if w.Objects, err = readObjects(body); err != nil {
				return nil, err
			}
		case TagObjectState:
			if !objectsSeen {
				return nil, invalid("the object states come before the objects")
			}
			if statesSeen {
				return nil, invalid("more than one object state record")
			}
			statesSeen = true
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			if len(body) != len(w.Objects) {
				return nil, invalid(fmt.Sprintf("%d object states for %d objects", len(body), len(w.Objects)))
			}
			for i, s := range body {
				if s >= StateCount {
					return nil, invalid(fmt.Sprintf("unknown object state %d", s))
				}
				w.Objects[i].State = s
			}
		case TagChunk:
			if w == nil {
				return nil, invalid("a chunk comes before the bounds")
			}
			body, err := readBody(r, tag, n)
			if err != nil {
				return nil, err
			}
			c, err := ReadChunk(body)
			if err != nil {
				return nil, err
			}
			p := pos{c.CX, c.CZ, c.Layer}
			if seen[p] {
				return nil, invalid(fmt.Sprintf("chunk (%d, %d, layer %d) appears twice", c.CX, c.CZ, c.Layer))
			}
			seen[p] = true
			if c.CX < 0 || c.CZ < 0 || uint32(c.CX) >= w.ChunksX || uint32(c.CZ) >= w.ChunksZ {
				return nil, invalid(fmt.Sprintf("chunk (%d, %d, layer %d) is outside the world", c.CX, c.CZ, c.Layer))
			}
			w.Chunks = append(w.Chunks, c)
		default:
			if flags&FlagRequired != 0 {
				return nil, fmt.Errorf("the world file needs record %d, which this build does not know", tag)
			}
			if n <= maxRecordLen {
				body, err := readBody(r, tag, n)
				if err != nil {
					return nil, err
				}
				kept = append(kept, Record{Tag: tag, Flags: flags, Body: body})
				continue
			}
			skipped, err := io.CopyN(io.Discard, r, int64(n))
			if err != nil || skipped < int64(n) {
				return nil, ErrTruncated
			}
		}
	}
}

// body is a little-endian reader over a record's body; a read past its end sets short.
type body struct {
	b     []byte
	short bool
}

func (b *body) take(n int) []byte {
	if b.short || n > len(b.b) {
		b.short = true
		return make([]byte, n)
	}
	out := b.b[:n]
	b.b = b.b[n:]
	return out
}

func (b *body) u16() uint16 { return binary.LittleEndian.Uint16(b.take(2)) }

func (b *body) u32() uint32 { return binary.LittleEndian.Uint32(b.take(4)) }

func (b *body) f32() float32 { return math.Float32frombits(b.u32()) }

// pos reads a cube's position: i32 x, i32 z, u8 layer and three reserved bytes.
func (b *body) pos() CubePos {
	p := b.take(12)
	return CubePos{X: int32(binary.LittleEndian.Uint32(p)), Z: int32(binary.LittleEndian.Uint32(p[4:])), Layer: p[8]}
}

// end checks the record was read whole and to its end.
func (b *body) end(what string) error {
	if b.short {
		return invalid("a record ends before its contents do")
	}
	if len(b.b) > 0 {
		return invalid("bytes after the " + what)
	}
	return nil
}

// readMonsters reads a MONSTERS record's body: a u32 count, then per spawn point its cube's position,
// a u16 length and its kind's name, that many bytes of UTF-8.
func readMonsters(rec []byte) ([]MonsterSpawn, error) {
	b := &body{b: rec}
	var spawns []MonsterSpawn
	for n := b.u32(); n > 0 && !b.short; n-- {
		p := b.pos()
		name := b.take(int(b.u16()))
		spawns = append(spawns, MonsterSpawn{Kind: string(name), Pos: p})
	}
	return spawns, b.end("monster spawn points")
}

// checkMonsters refuses a monster spawn point outside the world, or whose kind's name is not UTF-8
// or too long for its u16 length.
func checkMonsters(w *World) error {
	for _, m := range w.Monsters {
		p := m.Pos
		if !p.inside(w.ChunksX, w.ChunksZ) {
			return fmt.Errorf("the monster spawn point (%d, %d, layer %d) is outside the world", p.X, p.Z, p.Layer)
		}
		if !utf8.ValidString(m.Kind) {
			return fmt.Errorf("the monster kind name at (%d, %d, layer %d) is not UTF-8", p.X, p.Z, p.Layer)
		}
		if len(m.Kind) > 0xffff {
			return fmt.Errorf("the monster kind name at (%d, %d, layer %d) is %d bytes long, more than 65535", p.X, p.Z, p.Layer, len(m.Kind))
		}
	}
	return nil
}

// readNpcs reads an NPCS record's body: a u32 count, then per NPC its cube's position, a u16 length
// and its name, that many bytes of UTF-8, then a u32 count and the positions of its route.
func readNpcs(rec []byte) ([]Npc, error) {
	b := &body{b: rec}
	var npcs []Npc
	for n := b.u32(); n > 0 && !b.short; n-- {
		npc := Npc{Pos: b.pos()}
		npc.Name = string(b.take(int(b.u16())))
		for k := b.u32(); k > 0 && !b.short; k-- {
			npc.Route = append(npc.Route, b.pos())
		}
		npcs = append(npcs, npc)
	}
	return npcs, b.end("NPCs")
}

// checkNpcs refuses an NPC standing or walking outside the world, or whose name is not UTF-8 or too
// long for its u16 length.
func checkNpcs(w *World) error {
	for _, npc := range w.Npcs {
		for _, p := range append([]CubePos{npc.Pos}, npc.Route...) {
			if !p.inside(w.ChunksX, w.ChunksZ) {
				return fmt.Errorf("the NPC %q stands or walks at (%d, %d, layer %d), outside the world", npc.Name, p.X, p.Z, p.Layer)
			}
		}
		p := npc.Pos
		if !utf8.ValidString(npc.Name) {
			return fmt.Errorf("the name of the NPC at (%d, %d, layer %d) is not UTF-8", p.X, p.Z, p.Layer)
		}
		if len(npc.Name) > 0xffff {
			return fmt.Errorf("the name of the NPC at (%d, %d, layer %d) is %d bytes long, more than 65535", p.X, p.Z, p.Layer, len(npc.Name))
		}
	}
	return nil
}

// readMoods reads a MOODS record's body: a u32 count, then per region the positions of its two
// corners, a u16 length and its mood's name, that many bytes of UTF-8 (crates/world format.rs
// read_moods).
func readMoods(rec []byte) ([]MoodRegion, error) {
	b := &body{b: rec}
	var regions []MoodRegion
	for n := b.u32(); n > 0 && !b.short; n-- {
		r := MoodRegion{Min: b.pos(), Max: b.pos()}
		r.Mood = string(b.take(int(b.u16())))
		regions = append(regions, r)
	}
	return regions, b.end("mood regions")
}

// readHints reads a TEXTURE_HINTS record's body: a u32 count, then per hint a u16 texture id, its
// colour as three bytes r, g, b, a u16 length and its name, that many bytes of UTF-8.
func readHints(rec []byte) ([]TextureHint, error) {
	b := &body{b: rec}
	var hints []TextureHint
	for n := b.u32(); n > 0 && !b.short; n-- {
		h := TextureHint{ID: b.u16()}
		if c := b.take(3); len(c) == 3 {
			h.Colour = uint32(c[0])<<16 | uint32(c[1])<<8 | uint32(c[2])
		}
		h.Name = string(b.take(int(b.u16())))
		hints = append(hints, h)
	}
	return hints, b.end("texture hints")
}

// checkHints refuses a texture id hinted twice, a colour past 24 bits or a name that is not UTF-8 or too
// long for its u16 length.
func checkHints(hints []TextureHint) error {
	seen := make(map[uint16]bool, len(hints))
	for _, h := range hints {
		if seen[h.ID] {
			return fmt.Errorf("texture %d is hinted twice", h.ID)
		}
		seen[h.ID] = true
		if h.Colour > 0xffffff {
			return fmt.Errorf("texture %d's colour %#x is more than 24 bits", h.ID, h.Colour)
		}
		if !utf8.ValidString(h.Name) {
			return fmt.Errorf("texture %d's name is not UTF-8", h.ID)
		}
		if len(h.Name) > 0xffff {
			return fmt.Errorf("texture %d's name is %d bytes long, more than 65535", h.ID, len(h.Name))
		}
	}
	return nil
}

// readImages reads a TEXTURE_IMAGES record's body: a u32 count, then per picture a u16 texture id, a
// u32 length and that many bytes of PNG.
func readImages(rec []byte) ([]TextureImage, error) {
	b := &body{b: rec}
	var images []TextureImage
	for n := b.u32(); n > 0 && !b.short; n-- {
		im := TextureImage{ID: b.u16()}
		im.PNG = append([]byte(nil), b.take(int(b.u32()))...)
		images = append(images, im)
	}
	return images, b.end("texture images")
}

// maxImageLen is the longest picture TEXTURE_IMAGES holds, 1 MiB.
const maxImageLen = 1 << 20

// checkImages refuses a texture id with two pictures, an empty picture or one over maxImageLen.
func checkImages(images []TextureImage) error {
	seen := make(map[uint16]bool, len(images))
	for _, im := range images {
		if seen[im.ID] {
			return fmt.Errorf("texture %d has two images", im.ID)
		}
		seen[im.ID] = true
		if len(im.PNG) == 0 || len(im.PNG) > maxImageLen {
			return fmt.Errorf("texture %d's image is %d bytes, not 1 to %d", im.ID, len(im.PNG), maxImageLen)
		}
	}
	return nil
}

// checkMoods refuses a mood region with a corner outside the world or its corners out of order, or
// whose mood's name is not UTF-8 or too long for its u16 length.
func checkMoods(w *World) error {
	for _, r := range w.Moods {
		a, b := r.Min, r.Max
		if !a.inside(w.ChunksX, w.ChunksZ) || !b.inside(w.ChunksX, w.ChunksZ) {
			return fmt.Errorf("the mood region %q from (%d, %d, layer %d) to (%d, %d, layer %d) is outside the world", r.Mood, a.X, a.Z, a.Layer, b.X, b.Z, b.Layer)
		}
		if a.X > b.X || a.Z > b.Z || a.Layer > b.Layer {
			return fmt.Errorf("the mood region %q from (%d, %d, layer %d) to (%d, %d, layer %d) has its corners out of order", r.Mood, a.X, a.Z, a.Layer, b.X, b.Z, b.Layer)
		}
		if !utf8.ValidString(r.Mood) {
			return fmt.Errorf("the mood name of the region at (%d, %d, layer %d) is not UTF-8", a.X, a.Z, a.Layer)
		}
		if len(r.Mood) > 0xffff {
			return fmt.Errorf("the mood name of the region at (%d, %d, layer %d) is %d bytes long, more than 65535", a.X, a.Z, a.Layer, len(r.Mood))
		}
	}
	return nil
}

// readProps reads a PROPS record's body: a u32 count, then per prop f32 x, y, z, turn and scale, a
// u16 length and its model's name, that many bytes of UTF-8 (crates/world format.rs read_props).
func readProps(rec []byte) ([]Prop, error) {
	b := &body{b: rec}
	var props []Prop
	for n := b.u32(); n > 0 && !b.short; n-- {
		var p Prop
		p.X, p.Y, p.Z, p.Turn, p.Scale = b.f32(), b.f32(), b.f32(), b.f32(), b.f32()
		p.Model = string(b.take(int(b.u16())))
		props = append(props, p)
	}
	return props, b.end("props")
}

// checkProps refuses a prop whose place, turn or scale is not finite or whose scale is not above
// 0, as the Rust reader does, or whose model's name is not UTF-8 or too long for its u16 length.
// A prop may stand anywhere: the game does not keep it inside the world.
func checkProps(w *World) error {
	for _, p := range w.Props {
		for _, v := range []float32{p.X, p.Y, p.Z, p.Turn, p.Scale} {
			if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				return fmt.Errorf("the prop %q at (%g, %g, %g) has a bad place, turn or scale", p.Model, p.X, p.Y, p.Z)
			}
		}
		if p.Scale <= 0 {
			return fmt.Errorf("the prop %q at (%g, %g, %g) has a bad place, turn or scale", p.Model, p.X, p.Y, p.Z)
		}
		if !utf8.ValidString(p.Model) {
			return fmt.Errorf("the model name of the prop at (%g, %g, %g) is not UTF-8", p.X, p.Y, p.Z)
		}
		if len(p.Model) > 0xffff {
			return fmt.Errorf("the model name of the prop at (%g, %g, %g) is %d bytes long, more than 65535", p.X, p.Y, p.Z, len(p.Model))
		}
	}
	return nil
}

// readJoins reads a JOINS record's body: a u32 count, then per group its u32 id, a u32 count and
// its cubes' positions. What they hold is checked at the end of the file (checkJoinsAndObjects).
func readJoins(rec []byte) ([]Join, error) {
	b := &body{b: rec}
	var joins []Join
	for n := b.u32(); n > 0 && !b.short; n-- {
		j := Join{ID: b.u32()}
		for k := b.u32(); k > 0 && !b.short; k-- {
			j.Cubes = append(j.Cubes, b.pos())
		}
		joins = append(joins, j)
	}
	return joins, b.end("joins")
}

// readObjects reads an OBJECTS record's body: a u32 count, then per object its u32 id, u8 kind, u8
// face, u8 fire colour, a reserved byte, its cube's position, a u32 count and the u32 ids it acts on.
func readObjects(rec []byte) ([]Object, error) {
	b := &body{b: rec}
	var objects []Object
	for n := b.u32(); n > 0 && !b.short; n-- {
		o := Object{ID: b.u32()}
		kf := b.take(4)
		o.Kind, o.Face, o.Colour = kf[0], kf[1], kf[2]
		o.Pos = b.pos()
		for k := b.u32(); k > 0 && !b.short; k-- {
			o.Targets = append(o.Targets, b.u32())
		}
		objects = append(objects, o)
	}
	return objects, b.end("objects")
}

// checkJoinsAndObjects refuses what the game refuses in w's groups and objects: a group of fewer
// than two cubes, a cube outside the world, twice in a group or in two groups, an id used twice, an
// unknown object kind, face, state or fire colour, and an object acting on itself, on one that does not exist
// or on one twice.
func checkJoinsAndObjects(w *World) error {
	joinIDs := map[uint32]bool{}
	joined := map[CubePos]uint32{}
	for _, j := range w.Joins {
		if joinIDs[j.ID] {
			return fmt.Errorf("two groups have the id %d", j.ID)
		}
		joinIDs[j.ID] = true
		for _, p := range j.Cubes {
			if !p.inside(w.ChunksX, w.ChunksZ) {
				return fmt.Errorf("group %d: the cube (%d, %d, layer %d) is outside the world", j.ID, p.X, p.Z, p.Layer)
			}
			if other, ok := joined[p]; ok {
				return fmt.Errorf("group %d: the cube (%d, %d, layer %d) is already in group %d", j.ID, p.X, p.Z, p.Layer, other)
			}
			joined[p] = j.ID
		}
		if len(j.Cubes) < 2 {
			return fmt.Errorf("group %d: a group of joined cubes needs two cubes or more", j.ID)
		}
	}
	objectIDs := map[uint32]bool{}
	for _, o := range w.Objects {
		if objectIDs[o.ID] {
			return fmt.Errorf("two objects have the id %d", o.ID)
		}
		objectIDs[o.ID] = true
	}
	for _, o := range w.Objects {
		if o.Kind >= ObjectKindCount {
			return fmt.Errorf("object %d: unknown object kind %d", o.ID, o.Kind)
		}
		if o.Face >= FaceCount {
			return fmt.Errorf("object %d: unknown face %d", o.ID, o.Face)
		}
		if o.State >= StateCount {
			return fmt.Errorf("object %d: unknown object state %d", o.ID, o.State)
		}
		if o.Colour >= FireColourCount {
			return fmt.Errorf("object %d: unknown fire colour %d", o.ID, o.Colour)
		}
		if !o.Pos.inside(w.ChunksX, w.ChunksZ) {
			return fmt.Errorf("object %d at (%d, %d, layer %d) is outside the world", o.ID, o.Pos.X, o.Pos.Z, o.Pos.Layer)
		}
		targets := map[uint32]bool{}
		for _, t := range o.Targets {
			switch {
			case t == o.ID:
				return fmt.Errorf("object %d acts on itself", o.ID)
			case !objectIDs[t]:
				return fmt.Errorf("object %d acts on object %d, which does not exist", o.ID, t)
			case targets[t]:
				return fmt.Errorf("object %d names object %d twice among what it acts on", o.ID, t)
			}
			targets[t] = true
		}
	}
	return nil
}

// ReadChunk reads a CHUNK record's body. It does not check the chunk lies inside a world's bounds.
func ReadChunk(body []byte) (Chunk, error) {
	if len(body) < 12 {
		return Chunk{}, ErrTruncated
	}
	c := Chunk{
		CX:    int32(binary.LittleEndian.Uint32(body)),
		CZ:    int32(binary.LittleEndian.Uint32(body[4:])),
		Layer: body[8],
	}
	if c.Layer > BottomLayer {
		return Chunk{}, invalid(fmt.Sprintf("layer %d does not exist", c.Layer))
	}
	where := func(why string) error {
		return invalid(fmt.Sprintf("chunk (%d, %d, layer %d): %s", c.CX, c.CZ, c.Layer, why))
	}
	rest := body[12:]
	for len(rest) > 0 {
		if len(rest) < 8 {
			return Chunk{}, ErrTruncated
		}
		tag := binary.LittleEndian.Uint16(rest)
		flags := binary.LittleEndian.Uint16(rest[2:])
		n := binary.LittleEndian.Uint32(rest[4:])
		rest = rest[8:]
		if uint64(n) > uint64(len(rest)) {
			return Chunk{}, ErrTruncated
		}
		rec := rest[:n]
		rest = rest[n:]
		switch {
		case tag == ChunkTagCubes:
			if c.Cubes != nil {
				return Chunk{}, where("two cubes records")
			}
			cubes, err := readCubes(rec)
			if err != nil {
				return Chunk{}, where(err.Error())
			}
			c.Cubes = cubes
		case tag == ChunkTagPaint:
			if c.Paint != nil {
				return Chunk{}, where("two paint records")
			}
			// A texture id past TextureCount is kept as it is (3dgame #215): the frontend draws it as
			// the missing texture, and saving writes it back.
			paint, err := readPaint(rec)
			if err != nil {
				return Chunk{}, where(err.Error())
			}
			c.Paint = paint
		case tag == ChunkTagBlend:
			if c.Blend != nil {
				return Chunk{}, where("two blend records")
			}
			blend, err := readFacePlanes(rec, "blend")
			if err == nil {
				err = checkBlend(blend)
			}
			if err != nil {
				return Chunk{}, where(err.Error())
			}
			c.Blend = blend
		case tag == ChunkTagOverlay:
			if c.Overlay != nil {
				return Chunk{}, where("two overlay records")
			}
			overlay, err := readOverlay(rec)
			if err != nil {
				return Chunk{}, where(err.Error())
			}
			c.Overlay = overlay
		case flags&FlagRequired != 0:
			return Chunk{}, fmt.Errorf("the world file needs record %d, which this build does not know", tag)
		}
	}
	if c.Cubes == nil {
		return Chunk{}, where("no cubes record")
	}
	c.Paint = normalizePaint(c.Cubes, c.Paint)
	c.Blend = normalizeBlend(c.Cubes, c.Blend)
	c.Overlay = normalizeOverlay(c.Cubes, c.Overlay)
	return c, nil
}

// readOverlay reads an OVERLAY record: its encoding byte, 1 (zlib), then a zlib stream of the 256 ids,
// two bytes each, little-endian.
func readOverlay(rec []byte) ([]uint16, error) {
	if len(rec) == 0 {
		return nil, ErrTruncated
	}
	if rec[0] != EncodingZlibPlanes {
		return nil, fmt.Errorf("unknown overlay encoding %d", rec[0])
	}
	zr, err := zlib.NewReader(bytes.NewReader(rec[1:]))
	if err != nil {
		return nil, fmt.Errorf("the overlay does not decompress: %v", err)
	}
	buf := make([]byte, 2*OverlayLen+1)
	got, err := io.ReadFull(zr, buf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, fmt.Errorf("the overlay does not decompress: %v", err)
	}
	if got != 2*OverlayLen {
		return nil, fmt.Errorf("the overlay decompresses to %d bytes or more, not %d", got, 2*OverlayLen)
	}
	overlay := make([]uint16, OverlayLen)
	for i := range overlay {
		overlay[i] = binary.LittleEndian.Uint16(buf[2*i:])
	}
	return overlay, nil
}

// normalizeOverlay clears, in place, the overlay of empty cubes, and returns overlay, or nil when none
// is left.
func normalizeOverlay(cubes []byte, overlay []uint16) []uint16 {
	has := false
	for i := range overlay {
		if cubes[i] == 0 {
			overlay[i] = 0
		}
		has = has || overlay[i] != 0
	}
	if !has {
		return nil
	}
	return overlay
}

// readFacePlanes reads a PAINT or BLEND record (what it is, for errors) to its planes, a byte per
// cube for each face: uniform (every cube's six faces alike) or zlib planes. It does not check the
// bytes.
func readFacePlanes(rec []byte, what string) ([]byte, error) {
	if len(rec) == 0 {
		return nil, ErrTruncated
	}
	// One byte past the planes, to tell a zlib stream that inflates to too much.
	buf := make([]byte, PaintLen+1)
	planes := buf[:PaintLen]
	switch rec[0] {
	case EncodingUniform:
		if len(rec) < 1+FaceCount {
			return nil, ErrTruncated
		}
		if len(rec) > 1+FaceCount {
			return nil, fmt.Errorf("bytes after a uniform %s", what)
		}
		for f := range FaceCount {
			for i := range ChunkArea {
				planes[f*ChunkArea+i] = rec[1+f]
			}
		}
	case EncodingZlibPlanes:
		zr, err := zlib.NewReader(bytes.NewReader(rec[1:]))
		if err != nil {
			return nil, fmt.Errorf("the %s does not decompress: %v", what, err)
		}
		got, err := io.ReadFull(zr, buf)
		if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, fmt.Errorf("the %s does not decompress: %v", what, err)
		}
		if got != PaintLen {
			return nil, fmt.Errorf("the %s decompresses to %d bytes or more, not %d", what, got, PaintLen)
		}
		if err := zr.Close(); err != nil {
			return nil, fmt.Errorf("the %s does not decompress: %v", what, err)
		}
	default:
		return nil, fmt.Errorf("unknown %s encoding %d", what, rec[0])
	}
	return planes, nil
}

// readPaint reads a PAINT record to its planes, an id per cube for each face: the byte encodings
// (readFacePlanes) or the wide ones, two bytes an id. It does not check the ids.
func readPaint(rec []byte) ([]uint16, error) {
	if len(rec) == 0 {
		return nil, ErrTruncated
	}
	paint := make([]uint16, PaintLen)
	switch rec[0] {
	case EncodingUniform, EncodingZlibPlanes:
		planes, err := readFacePlanes(rec, "paint")
		if err != nil {
			return nil, err
		}
		for i, t := range planes {
			paint[i] = uint16(t)
		}
	case EncodingUniformWide:
		if len(rec) < 1+2*FaceCount {
			return nil, ErrTruncated
		}
		if len(rec) > 1+2*FaceCount {
			return nil, errors.New("bytes after a uniform paint")
		}
		for f := range FaceCount {
			t := binary.LittleEndian.Uint16(rec[1+2*f:])
			for i := range ChunkArea {
				paint[f*ChunkArea+i] = t
			}
		}
	case EncodingZlibPlanesWide:
		zr, err := zlib.NewReader(bytes.NewReader(rec[1:]))
		if err != nil {
			return nil, fmt.Errorf("the paint does not decompress: %v", err)
		}
		// One byte past the planes, to tell a zlib stream that inflates to too much.
		buf := make([]byte, 2*PaintLen+1)
		got, err := io.ReadFull(zr, buf)
		if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, fmt.Errorf("the paint does not decompress: %v", err)
		}
		if got != 2*PaintLen {
			return nil, fmt.Errorf("the paint decompresses to %d bytes or more, not %d", got, 2*PaintLen)
		}
		if err := zr.Close(); err != nil {
			return nil, fmt.Errorf("the paint does not decompress: %v", err)
		}
		for i := range paint {
			paint[i] = binary.LittleEndian.Uint16(buf[2*i:])
		}
	default:
		return nil, fmt.Errorf("unknown paint encoding %d", rec[0])
	}
	return paint, nil
}

func readCubes(rec []byte) ([]byte, error) {
	if len(rec) == 0 {
		return nil, ErrTruncated
	}
	// One byte past the planes, to tell a zlib stream that inflates to too much.
	buf := make([]byte, PlanesLen+1)
	planes := buf[:PlanesLen]
	switch rec[0] {
	case EncodingUniform:
		if len(rec) < 4 {
			return nil, ErrTruncated
		}
		if len(rec) > 4 {
			return nil, errors.New("bytes after a uniform cube")
		}
		if err := checkCube(rec[1], rec[2], rec[3]); err != nil {
			return nil, err
		}
		k, s, r := Normalize(rec[1], rec[2], rec[3])
		for i := range ChunkArea {
			planes[i], planes[ChunkArea+i], planes[2*ChunkArea+i] = k, s, r
		}
	case EncodingZlibPlanes:
		zr, err := zlib.NewReader(bytes.NewReader(rec[1:]))
		if err != nil {
			return nil, fmt.Errorf("the cubes do not decompress: %v", err)
		}
		got, err := io.ReadFull(zr, buf)
		if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, fmt.Errorf("the cubes do not decompress: %v", err)
		}
		if got != PlanesLen {
			return nil, fmt.Errorf("the cubes decompress to %d bytes or more, not %d", got, PlanesLen)
		}
		if err := zr.Close(); err != nil {
			return nil, fmt.Errorf("the cubes do not decompress: %v", err)
		}
		for i := range ChunkArea {
			k, s, r := planes[i], planes[ChunkArea+i], planes[2*ChunkArea+i]
			if err := checkCube(k, s, r); err != nil {
				return nil, err
			}
			planes[i], planes[ChunkArea+i], planes[2*ChunkArea+i] = Normalize(k, s, r)
		}
	default:
		return nil, fmt.Errorf("unknown cube encoding %d", rec[0])
	}
	return planes, nil
}

// Write writes w in the world format. Chunks go out in order of layer, then cz, then cx; chunks
// that are all empty are left out, and cubes are normalized. It refuses a chunk with unknown ids,
// outside the bounds or given twice, and a spawn point, a monster's or an NPC's outside the bounds,
// so it never writes a file the game would refuse. Monster spawn points and NPCs keep their order.
// Props and mood regions keep their order too. The kept records go out unchanged after MOODS; one with a known tag or the required flag is
// refused.
func Write(out io.Writer, w *World) error {
	for _, k := range w.Kept {
		if knownTag(k.Tag) || k.Flags&FlagRequired != 0 {
			return fmt.Errorf("record %d (flags %d) cannot be kept: only optional records of unknown tags are", k.Tag, k.Flags)
		}
		if len(k.Body) > maxRecordLen {
			return fmt.Errorf("record %d is %d bytes long, more than %d", k.Tag, len(k.Body), maxRecordLen)
		}
	}
	if s := w.Spawn; s != nil && !s.inside(w.ChunksX, w.ChunksZ) {
		return fmt.Errorf("the spawn point (%d, %d, layer %d) is outside the world", s.X, s.Z, s.Layer)
	}
	if err := checkMonsters(w); err != nil {
		return err
	}
	if err := checkNpcs(w); err != nil {
		return err
	}
	if err := checkProps(w); err != nil {
		return err
	}
	if err := checkMoods(w); err != nil {
		return err
	}
	if err := checkHints(w.Hints); err != nil {
		return err
	}
	if err := checkImages(w.Images); err != nil {
		return err
	}
	if err := checkJoinsAndObjects(w); err != nil {
		return err
	}
	type pos struct {
		cx, cz int32
		layer  uint8
	}
	chunks := make([]Chunk, 0, len(w.Chunks))
	seen := map[pos]bool{}
	for _, c := range w.Chunks {
		if len(c.Cubes) != PlanesLen {
			return fmt.Errorf("chunk (%d, %d, layer %d) has %d bytes of cubes, not %d", c.CX, c.CZ, c.Layer, len(c.Cubes), PlanesLen)
		}
		if c.Layer > BottomLayer || c.CX < 0 || c.CZ < 0 || uint32(c.CX) >= w.ChunksX || uint32(c.CZ) >= w.ChunksZ {
			return fmt.Errorf("chunk (%d, %d, layer %d) is outside the world", c.CX, c.CZ, c.Layer)
		}
		p := pos{c.CX, c.CZ, c.Layer}
		if seen[p] {
			return fmt.Errorf("chunk (%d, %d, layer %d) is given twice", c.CX, c.CZ, c.Layer)
		}
		seen[p] = true
		if c.Paint != nil && len(c.Paint) != PaintLen {
			return fmt.Errorf("chunk (%d, %d, layer %d) has %d ids of paint, not %d", c.CX, c.CZ, c.Layer, len(c.Paint), PaintLen)
		}
		if c.Overlay != nil && len(c.Overlay) != OverlayLen {
			return fmt.Errorf("chunk (%d, %d, layer %d) has %d overlay ids, not %d", c.CX, c.CZ, c.Layer, len(c.Overlay), OverlayLen)
		}
		if c.Blend != nil && len(c.Blend) != BlendLen {
			return fmt.Errorf("chunk (%d, %d, layer %d) has %d bytes of blend, not %d", c.CX, c.CZ, c.Layer, len(c.Blend), BlendLen)
		}
		if err := checkBlend(c.Blend); err != nil {
			return fmt.Errorf("chunk (%d, %d, layer %d): %v", c.CX, c.CZ, c.Layer, err)
		}
		planes := make([]byte, PlanesLen)
		empty := true
		for i := range ChunkArea {
			k, s, r := c.Cubes[i], c.Cubes[ChunkArea+i], c.Cubes[2*ChunkArea+i]
			if err := checkCube(k, s, r); err != nil {
				return fmt.Errorf("chunk (%d, %d, layer %d): %v", c.CX, c.CZ, c.Layer, err)
			}
			k, s, r = Normalize(k, s, r)
			planes[i], planes[ChunkArea+i], planes[2*ChunkArea+i] = k, s, r
			empty = empty && k == 0
		}
		if !empty {
			var paint, overlay []uint16
			var blend []byte
			if c.Paint != nil {
				paint = normalizePaint(planes, append([]uint16(nil), c.Paint...))
			}
			if c.Blend != nil {
				blend = normalizeBlend(planes, append([]byte(nil), c.Blend...))
			}
			if c.Overlay != nil {
				overlay = normalizeOverlay(planes, append([]uint16(nil), c.Overlay...))
			}
			chunks = append(chunks, Chunk{CX: c.CX, CZ: c.CZ, Layer: c.Layer, Cubes: planes, Paint: paint, Blend: blend, Overlay: overlay})
		}
	}
	sort.Slice(chunks, func(i, j int) bool {
		a, b := chunks[i], chunks[j]
		if a.Layer != b.Layer {
			return a.Layer < b.Layer
		}
		if a.CZ != b.CZ {
			return a.CZ < b.CZ
		}
		return a.CX < b.CX
	})

	var head [12]byte
	copy(head[:], Magic)
	binary.LittleEndian.PutUint32(head[8:], Version)
	if _, err := out.Write(head[:]); err != nil {
		return err
	}
	var bounds [8]byte
	binary.LittleEndian.PutUint32(bounds[:], w.ChunksX)
	binary.LittleEndian.PutUint32(bounds[4:], w.ChunksZ)
	if err := writeRecord(out, TagBounds, FlagRequired, bounds[:]); err != nil {
		return err
	}
	if s := w.Spawn; s != nil {
		var spawn [12]byte
		binary.LittleEndian.PutUint32(spawn[:], uint32(s.X))
		binary.LittleEndian.PutUint32(spawn[4:], uint32(s.Z))
		spawn[8] = s.Layer
		if err := writeRecord(out, TagSpawn, 0, spawn[:]); err != nil {
			return err
		}
	}
	if len(w.Monsters) > 0 {
		var b bytes.Buffer
		putU32(&b, uint32(len(w.Monsters)))
		for _, m := range w.Monsters {
			putPos(&b, m.Pos)
			b.Write(binary.LittleEndian.AppendUint16(nil, uint16(len(m.Kind))))
			b.WriteString(m.Kind)
		}
		if err := writeRecord(out, TagMonsters, 0, b.Bytes()); err != nil {
			return err
		}
	}
	if len(w.Npcs) > 0 {
		var b bytes.Buffer
		putU32(&b, uint32(len(w.Npcs)))
		for _, npc := range w.Npcs {
			putPos(&b, npc.Pos)
			b.Write(binary.LittleEndian.AppendUint16(nil, uint16(len(npc.Name))))
			b.WriteString(npc.Name)
			putU32(&b, uint32(len(npc.Route)))
			for _, p := range npc.Route {
				putPos(&b, p)
			}
		}
		if err := writeRecord(out, TagNpcs, 0, b.Bytes()); err != nil {
			return err
		}
	}
	if len(w.Props) > 0 {
		var b bytes.Buffer
		putU32(&b, uint32(len(w.Props)))
		for _, p := range w.Props {
			for _, v := range []float32{p.X, p.Y, p.Z, p.Turn, p.Scale} {
				putU32(&b, math.Float32bits(v))
			}
			b.Write(binary.LittleEndian.AppendUint16(nil, uint16(len(p.Model))))
			b.WriteString(p.Model)
		}
		if err := writeRecord(out, TagProps, 0, b.Bytes()); err != nil {
			return err
		}
	}
	if len(w.Moods) > 0 {
		var b bytes.Buffer
		putU32(&b, uint32(len(w.Moods)))
		for _, r := range w.Moods {
			putPos(&b, r.Min)
			putPos(&b, r.Max)
			b.Write(binary.LittleEndian.AppendUint16(nil, uint16(len(r.Mood))))
			b.WriteString(r.Mood)
		}
		if err := writeRecord(out, TagMoods, 0, b.Bytes()); err != nil {
			return err
		}
	}
	if len(w.Hints) > 0 {
		var b bytes.Buffer
		putU32(&b, uint32(len(w.Hints)))
		for _, h := range w.Hints {
			b.Write(binary.LittleEndian.AppendUint16(nil, h.ID))
			b.Write([]byte{byte(h.Colour >> 16), byte(h.Colour >> 8), byte(h.Colour)})
			b.Write(binary.LittleEndian.AppendUint16(nil, uint16(len(h.Name))))
			b.WriteString(h.Name)
		}
		if err := writeRecord(out, TagTextureHints, 0, b.Bytes()); err != nil {
			return err
		}
	}
	if len(w.Images) > 0 {
		var b bytes.Buffer
		putU32(&b, uint32(len(w.Images)))
		for _, im := range w.Images {
			b.Write(binary.LittleEndian.AppendUint16(nil, im.ID))
			putU32(&b, uint32(len(im.PNG)))
			b.Write(im.PNG)
		}
		if err := writeRecord(out, TagTextureImages, 0, b.Bytes()); err != nil {
			return err
		}
	}
	for _, k := range w.Kept {
		if err := writeRecord(out, k.Tag, k.Flags, k.Body); err != nil {
			return err
		}
	}
	if len(w.Joins) > 0 {
		joins := append([]Join(nil), w.Joins...)
		sort.Slice(joins, func(i, j int) bool { return joins[i].ID < joins[j].ID })
		var b bytes.Buffer
		putU32(&b, uint32(len(joins)))
		for _, j := range joins {
			cubes := append([]CubePos(nil), j.Cubes...)
			sort.Slice(cubes, func(i, k int) bool {
				a, c := cubes[i], cubes[k]
				if a.Layer != c.Layer {
					return a.Layer < c.Layer
				}
				if a.Z != c.Z {
					return a.Z < c.Z
				}
				return a.X < c.X
			})
			putU32(&b, j.ID)
			putU32(&b, uint32(len(cubes)))
			for _, p := range cubes {
				putPos(&b, p)
			}
		}
		if err := writeRecord(out, TagJoins, FlagRequired, b.Bytes()); err != nil {
			return err
		}
	}
	if len(w.Objects) > 0 {
		objects := append([]Object(nil), w.Objects...)
		sort.Slice(objects, func(i, j int) bool { return objects[i].ID < objects[j].ID })
		var b bytes.Buffer
		putU32(&b, uint32(len(objects)))
		states := make([]byte, len(objects))
		for i, o := range objects {
			putU32(&b, o.ID)
			b.Write([]byte{o.Kind, o.Face, o.Colour, 0})
			putPos(&b, o.Pos)
			putU32(&b, uint32(len(o.Targets)))
			for _, t := range o.Targets {
				putU32(&b, t)
			}
			states[i] = o.State
		}
		if err := writeRecord(out, TagObjects, FlagRequired, b.Bytes()); err != nil {
			return err
		}
		if err := writeRecord(out, TagObjectState, FlagRequired, states); err != nil {
			return err
		}
	}
	for _, c := range chunks {
		body, err := ChunkBody(c)
		if err != nil {
			return err
		}
		if err := writeRecord(out, TagChunk, FlagRequired, body); err != nil {
			return err
		}
	}
	return writeRecord(out, TagEnd, FlagRequired, nil)
}

// ChunkBody is a CHUNK record's body for c, whose cubes, paint and blend must be normalized planes:
// its position, then its CUBES record, uniform when every cube is the same leaving paint and blend
// aside, then its PAINT record when a cube is painted and its BLEND record when an edge blends,
// each uniform when every cube's is the same.
func ChunkBody(c Chunk) ([]byte, error) {
	var body bytes.Buffer
	var head [12]byte
	binary.LittleEndian.PutUint32(head[:], uint32(c.CX))
	binary.LittleEndian.PutUint32(head[4:], uint32(c.CZ))
	head[8] = c.Layer
	body.Write(head[:])

	k, s, r := c.Cubes[0], c.Cubes[ChunkArea], c.Cubes[2*ChunkArea]
	uniform := true
	for i := 1; i < ChunkArea && uniform; i++ {
		uniform = c.Cubes[i] == k && c.Cubes[ChunkArea+i] == s && c.Cubes[2*ChunkArea+i] == r
	}
	var cubes bytes.Buffer
	if uniform {
		cubes.Write([]byte{EncodingUniform, k, s, r})
	} else {
		cubes.WriteByte(EncodingZlibPlanes)
		zw, err := zlib.NewWriterLevel(&cubes, 6)
		if err != nil {
			return nil, err
		}
		if _, err := zw.Write(c.Cubes); err != nil {
			return nil, err
		}
		if err := zw.Close(); err != nil {
			return nil, err
		}
	}
	if err := writeRecord(&body, ChunkTagCubes, FlagRequired, cubes.Bytes()); err != nil {
		return nil, err
	}
	if c.Paint != nil {
		paint, err := paintBody(c.Paint)
		if err != nil {
			return nil, err
		}
		if err := writeRecord(&body, ChunkTagPaint, FlagRequired, paint); err != nil {
			return nil, err
		}
	}
	if c.Blend != nil {
		blend, err := facePlanesBody(c.Blend)
		if err != nil {
			return nil, err
		}
		if err := writeRecord(&body, ChunkTagBlend, FlagRequired, blend); err != nil {
			return nil, err
		}
	}
	if c.Overlay != nil {
		var b bytes.Buffer
		b.WriteByte(EncodingZlibPlanes)
		zw, err := zlib.NewWriterLevel(&b, 6)
		if err != nil {
			return nil, err
		}
		raw := make([]byte, 2*OverlayLen)
		for i, t := range c.Overlay {
			binary.LittleEndian.PutUint16(raw[2*i:], t)
		}
		if _, err := zw.Write(raw); err != nil {
			return nil, err
		}
		if err := zw.Close(); err != nil {
			return nil, err
		}
		if err := writeRecord(&body, ChunkTagOverlay, 0, b.Bytes()); err != nil {
			return nil, err
		}
	}
	return body.Bytes(), nil
}

// facePlanesBody is a PAINT or BLEND record's body for its planes (paint), a byte per cube for
// each face: uniform when every cube's six bytes are the same.
func facePlanesBody(paint []byte) ([]byte, error) {
	uniform := true
	for f := range FaceCount {
		face := paint[f*ChunkArea : (f+1)*ChunkArea]
		for _, t := range face {
			uniform = uniform && t == face[0]
		}
	}
	var b bytes.Buffer
	if uniform {
		b.WriteByte(EncodingUniform)
		for f := range FaceCount {
			b.WriteByte(paint[f*ChunkArea])
		}
		return b.Bytes(), nil
	}
	b.WriteByte(EncodingZlibPlanes)
	zw, err := zlib.NewWriterLevel(&b, 6)
	if err != nil {
		return nil, err
	}
	if _, err := zw.Write(paint); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// paintBody is a PAINT record's body for its planes: the byte encodings (facePlanesBody) when every id
// fits in a byte, so the game reads it as before, else the wide ones, uniform when every cube's six
// ids are the same.
func paintBody(paint []uint16) ([]byte, error) {
	wide := false
	for _, t := range paint {
		wide = wide || t > 0xff
	}
	if !wide {
		narrow := make([]byte, PaintLen)
		for i, t := range paint {
			narrow[i] = byte(t)
		}
		return facePlanesBody(narrow)
	}
	uniform := true
	for f := range FaceCount {
		face := paint[f*ChunkArea : (f+1)*ChunkArea]
		for _, t := range face {
			uniform = uniform && t == face[0]
		}
	}
	var b bytes.Buffer
	var x [2]byte
	if uniform {
		b.WriteByte(EncodingUniformWide)
		for f := range FaceCount {
			binary.LittleEndian.PutUint16(x[:], paint[f*ChunkArea])
			b.Write(x[:])
		}
		return b.Bytes(), nil
	}
	b.WriteByte(EncodingZlibPlanesWide)
	zw, err := zlib.NewWriterLevel(&b, 6)
	if err != nil {
		return nil, err
	}
	raw := make([]byte, 2*PaintLen)
	for i, t := range paint {
		binary.LittleEndian.PutUint16(raw[2*i:], t)
	}
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func putU32(b *bytes.Buffer, v uint32) {
	var x [4]byte
	binary.LittleEndian.PutUint32(x[:], v)
	b.Write(x[:])
}

// putPos writes a cube's position as body.pos reads it.
func putPos(b *bytes.Buffer, p CubePos) {
	putU32(b, uint32(p.X))
	putU32(b, uint32(p.Z))
	b.Write([]byte{p.Layer, 0, 0, 0})
}

// writeRecord writes one record with the given flags.
func writeRecord(out io.Writer, tag, flags uint16, body []byte) error {
	var head [8]byte
	binary.LittleEndian.PutUint16(head[:], tag)
	binary.LittleEndian.PutUint16(head[2:], flags)
	binary.LittleEndian.PutUint32(head[4:], uint32(len(body)))
	if _, err := out.Write(head[:]); err != nil {
		return err
	}
	_, err := out.Write(body)
	return err
}

func readHeader(r io.Reader) (tag, flags uint16, n uint32, err error) {
	var head [8]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return 0, 0, 0, eof(err)
	}
	return binary.LittleEndian.Uint16(head[:]), binary.LittleEndian.Uint16(head[2:]), binary.LittleEndian.Uint32(head[4:]), nil
}

func readBody(r io.Reader, tag uint16, n uint32) ([]byte, error) {
	if n > maxRecordLen {
		return nil, invalid(fmt.Sprintf("record %d is %d bytes long, more than %d", tag, n, maxRecordLen))
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, eof(err)
	}
	return body, nil
}

func eof(err error) error {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return ErrTruncated
	}
	return err
}

func invalid(why string) error {
	return fmt.Errorf("the world file is invalid: %s", why)
}
