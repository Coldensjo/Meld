package wow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strings"
)

// The 3.3.5a client's models (MD20 version 264, #1071) are read by rewriting them in the layout the
// 1.12 client's have, which every reader here takes as it is: ParseM2Look and its bones, texture
// animations, lights, particle emitters and ribbons, the collision hull, the texture references and
// the animation list. So nothing about how a 1.12 model is read changes.
//
// What version 264 moved, and LegacyM2 moves back:
//   - The views. The index and triangle lists, the submeshes and the batches of each level of
//     detail are in <Model>NN.skin files; the first, <Model>00.skin, becomes the model's one view.
//   - The animation tracks. A track holds one list of keys per sequence (M2Array<M2Array<T>>), timed
//     from the sequence's own start, where a 1.12 track holds one list for the whole model with a
//     window per sequence. The sequences are laid end to end on one timeline, as Benilla-WotLK's
//     benilla-m2 timeline.rs does (MIT/Apache-2.0), whose padding of each window this follows: the
//     client holds a sequence's first key before it and its last key after it, and a sequence with
//     no keys takes the channel's default.
//   - The keys of most sequences, which are in <Model><id>-<sub>.anim files (a sequence without flag
//     0x20). Only the files of the loop the model is read for are opened; the other sequences keep
//     no keys. An alias (flag 0x40) plays the keys of the sequence it leads to.
//   - The header, which lost the playable-animation lookup, the views' array (a count is left) and
//     the texture flipbooks, and the records that hold tracks, which shrank with them.
//   - A particle emitter's ramps over a particle's life, which are lists of keys (colour, opacity,
//     size, and the head's and tail's cells) where 1.12 has three values and a mid point: they are
//     sampled at the start, the middle key and the end.
//
// What is not carried over: cameras and events (nothing here reads them), tracks keyed with spline
// tangents outside cameras (the client has none on the channels read here), the second and later
// levels of detail, and an emitter's variance of life, rate, size and spin, which 1.12 does not have.

// m2Later is the MD20 version of the 3.3.5a client's models.
const m2Later = 264

// The version-264 header: its arrays' places, and its size without the texture combiner list.
const (
	h264Name        = 0x08
	h264Flags       = 0x10
	h264GlobalLoops = 0x14
	h264Sequences   = 0x1C
	h264SeqLookup   = 0x24
	h264Bones       = 0x2C
	h264KeyBones    = 0x34
	h264Vertices    = 0x3C
	h264Colors      = 0x48
	h264Textures    = 0x50
	h264Weights     = 0x58
	h264UVAnims     = 0x60
	h264ReplTex     = 0x68
	h264Materials   = 0x70
	h264BoneLookup  = 0x78
	h264TexLookup   = 0x80
	h264TexUnits    = 0x88
	h264WeightLook  = 0x90
	h264UVLookup    = 0x98
	h264Bounds      = 0xA0 // the two boxes and radii, 0x38 bytes
	h264HullTris    = 0xD8
	h264HullVerts   = 0xE0
	h264HullNormals = 0xE8
	h264Attachments = 0xF0
	h264AttachLook  = 0xF8
	h264Lights      = 0x108
	h264Ribbons     = 0x120
	h264Emitters    = 0x128
	h264Size        = 0x130

	seq264Size   = 64
	track264Size = 20
	// A sequence whose keys are in the model's own file; without it, in its .anim file.
	seqInFile = 0x20
	// A sequence that plays the keys of the one its aliasNext (+0x3E) leads to.
	seqAlias = 0x40
)

// M2Version is the MD20 version of a model file, or 0 when b is not one.
func M2Version(b []byte) int {
	if len(b) < 8 || string(b[:4]) != "MD20" {
		return 0
	}
	return int(binary.LittleEndian.Uint32(b[4:]))
}

// m2Stem is a model's path without its extension (.m2, or the .mdx and .mdl the tables name).
func m2Stem(path string) string {
	if i := strings.LastIndexByte(path, '.'); i >= 0 && !strings.ContainsAny(path[i:], `\/`) {
		return path[:i]
	}
	return path
}

// SkinPath is the file that holds the first view of the version-264 model at path.
func SkinPath(path string) string { return m2Stem(path) + "00.skin" }

