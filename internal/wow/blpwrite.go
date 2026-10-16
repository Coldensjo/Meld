package wow

import (
	"encoding/binary"
	"errors"
	"math"
)

// blpHeaderLen is a BLP2 file's fixed part: magic, type, the four format bytes, the size, sixteen mip
// offsets and sixteen sizes; a 256-colour palette (1024 bytes) follows it in every BLP2 file.
const blpHeaderLen = 148

// EncodeMinimapBLP writes a w by h RGBA image as the client's minimap tiles are stored (B-129): BLP2,
// type 1, DXT1 without alpha, one mip and a zeroed palette, so a 256x256 tile is 33940 bytes like the
// client's own (textures\Minimap, surveyed 2026-10-16). w and h must be multiples of 4.
func EncodeMinimapBLP(rgba []byte, w, h int) ([]byte, error) {
	if w <= 0 || h <= 0 || w%4 != 0 || h%4 != 0 {
		return nil, errors.New("blp: the size must be a positive multiple of 4")
	}
	if len(rgba) != w*h*4 {
		return nil, errors.New("blp: the pixels don't match the size")
	}
	data := EncodeDXT1(rgba, w, h)
	out := make([]byte, blpHeaderLen+1024, blpHeaderLen+1024+len(data))
	copy(out, "BLP2")
	binary.LittleEndian.PutUint32(out[4:], 1) // type 1: the BLP2 content kind every client texture has
	out[8] = 2                                // compression: DXT
	out[9] = 0                                // alpha depth 0: DXT1 without alpha
	out[10] = 0                               // alpha type
	out[11] = 0                               // no mips beyond the first
	binary.LittleEndian.PutUint32(out[12:], uint32(w))
	binary.LittleEndian.PutUint32(out[16:], uint32(h))
	binary.LittleEndian.PutUint32(out[20:], uint32(len(out)))
	binary.LittleEndian.PutUint32(out[20+64:], uint32(len(data)))
	return append(out, data...), nil
}

// EncodeDXT1 compresses a w by h RGBA image (multiples of 4) into DXT1 blocks, four colours each: the
// block's colours are fitted along their principal axis (the range fit stb_dxt and squish use), then
// each pixel takes the nearest of the four.
func EncodeDXT1(rgba []byte, w, h int) []byte {
	out := make([]byte, 0, w*h/2)
	var block [16][3]float64
	for by := 0; by < h; by += 4 {
		for bx := 0; bx < w; bx += 4 {
			for y := 0; y < 4; y++ {
				for x := 0; x < 4; x++ {
					i := ((by+y)*w + bx + x) * 4
					block[y*4+x] = [3]float64{float64(rgba[i]), float64(rgba[i+1]), float64(rgba[i+2])}
				}
			}
			out = append(out, dxt1Block(&block)...)
		}
	}
	return out
}

// dxt1Block encodes 16 colours as one 8-byte DXT1 block in its four-colour mode.
func dxt1Block(px *[16][3]float64) []byte {
	var mean [3]float64
	for _, c := range px {
		for k := 0; k < 3; k++ {
			mean[k] += c[k] / 16
		}
	}
	// The principal axis of the colours, by power iteration on their covariance.
	var cov [3][3]float64
	for _, c := range px {
		d := [3]float64{c[0] - mean[0], c[1] - mean[1], c[2] - mean[2]}
		for i := 0; i < 3; i++ {
			for j := 0; j < 3; j++ {
				cov[i][j] += d[i] * d[j]
			}
		}
	}
	axis := [3]float64{1, 1, 1}
	for it := 0; it < 8; it++ {
		var n [3]float64
		for i := 0; i < 3; i++ {
			n[i] = cov[i][0]*axis[0] + cov[i][1]*axis[1] + cov[i][2]*axis[2]
		}
		l := math.Sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2])
		if l < 1e-9 {
			break
		}
		axis = [3]float64{n[0] / l, n[1] / l, n[2] / l}
	}
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, c := range px {
		t := (c[0]-mean[0])*axis[0] + (c[1]-mean[1])*axis[1] + (c[2]-mean[2])*axis[2]
		lo = math.Min(lo, t)
		hi = math.Max(hi, t)
	}
	end := func(t float64) uint16 {
		return pack565(mean[0]+axis[0]*t, mean[1]+axis[1]*t, mean[2]+axis[2]*t)
	}
	c0, c1 := end(hi), end(lo)
	if c0 < c1 {
		c0, c1 = c1, c0
	}
	var idx uint32
	if c0 != c1 {
		// Four-colour mode (c0 > c1): the endpoints and the two thirds between them.
		var pal [4][3]float64
		pal[0] = unpack565(c0)
		pal[1] = unpack565(c1)
		for k := 0; k < 3; k++ {
			pal[2][k] = (2*pal[0][k] + pal[1][k]) / 3
			pal[3][k] = (pal[0][k] + 2*pal[1][k]) / 3
		}
		for i, c := range px {
			best, bestD := 0, math.Inf(1)
			for p := 0; p < 4; p++ {
				d := sq(c[0]-pal[p][0]) + sq(c[1]-pal[p][1]) + sq(c[2]-pal[p][2])
				if d < bestD {
					best, bestD = p, d
				}
			}
			idx |= uint32(best) << (2 * i)
		}
	}
	b := make([]byte, 8)
	binary.LittleEndian.PutUint16(b[0:], c0)
	binary.LittleEndian.PutUint16(b[2:], c1)
	binary.LittleEndian.PutUint32(b[4:], idx)
	return b
}

func sq(v float64) float64 { return v * v }

// pack565 rounds a colour (0 to 255 a channel, clamped) to RGB565.
func pack565(r, g, b float64) uint16 {
	q := func(v float64, bits uint) uint16 {
		m := float64(int(1)<<bits - 1)
		return uint16(math.Round(math.Max(0, math.Min(255, v)) / 255 * m))
	}
	return q(r, 5)<<11 | q(g, 6)<<5 | q(b, 5)
}

// unpack565 is an RGB565 colour back at 0 to 255 a channel, as rgb565 decodes it.
func unpack565(c uint16) [3]float64 {
	r, g, b := rgb565(c)
	return [3]float64{float64(r), float64(g), float64(b)}
}
