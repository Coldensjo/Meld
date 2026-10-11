// Package mapfile reads and writes WorldEditor map files (*.wmap).
//
// On-disk layout (whole stream gzip-compressed):
//
//	magic   [4]byte  "WMAP"
//	version uint32   little endian
//	hdrLen  uint32   length of the JSON header
//	header  []byte   JSON-encoded Header
//	heights []byte   (Size+1)^2 float32 little endian
//	splatA  []byte   SplatRes^2 * 4 bytes
//	splatB  []byte   SplatRes^2 * 4 bytes
//
// Over the Wails bridge the binary blobs travel as base64 strings, which keeps
// the JS side to a single typed-array copy and avoids huge JSON number arrays.
package mapfile

import (
	"bufio"
	"compress/gzip"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

const (
	Magic   = "WMAP"
	Version = 1
)

// PlacedObject is a model instance placed in the world. Objects with a Parent
// are attached to it: X/YOff/Z/RotY are then local to the parent's transform.
type PlacedObject struct {
	ID     int     `json:"id,omitempty"`
	Parent int     `json:"parent,omitempty"`
	Type   string  `json:"type"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	YOff   float64 `json:"yOff"`
	RotY   float64 `json:"rotY"`
	Scale  float64 `json:"scale"`
}

// Header is the JSON metadata section of a map file.
type Header struct {
	Name         string         `json:"name"`
	Size         int            `json:"size"`     // terrain cells per side
	CellSize     float64        `json:"cellSize"` // world units per cell
	SplatRes     int            `json:"splatRes"` // splat texture resolution per side
	WaterLevel   float64        `json:"waterLevel"`
	WaterEnabled bool           `json:"waterEnabled"`
	Objects      []PlacedObject `json:"objects"`
	// LayerTextures optionally overrides each paint layer with a WoW tileset
	// path ("" = built-in procedural texture). Added after v1; optional.
	LayerTextures []string `json:"layerTextures,omitempty"`
	TexScale      float64  `json:"texScale,omitempty"`
}

// MapData is the bridge representation exchanged with the frontend.
type MapData struct {
	Header
	Heights string `json:"heights"` // base64 float32 LE
	SplatA  string `json:"splatA"`  // base64 RGBA8
	SplatB  string `json:"splatB"`  // base64 RGBA8
}

func (h *Header) validate() error {
	if h.Size < 16 || h.Size > 2048 {
		return fmt.Errorf("invalid terrain size %d", h.Size)
	}
	if h.SplatRes < 16 || h.SplatRes > 4096 {
		return fmt.Errorf("invalid splat resolution %d", h.SplatRes)
	}
	if h.CellSize <= 0 {
		return fmt.Errorf("invalid cell size %v", h.CellSize)
	}
	return nil
}

func (h *Header) heightBytes() int { return (h.Size + 1) * (h.Size + 1) * 4 }
func (h *Header) splatBytes() int  { return h.SplatRes * h.SplatRes * 4 }

// Write encodes m to w.
func Write(w io.Writer, m *MapData) error {
	if err := m.validate(); err != nil {
		return err
	}
	blobs := make([][]byte, 0, 3)
	for _, b := range []struct {
		name string
		s    string
		want int
	}{
		{"heights", m.Heights, m.heightBytes()},
		{"splatA", m.SplatA, m.splatBytes()},
		{"splatB", m.SplatB, m.splatBytes()},
	} {
		raw, err := base64.StdEncoding.DecodeString(b.s)
		if err != nil {
			return fmt.Errorf("%s: %w", b.name, err)
		}
		if len(raw) != b.want {
			return fmt.Errorf("%s: got %d bytes, want %d", b.name, len(raw), b.want)
		}
		blobs = append(blobs, raw)
	}

	hdr, err := json.Marshal(&m.Header)
	if err != nil {
		return err
	}

	gz, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
	if err != nil {
		return err
	}
	var pre [12]byte
	copy(pre[:4], Magic)
	binary.LittleEndian.PutUint32(pre[4:8], Version)
	binary.LittleEndian.PutUint32(pre[8:12], uint32(len(hdr)))
	if _, err := gz.Write(pre[:]); err != nil {
		return err
	}
	if _, err := gz.Write(hdr); err != nil {
		return err
	}
	for _, b := range blobs {
		if _, err := gz.Write(b); err != nil {
			return err
		}
	}
	return gz.Close()
}

// Read decodes a map from r.
func Read(r io.Reader) (*MapData, error) {
	gz, err := gzip.NewReader(bufio.NewReader(r))
	if err != nil {
		return nil, fmt.Errorf("not a WorldEditor map: %w", err)
	}
	defer gz.Close()

	var pre [12]byte
	if _, err := io.ReadFull(gz, pre[:]); err != nil {
		return nil, err
	}
	if string(pre[:4]) != Magic {
		return nil, errors.New("not a WorldEditor map: bad magic")
	}
	if v := binary.LittleEndian.Uint32(pre[4:8]); v != Version {
		return nil, fmt.Errorf("unsupported map version %d", v)
	}
	hdrLen := binary.LittleEndian.Uint32(pre[8:12])
	if hdrLen > 64<<20 {
		return nil, errors.New("header too large")
	}
	hdr := make([]byte, hdrLen)
	if _, err := io.ReadFull(gz, hdr); err != nil {
		return nil, err
	}
	m := &MapData{}
	if err := json.Unmarshal(hdr, &m.Header); err != nil {
		return nil, fmt.Errorf("header: %w", err)
	}
	if err := m.validate(); err != nil {
		return nil, err
	}
	read := func(n int) (string, error) {
		buf := make([]byte, n)
		if _, err := io.ReadFull(gz, buf); err != nil {
			return "", err
		}
		return base64.StdEncoding.EncodeToString(buf), nil
	}
	if m.Heights, err = read(m.heightBytes()); err != nil {
		return nil, fmt.Errorf("heights: %w", err)
	}
	if m.SplatA, err = read(m.splatBytes()); err != nil {
		return nil, fmt.Errorf("splatA: %w", err)
	}
	if m.SplatB, err = read(m.splatBytes()); err != nil {
		return nil, fmt.Errorf("splatB: %w", err)
	}
	if m.Objects == nil {
		m.Objects = []PlacedObject{}
	}
	return m, nil
}

// Save writes m to path atomically (temp file + rename).
func Save(path string, m *MapData) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(f, 1<<20)
	if err := Write(bw, m); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := bw.Flush(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// Load reads a map from path.
func Load(path string) (*MapData, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Read(f)
}
