package wow

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestInteriorBoxMarksEffects(t *testing.T) {
	// MOGP header: name, desc, flags (interior), bbox min/max in WoW space.
	hdr := make([]byte, 68)
	binary.LittleEndian.PutUint32(hdr[8:], 0x2000)
	for i, v := range []float32{0, 0, 0, 10, 20, 5} {
		binary.LittleEndian.PutUint32(hdr[12+i*4:], math.Float32bits(v))
	}
	file := append([]byte("PGOM"), 68, 0, 0, 0)
	file = append(file, hdr...)
	box, ok := InteriorBox(file)
	if !ok {
		t.Fatal("interior group not detected")
	}
	// WoW (x, y, z) → editor (x, z, -y): y 0..20 becomes z -20..0.
	if box != [6]float32{0, 0, -20, 10, 5, 0} {
		t.Fatalf("box = %v", box)
	}
	fx := []Effect{{Pos: [3]float32{5, 2, -10}}, {Pos: [3]float32{5, 2, 10}}}
	markInterior(fx, [][6]float32{box})
	if !fx[0].Interior || fx[1].Interior {
		t.Fatalf("interior flags = %v, %v", fx[0].Interior, fx[1].Interior)
	}

	binary.LittleEndian.PutUint32(hdr[8:], 0x8)
	file = append(append([]byte("PGOM"), 68, 0, 0, 0), hdr...)
	if _, ok := InteriorBox(file); ok {
		t.Fatal("exterior group reported as interior")
	}
}
