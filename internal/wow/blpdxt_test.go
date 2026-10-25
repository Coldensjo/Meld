package wow

import (
	"encoding/binary"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// dxtBLP is a DXT1 BLP of w by h with its mips down to 1x1 (levels of them, -1 for all), each block
// filled with its level number.
func dxtBLP(w, h, levels int) []byte {
	b := blpHeader(2, 0, 0, w, h, 0)
	b[11] = 1
	lw, lh := w, h
	for level := 0; level < 16 && levels != 0; level++ {
		n := ((lw + 3) / 4) * ((lh + 3) / 4) * 8
		binary.LittleEndian.PutUint32(b[20+4*level:], uint32(len(b)))
		binary.LittleEndian.PutUint32(b[84+4*level:], uint32(n))
		for i := 0; i < n; i++ {
			b = append(b, byte(level))
		}
		levels--
		if lw == 1 && lh == 1 {
			break
		}
		lw, lh = max(1, lw/2), max(1, lh/2)
	}
	return b
}

func TestDXTOfGivesTheWholeMipChain(t *testing.T) {
	d, ok := DXTOf(dxtBLP(8, 4, -1))
	if !ok {
		t.Fatal("a whole chain was refused")
	}
	if d.Kind != 1 || d.W != 8 || d.H != 4 || len(d.Mips) != 4 {
		t.Fatalf("got kind %d, %dx%d, %d mips", d.Kind, d.W, d.H, len(d.Mips))
	}
	// 8x4 is two blocks, then 4x2, 2x1 and 1x1 one each.
	for level, want := range []int{16, 8, 8, 8} {
		if len(d.Mips[level]) != want || d.Mips[level][0] != byte(level) {
			t.Fatalf("mip %d: %d bytes starting %d", level, len(d.Mips[level]), d.Mips[level][0])
		}
	}
}

func TestDXTOfRefusesWhatTheGPUCantTakeWhole(t *testing.T) {
	cases := map[string][]byte{
		"a chain short of 1x1":       dxtBLP(8, 8, 2),
		"a size not a multiple of 4": dxtBLP(6, 4, -1),
		"palettized":                 blpHeader(1, 8, 0, 4, 4, 16),
	}
	noMips := dxtBLP(4, 4, -1)
	noMips[11] = 0
	cases["no mips flag"] = noMips
	for name, b := range cases {
		if _, ok := DXTOf(b); ok {
			t.Errorf("%s was taken", name)
		}
	}
}

func TestDXTOfPicksTheKindDecodeBLPDoes(t *testing.T) {
	for _, c := range []struct {
		depth, typ byte
		kind       int
	}{{0, 0, 1}, {1, 0, 1}, {8, 1, 3}, {4, 1, 3}, {8, 7, 5}, {8, 0, 3}} {
		b := dxtBLP(4, 4, -1)
		b[9], b[10] = c.depth, c.typ
		// DXT3 and DXT5 blocks are twice the size: the DXT1-sized fixture is then short, so give each
		// level room by doubling the file's tail.
		if c.kind != 1 {
			b = dxtBLP16(4, 4)
			b[9], b[10] = c.depth, c.typ
		}
		d, ok := DXTOf(b)
		if !ok || d.Kind != c.kind {
			t.Errorf("depth %d type %d: kind %v (ok %v), want %d", c.depth, c.typ, d, ok, c.kind)
		}
	}
}

// dxtBLP16 is a 4x4 BLP with 16-byte blocks down to 1x1.
func dxtBLP16(w, h int) []byte {
	b := blpHeader(2, 8, 1, w, h, 0)
	b[11] = 1
	lw, lh := w, h
	for level := 0; level < 16; level++ {
		n := ((lw + 3) / 4) * ((lh + 3) / 4) * 16
		binary.LittleEndian.PutUint32(b[20+4*level:], uint32(len(b)))
		binary.LittleEndian.PutUint32(b[84+4*level:], uint32(n))
		b = append(b, make([]byte, n)...)
		if lw == 1 && lh == 1 {
			break
		}
		lw, lh = max(1, lw/2), max(1, lh/2)
	}
	return b
}

// TestClientTexturesAsDXT counts the client's model and tileset BLPs DXTOf takes whole, and checks
// each one's first level decodes to the same pixels DecodeBLP gives (the GPU path shows what the
// RGBA path did). WOW_DIR=/path/to/client go test ./internal/wow/ -run ClientTexturesAsDXT -v
func TestClientTexturesAsDXT(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	var names []string
	for _, a := range set.Archives() {
		list, _ := a.ListFile()
		for _, n := range list {
			low := strings.ToLower(n)
			if strings.HasSuffix(low, ".blp") && (strings.HasPrefix(low, `world\`) || strings.HasPrefix(low, `tileset\`) || strings.HasPrefix(low, `creature\`) || strings.HasPrefix(low, `xtextures\`)) {
				names = append(names, n)
			}
		}
	}
	taken, other, bytesDXT, bytesRGBA := 0, 0, 0, 0
	for i, n := range names {
		if i%7 != 0 { // a sample keeps the run short
			continue
		}
		raw, err := set.ReadFile(n)
		if err != nil {
			continue
		}
		d, ok := DXTOf(raw)
		if !ok {
			other++
			continue
		}
		taken++
		for _, m := range d.Mips {
			bytesDXT += len(m)
		}
		bytesRGBA += d.W * d.H * 4 * 4 / 3
		img, err := DecodeBLP(raw)
		if err != nil {
			t.Fatalf("%s: %v", n, err)
		}
		again := &Image{W: d.W, H: d.H, Pix: make([]byte, d.W*d.H*4)}
		if err := decodeDXT(again, d.Mips[0], d.Kind); err != nil {
			t.Fatalf("%s: %v", n, err)
		}
		if string(again.Pix) != string(img.Pix) {
			t.Fatalf("%s: the blocks DXTOf gives decode to other pixels", n)
		}
	}
	t.Logf("%d of %d sampled textures go as DXT; %d MB of blocks against %d MB of RGBA with mips", taken, taken+other, bytesDXT>>20, bytesRGBA>>20)
	if taken == 0 {
		t.Fatal("no client texture went as DXT")
	}
}
