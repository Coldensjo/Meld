package wow

import (
	"testing"
)

// The fuzzers below feed the client's parsers arbitrary bytes and assert they neither panic nor hang
// (#499). Under plain `go test` they run only their seeds; `make fuzz` mutates them for a few
// seconds each. The seeds are the synthetic buffers the other tests build, no Blizzard bytes.

func FuzzParseM2(f *testing.F) {
	f.Add(shortM2(m2HeaderSize))
	f.Add(shortM2(0xB4))
	f.Add(shortM2(m2HeaderSize + 64))
	f.Add([]byte("MD20"))
	f.Fuzz(func(t *testing.T, b []byte) {
		ParseM2(b, `Creature\x\x.m2`)
		ParseM2(b, `World\Generic\Human\Passive Doodads\Torch\torch.m2`)
	})
}

func FuzzParseWMORoot(f *testing.F) {
	root := iffChunk("MVER", le(17))
	root = append(root, iffChunk("MOHD", le(0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))...)
	f.Add(root)
	f.Add(append(iffChunk("MVER", le(17)), iffChunk("MOHD", le(0, 0xFFFFFFFF, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))...))
	f.Fuzz(func(t *testing.T, b []byte) {
		ParseWMORoot(b)
		ParseWMONav(b, nil)
	})
}

func FuzzParseWMOGroup(f *testing.F) {
	f.Add(mliqGroup(0, 1, make([]byte, 6)))
	f.Add(mliqGroup(0x2000, 0, nil))
	f.Fuzz(func(t *testing.T, b []byte) {
		ParseWMOGroup(b, nil)
		GroupLiquid(b)
	})
}

func FuzzParseMLIQ(f *testing.F) {
	g := mliqGroup(0, 1, make([]byte, 6))
	f.Add(g[len(g)-30-12*8-6:])
	f.Add(le(0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, float32(0), float32(0), float32(0), u16(0)))
	f.Fuzz(func(t *testing.T, b []byte) {
		parseMLIQ(b)
	})
}

func FuzzDecodeBLP(f *testing.F) {
	pal := blpHeader(1, 8, 0, 2, 1, 4)
	f.Add(append(pal, 1, 0, 200, 50))
	f.Add(dxtBLP(8, 8, -1))
	f.Add(dxtBLP(4, 4, 1))
	f.Add(dxtBLP16(8, 8))
	f.Add(blpHeader(2, 8, 1, 4096, 4096, 0xFFFFFFF))
	f.Fuzz(func(t *testing.T, b []byte) {
		DecodeBLP(b)
	})
}

func FuzzDXTOf(f *testing.F) {
	f.Add(dxtBLP(8, 8, -1))
	f.Add(dxtBLP(4, 4, 1))
	f.Add(dxtBLP(16, 4, 2))
	f.Add(dxtBLP16(8, 8))
	f.Fuzz(func(t *testing.T, b []byte) {
		if d, ok := DXTOf(b); ok && (d == nil || len(d.Mips) == 0) {
			t.Fatalf("DXTOf said ok with %v", d)
		}
	})
}
