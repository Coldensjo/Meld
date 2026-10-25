package mpq

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
)

// A test-only writer for the block layouts Write never produces: zlib-packed sectors with their
// offset table, single-unit files, encrypted files (with and without the fixed key) and the sector
// CRC table. Write stores every file whole, so these paths only ran on Blizzard's archives.

const testSector = 512 << sectorShift

type testFile struct {
	name  string
	data  []byte
	flags uint32 // flagCompress, flagSingleUnit, flagEncrypted, flagFixKey, flagSectorCRC
	// tamper changes the offset table (as uint32s, before encryption) to build a corrupt file.
	tamper func(offs []uint32)
}

func zlibPack(raw []byte) []byte {
	var z bytes.Buffer
	z.WriteByte(0x02)
	w := zlib.NewWriter(&z)
	w.Write(raw)
	w.Close()
	return z.Bytes()
}

func putWords(w []uint32) []byte {
	b := make([]byte, len(w)*4)
	for i, v := range w {
		binary.LittleEndian.PutUint32(b[i*4:], v)
	}
	return b
}

// buildArchive lays out the files after a 32-byte header and writes the hash and block tables.
func buildArchive(files []testFile) []byte {
	var body bytes.Buffer
	hashCount := 16
	hashes := make([]byte, hashCount*16)
	for i := 0; i < hashCount; i++ {
		binary.LittleEndian.PutUint32(hashes[i*16+12:], hashEmpty)
		binary.LittleEndian.PutUint32(hashes[i*16:], hashEmpty)
		binary.LittleEndian.PutUint32(hashes[i*16+4:], hashEmpty)
	}
	blocks := make([]byte, len(files)*16)
	for idx, f := range files {
		pos := uint32(writeHeaderSize + body.Len())
		size := uint32(len(f.data))
		var key uint32
		if f.flags&flagEncrypted != 0 {
			key = hashString(filepath.Base(f.name), hashFileKey)
			if f.flags&flagFixKey != 0 {
				key = (key + pos) ^ size
			}
		}
		packed := f.flags&flagCompress != 0
		var out []byte
		switch {
		case f.flags&flagSingleUnit != 0:
			out = f.data
			if packed {
				out = zlibPack(f.data)
			}
			out = append([]byte(nil), out...)
			if f.flags&flagEncrypted != 0 {
				encryptBytes(out, key)
			}
		case !packed:
			out = append([]byte(nil), f.data...)
			if f.flags&flagEncrypted != 0 {
				for i := 0; i*testSector < len(out); i++ {
					encryptBytes(out[i*testSector:min((i+1)*testSector, len(out))], key+uint32(i))
				}
			}
		default:
			n := (len(f.data) + testSector - 1) / testSector
			nOffs := n + 1
			if f.flags&flagSectorCRC != 0 {
				nOffs++
			}
			offs := make([]uint32, nOffs)
			var secs [][]byte
			at := uint32(nOffs * 4)
			for i := 0; i < n; i++ {
				raw := f.data[i*testSector : min((i+1)*testSector, len(f.data))]
				s := zlibPack(raw)
				if len(s) >= len(raw) {
					s = append([]byte(nil), raw...) // stored raw when packing doesn't help
				}
				if f.flags&flagEncrypted != 0 {
					encryptBytes(s, key+uint32(i))
				}
				offs[i] = at
				at += uint32(len(s))
				secs = append(secs, s)
			}
			offs[n] = at
			var crc []byte
			if f.flags&flagSectorCRC != 0 {
				crc = make([]byte, n*4)
				offs[n+1] = at + uint32(len(crc))
			}
			if f.tamper != nil {
				f.tamper(offs)
			}
			table := putWords(offs)
			if f.flags&flagEncrypted != 0 {
				encryptBytes(table, key-1)
			}
			out = table
			for _, s := range secs {
				out = append(out, s...)
			}
			out = append(out, crc...)
		}
		body.Write(out)
		b := blocks[idx*16:]
		binary.LittleEndian.PutUint32(b[0:], pos)
		binary.LittleEndian.PutUint32(b[4:], uint32(len(out)))
		binary.LittleEndian.PutUint32(b[8:], size)
		binary.LittleEndian.PutUint32(b[12:], f.flags|flagExists)

		slot := hashString(f.name, hashOffset) & uint32(hashCount-1)
		for binary.LittleEndian.Uint32(hashes[slot*16+12:]) != hashEmpty {
			slot = (slot + 1) & uint32(hashCount-1)
		}
		h := hashes[slot*16:]
		binary.LittleEndian.PutUint32(h[0:], hashString(f.name, hashNameA))
		binary.LittleEndian.PutUint32(h[4:], hashString(f.name, hashNameB))
		binary.LittleEndian.PutUint32(h[8:], 0)
		binary.LittleEndian.PutUint32(h[12:], uint32(idx))
	}
	encryptBytes(hashes, hashString("(hash table)", hashFileKey))
	encryptBytes(blocks, hashString("(block table)", hashFileKey))
	hashPos := writeHeaderSize + body.Len()
	blockPos := hashPos + len(hashes)
	var hdr [writeHeaderSize]byte
	binary.LittleEndian.PutUint32(hdr[0:], 0x1a51504d)
	binary.LittleEndian.PutUint32(hdr[4:], writeHeaderSize)
	binary.LittleEndian.PutUint32(hdr[8:], uint32(blockPos+len(blocks)))
	binary.LittleEndian.PutUint16(hdr[14:], sectorShift)
	binary.LittleEndian.PutUint32(hdr[16:], uint32(hashPos))
	binary.LittleEndian.PutUint32(hdr[20:], uint32(blockPos))
	binary.LittleEndian.PutUint32(hdr[24:], uint32(hashCount))
	binary.LittleEndian.PutUint32(hdr[28:], uint32(len(files)))
	var all bytes.Buffer
	all.Write(hdr[:])
	all.Write(body.Bytes())
	all.Write(hashes)
	all.Write(blocks)
	return all.Bytes()
}

