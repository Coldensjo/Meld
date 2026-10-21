package adt

import (
	"encoding/binary"
	"math"
	"strings"
)

// The editor holds a chunk's paint at half the client's resolution: 32x32 texel weights, each the
// box average of a 2x2 block of the 64x64 alpha maps (frontend/src/lib/io/tileImport.ts, tilePaint).
// LayersFromWeights scales them back up by repeating each weight over its block, so a chunk written
// from its weights alone would lose half its detail even where nothing was painted, and a region's
// compile sends every chunk (#526). KeepClientAlpha puts the client's own alpha back wherever the
// weights are still the ones the editor read from it.

// ClientWeights gives a chunk's texel weights as the editor reads them from the chunk's own layers
// (tilePaint): perSide texels a side, four weights a texel (the first len(own.Layers) used), each
// texel summing to 255. KeepClientAlpha compares against it exactly, so it must follow tilePaint to
// the unit: the same sums, the same order of float operations and the same rounding.
func ClientWeights(own TexChunk, perSide int) []byte {
	out := make([]byte, perSide*perSide*4)
	n := min(len(own.Layers), 4)
	if n == 0 || perSide <= 0 || AlphaSize%perSide != 0 || len(own.Alpha) < n-1 {
		return out
	}
	step := AlphaSize / perSide
	var alphas, w [4]float64
	for v := 0; v < perSide; v++ {
		for u := 0; u < perSide; u++ {
			for k := 1; k < n; k++ {
				alpha := own.Alpha[k-1]
				sum := 0
				for by := 0; by < step; by++ {
					row := (v*step+by)*AlphaSize + u*step
					for bx := 0; bx < step; bx++ {
						sum += int(alpha[row+bx])
					}
				}
				alphas[k] = float64(sum) / float64(step*step) / 255
			}
			// The game blends the layers in order: layer k shows alpha_k of what the layers above it leave.
			rest := 1.0
			for k := n - 1; k >= 1; k-- {
				w[k] = alphas[k] * rest
				rest *= 1 - alphas[k]
			}
			w[0] = rest
			t := (v*perSide + u) * 4
			for k := 0; k < n; k++ {
				out[t+k] = byte(math.Round(w[k] * 255))
			}
			normalizeTexel(out[t : t+4])
		}
	}
	return out
}

// normalizeTexel makes a texel's four weights sum to 255, as chunkPaint.ts's normalizeTexel does:
// scaled in proportion, the rounding's remainder going to the largest.
func normalizeTexel(w []byte) {
	sum := 0
	for _, v := range w[:4] {
		sum += int(v)
	}
	if sum == 255 {
		return
	}
	if sum == 0 {
		w[0] = 255
		return
	}
	largest := 0
	for k := 1; k < 4; k++ {
		if w[k] > w[largest] {
			largest = k
		}
	}
	total := 0
	for k := 0; k < 4; k++ {
		w[k] = byte(math.Round(float64(int(w[k])*255) / float64(sum)))
		total += int(w[k])
	}
	w[largest] = byte(max(0, min(255, int(w[largest])+255-total)))
}

// KeepClientAlpha puts the chunk's own alpha (own, as ParseTextures reads it) back into p's layers on
// every texel whose weights (as LayersFromWeights took them: perSide texels a side, four a texel) are
// still those ClientWeights reads from own: that texel was not painted, so it keeps the client's full
// resolution rather than its block repeated. p's first layers must be own's textures in the same
// order; a layer past own's (a texture painted in) must weigh nothing on a texel for it to be kept.
// When every texel is kept and p has no layer own lacks, p.ClientAlpha is set: the chunk keeps its own
// alpha bytes, layer records and predominant texture map, so an unpainted chunk is written as the
// client has it.
func (p *ChunkPaint) KeepClientAlpha(own TexChunk, weights []byte, perSide int) {
	n := len(own.Layers)
	if n == 0 || n > 4 || n > len(p.Layers) || len(own.Alpha) < n-1 || perSide <= 0 || AlphaSize%perSide != 0 ||
		len(weights) != perSide*perSide*4 {
		return
	}
	for k := range p.Layers {
		if k < n && !strings.EqualFold(p.Layers[k].Texture, own.Layers[k].Texture) {
			return
		}
		if k > 0 && len(p.Layers[k].Alpha) != AlphaSize*AlphaSize {
			return
		}
	}
	client := ClientWeights(own, perSide)
	step := AlphaSize / perSide
	all := true
	for t := 0; t < perSide*perSide; t++ {
		same := true
		for k := range p.Layers {
			want := byte(0)
			if k < n {
				want = client[t*4+k]
			}
			if weights[t*4+k] != want {
				same = false
				break
			}
		}
		if !same {
			all = false
			continue
		}
		u, v := t%perSide, t/perSide
		for by := 0; by < step; by++ {
			row := (v*step+by)*AlphaSize + u*step
			for bx := 0; bx < step; bx++ {
				for k := 1; k < len(p.Layers); k++ {
					a := byte(0)
					if k < n {
						a = own.Alpha[k-1][row+bx]
					}
					p.Layers[k].Alpha[row+bx] = a
				}
			}
		}
	}
	if all && len(p.Layers) == n {
		p.ClientAlpha = true
		p.Predominant = nil
	}
}

// ownLayers is a chunk's own MCLY (raw: its sub-chunk header and records) with the effects and look
// flags that layers name written over its records, for a chunk that keeps its own alpha
// (ChunkPaint.ClientAlpha). Nil when the records are not one for each layer.
func ownLayers(raw []byte, layers []Layer) []byte {
	if len(raw) < 8 {
		return nil
	}
	size := int(binary.LittleEndian.Uint32(raw[4:]))
	if size != 16*len(layers) || 8+size > len(raw) {
		return nil
	}
	out := append([]byte(nil), raw...)
	for l, layer := range layers {
		o := 8 + l*16
		if layer.Flags != nil {
			f := binary.LittleEndian.Uint32(out[o+4:])
			binary.LittleEndian.PutUint32(out[o+4:], f&^LayerLookFlags|*layer.Flags&LayerLookFlags)
		}
		if layer.Effect != 0 {
			binary.LittleEndian.PutUint32(out[o+12:], layer.Effect)
		}
	}
	return out
}
