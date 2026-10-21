// Package mpq is a small, read-only MPQ (format v1/v2) reader sufficient for
// World of Warcraft 1.x client archives. Archives are opened lazily and read
// with ReadAt, so they are safe for concurrent use.
package mpq

import (
	"bytes"
	"compress/bzip2"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JoshVarga/blast"
)

var ErrNotFound = errors.New("mpq: file not found")

const (
	flagImplode    = 0x00000100
	flagCompress   = 0x00000200
	flagEncrypted  = 0x00010000
	flagFixKey     = 0x00020000
	flagSingleUnit = 0x01000000
	flagDeleted    = 0x02000000
	flagSectorCRC  = 0x04000000
	flagExists     = 0x80000000

	hashEmpty   = 0xFFFFFFFF
	hashDeleted = 0xFFFFFFFE
)

var cryptTable [0x500]uint32

func init() {
	seed := uint32(0x00100001)
	for i := 0; i < 0x100; i++ {
		idx := i
		for j := 0; j < 5; j++ {
			seed = (seed*125 + 3) % 0x2AAAAB
			t1 := (seed & 0xFFFF) << 16
			seed = (seed*125 + 3) % 0x2AAAAB
			t2 := seed & 0xFFFF
			cryptTable[idx] = t1 | t2
			idx += 0x100
		}
	}
}

func hashString(s string, kind uint32) uint32 {
	seed1 := uint32(0x7FED7FED)
	seed2 := uint32(0xEEEEEEEE)
	for i := 0; i < len(s); i++ {
		ch := uint32(upper(s[i]))
		seed1 = cryptTable[kind*0x100+ch] ^ (seed1 + seed2)
		seed2 = ch + seed1 + seed2 + (seed2 << 5) + 3
	}
	return seed1
}

func upper(c byte) byte {
	if c >= 'a' && c <= 'z' {
		return c - 32
	}
	if c == '/' {
		return '\\'
	}
	return c
}

func decrypt(data []uint32, key uint32) {
	seed := uint32(0xEEEEEEEE)
	for i := range data {
		seed += cryptTable[0x400+(key&0xFF)]
		ch := data[i] ^ (key + seed)
		key = ((^key << 0x15) + 0x11111111) | (key >> 0x0B)
		seed = ch + seed + (seed << 5) + 3
		data[i] = ch
	}
}

func decryptBytes(b []byte, key uint32) {
	n := len(b) / 4
	words := make([]uint32, n)
	for i := range words {
		words[i] = binary.LittleEndian.Uint32(b[i*4:])
	}
	decrypt(words, key)
	for i, w := range words {
		binary.LittleEndian.PutUint32(b[i*4:], w)
	}
}

type hashEntry struct {
	nameA, nameB uint32
	locale       uint16
	platform     uint16
	block        uint32
}

type blockEntry struct {
	pos   uint32
	csize uint32
	size  uint32
	flags uint32
	posHi uint16
}

// Archive is one opened MPQ file.
type Archive struct {
	Path       string
	f          *os.File
	base       int64
	sectorSize uint32
	hashes     []hashEntry
	blocks     []blockEntry
}

