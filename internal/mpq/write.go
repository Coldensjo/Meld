package mpq

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"strings"
)

// File is one file to store in an archive.
type File struct {
	Name string
	Data []byte
}

const (
	writeHeaderSize = 32
	// sectorShift 3 is 512 << 3, the sector size the game's own archives use.
	sectorShift = 3
	fileExists  = 0x80000000
)

// MarkerName is a file every archive written by Write carries, so an editor can tell its own
// patches from the game's and refuse to overwrite the game's.
const MarkerName = "(meld)"

// OldMarkerName is the marker of archives written before the app was renamed.
const OldMarkerName = "(worldeditor)"

// MarkerText is the marker file's contents. Stored uncompressed, it can be found in the file.
const MarkerText = "Meld map export: this patch was written by Meld and is replaced by its next export."

// Entry is a file to store whose bytes are read only while the archive is written, so an archive
// can be rebuilt from another one without holding every file in memory (Archive.Reader).
type Entry struct {
	Name string
	// Size is how many bytes Data gives.
	Size int64
	Data io.Reader
}

// Entries wraps files as entries.
func Entries(files []File) []Entry {
	out := make([]Entry, len(files))
	for i, f := range files {
		out[i] = Entry{Name: f.Name, Size: int64(len(f.Data)), Data: bytes.NewReader(f.Data)}
	}
	return out
}

// Write builds an MPQ archive (format 1) that the 1.12 client reads: each file is stored whole and
// uncompressed, found through encrypted hash and block tables. A (listfile) names the files, and
// the marker file is added. A file with the marker's name in files is replaced by it.
func Write(files []File) []byte {
	var buf bytes.Buffer
	// A write fails only on a short reader, which bytes.Reader never is, or past 4 GB, which files
	// held in memory don't reach.
	_ = WriteTo(&buf, Entries(files))
	return buf.Bytes()
}

// WriteTo writes the archive Write builds to w, reading each entry's bytes as it goes.
func WriteTo(w io.Writer, files []Entry) error {
	all := make([]Entry, 0, len(files)+2)
	for _, f := range files {
		if f.Name != "(listfile)" && f.Name != MarkerName && f.Name != OldMarkerName {
			all = append(all, f)
		}
	}
	all = append(all, Entry{Name: MarkerName, Size: int64(len(MarkerText)), Data: strings.NewReader(MarkerText)})
	var list strings.Builder
	for _, f := range all {
		list.WriteString(strings.ReplaceAll(f.Name, "/", `\`) + "\r\n")
	}
	all = append(all, Entry{Name: "(listfile)", Size: int64(list.Len()), Data: strings.NewReader(list.String())})

	// Room for twice the files, a power of two as the lookup needs.
	hashCount := 16
	for hashCount < len(all)*2 {
		hashCount *= 2
	}
	mask := uint32(hashCount - 1)
	dataSize := int64(0)
	for _, f := range all {
		dataSize += f.Size
	}
	hashPos := writeHeaderSize + dataSize
	blockPos := hashPos + int64(hashCount)*16
	total := blockPos + int64(len(all))*16
	if total > math.MaxUint32 {
		return fmt.Errorf("mpq: %d MB is more than an archive of this format holds", total>>20)
	}
	if b, ok := w.(*bytes.Buffer); ok {
		b.Grow(int(total))
	}

	var header [writeHeaderSize]byte
	binary.LittleEndian.PutUint32(header[0:], 0x1a51504d) // "MPQ\x1a"
	binary.LittleEndian.PutUint32(header[4:], writeHeaderSize)
	binary.LittleEndian.PutUint32(header[8:], uint32(total))
	binary.LittleEndian.PutUint16(header[14:], sectorShift)
	binary.LittleEndian.PutUint32(header[16:], uint32(hashPos))
	binary.LittleEndian.PutUint32(header[20:], uint32(blockPos))
	binary.LittleEndian.PutUint32(header[24:], uint32(hashCount))
	binary.LittleEndian.PutUint32(header[28:], uint32(len(all)))
	if _, err := w.Write(header[:]); err != nil {
		return err
	}

	hashes := make([]byte, hashCount*16)
	for i := 0; i < hashCount; i++ {
		binary.LittleEndian.PutUint32(hashes[i*16+12:], hashEmpty)
	}
	used := make([]bool, hashCount)
	blocks := make([]byte, len(all)*16)

	// One copy buffer for every file: w's own ReadFrom (a file's, a bufio.Writer's) would take a new
	// one for each.
	out := struct{ io.Writer }{w}
	copyBuf := make([]byte, 64<<10)
	at := int64(writeHeaderSize)
	for index, f := range all {
		n, err := io.CopyBuffer(out, io.LimitReader(f.Data, f.Size), copyBuf)
		if err == nil && n < f.Size {
			err = io.ErrUnexpectedEOF
		}
		if err != nil {
			return fmt.Errorf("mpq: %s: %d of %d bytes: %w", f.Name, n, f.Size, err)
		}
		b := blocks[index*16:]
		binary.LittleEndian.PutUint32(b[0:], uint32(at))
		binary.LittleEndian.PutUint32(b[4:], uint32(f.Size))
		binary.LittleEndian.PutUint32(b[8:], uint32(f.Size))
		binary.LittleEndian.PutUint32(b[12:], fileExists)
		at += f.Size

		// Its slot: where the name hashes to, or the next free one after it.
		slot := hashString(f.Name, hashOffset) & mask
		for used[slot] {
			slot = (slot + 1) & mask
		}
		used[slot] = true
		h := hashes[int(slot)*16:]
		binary.LittleEndian.PutUint32(h[0:], hashString(f.Name, hashNameA))
		binary.LittleEndian.PutUint32(h[4:], hashString(f.Name, hashNameB))
		binary.LittleEndian.PutUint32(h[8:], 0) // neutral locale, any platform
		binary.LittleEndian.PutUint32(h[12:], uint32(index))
	}
	// Empty slots carry all-ones names, as the game's own tools leave them.
	for i := 0; i < hashCount; i++ {
		if used[i] {
			continue
		}
		h := hashes[i*16:]
		binary.LittleEndian.PutUint32(h[0:], hashEmpty)
		binary.LittleEndian.PutUint32(h[4:], hashEmpty)
		binary.LittleEndian.PutUint32(h[8:], hashEmpty)
	}
	encryptBytes(hashes, hashString("(hash table)", hashFileKey))
	encryptBytes(blocks, hashString("(block table)", hashFileKey))
	if _, err := w.Write(hashes); err != nil {
		return err
	}
	_, err := w.Write(blocks)
	return err
}

// encryptBytes encrypts little-endian words in place; decryptBytes undoes it.
func encryptBytes(b []byte, key uint32) {
	seed := uint32(0xEEEEEEEE)
	for o := 0; o+4 <= len(b); o += 4 {
		seed += cryptTable[0x400+(key&0xFF)]
		word := binary.LittleEndian.Uint32(b[o:])
		binary.LittleEndian.PutUint32(b[o:], word^(key+seed))
		key = ((^key << 0x15) + 0x11111111) | (key >> 0x0B)
		seed = word + seed + (seed << 5) + 3
	}
}

// The kinds a name is hashed for: its slot, the two halves of its check, and its encryption key.
const (
	hashOffset  = 0
	hashNameA   = 1
	hashNameB   = 2
	hashFileKey = 3
)
