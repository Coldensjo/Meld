package mpq

import "testing"

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