// animPath is the file that holds the keys of a version-264 model's sequence id, variation sub.
func animPath(path string, id, sub int) string {
	return fmt.Sprintf("%s%04d-%02d.anim", m2Stem(path), id, sub)
}

// LegacyM2 returns the model b, read from path, in the layout the readers here take: b itself for
// a model of the 1.12 or the 2.4.3 client, and a version-264 model rewritten in the 1.12 layout,
// with its first view from its .skin file and the keys of the loop it is read for (the sequence of
// AnimationData ID animID, else Stand, else Closed, else its first: pickSequence) from their .anim
// files. read reads a file of the client by its archive path. A model without its .skin file is an
// error; a missing .anim file leaves its sequence without keys.
func LegacyM2(b []byte, path string, animID int, read func(string) ([]byte, error)) ([]byte, error) {
	if M2Version(b) != m2Later {
		return b, nil
	}
	skin, err := read(SkinPath(path))
	if err != nil {
		return nil, fmt.Errorf("m2: %s: %w", SkinPath(path), err)
	}
	c := &m2conv{src: b, skin: skin}
	if err := c.sequences(path, animID, read); err != nil {
		return nil, err
	}
	if err := c.convert(); err != nil {
		return nil, err
	}
	return c.out, nil
}

// m2band is one sequence's place on the timeline.
type m2band struct {
	start, length uint32
	// owner is the sequence whose keys this one plays (itself, or the end of its alias chain), and
	// keys the bytes that sequence's key lists index: the model's file or its .anim file. keys is
	// nil when those bytes are not at hand.
	owner int
	keys  []byte
}

// m2conv rewrites a version-264 model.
type m2conv struct {
	src, skin []byte
	out       []byte
	bands     []m2band
}

var errM2Truncated = errors.New("m2: truncated")

func le16(b []byte, o int) int { return int(binary.LittleEndian.Uint16(b[o:])) }
func le32(b []byte, o int) int { return int(binary.LittleEndian.Uint32(b[o:])) }

// arrOf is the M2Array at o of b: its count and offset, checked to hold count elements of stride
// bytes inside b. An empty array is (0, 0).
func arrOf(b []byte, o, stride int) (n, ofs int, err error) {
	if o < 0 || o+8 > len(b) {
		return 0, 0, errM2Truncated
	}
	n, ofs = le32(b, o), le32(b, o+4)
	if n == 0 {
		return 0, 0, nil
	}
	if n < 0 || ofs < 0 || n > len(b) || ofs+n*stride > len(b) {
		return 0, 0, fmt.Errorf("m2: array at 0x%x out of bounds", o)
	}
	return n, ofs, nil
}

// alloc adds n zero bytes to the output, on a 4-byte boundary, and returns where they start.
func (c *m2conv) alloc(n int) int {
	for len(c.out)%4 != 0 {
		c.out = append(c.out, 0)
	}
	at := len(c.out)
	c.out = append(c.out, make([]byte, n)...)
	return at
}

// put adds data to the output and returns where it starts.
func (c *m2conv) put(data []byte) int {
	at := c.alloc(len(data))
	copy(c.out[at:], data)
	return at
}

func (c *m2conv) set16(at, v int) { binary.LittleEndian.PutUint16(c.out[at:], uint16(v)) }
func (c *m2conv) set32(at, v int) { binary.LittleEndian.PutUint32(c.out[at:], uint32(v)) }

// setArr writes an M2Array (count, offset) at at; an empty one is all zero.
func (c *m2conv) setArr(at, n, ofs int) {
	if n == 0 {
		ofs = 0
	}
	c.set32(at, n)
	c.set32(at+4, ofs)
}

// copyArr copies the array at src of from (elements of stride bytes) to the output, and writes its
// M2Array at dst.
func (c *m2conv) copyArr(dst int, from []byte, src, stride int) error {
	n, ofs, err := arrOf(from, src, stride)
	if err != nil {
		return err
	}
	if n == 0 {
		c.setArr(dst, 0, 0)
		return nil
	}
	c.setArr(dst, n, c.put(from[ofs:ofs+n*stride]))
	return nil
}

