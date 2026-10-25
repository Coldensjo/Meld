package adt

import (
	"encoding/binary"
	"testing"
)

// Fuzzers for the tile readers (#499): arbitrary bytes must give an error or a result, never a panic.
// Plain `go test` runs the seeds; `make fuzz` mutates them.

func FuzzParseTerrain(f *testing.F) {
	root := chunkBytes("MVER", []byte{18, 0, 0, 0})
	f.Add(append(root, mcnk(3, 5, 10, 0x0001)...))
	f.Add(root)
	f.Fuzz(func(t *testing.T, b []byte) {
		ParseTerrain(b)
	})
}

func FuzzParsePlacements(f *testing.F) {
	mmid := make([]byte, 8)
	binary.LittleEndian.PutUint32(mmid[4:], 5)
	mddf := make([]byte, 36)
	binary.LittleEndian.PutUint32(mddf[0:], 1)
	obj := append(chunkBytes("MMDX", []byte("a.m2\x00b.m2\x00")), chunkBytes("MMID", mmid)...)
	f.Add(append(obj, chunkBytes("MDDF", mddf)...))
	f.Add(append(obj, chunkBytes("MODF", make([]byte, 64))...))
	f.Fuzz(func(t *testing.T, b []byte) {
		ParsePlacements(b)
	})
}