func openBuilt(t *testing.T, files []testFile) *Archive {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.MPQ")
	if err := os.WriteFile(path, buildArchive(files), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	return a
}

// testPayload is 20000 bytes (five 4 KiB sectors, the last partial): compressible text, except the
// third sector, which is noise that zlib can't shrink and so is stored raw.
func testPayload() []byte {
	p := bytes.Repeat([]byte("terrain tile 0123456789 "), 1000)[:20000]
	rand.New(rand.NewSource(1)).Read(p[2*testSector : 3*testSector])
	return p
}

func TestReadCompressedAndEncrypted(t *testing.T) {
	payload := testPayload()
	cases := []struct {
		name  string
		flags uint32
	}{
		{`a\sectors.bin`, flagCompress},
		{`a\sectors_crc.bin`, flagCompress | flagSectorCRC},
		{`a\single.bin`, flagCompress | flagSingleUnit},
		{`a\single_plain.bin`, flagSingleUnit},
		{`a\enc_plain.bin`, flagEncrypted},
		{`a\enc_plain_fix.bin`, flagEncrypted | flagFixKey},
		{`a\enc_sectors.bin`, flagCompress | flagEncrypted},
		{`a\enc_sectors_fix.bin`, flagCompress | flagEncrypted | flagFixKey},
		{`a\enc_single.bin`, flagCompress | flagSingleUnit | flagEncrypted},
		{`a\enc_single_fix.bin`, flagCompress | flagSingleUnit | flagEncrypted | flagFixKey},
	}
	var files []testFile
	for _, c := range cases {
		files = append(files, testFile{name: c.name, data: payload, flags: c.flags})
	}
	a := openBuilt(t, files)
	for _, c := range cases {
		got, err := a.ReadFile(c.name)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if !bytes.Equal(got, payload) {
			t.Errorf("%s: read %d bytes that differ from the payload", c.name, len(got))
		}
		// Forward slashes and case find the same file.
		if _, err := a.ReadFile("A/" + c.name[2:]); err != nil {
			t.Errorf("%s by another spelling: %v", c.name, err)
		}
	}
}

func TestReadPrefixUnpacksOnlyNeededSectors(t *testing.T) {
	payload := testPayload()
	for _, flags := range []uint32{flagCompress, flagCompress | flagEncrypted, flagEncrypted, 0} {
		const name = `p.bin`
		a := openBuilt(t, []testFile{{name: name, data: payload, flags: flags}})
		for _, n := range []int{0, 1, testSector, testSector + 1, 3*testSector + 5, len(payload), len(payload) + 10} {
			got, err := a.ReadPrefix(name, n)
			if err != nil {
				t.Errorf("flags %x, n %d: %v", flags, n, err)
				continue
			}
			wantLen := min(len(payload), (n+testSector-1)/testSector*testSector)
			if n > 0 && (len(got) < min(n, len(payload)) || len(got) != wantLen) {
				t.Errorf("flags %x, n %d: %d bytes, want %d", flags, n, len(got), wantLen)
			}
			if !bytes.Equal(got, payload[:len(got)]) {
				t.Errorf("flags %x, n %d: prefix differs", flags, n)
			}
		}
	}
}

func TestReadCorruptSectorTables(t *testing.T) {
	payload := testPayload()
	cases := []struct {
		what   string
		tamper func(offs []uint32)
	}{
		{"offsets run backwards", func(o []uint32) { o[2], o[3] = o[3], o[2] }},
		{"sector shifted past the next", func(o []uint32) { o[1] += 50 }},
		{"end offset past the block", func(o []uint32) { o[5] = 0x7FFFFFFF }},
		{"end offset before a sector", func(o []uint32) { o[5] = o[4] - 1 }},
	}
	for _, c := range cases {
		for _, enc := range []uint32{0, flagEncrypted} {
			a := openBuilt(t, []testFile{{name: `bad.bin`, data: payload, flags: flagCompress | enc, tamper: c.tamper}})
			if got, err := a.ReadFile(`bad.bin`); err == nil && bytes.Equal(got, payload) {
				t.Errorf("%s (flags %x): read the payload from a corrupt table", c.what, enc)
			} else if err == nil {
				t.Errorf("%s (flags %x): read %d wrong bytes without an error", c.what, enc, len(got))
			}
		}
	}

	// A block whose sector table is cut off by the archive's end.
	a := openBuilt(t, []testFile{{name: `cut.bin`, data: payload, flags: flagCompress}})
	b, _ := a.find(`cut.bin`)
	b.pos = uint32(a.fileSize-a.base) - 8
	b.csize = 8
	if _, err := a.ReadFile(`cut.bin`); err == nil {
		t.Error("truncated sector table: want an error")
	}

	// Wrong key (a file renamed in its hash entry) decrypts to garbage and must fail, not panic.
	a = openBuilt(t, []testFile{{name: `k.bin`, data: payload, flags: flagCompress | flagEncrypted}})
	b, _ = a.find(`k.bin`)
	b.flags |= flagFixKey
	if got, err := a.ReadFile(`k.bin`); err == nil {
		t.Errorf("wrong key: read %d bytes without an error", len(got))
	}
}