// sequences reads the model's sequences onto one timeline and opens the .anim files of the loop
// the model is read for.
func (c *m2conv) sequences(path string, animID int, read func(string) ([]byte, error)) error {
	if len(c.src) < h264Size {
		return fmt.Errorf("m2: header truncated (%d bytes, want %d)", len(c.src), h264Size)
	}
	n, ofs, err := arrOf(c.src, h264Sequences, seq264Size)
	if err != nil {
		return err
	}
	flags := func(i int) int { return le32(c.src, ofs+i*seq264Size+12) }
	owner := func(i int) int {
		for hops := 0; hops <= n; hops++ {
			if flags(i)&seqAlias == 0 {
				return i
			}
			if i = le16(c.src, ofs+i*seq264Size+0x3E); i >= n {
				return -1
			}
		}
		return -1
	}
	// The sequences the readers may pick (pickSequence's order), whose .anim files are opened.
	wanted := map[int]bool{}
	for _, id := range []int{animID, 0, animClosed} {
		for i := 0; i < n; i++ {
			if le16(c.src, ofs+i*seq264Size) == id {
				wanted[owner(i)] = true
				break
			}
		}
	}
	if n > 0 {
		wanted[owner(0)] = true
	}
	files := map[int][]byte{}
	c.bands = make([]m2band, n)
	start := uint32(0)
	for i := range c.bands {
		o := owner(i)
		band := m2band{start: start, length: uint32(le32(c.src, ofs+i*seq264Size+4)), owner: o}
		switch {
		case o < 0:
		case flags(o)&seqInFile != 0:
			band.keys = c.src
		case wanted[o]:
			b, opened := files[o]
			if !opened {
				at := ofs + o*seq264Size
				b, _ = read(animPath(path, le16(c.src, at), le16(c.src, at+2)))
				files[o] = b
			}
			band.keys = b
		}
		c.bands[i] = band
		// One empty millisecond between two sequences, so each one's last key stays its own.
		start += band.length + 1
	}
	return nil
}

// m2channel is what a track's keys hold.
type m2channel struct {
	size int    // a value's bytes in the version-264 file
	def  []byte // the value a sequence without keys takes, as written
	quat bool   // four int16 (a bone's rotation), written as four float32
}

func floats(v ...float32) []byte {
	b := make([]byte, 0, len(v)*4)
	for _, f := range v {
		b = binary.LittleEndian.AppendUint32(b, math.Float32bits(f))
	}
	return b
}

// The channels, with the defaults of the client's samplers (after Benilla-WotLK): a transform is the
// identity, a colour and a weight 1, a light nothing, a gate open.
var (
	chMove   = m2channel{size: 12, def: floats(0, 0, 0)}
	chScale  = m2channel{size: 12, def: floats(1, 1, 1)}
	chColor  = m2channel{size: 12, def: floats(1, 1, 1)}
	chTurn   = m2channel{size: 8, def: floats(0, 0, 0, 1), quat: true}
	chQuat   = m2channel{size: 16, def: floats(0, 0, 0, 1)}
	chFloat  = m2channel{size: 4, def: floats(0)}
	chOne    = m2channel{size: 4, def: floats(1)}
	chFixed  = m2channel{size: 2, def: []byte{0xFF, 0x7F}}
	chCell   = m2channel{size: 2, def: []byte{0, 0}}
	chGate   = m2channel{size: 1, def: []byte{1}}
	chHidden = m2channel{size: 1, def: []byte{0}}
)

// unpack appends the value v of the channel as the output holds it.
func (ch m2channel) unpack(out, v []byte) []byte {
	if !ch.quat {
		return append(out, v...)
	}
	for k := 0; k < 4; k++ {
		out = binary.LittleEndian.AppendUint32(out, math.Float32bits(unpackQ(le16(v, k*2))))
	}
	return out
}

