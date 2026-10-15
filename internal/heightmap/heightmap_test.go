package heightmap

import (
	"bytes"
	"image/png"
	"math"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	const side = 33
	heights := make([]float32, side*side)
	for i := range heights {
		heights[i] = float32(math.Sin(float64(i)/7)*120 + 3)
	}
	data, err := Encode(side, heights)
	if err != nil {
		t.Fatal(err)
	}
	got, back, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if got != side || len(back) != len(heights) {
		t.Fatalf("size %d, %d heights", got, len(back))
	}
	// 16 bits across 2048 yards: about a 0.03 yard step.
	for i := range heights {
		if d := math.Abs(float64(back[i] - heights[i])); d > 0.04 {
			t.Fatalf("height %d: %v came back as %v", i, heights[i], back[i])
		}
	}
}

func TestHeightsOutsideTheRangeAreClamped(t *testing.T) {
	data, err := Encode(2, []float32{-5000, 5000, 0, 1})
	if err != nil {
		t.Fatal(err)
	}
	_, back, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if back[0] != Min || back[1] != Max {
		t.Fatalf("clamped = %v %v", back[0], back[1])
	}
}

func TestRejectsNonSquare(t *testing.T) {
	if _, err := Encode(3, make([]float32, 8)); err == nil {
		t.Fatal("a grid of the wrong size was encoded")
	}
}

func TestEncodeRGB(t *testing.T) {
	data, err := EncodeRGB(2, []byte{255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 255})
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if r, g, b, _ := img.At(1, 1).RGBA(); r>>8 != 128 || g>>8 != 128 || b>>8 != 255 {
		t.Fatalf("pixel (1, 1) = %d %d %d", r>>8, g>>8, b>>8)
	}
	if _, err := EncodeRGB(2, make([]byte, 5)); err == nil {
		t.Fatal("a short buffer must be refused")
	}
}
