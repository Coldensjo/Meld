package wow

import (
	"encoding/binary"
	"testing"
)

func blpHeader(compression, alphaDepth, alphaType byte, w, h int, mipSize int) []byte {
	b := make([]byte, 148+1024)
	copy(b, "BLP2")
	binary.LittleEndian.PutUint32(b[4:], 1)
	b[8], b[9], b[10], b[11] = compression, alphaDepth, alphaType, 0
	binary.LittleEndian.PutUint32(b[12:], uint32(w))
	binary.LittleEndian.PutUint32(b[16:], uint32(h))
	binary.LittleEndian.PutUint32(b[20:], uint32(len(b)))
	binary.LittleEndian.PutUint32(b[84:], uint32(mipSize))
	return b
}

func TestDecodePalettized(t *testing.T) {
	b := blpHeader(1, 8, 0, 2, 1, 4)
	// palette entry 1 = BGRA(10,20,30)
	b[148+4], b[148+5], b[148+6] = 10, 20, 30
	b = append(b, 1, 0, 200, 50) // indices then 8-bit alpha
	img, err := DecodeBLP(b)
	if err != nil {
		t.Fatal(err)
	}
	if got := img.Pix[:4]; got[0] != 30 || got[1] != 20 || got[2] != 10 || got[3] != 200 {
		t.Fatalf("pixel 0 = %v", got)
	}
	if img.Pix[7] != 50 {
		t.Fatalf("alpha 1 = %d", img.Pix[7])
	}
}

func TestDecodeDXT1(t *testing.T) {
	b := blpHeader(2, 0, 0, 4, 4, 8)
	// c0 = pure red (0xF800), c1 = black, all indices 0
	b = append(b, 0x00, 0xF8, 0x00, 0x00, 0, 0, 0, 0)
	img, err := DecodeBLP(b)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 16; i++ {
		p := img.Pix[i*4 : i*4+4]
		if p[0] != 255 || p[1] != 0 || p[2] != 0 || p[3] != 255 {
			t.Fatalf("pixel %d = %v", i, p)
		}
	}
}