// keysOf reads list set of the version-264 track at src: its times, and its values of size bytes
// read from keys (the model's file or a .anim file, which the list's offsets index). A list that
// reaches past those bytes ends at its last whole key.
func (c *m2conv) keysOf(src, set, size int, keys []byte) (times []uint32, values []byte) {
	sub := func(o int) (int, int, bool) {
		n, ofs, err := arrOf(c.src, o, 8)
		if err != nil || set >= n {
			return 0, 0, false
		}
		return le32(c.src, ofs+set*8), le32(c.src, ofs+set*8+4), true
	}
	tn, to, ok1 := sub(src + 4)
	vn, vo, ok2 := sub(src + 12)
	if !ok1 || !ok2 || to < 0 || vo < 0 {
		return nil, nil
	}
	n := min(tn, vn)
	if n <= 0 || n > len(keys) {
		return nil, nil
	}
	for k := 0; k < n; k++ {
		if to+k*4+4 > len(keys) || vo+(k+1)*size > len(keys) {
			break
		}
		times = append(times, binary.LittleEndian.Uint32(keys[to+k*4:]))
		values = append(values, keys[vo+k*size:vo+(k+1)*size]...)
	}
	return times, values
}

// track rewrites the version-264 track at src of the model's file as a 1.12 track at dst of the
// output: its keys on the one timeline, a window per sequence.
func (c *m2conv) track(dst, src int, ch m2channel) {
	if src < 0 || src+track264Size > len(c.src) {
		return
	}
	interp, gseq := le16(c.src, src), le16(c.src, src+2)
	c.set16(dst+2, gseq)
	if interp > 1 {
		// Keys with spline tangents, which no channel read here holds: the track is left empty.
		c.set16(dst, 1)
		return
	}
	c.set16(dst, interp)
	sets, _, err := arrOf(c.src, src+4, 8)
	if err != nil || sets == 0 {
		return
	}
	var times []uint32
	var values []byte
	var ranges []byte
	if gseq != 0xFFFF {
		// A track on a global sequence keys one list on that sequence's own clock.
		t, v := c.keysOf(src, 0, ch.size, c.src)
		for k := range t {
			times = append(times, t[k])
			values = ch.unpack(values, v[k*ch.size:(k+1)*ch.size])
		}
	} else {
		any := false
		per := make([][]uint32, len(c.bands))
		vals := make([][]byte, len(c.bands))
		for s, band := range c.bands {
			if band.keys == nil {
				continue
			}
			// A track with fewer lists than the model has sequences plays its first for the rest.
			set, keys := band.owner, band.keys
			if set >= sets {
				set, keys = 0, c.bands[0].keys
				if keys == nil {
					continue
				}
			}
			per[s], vals[s] = c.keysOf(src, set, ch.size, keys)
			any = any || len(per[s]) > 0
		}
		if !any {
			return
		}
		for s, band := range c.bands {
			first := len(times)
			// The keys inside the sequence; one past its end belongs to no window.
			t, v := per[s], vals[s]
			n := 0
			for n < len(t) && t[n] <= band.length {
				n++
			}
			if n == 0 {
				times = append(times, band.start)
				values = append(values, ch.def...)
			} else {
				if t[0] > 0 {
					times = append(times, band.start)
					values = ch.unpack(values, v[:ch.size])
				}
				for k := 0; k < n; k++ {
					times = append(times, band.start+t[k])
					values = ch.unpack(values, v[k*ch.size:(k+1)*ch.size])
				}
				if t[n-1] < band.length {
					times = append(times, band.start+band.length)
					values = ch.unpack(values, v[(n-1)*ch.size:n*ch.size])
				}
			}
			ranges = binary.LittleEndian.AppendUint32(ranges, uint32(first))
			ranges = binary.LittleEndian.AppendUint32(ranges, uint32(len(times)-1))
		}
	}
	if len(times) == 0 {
		return
	}
	tb := make([]byte, 0, len(times)*4)
	for _, t := range times {
		tb = binary.LittleEndian.AppendUint32(tb, t)
	}
	c.setArr(dst+4, len(ranges)/8, c.put(ranges))
	c.setArr(dst+12, len(times), c.put(tb))
	c.setArr(dst+20, len(times), c.put(values))
}

// records rewrites the array of version-264 records at header place src (each from bytes) as 1.12
// records of to bytes at header place dst, and returns where each pair is: the record in the
// model's file and the record in the output, which each calls fill with.
func (c *m2conv) records(dst, src, from, to int, fill func(d, s int)) error {
	n, ofs, err := arrOf(c.src, src, from)
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	at := c.alloc(n * to)
	c.setArr(dst, n, at)
	for i := 0; i < n; i++ {
		fill(at+i*to, ofs+i*from)
	}
	return nil
}

// bytes copies n bytes of the model's file at s to the output at d.
func (c *m2conv) bytes(d, s, n int) { copy(c.out[d:d+n], c.src[s:s+n]) }

