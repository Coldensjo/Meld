package mpq

import (
	"bytes"
	"compress/zlib"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestHashStringKnownKeys(t *testing.T) {
	// Well-known MPQ table keys.
	if got := hashString("(hash table)", 3); got != 0xC3AF3770 {
		t.Fatalf("hash table key = %08x", got)
	}
	if got := hashString("(block table)", 3); got != 0xEC83B3A3 {
		t.Fatalf("block table key = %08x", got)
	}
	// Case and slash insensitive.
	if hashString(`World/Foo.m2`, 0) != hashString(`WORLD\foo.M2`, 0) {
		t.Fatal("hash should ignore case and slash style")
	}
}

func TestDecryptRoundTrip(t *testing.T) {
	// Encrypting is the inverse of decrypt; verify via a known-plaintext loop.
	plain := []uint32{1, 2, 3, 0xDEADBEEF}
	enc := make([]uint32, len(plain))
	key := uint32(0x12345678)
	seed := uint32(0xEEEEEEEE)
	k := key
	for i, v := range plain {
		seed += cryptTable[0x400+(k&0xFF)]
		enc[i] = v ^ (k + seed)
		k = ((^k << 0x15) + 0x11111111) | (k >> 0x0B)
		seed = v + seed + (seed << 5) + 3
	}
	decrypt(enc, key)
	for i := range plain {
		if enc[i] != plain[i] {
			t.Fatalf("word %d: %x != %x", i, enc[i], plain[i])
		}
	}
}

// A damaged block entry must fail the read instead of asking for gigabytes, and a sector that unpacks
// to the wrong length must fail instead of handing the parsers a short or long file (#495).
func TestReadFileRejectsCorruptBlocks(t *testing.T) {
	payload := bytes.Repeat([]byte("alpha map "), 400)
	var z bytes.Buffer
	z.WriteByte(0x02) // zlib
	zw := zlib.NewWriter(&z)
	zw.Write(payload)
	zw.Close()
	packed := z.Bytes()
	const name = `World\Maps\Test\packed.adt`
	path := filepath.Join(t.TempDir(), "patch-3.MPQ")
	if err := os.WriteFile(path, Write([]File{{Name: name, Data: packed}, {Name: `plain.txt`, Data: []byte("plain")}}), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, ok := a.find(name)
	if !ok {
		t.Fatal("packed file not found")
	}
	orig := *b
	set := func(csize, size, flags uint32) {
		*b = orig
		b.csize, b.size, b.flags = csize, size, flags
	}
	single := uint32(flagExists | flagSingleUnit | flagCompress)
	n := uint32(len(packed))
	want := uint32(len(payload))

	// A good single-unit zlib file reads back whole.
	set(n, want, single)
	if got, err := a.ReadFile(name); err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("good zlib file: %d bytes, %v", len(got), err)
	}
	cases := []struct {
		what               string
		csize, size, flags uint32
	}{
		{"packed size past the archive's end", 0xFFFFFFF0, want, single},
		{"unpacked size of 4 GiB", n, 0xFFFFFFF0, single},
		{"plain file past the archive's end", n, 0xFFFFFFF0, flagExists},
		{"sector unpacks short", n, want + 100, single},
		{"sector unpacks long", n, want - 100, single},
		{"short and not packed", n, n + 10, flagExists | flagSingleUnit},
	}
	for _, c := range cases {
		set(c.csize, c.size, c.flags)
		if got, err := a.ReadFile(name); err == nil {
			t.Errorf("%s: read %d bytes, want an error", c.what, len(got))
		}
	}
	// A plain file whose data runs past the archive's end is corrupt, not zero-filled.
	set(n, n, flagExists)
	b.pos = uint32(a.fileSize-a.base) - n/2
	if _, err := a.ReadFile(name); !errors.Is(err, errCorrupt) {
		t.Errorf("file past the end: %v, want errCorrupt", err)
	}
	*b = orig
	if got, err := a.ReadFile(`plain.txt`); err != nil || string(got) != "plain" {
		t.Fatalf("plain.txt = %q, %v", got, err)
	}
}