// Open parses an MPQ archive's header and tables.
func Open(path string) (*Archive, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	a := &Archive{Path: path, f: f}
	if err := a.readHeader(); err != nil {
		f.Close()
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return a, nil
}

func (a *Archive) Close() error { return a.f.Close() }

func (a *Archive) readHeader() error {
	var buf [44]byte
	// The header may sit at any 512-byte boundary.
	for off := int64(0); ; off += 512 {
		if _, err := a.f.ReadAt(buf[:32], off); err != nil {
			return errors.New("no MPQ header found")
		}
		magic := string(buf[:4])
		if magic == "MPQ\x1b" { // user data block → points at real header
			off += int64(binary.LittleEndian.Uint32(buf[8:])) - 512
			continue
		}
		if magic == "MPQ\x1a" {
			a.base = off
			break
		}
		if off > 1<<24 {
			return errors.New("no MPQ header found")
		}
	}
	if _, err := a.f.ReadAt(buf[:], a.base); err != nil && err != io.EOF {
		return err
	}
	headerSize := binary.LittleEndian.Uint32(buf[4:])
	version := binary.LittleEndian.Uint16(buf[12:])
	// The format allows 512 << 15 at most; a larger shift (a damaged or
	// half-written archive) overflows the size to 0 at 23 and would make
	// ReadFile divide by zero, so the archive is refused instead.
	shift := binary.LittleEndian.Uint16(buf[14:])
	if shift > 15 {
		return fmt.Errorf("sector size shift %d out of range", shift)
	}
	a.sectorSize = 512 << shift
	hashPos := int64(binary.LittleEndian.Uint32(buf[16:]))
	blockPos := int64(binary.LittleEndian.Uint32(buf[20:]))
	hashCount := binary.LittleEndian.Uint32(buf[24:])
	blockCount := binary.LittleEndian.Uint32(buf[28:])
	var hiBlockPos int64
	if version >= 1 && headerSize >= 44 {
		hiBlockPos = int64(binary.LittleEndian.Uint64(buf[32:]))
		hashPos |= int64(binary.LittleEndian.Uint16(buf[40:])) << 32
		blockPos |= int64(binary.LittleEndian.Uint16(buf[42:])) << 32
	}
	if hashCount > 1<<22 || blockCount > 1<<22 {
		return errors.New("table too large")
	}

	ht, err := a.readTable(hashPos, hashCount, hashString("(hash table)", 3))
	if err != nil {
		return fmt.Errorf("hash table: %w", err)
	}
	a.hashes = make([]hashEntry, hashCount)
	for i := range a.hashes {
		w := ht[i*4:]
		a.hashes[i] = hashEntry{w[0], w[1], uint16(w[2]), uint16(w[2] >> 16), w[3]}
	}
	bt, err := a.readTable(blockPos, blockCount, hashString("(block table)", 3))
	if err != nil {
		return fmt.Errorf("block table: %w", err)
	}
	a.blocks = make([]blockEntry, blockCount)
	for i := range a.blocks {
		w := bt[i*4:]
		a.blocks[i] = blockEntry{pos: w[0], csize: w[1], size: w[2], flags: w[3]}
	}
	if hiBlockPos != 0 {
		hi := make([]byte, blockCount*2)
		if _, err := a.f.ReadAt(hi, a.base+hiBlockPos); err == nil {
			for i := range a.blocks {
				a.blocks[i].posHi = binary.LittleEndian.Uint16(hi[i*2:])
			}
		}
	}
	return nil
}

func (a *Archive) readTable(pos int64, count uint32, key uint32) ([]uint32, error) {
	raw := make([]byte, count*16)
	if _, err := a.f.ReadAt(raw, a.base+pos); err != nil && err != io.EOF {
		return nil, err
	}
	words := make([]uint32, count*4)
	for i := range words {
		words[i] = binary.LittleEndian.Uint32(raw[i*4:])
	}
	decrypt(words, key)
	return words, nil
}

func (a *Archive) find(name string) (*blockEntry, bool) {
	if len(a.hashes) == 0 {
		return nil, false
	}
	mask := uint32(len(a.hashes) - 1)
	start := hashString(name, 0) & mask
	na := hashString(name, 1)
	nb := hashString(name, 2)
	for i := start; ; {
		h := &a.hashes[i]
		if h.block == hashEmpty {
			return nil, false
		}
		if h.nameA == na && h.nameB == nb && h.block != hashDeleted && h.block < uint32(len(a.blocks)) {
			b := &a.blocks[h.block]
			if b.flags&flagExists != 0 {
				return b, true
			}
		}
		i = (i + 1) & mask
		if i == start {
			return nil, false
		}
	}
}

// Has reports whether the archive contains name.
func (a *Archive) Has(name string) bool {
	b, ok := a.find(name)
	return ok && b.flags&flagDeleted == 0
}

// ReadFile returns the full, decompressed contents of name.
func (a *Archive) ReadFile(name string) ([]byte, error) {
	return a.ReadPrefix(name, -1)
}

// ReadPrefix returns at least the first n bytes of name (all of it when shorter, or when n < 0),
// unpacking only the sectors they lie in, so a caller after a file's header doesn't pay for the rest.
// It may return more than n bytes: up to the end of the last sector read.
func (a *Archive) ReadPrefix(name string, n int) ([]byte, error) {
	b, ok := a.find(name)
	if !ok || b.flags&flagDeleted != 0 {
		return nil, ErrNotFound
	}
	if b.size == 0 {
		return []byte{}, nil
	}
	limit := b.size
	if n >= 0 && int64(n) < int64(limit) {
		limit = uint32(n)
	}
	pos := a.base + (int64(b.pos) | int64(b.posHi)<<32)
	var key uint32
	if b.flags&flagEncrypted != 0 {
		base := name
		if i := strings.LastIndexAny(base, `\/`); i >= 0 {
			base = base[i+1:]
		}
		key = hashString(base, 3)
		if b.flags&flagFixKey != 0 {
			key = (key + b.pos) ^ b.size
		}
	}

	if b.flags&flagSingleUnit != 0 {
		data := make([]byte, b.csize)
		if _, err := a.f.ReadAt(data, pos); err != nil && err != io.EOF {
			return nil, err
		}
		if b.flags&flagEncrypted != 0 {
			decryptBytes(data, key)
		}
		return decompressSector(data, b.size, b.flags)
	}

	compressed := b.flags&(flagCompress|flagImplode) != 0
	nSectors := (b.size + a.sectorSize - 1) / a.sectorSize
	// The sectors the first limit bytes lie in.
	nRead := (limit + a.sectorSize - 1) / a.sectorSize
	readSize := min(b.size, nRead*a.sectorSize)
	if !compressed {
		data := make([]byte, readSize)
		if _, err := a.f.ReadAt(data, pos); err != nil && err != io.EOF {
			return nil, err
		}
		if b.flags&flagEncrypted != 0 {
			for i := uint32(0); i < nRead; i++ {
				end := min((i+1)*a.sectorSize, readSize)
				decryptBytes(data[i*a.sectorSize:end], key+i)
			}
		}
		return data, nil
	}

	nOffsets := nSectors + 1
	if b.flags&flagSectorCRC != 0 {
		nOffsets++
	}
	ob := make([]byte, nOffsets*4)
	if _, err := a.f.ReadAt(ob, pos); err != nil && err != io.EOF {
		return nil, err
	}
	if b.flags&flagEncrypted != 0 {
		decryptBytes(ob, key-1)
	}
	offs := make([]uint32, nOffsets)
	for i := range offs {
		offs[i] = binary.LittleEndian.Uint32(ob[i*4:])
	}
	if offs[nSectors] > b.csize+16 || offs[nRead] > offs[nSectors] {
		return nil, errors.New("mpq: corrupt sector table")
	}
	raw := make([]byte, offs[nRead])
	if _, err := a.f.ReadAt(raw, pos); err != nil && err != io.EOF {
		return nil, err
	}
	out := make([]byte, 0, readSize)
	for i := uint32(0); i < nRead; i++ {
		if offs[i] > offs[i+1] || offs[i+1] > uint32(len(raw)) {
			return nil, errors.New("mpq: corrupt sector offsets")
		}
		sec := raw[offs[i]:offs[i+1]]
		if b.flags&flagEncrypted != 0 {
			sec = append([]byte(nil), sec...)
			decryptBytes(sec, key+i)
		}
		want := min(a.sectorSize, b.size-i*a.sectorSize)
		d, err := decompressSector(sec, want, b.flags)
		if err != nil {
			return nil, fmt.Errorf("sector %d: %w", i, err)
		}
		out = append(out, d...)
	}
	return out, nil
}

// Size returns the unpacked size of name.
func (a *Archive) Size(name string) (int64, bool) {
	b, ok := a.find(name)
	if !ok || b.flags&flagDeleted != 0 {
		return 0, false
	}
	return int64(b.size), true
}

// Reader returns a reader of name's contents and their size, for copying a file into another archive
// (Entry) without holding it in memory. A file stored plainly, as Write stores every file, is read
// straight from the archive; any other is read whole at the reader's first Read. The archive must
// stay open until the reader is done.
func (a *Archive) Reader(name string) (io.Reader, int64, error) {
	b, ok := a.find(name)
	if !ok || b.flags&flagDeleted != 0 {
		return nil, 0, ErrNotFound
	}
	if b.flags&(flagCompress|flagImplode|flagEncrypted) == 0 && b.csize >= b.size {
		pos := a.base + (int64(b.pos) | int64(b.posHi)<<32)
		return io.NewSectionReader(a.f, pos, int64(b.size)), int64(b.size), nil
	}
	return &wholeReader{a: a, name: name}, int64(b.size), nil
}

// wholeReader reads a packed file whole at its first Read.
type wholeReader struct {
	a    *Archive
	name string
	r    *bytes.Reader
}

func (w *wholeReader) Read(p []byte) (int, error) {
	if w.r == nil {
		data, err := w.a.ReadFile(w.name)
		if err != nil {
			return 0, err
		}
		w.r = bytes.NewReader(data)
	}
	return w.r.Read(p)
}

func decompressSector(data []byte, want uint32, flags uint32) ([]byte, error) {
	if uint32(len(data)) >= want {
		return data[:want], nil // stored uncompressed
	}
	if flags&flagImplode != 0 {
		return explode(data, want)
	}
	if flags&flagCompress == 0 || len(data) == 0 {
		return data, nil
	}
	mask := data[0]
	data = data[1:]
	var err error
	// Decompression order is the reverse of compression: bzip2 → implode → zlib.
	if mask&0x10 != 0 {
		if data, err = io.ReadAll(bzip2.NewReader(bytes.NewReader(data))); err != nil {
			return nil, err
		}
	}
	if mask&0x08 != 0 {
		if data, err = explode(data, want); err != nil {
			return nil, err
		}
	}
	if mask&0x02 != 0 {
		r, err := zlib.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		if data, err = io.ReadAll(r); err != nil {
			return nil, err
		}
	}
	if mask&^(0x10|0x08|0x02) != 0 {
		return nil, fmt.Errorf("mpq: unsupported compression 0x%02x", mask)
	}
	return data, nil
}

func explode(data []byte, want uint32) ([]byte, error) {
	r, err := blast.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := make([]byte, 0, want)
	buf := bytes.NewBuffer(out)
	_, err = io.Copy(buf, r)
	return buf.Bytes(), err
}

// ListFile returns the names from the archive's (listfile), if present.
func (a *Archive) ListFile() ([]string, error) {
	data, err := a.ReadFile("(listfile)")
	if err != nil {
		return nil, err
	}
	var names []string
	for _, line := range strings.FieldsFunc(string(data), func(r rune) bool { return r == '\n' || r == '\r' || r == ';' }) {
		if line = strings.TrimSpace(line); line != "" {
			names = append(names, line)
		}
	}
	return names, nil
}