// str copies the string array (M2Array<char>) at s of the model's file to the output, its M2Array at d.
func (c *m2conv) str(d, s int) {
	if n, ofs, err := arrOf(c.src, s, 1); err == nil && n > 0 {
		c.setArr(d, n, c.put(c.src[ofs:ofs+n]))
	}
}

// convert writes the model in the 1.12 layout.
func (c *m2conv) convert() error {
	c.out = make([]byte, m2HeaderSize, len(c.src)+len(c.skin)+m2HeaderSize)
	copy(c.out, "MD20")
	c.set32(4, 256)
	c.str(0x08, h264Name)
	c.bytes(0x10, h264Flags, 4)

	// The lists that are the same in both, at their 1.12 places.
	for _, a := range []struct{ dst, src, stride int }{
		{0x14, h264GlobalLoops, 4}, {0x24, h264SeqLookup, 2}, {0x3C, h264KeyBones, 2}, {0x44, h264Vertices, 48},
		{0x7C, h264ReplTex, 2}, {0x84, h264Materials, 4}, {0x8C, h264BoneLookup, 2}, {0x94, h264TexLookup, 2},
		{0x9C, h264TexUnits, 2}, {0xA4, h264WeightLook, 2}, {0xAC, h264UVLookup, 2},
		{0xEC, h264HullTris, 2}, {0xF4, h264HullVerts, 12}, {0xFC, h264HullNormals, 12}, {0x10C, h264AttachLook, 2},
	} {
		if err := c.copyArr(a.dst, c.src, a.src, a.stride); err != nil {
			return err
		}
	}
	c.bytes(0xB4, h264Bounds, 0x38)

	// The sequences: a start and an end on the timeline where version 264 has a length.
	if err := c.records(0x1C, h264Sequences, seq264Size, seqSize, func(d, s int) {
		c.bytes(d, s, 4)
		c.bytes(d+12, s+8, seq264Size-8)
	}); err != nil {
		return err
	}
	if n, at := le32(c.out, 0x1C), le32(c.out, 0x20); n == len(c.bands) {
		for i, band := range c.bands {
			c.set32(at+i*seqSize+4, int(band.start))
			c.set32(at+i*seqSize+8, int(band.start+band.length))
		}
	}

	// The bones: the name's hash (+12) is not in a 1.12 bone.
	if err := c.records(0x34, h264Bones, 88, 108, func(d, s int) {
		c.bytes(d, s, 12)
		c.track(d+12, s+16, chMove)
		c.track(d+12+trackSize, s+36, chTurn)
		c.track(d+12+2*trackSize, s+56, chScale)
		c.bytes(d+12+3*trackSize, s+76, 12)
	}); err != nil {
		return err
	}

	if err := c.view(); err != nil {
		return err
	}

	// A colour is an RGB and an alpha track; a transparency a weight track; a texture animation a
	// move, a turn and a scale.
	if err := c.records(0x54, h264Colors, 2*track264Size, 2*trackSize, func(d, s int) {
		c.track(d, s, chColor)
		c.track(d+trackSize, s+track264Size, chFixed)
	}); err != nil {
		return err
	}
	if err := c.records(0x5C, h264Textures, 16, 16, func(d, s int) {
		c.bytes(d, s, 8)
		c.str(d+8, s+8)
	}); err != nil {
		return err
	}
	if err := c.records(0x64, h264Weights, track264Size, trackSize, func(d, s int) { c.track(d, s, chFixed) }); err != nil {
		return err
	}
	if err := c.records(0x74, h264UVAnims, 3*track264Size, 3*trackSize, func(d, s int) {
		c.track(d, s, chMove)
		c.track(d+trackSize, s+track264Size, chQuat)
		c.track(d+2*trackSize, s+2*track264Size, chScale)
	}); err != nil {
		return err
	}

	// An attachment point: its ID, bone and place, and whether it is shown.
	if err := c.records(0x104, h264Attachments, 40, 48, func(d, s int) {
		c.bytes(d, s, 20)
		c.track(d+20, s+20, chGate)
	}); err != nil {
		return err
	}

	// A light: its kind, bone and place, then two colours with their intensities, the two radii and
	// whether it is on.
	if err := c.records(0x11C, h264Lights, 156, 212, func(d, s int) {
		c.bytes(d, s, 16)
		for k, ch := range []m2channel{chMove, chFloat, chMove, chFloat, chFloat, chFloat, chHidden} {
			c.track(d+16+k*trackSize, s+16+k*track264Size, ch)
		}
	}); err != nil {
		return err
	}

	// A ribbon: its ID, bone and place, its texture and material lists, then colour, opacity, the
	// heights above and below, the numbers, the texture slot and whether it is on.
	if err := c.records(0x134, h264Ribbons, 176, ribbonStride, func(d, s int) {
		c.bytes(d, s, 0x14)
		_ = c.copyArr(d+0x14, c.src, s+0x14, 2)
		_ = c.copyArr(d+0x1C, c.src, s+0x1C, 2)
		c.track(d+0x24, s+0x24, chColor)
		c.track(d+0x40, s+0x38, chFixed)
		c.track(d+0x5C, s+0x4C, chFloat)
		c.track(d+0x78, s+0x60, chFloat)
		c.bytes(d+0x94, s+0x74, 16)
		c.track(d+0xA4, s+0x84, chCell)
		c.track(d+0xC0, s+0x98, chGate)
	}); err != nil {
		return err
	}
	return c.records(0x13C, h264Emitters, 476, emitterStride, c.emitter)
}

