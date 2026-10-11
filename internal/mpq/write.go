package mpq

import (
	"encoding/binary"
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
const MarkerName = "(worldeditor)"

// MarkerText is the marker file's contents. Stored uncompressed, it can be found in the file.
const MarkerText = "WorldEditor map export: this patch was written by WorldEditor and is replaced by its next export."

// Write builds an MPQ archive (format 1) that the 1.12 client reads: each file is stored whole and
// uncompressed, found through encrypted hash and block tables. A (listfile) names the files, and
// the marker file is added. A file with the marker's name in files is replaced by it.
func Write(files []File) []byte {
	all := make([]File, 0, len(files)+2)
	for _, f := range files {
		if f.Name != "(listfile)" && f.Name != MarkerName {
			all = append(all, f)
		}
	}
	all = append(all, File{Name: MarkerName, Data: []byte(MarkerText)})
	var list strings.Builder
	for _, f := range all {
		list.WriteString(strings.ReplaceAll(f.Name, "/", `\`) + "\r\n")
	}
	all = append(all, File{Name: "(listfile)", Data: []byte(list.String())})

	// Room for twice the files, a power of two as the lookup needs.
	hashCount := 16
	for hashCount < len(all)*2 {
		hashCount *= 2
	}
	mask := uint32(hashCount - 1)
	dataSize := 0
	for _, f := range all {
		dataSize += len(f.Data)
	}
	hashPos := writeHeaderSize + dataSize
	blockPos := hashPos + hashCount*16
	out := make([]byte, blockPos+len(all)*16)

	binary.LittleEndian.PutUint32(out[0:], 0x1a51504d) // "MPQ\x1a"
	binary.LittleEndian.PutUint32(out[4:], writeHeaderSize)
	binary.LittleEndian.PutUint32(out[8:], uint32(len(out)))
	binary.LittleEndian.PutUint16(out[14:], sectorShift)
	binary.LittleEndian.PutUint32(out[16:], uint32(hashPos))
	binary.LittleEndian.PutUint32(out[20:], uint32(blockPos))
	binary.LittleEndian.PutUint32(out[24:], uint32(hashCount))
	binary.LittleEndian.PutUint32(out[28:], uint32(len(all)))

	hashes := make([]byte, hashCount*16)
	for i := 0; i < hashCount; i++ {
		binary.LittleEndian.PutUint32(hashes[i*16+12:], hashEmpty)
	}
	used := make([]bool, hashCount)
	blocks := make([]byte, len(all)*16)

	at := writeHeaderSize
	for index, f := range all {
		copy(out[at:], f.Data)
		b := blocks[index*16:]
		binary.LittleEndian.PutUint32(b[0:], uint32(at))
		binary.LittleEndian.PutUint32(b[4:], uint32(len(f.Data)))
		binary.LittleEndian.PutUint32(b[8:], uint32(len(f.Data)))
		binary.LittleEndian.PutUint32(b[12:], fileExists)
		at += len(f.Data)

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
	copy(out[hashPos:], hashes)
	copy(out[blockPos:], blocks)
	return out
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
