package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"io"
	"os"

	"Meld/internal/wow"
)

// blpInfo is what blp decode and blp encode print: the texture's header, and the files read and
// written.
type blpInfo struct {
	File string `json:"file"`
	Out  string `json:"out"`
	W    int    `json:"width"`
	H    int    `json:"height"`
	// Format names the header's compression: dxt1, dxt3, dxt5, palette or raw.
	Format     string `json:"format"`
	AlphaDepth int    `json:"alphaDepth"`
	// Mips counts the mip levels the file holds.
	Mips  int `json:"mips"`
	Bytes int `json:"bytes"`
}

// readBLPInfo reads a BLP2 header as blpInfo.
func readBLPInfo(b []byte) blpInfo {
	if len(b) < 148 || string(b[:4]) != "BLP2" {
		return blpInfo{}
	}
	info := blpInfo{W: int(binary.LittleEndian.Uint32(b[12:])), H: int(binary.LittleEndian.Uint32(b[16:])), AlphaDepth: int(b[9]), Bytes: len(b)}
	switch {
	case b[8] == 1:
		info.Format = "palette"
	case b[8] == 2 && b[10] == 7:
		info.Format = "dxt5"
	case b[8] == 2 && (b[10] == 1 && b[9] > 1 || b[9] == 8):
		info.Format = "dxt3"
	case b[8] == 2:
		info.Format = "dxt1"
	default:
		info.Format = "raw"
	}
	for i := 0; i < 16; i++ {
		if binary.LittleEndian.Uint32(b[20+i*4:]) == 0 || binary.LittleEndian.Uint32(b[20+64+i*4:]) == 0 {
			break
		}
		info.Mips++
		if b[11] == 0 {
			break
		}
	}
	return info
}

// blpDecode writes a BLP texture (a file, or an archive path read from the client) as a PNG: its
// first mip level, with its alpha.
func blpDecode(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("blp decode", flag.ContinueOnError)
	clientDir := fs.String("client", "", "client folder, Data folder or .MPQ")
	dest := fs.String("o", "", "the PNG to write")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 || *dest == "" {
		return fmt.Errorf("%w: blp decode takes one texture and -o out.png", errUsage)
	}
	src := &tileSource{dir: *clientDir}
	defer src.close()
	data, err := src.file(pos[0])
	if err != nil {
		return err
	}
	img, err := wow.DecodeBLP(data)
	if err != nil {
		return fmt.Errorf("%s: %w", pos[0], err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, &image.NRGBA{Pix: img.Pix, Stride: img.W * 4, Rect: image.Rect(0, 0, img.W, img.H)}); err != nil {
		return err
	}
	if err := os.WriteFile(*dest, buf.Bytes(), 0o644); err != nil {
		return err
	}
	info := readBLPInfo(data)
	info.File, info.Out = pos[0], *dest
	return writeJSON(out, info)
}

// blpEncode writes a PNG as a BLP texture in the client's own form (wow.EncodeBLP): DXT1, or DXT3
// when the image has alpha, with mips.
func blpEncode(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("blp encode", flag.ContinueOnError)
	dest := fs.String("o", "", "the BLP to write")
	format := fs.String("format", "auto", "auto (dxt3 when the image has alpha, else dxt1), dxt1 or dxt3")
	mips := fs.Bool("mips", true, "write every mip level down to 1x1 (--mips=false: the first only)")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 || *dest == "" {
		return fmt.Errorf("%w: blp encode takes one PNG and -o out.blp", errUsage)
	}
	f, err := os.Open(pos[0])
	if err != nil {
		return err
	}
	src, _, err := image.Decode(f)
	_ = f.Close()
	if err != nil {
		return fmt.Errorf("%s: %w", pos[0], err)
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w&(w-1) != 0 || h&(h-1) != 0 || w < 4 || h < 4 || w > 4096 || h > 4096 {
		return fmt.Errorf("%s is %dx%d: a client texture's sides are powers of two from 4 to 4096", pos[0], w, h)
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Rect, src, b.Min, draw.Src)
	var alpha bool
	switch *format {
	case "auto":
		for i := 3; i < len(img.Pix); i += 4 {
			if img.Pix[i] != 255 {
				alpha = true
				break
			}
		}
	case "dxt1":
	case "dxt3":
		alpha = true
	default:
		return fmt.Errorf("%w: --format is auto, dxt1 or dxt3", errUsage)
	}
	data, err := wow.EncodeBLP(img.Pix, w, h, alpha, *mips)
	if err != nil {
		return err
	}
	if _, err := wow.DecodeBLP(data); err != nil {
		return errors.New("the written texture doesn't read back: " + err.Error())
	}
	if err := os.WriteFile(*dest, data, 0o644); err != nil {
		return err
	}
	info := readBLPInfo(data)
	info.File, info.Out = pos[0], *dest
	return writeJSON(out, info)
}