// view writes the model's one view from its .skin file: the vertex list, the triangles, the
// vertices' bone lists, the submeshes (a 1.12 one is the first 32 bytes of a version-264 one) and
// the batches.
func (c *m2conv) view() error {
	if len(c.skin) < 48 || string(c.skin[:4]) != "SKIN" {
		return errors.New("m2: the .skin file is not one")
	}
	v := c.alloc(44)
	c.setArr(0x4C, 1, v)
	for _, a := range []struct{ dst, src, stride int }{{0, 4, 2}, {8, 12, 2}, {16, 20, 4}, {32, 36, 24}} {
		if err := c.copyArr(v+a.dst, c.skin, a.src, a.stride); err != nil {
			return err
		}
	}
	n, ofs, err := arrOf(c.skin, 28, 48)
	if err != nil {
		return err
	}
	if n > 0 {
		at := c.alloc(n * 32)
		for i := 0; i < n; i++ {
			copy(c.out[at+i*32:at+(i+1)*32], c.skin[ofs+i*48:])
		}
		c.setArr(v+24, n, at)
	}
	copy(c.out[v+40:v+44], c.skin[44:48])
	return nil
}

// ramp is one of a version-264 emitter's lists of keys over a particle's life (16 bytes at o of the
// model's file: the times, each an int16 over 32767 of the life, then the values, size bytes each).
type ramp struct {
	times []float32
	vals  []byte
	size  int
}

func (c *m2conv) ramp(o, size int) ramp {
	tn, to, err1 := arrOf(c.src, o, 2)
	vn, vo, err2 := arrOf(c.src, o+8, size)
	r := ramp{size: size}
	if err1 != nil || err2 != nil {
		return r
	}
	for k := 0; k < min(tn, vn); k++ {
		r.times = append(r.times, float32(int16(le16(c.src, to+k*2)))/32767)
	}
	r.vals = c.src[vo : vo+len(r.times)*size]
	return r
}

// at is the ramp's value at t of the particle's life (0 to 1), read by get and blended between the
// two keys around t; def with no keys.
func (r ramp) at(t float32, n int, get func(v []byte, c int) float32, def float32) []float32 {
	out := make([]float32, n)
	if len(r.times) == 0 {
		for c := range out {
			out[c] = def
		}
		return out
	}
	k := 0
	for k+1 < len(r.times) && r.times[k+1] <= t {
		k++
	}
	f := float32(0)
	if k+1 < len(r.times) && r.times[k+1] > r.times[k] && t > r.times[k] {
		f = (t - r.times[k]) / (r.times[k+1] - r.times[k])
	}
	for c := range out {
		a := get(r.vals[k*r.size:], c)
		b := a
		if k+1 < len(r.times) {
			b = get(r.vals[(k+1)*r.size:], c)
		}
		out[c] = a + (b-a)*f
	}
	return out
}

