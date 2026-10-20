package wow

import (
	"encoding/binary"
	"errors"
	"strconv"
	"strings"
)

// A character's body texture, as the game builds it for a player or an NPC without a baked one: the
// skin (CharSections), then the face, facial hair, scalp and underwear, then the worn items' body
// textures (ItemDisplayInfo fields 14-21), each painted over its region of the skin. A look names it
// as a texture path (ComposedTexture), which Texture draws.

// The regions of a 1.12 character's 256x256 body texture.
const (
	RegionBase = iota
	RegionArmUpper
	RegionArmLower
	RegionHand
	RegionFaceUpper
	RegionFaceLower
	RegionTorsoUpper
	RegionTorsoLower
	RegionLegUpper
	RegionLegLower
	RegionFoot
	regionCount
)

// regionRects are the regions' x, y, width and height on the 256x256 layout (as WoW Model Viewer
// has them for the pre-Cataclysm clients). A larger skin scales them.
var regionRects = [regionCount][4]int{
	{0, 0, 256, 256},
	{0, 0, 128, 64},
	{0, 64, 128, 64},
	{0, 128, 128, 32},
	{0, 160, 128, 32},
	{0, 192, 128, 64},
	{128, 0, 128, 64},
	{128, 64, 128, 32},
	{128, 96, 128, 64},
	{128, 160, 128, 64},
	{128, 224, 128, 32},
}

// SkinLayer is a client texture painted over one region of a body texture.
type SkinLayer struct {
	Region int
	Path   string
}

// composedPrefix starts a composed texture's path; no client file has a colon in its name.
const composedPrefix = "compose:"

// ComposedTexture names the body texture made of layers, painted in order, the first the base (the
// skin, RegionBase): "compose:<region>=<path>|..." with each layer. It holds no '?', which would end
// the path in the frontend's URLs (api.ts url).
func ComposedTexture(layers []SkinLayer) string {
	var b strings.Builder
	b.WriteString(composedPrefix)
	for i, l := range layers {
		if i > 0 {
			b.WriteByte('|')
		}
		b.WriteString(strconv.Itoa(l.Region))
		b.WriteByte('=')
		b.WriteString(l.Path)
	}
	return b.String()
}

// parseComposed reads a ComposedTexture name; ok is false for a client file's path.
func parseComposed(path string) (layers []SkinLayer, ok bool) {
	if len(path) < len(composedPrefix) || !strings.EqualFold(path[:len(composedPrefix)], composedPrefix) {
		return nil, false
	}
	for _, s := range strings.Split(path[len(composedPrefix):], "|") {
		r, p, found := strings.Cut(s, "=")
		n, err := strconv.Atoi(r)
		if !found || err != nil || n < 0 || n >= regionCount || p == "" || strings.ContainsAny(p, "?") {
			continue
		}
		layers = append(layers, SkinLayer{Region: n, Path: p})
	}
	return layers, true
}

// composeTexture draws a composed body texture: the first layer is the canvas, and each other is
// scaled into its region and painted over it by its alpha. A layer the client lacks is left out.
func (c *Client) composeTexture(layers []SkinLayer) (*Image, error) {
	if len(layers) == 0 || layers[0].Region != RegionBase {
		return nil, errors.New("a composed texture starts with its skin")
	}
	raw, err := c.read(layers[0].Path)
	if err != nil {
		return nil, err
	}
	base, err := DecodeBLP(raw)
	if err != nil {
		return nil, err
	}
	out := &Image{W: base.W, H: base.H, Pix: append([]byte(nil), base.Pix...)}
	for _, l := range layers[1:] {
		raw, err := c.read(l.Path)
		if err != nil {
			continue
		}
		img, err := DecodeBLP(raw)
		if err != nil {
			continue
		}
		paintRegion(out, img, l.Region)
	}
	return out, nil
}

// paintRegion paints img over the region of dst, scaled to it (nearest texel), blending by img's
// alpha. dst keeps its own alpha.
func paintRegion(dst, img *Image, region int) {
	r := regionRects[region]
	x0, y0 := r[0]*dst.W/256, r[1]*dst.H/256
	w, h := r[2]*dst.W/256, r[3]*dst.H/256
	if w <= 0 || h <= 0 || img.W <= 0 || img.H <= 0 {
		return
	}
	for y := 0; y < h && y0+y < dst.H; y++ {
		sy := y * img.H / h
		for x := 0; x < w && x0+x < dst.W; x++ {
			s := (sy*img.W + x*img.W/w) * 4
			a := int(img.Pix[s+3])
			if a == 0 {
				continue
			}
			d := ((y0+y)*dst.W + x0 + x) * 4
			for k := 0; k < 3; k++ {
				dst.Pix[d+k] = byte((int(img.Pix[s+k])*a + int(dst.Pix[d+k])*(255-a) + 127) / 255)
			}
		}
	}
}

// encodeImage is Texture's reply for an image: "RGBA", the width and height, then the pixels.
func encodeImage(img *Image) []byte {
	out := make([]byte, 12+len(img.Pix))
	copy(out, "RGBA")
	binary.LittleEndian.PutUint32(out[4:], uint32(img.W))
	binary.LittleEndian.PutUint32(out[8:], uint32(img.H))
	copy(out[12:], img.Pix)
	return out
}
