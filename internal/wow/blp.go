package wow

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// Image is a decoded RGBA8 texture (top row first).
type Image struct {
	W, H int
	Pix  []byte
}

// DecodeBLP decodes mip level 0 of a BLP2 texture (WoW 1.x - 3.x).
func DecodeBLP(b []byte) (*Image, error) {
	if len(b) < 148 || string(b[:4]) != "BLP2" {
		return nil, errors.New("blp: not a BLP2 file")
	}
	compression := b[8]
	alphaDepth := b[9]
	alphaType := b[10]
	w := int(binary.LittleEndian.Uint32(b[12:]))
	h := int(binary.LittleEndian.Uint32(b[16:]))
	if w <= 0 || h <= 0 || w > 4096 || h > 4096 {
		return nil, fmt.Errorf("blp: bad size %dx%d", w, h)
	}
	off := int(binary.LittleEndian.Uint32(b[20:]))
	size := int(binary.LittleEndian.Uint32(b[20+64:]))
	if off <= 0 || size <= 0 || off+size > len(b) {
		return nil, errors.New("blp: bad mip offset")
	}
	data := b[off : off+size]
	img := &Image{W: w, H: h, Pix: make([]byte, w*h*4)}

	switch compression {
	case 1: // palettized
		if len(b) < 148+1024 {
			return nil, errors.New("blp: missing palette")
		}
		pal := b[148 : 148+1024]
		n := w * h
		if len(data) < n {
			return nil, errors.New("blp: truncated indices")
		}
		alpha := data[n:]
		for i := 0; i < n; i++ {
			p := int(data[i]) * 4
			o := i * 4
			img.Pix[o] = pal[p+2]
			img.Pix[o+1] = pal[p+1]
			img.Pix[o+2] = pal[p]
			a := byte(255)
			switch alphaDepth {
			case 1:
				if i/8 < len(alpha) && alpha[i/8]>>(i%8)&1 == 0 {
					a = 0
				}
			case 4:
				if i/2 < len(alpha) {
					a = (alpha[i/2] >> ((i % 2) * 4) & 0xF) * 17
				}
			case 8:
				if i < len(alpha) {
					a = alpha[i]
				}
			}
			img.Pix[o+3] = a
		}
	case 2: // DXT
		var err error
		switch {
		case alphaType == 7:
			err = decodeDXT(img, data, 5)
		case alphaType == 1 && alphaDepth > 1:
			err = decodeDXT(img, data, 3)
		case alphaDepth == 8: // some files mark DXT5 via depth only
			err = decodeDXT(img, data, 3)
		default:
			err = decodeDXT(img, data, 1)
		}
		if err != nil {
			return nil, err
		}
	case 3: // raw BGRA
		if len(data) < w*h*4 {
			return nil, errors.New("blp: truncated raw data")
		}
		for i := 0; i < w*h; i++ {
			img.Pix[i*4] = data[i*4+2]
			img.Pix[i*4+1] = data[i*4+1]
			img.Pix[i*4+2] = data[i*4]
			img.Pix[i*4+3] = data[i*4+3]
		}
	default:
		return nil, fmt.Errorf("blp: unsupported compression %d", compression)
	}
	return img, nil
}

func rgb565(c uint16) (r, g, b int) {
	r = int(c>>11&0x1F) * 255 / 31
	g = int(c>>5&0x3F) * 255 / 63
	b = int(c&0x1F) * 255 / 31
	return
}

func decodeDXT(img *Image, data []byte, kind int) error {
	bw := (img.W + 3) / 4
	bh := (img.H + 3) / 4
	blockSize := 16
	if kind == 1 {
		blockSize = 8
	}
	if len(data) < bw*bh*blockSize {
		return errors.New("blp: truncated DXT data")
	}
	var colors [4][4]int
	var alphas [16]byte
	for by := 0; by < bh; by++ {
		for bx := 0; bx < bw; bx++ {
			blk := data[(by*bw+bx)*blockSize:]
			for i := range alphas {
				alphas[i] = 255
			}
			switch kind {
			case 3:
				for i := 0; i < 16; i++ {
					alphas[i] = (blk[i/2] >> ((i % 2) * 4) & 0xF) * 17
				}
				blk = blk[8:]
			case 5:
				a0, a1 := int(blk[0]), int(blk[1])
				var table [8]int
				table[0], table[1] = a0, a1
				if a0 > a1 {
					for i := 2; i < 8; i++ {
						table[i] = ((8-i)*a0 + (i-1)*a1) / 7
					}
				} else {
					for i := 2; i < 6; i++ {
						table[i] = ((6-i)*a0 + (i-1)*a1) / 5
					}
					table[6], table[7] = 0, 255
				}
				bits := uint64(blk[2]) | uint64(blk[3])<<8 | uint64(blk[4])<<16 | uint64(blk[5])<<24 | uint64(blk[6])<<32 | uint64(blk[7])<<40
				for i := 0; i < 16; i++ {
					alphas[i] = byte(table[bits>>(3*i)&7])
				}
				blk = blk[8:]
			}
			c0 := binary.LittleEndian.Uint16(blk[0:])
			c1 := binary.LittleEndian.Uint16(blk[2:])
			r0, g0, b0 := rgb565(c0)
			r1, g1, b1 := rgb565(c1)
			colors[0] = [4]int{r0, g0, b0, 255}
			colors[1] = [4]int{r1, g1, b1, 255}
			if kind != 1 || c0 > c1 {
				colors[2] = [4]int{(2*r0 + r1) / 3, (2*g0 + g1) / 3, (2*b0 + b1) / 3, 255}
				colors[3] = [4]int{(r0 + 2*r1) / 3, (g0 + 2*g1) / 3, (b0 + 2*b1) / 3, 255}
			} else {
				colors[2] = [4]int{(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255}
				colors[3] = [4]int{0, 0, 0, 0}
			}
			idx := binary.LittleEndian.Uint32(blk[4:])
			for py := 0; py < 4; py++ {
				y := by*4 + py
				if y >= img.H {
					break
				}
				for px := 0; px < 4; px++ {
					x := bx*4 + px
					if x >= img.W {
						continue
					}
					i := py*4 + px
					c := colors[idx>>(2*i)&3]
					o := (y*img.W + x) * 4
					img.Pix[o] = byte(c[0])
					img.Pix[o+1] = byte(c[1])
					img.Pix[o+2] = byte(c[2])
					if kind == 1 {
						img.Pix[o+3] = byte(c[3])
					} else {
						img.Pix[o+3] = alphas[i]
					}
				}
			}
		}
	}
	return nil
}