func rampFloat(v []byte, c int) float32 {
	return math.Float32frombits(binary.LittleEndian.Uint32(v[c*4:]))
}
func rampFixed(v []byte, _ int) float32 { return float32(int16(binary.LittleEndian.Uint16(v))) / 32767 }
func rampCell(v []byte, _ int) float32  { return float32(binary.LittleEndian.Uint16(v)) }

// emitter rewrites one particle emitter: the version-264 record at s of the model's file as the
// 1.12 record at d of the output.
func (c *m2conv) emitter(d, s int) {
	c.bytes(d, s, 0x18) // the ID, the flags, the place, the bone and the texture
	c.str(d+0x18, s+0x18)
	c.str(d+0x20, s+0x20)
	// The blend and the shape are bytes in version 264 and words in 1.12.
	c.set16(d+0x28, int(c.src[s+0x28]))
	c.set16(d+0x2A, int(c.src[s+0x29]))
	// What a particle draws is two flags in version 264 (0x20000 its head, 0x40000 its tail), and in
	// 1.12 a number: 0 the head, 1 the tail, 2 both.
	flags := le32(c.src, s+4)
	switch head, tail := flags&0x20000 != 0, flags&0x40000 != 0; {
	case head && tail:
		c.out[d+0x2C] = 2
	case tail:
		c.out[d+0x2C] = 1
	}
	c.bytes(d+0x2E, s+0x2E, 6) // the tile rotation, the rows and the columns

	// The ten emission tracks: 1.12 has them in a row, version 264 with a variance after the
	// lifespan and after the rate.
	for k, o := range []int{0x34, 0x48, 0x5C, 0x70, 0x84, 0x98, 0xB0, 0xC8, 0xDC, 0xF0} {
		ch := chFloat
		if k == 5 {
			ch = chOne // a particle without a lifespan key lives a second
		}
		c.track(d+0x34+k*trackSize, s+o, ch)
	}

	// The ramps over a particle's life, as 1.12's three values: at the start, at the middle key
	// (half way without one) and at the end.
	color, alpha, size := c.ramp(s+0x104, 12), c.ramp(s+0x114, 2), c.ramp(s+0x124, 8)
	mid := float32(0.5)
	for _, r := range []ramp{color, alpha, size} {
		if len(r.times) >= 3 {
			mid = r.times[1]
			break
		}
	}
	if mid <= 0 || mid >= 1 {
		mid = 0.5
	}
	c.set32(d+0x14C, int(math.Float32bits(mid)))
	byteOf := func(f float32) int { return int(min(max(f, 0), 255) + 0.5) }
	for k, t := range []float32{0, mid, 1} {
		rgb := color.at(t, 3, rampFloat, 255)
		a := alpha.at(t, 1, rampFixed, 1)[0]
		c.set32(d+0x150+k*4, byteOf(a*255)<<24|byteOf(rgb[0])<<16|byteOf(rgb[1])<<8|byteOf(rgb[2]))
		c.set32(d+0x15C+k*4, int(math.Float32bits(size.at(t, 1, rampFloat, 1)[0])))
	}
	// The cells: a first and a last one for each half of the life, each half played once. The head's
	// two pairs have their repeat after them; the tail's follow each other.
	cells := func(r ramp) (first, middle, last int) {
		return int(r.at(0, 1, rampCell, 0)[0]), int(r.at(mid, 1, rampCell, 0)[0]), int(r.at(1, 1, rampCell, 0)[0])
	}
	a, m, z := cells(c.ramp(s+0x13C, 2))
	for k, v := range []int{a, m, 1, m, z, 1} {
		c.set16(d+0x168+k*2, v)
	}
	a, m, z = cells(c.ramp(s+0x14C, 2))
	for k, v := range []int{a, m, m, z} {
		c.set16(d+0x174+k*2, v)
	}

	c.bytes(d+0x17C, s+0x15C, 0x1C) // the tail's length, the twinkle, the burst multiplier and the drag
	c.bytes(d+0x198, s+0x180, 4)    // the spin
	c.bytes(d+0x19C, s+0x188, 0x38) // the tumble, the wind and the four follow numbers
	_ = c.copyArr(d+0x1D4, c.src, s+0x1C0, 12)
	c.track(d+0x1DC, s+0x1C8, chGate)
}
