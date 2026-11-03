package wow

import (
	"fmt"
	"math"
	"strings"

	"Meld/internal/mpq"
)

// A model made or edited in Blender, turned into the client's files (#290): the GLB Blender saves
// becomes a still M2 (EncodeStaticM2) and one BLP a texture, under a folder of Meld's own in World\,
// so the client's own files are never written over.

// BuiltModel is a GLB turned into client files.
type BuiltModel struct {
	// Path is the M2's client path.
	Path string
	// Files are the M2 and its textures, to write into the client's patch.
	Files []mpq.File
	// Triangles and Textures count what the model holds.
	Triangles, Textures int
}

// maxModelTexture is the largest side a texture of a model made in Blender is written at.
const maxModelTexture = 1024

// BuildM2FromGLB turns GLB file glb into an M2 named name and its textures, all in client folder dir
// (World\Meld\<folder>, blender.ClientDir): <name>.m2, and <name>_<n>.blp a texture.
func BuildM2FromGLB(glb []byte, dir, name string) (BuiltModel, error) {
	parts, err := ReadGLB(glb)
	if err != nil {
		return BuiltModel{}, err
	}
	dir = strings.TrimRight(strings.ReplaceAll(dir, "/", `\`), `\`)
	out := BuiltModel{Path: dir + `\` + name + ".m2"}
	textures := map[*Image]string{}
	model := make([]ModelPart, 0, len(parts))
	for _, p := range parts {
		tex, ok := textures[p.Image]
		if !ok {
			tex = fmt.Sprintf(`%s\%s_%d.blp`, dir, name, len(textures))
			b, err := modelTextureBLP(p.Image, p.Blend != BlendOpaque)
			if err != nil {
				return BuiltModel{}, fmt.Errorf("texture of %q: %w", p.Name, err)
			}
			out.Files = append(out.Files, mpq.File{Name: tex, Data: b})
			textures[p.Image] = tex
		}
		mp := p.ModelPart
		mp.Texture = tex
		model = append(model, mp)
		out.Triangles += len(p.Index) / 3
	}
	m2, err := EncodeStaticM2(name, model)
	if err != nil {
		return BuiltModel{}, err
	}
	out.Textures = len(textures)
	out.Files = append([]mpq.File{{Name: out.Path, Data: m2}}, out.Files...)
	return out, nil
}

// modelTextureBLP writes img as a BLP the client takes: each side the nearest power of two (4 to
// maxModelTexture), with mips, DXT3 when alpha is drawn, else DXT1.
func modelTextureBLP(img *Image, alpha bool) ([]byte, error) {
	w, h := pow2Side(img.W), pow2Side(img.H)
	pix := img.Pix
	if w != img.W || h != img.H {
		pix = resizeRGBA(img.Pix, img.W, img.H, w, h)
	}
	return EncodeBLP(pix, w, h, alpha, true)
}

// pow2Side is the power of two nearest n (on a log scale), from 4 to maxModelTexture.
func pow2Side(n int) int {
	p := 1 << int(math.Round(math.Log2(float64(max(n, 1)))))
	return min(max(p, 4), maxModelTexture)
}

// resizeRGBA scales a w by h RGBA image to tw by th, one axis at a time: each new pixel the mean of the
// old ones it covers when shrinking, a linear blend of the two nearest when growing.
func resizeRGBA(pix []byte, w, h, tw, th int) []byte {
	// Rows first: w → tw.
	mid := make([]float64, tw*h*4)
	for y := 0; y < h; y++ {
		resample1D(func(x, k int) float64 { return float64(pix[(y*w+x)*4+k]) }, w, tw, func(x, k int, v float64) { mid[(y*tw+x)*4+k] = v })
	}
	out := make([]byte, tw*th*4)
	for x := 0; x < tw; x++ {
		resample1D(func(y, k int) float64 { return mid[(y*tw+x)*4+k] }, h, th, func(y, k int, v float64) {
			out[(y*tw+x)*4+k] = byte(math.Round(math.Max(0, math.Min(255, v))))
		})
	}
	return out
}

// resample1D scales a line of n RGBA pixels (read through get) to m (written through set).
func resample1D(get func(i, k int) float64, n, m int, set func(i, k int, v float64)) {
	scale := float64(n) / float64(m)
	for j := 0; j < m; j++ {
		if scale > 1 {
			// The source span [a, b) this pixel covers, partial pixels weighted.
			a, b := float64(j)*scale, float64(j+1)*scale
			for k := 0; k < 4; k++ {
				var sum, wsum float64
				for i := int(a); i < n && float64(i) < b; i++ {
					wgt := math.Min(b, float64(i+1)) - math.Max(a, float64(i))
					sum += get(i, k) * wgt
					wsum += wgt
				}
				set(j, k, sum/math.Max(wsum, 1e-9))
			}
			continue
		}
		c := (float64(j)+0.5)*scale - 0.5
		i0 := int(math.Floor(c))
		t := c - float64(i0)
		i1 := min(max(i0+1, 0), n-1)
		i0 = min(max(i0, 0), n-1)
		for k := 0; k < 4; k++ {
			set(j, k, get(i0, k)*(1-t)+get(i1, k)*t)
		}
	}
}
