package main

import (
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"

	"Meld/internal/wow"
)

// m2Info is what m2 info prints: an M2's header as the file has it (model space, z up), and what
// the editor draws of it (wow.ParseM2).
type m2Info struct {
	File    string `json:"file"`
	Version int    `json:"version"`
	Name    string `json:"name"`
	Flags   int    `json:"flags"`
	// BoundsMin, BoundsMax and Radius are the header's bounding box and sphere.
	BoundsMin [3]float32     `json:"boundsMin"`
	BoundsMax [3]float32     `json:"boundsMax"`
	Radius    float32        `json:"radius"`
	Counts    map[string]int `json:"counts"`
	// Textures are the texture table's entries: a file for type 0, else the replaceable slot's type
	// (11 to 13 a creature's skins, 1 a character's skin, 2 its cape...), which a display fills.
	Textures []m2Texture `json:"textures"`
	// Animations are the sequences' AnimationData IDs, each once.
	Animations []int `json:"animations"`
	// Submeshes are view 0's submesh IDs (the geosets a character look picks), each with its parts and triangles.
	Submeshes []wow.M2Submesh `json:"submeshes"`
	// Draw is what the editor draws (view 0), or DrawError why it draws nothing.
	Draw      *m2Draw `json:"draw,omitempty"`
	DrawError string  `json:"drawError,omitempty"`
}

type m2Texture struct {
	Type int    `json:"type"`
	File string `json:"file,omitempty"`
}

type m2Draw struct {
	Vertices  int        `json:"vertices"`
	Triangles int        `json:"triangles"`
	Batches   []drawPart `json:"batches"`
	Lights    int        `json:"lights"`
	Emitters  int        `json:"emitters"`
	Ribbons   int        `json:"ribbons"`
	Animated  bool       `json:"animated"`
}

// drawPart is one texture's triangles: an M2 batch, or a WMO group's material.
type drawPart struct {
	Texture   string `json:"texture"`
	Blend     int    `json:"blend"`
	Triangles int    `json:"triangles"`
}

// m2Arrays are the vanilla header's arrays m2 info counts, by their offset.
var m2Arrays = []struct {
	name string
	off  int
}{
	{"globalLoops", 0x14}, {"sequences", 0x1C}, {"bones", 0x34}, {"vertices", 0x44}, {"views", 0x4C},
	{"colors", 0x54}, {"textures", 0x5C}, {"transparency", 0x64}, {"textureAnimations", 0x74}, {"materials", 0x84},
	{"collisionTriangles", 0xEC}, {"attachments", 0x104}, {"events", 0x114}, {"lights", 0x11C}, {"cameras", 0x124},
	{"ribbons", 0x134}, {"particles", 0x13C},
}

func modelSource(name string, args []string) (*tileSource, string, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	clientDir := fs.String("client", "", "client folder, Data folder or .MPQ")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return nil, "", err
	}
	if len(pos) != 1 {
		return nil, "", fmt.Errorf("%w: %s takes one model", errUsage, name)
	}
	return &tileSource{dir: *clientDir}, pos[0], nil
}

// m2InfoCmd prints an M2's header, textures, animations and what the editor draws of it.
func m2InfoCmd(args []string, out io.Writer) error {
	src, path, err := modelSource("m2 info", args)
	if err != nil {
		return err
	}
	defer src.close()
	b, err := src.file(path)
	if err != nil {
		return err
	}
	info, err := readM2Info(b, path)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	info.File = path
	return writeJSON(out, info)
}

func readM2Info(b []byte, path string) (*m2Info, error) {
	const header = 0x144
	if len(b) < 4 || string(b[:4]) != "MD20" {
		return nil, errors.New("not an M2 (no MD20)")
	}
	if len(b) < header {
		return nil, fmt.Errorf("header truncated (%d bytes)", len(b))
	}
	u32 := func(o int) int { return int(binary.LittleEndian.Uint32(b[o:])) }
	f32 := func(o int) float32 { return math.Float32frombits(binary.LittleEndian.Uint32(b[o:])) }
	info := &m2Info{Version: u32(4), Flags: u32(0x10), Counts: map[string]int{}, Textures: []m2Texture{}}
	if n, off := u32(0x08), u32(0x0C); n > 0 && off+n <= len(b) {
		info.Name = strings.TrimRight(string(b[off:off+n]), "\x00")
	}
	for i := 0; i < 3; i++ {
		info.BoundsMin[i], info.BoundsMax[i] = f32(0xB4+i*4), f32(0xC0+i*4)
	}
	info.Radius = f32(0xCC)
	for _, a := range m2Arrays {
		info.Counts[a.name] = u32(a.off)
	}
	if n, off := u32(0x5C), u32(0x60); off+n*16 <= len(b) {
		for i := 0; i < n; i++ {
			o := off + i*16
			t := m2Texture{Type: u32(o)}
			if l, so := u32(o+8), u32(o+12); t.Type == 0 && l > 0 && so+l <= len(b) {
				t.File = strings.TrimRight(string(b[so:so+l]), "\x00")
			}
			info.Textures = append(info.Textures, t)
		}
	}
	if anims, err := wow.M2Animations(b); err == nil {
		info.Animations = anims
	}
	if info.Animations == nil {
		info.Animations = []int{}
	}
	if subs, err := wow.M2Submeshes(b); err == nil {
		info.Submeshes = subs
	}
	if info.Submeshes == nil {
		info.Submeshes = []wow.M2Submesh{}
	}
	mesh, err := wow.ParseM2(b, path)
	if err != nil {
		info.DrawError = err.Error()
		return info, nil
	}
	d := &m2Draw{Vertices: len(mesh.Pos) / 3, Triangles: len(mesh.Index) / 3, Batches: []drawPart{}, Emitters: len(mesh.Emitters), Ribbons: len(mesh.Ribbons), Animated: mesh.Anim != nil}
	for _, g := range mesh.Groups {
		d.Batches = append(d.Batches, drawPart{Texture: g.Texture, Blend: g.Blend, Triangles: g.Count / 3})
	}
	for _, e := range mesh.Effects {
		if e.Kind == "light" {
			d.Lights++
		}
	}
	info.Draw = d
	return info, nil
}

// wmoInfo is what wmo info prints: a WMO root's header, materials and doodads, and each group's
// file when it can be read (beside the root on disk, or in the client).
type wmoInfo struct {
	File      string     `json:"file"`
	Version   int        `json:"version"`
	Flags     int        `json:"flags"`
	BoundsMin [3]float32 `json:"boundsMin"`
	BoundsMax [3]float32 `json:"boundsMax"`
	Counts    struct {
		Materials int `json:"materials"`
		Groups    int `json:"groups"`
		Portals   int `json:"portals"`
		Lights    int `json:"lights"`
		Doodads   int `json:"doodads"`
	} `json:"counts"`
	Materials   []wmoMaterial `json:"materials"`
	DoodadSets  []wmoSet      `json:"doodadSets"`
	DoodadModel []string      `json:"doodadModels"`
	Groups      []wmoGroup    `json:"groups"`
	// Vertices and Triangles total the groups that were read.
	Vertices  int `json:"vertices"`
	Triangles int `json:"triangles"`
}

type wmoMaterial struct {
	Texture  string `json:"texture"`
	Blend    int    `json:"blend"`
	TwoSided bool   `json:"twoSided,omitempty"`
	Unlit    bool   `json:"unlit,omitempty"`
}

type wmoSet struct {
	Name    string `json:"name"`
	Doodads int    `json:"doodads"`
}

type wmoGroup struct {
	Index    int    `json:"index"`
	Name     string `json:"name"`
	Flags    int    `json:"flags"`
	Interior bool   `json:"interior"`
	// File is the group's file; Missing is set when it could not be read, and the counts below are 0.
	File      string `json:"file"`
	Missing   string `json:"missing,omitempty"`
	Vertices  int    `json:"vertices"`
	Triangles int    `json:"triangles"`
	Doodads   int    `json:"doodads"`
	Liquid    bool   `json:"liquid,omitempty"`
}

// iffChunk is a WMO chunk: its ID as written in the docs (MOHD), and its data.
type iffChunk struct {
	id   string
	data []byte
}

// iffChunks splits b into chunks, stopping at one that runs past the end.
func iffChunks(b []byte) []iffChunk {
	var out []iffChunk
	for len(b) >= 8 {
		n := int(binary.LittleEndian.Uint32(b[4:]))
		if n < 0 || 8+n > len(b) {
			break
		}
		out = append(out, iffChunk{string([]byte{b[3], b[2], b[1], b[0]}), b[8 : 8+n]})
		b = b[8+n:]
	}
	return out
}

func cstring(b []byte, off int) string {
	if off < 0 || off >= len(b) {
		return ""
	}
	s := b[off:]
	if i := strings.IndexByte(string(s), 0); i >= 0 {
		s = s[:i]
	}
	return string(s)
}

// wmoInfoCmd prints a WMO root's header, materials, doodad sets and groups.
func wmoInfoCmd(args []string, out io.Writer) error {
	src, path, err := modelSource("wmo info", args)
	if err != nil {
		return err
	}
	defer src.close()
	b, err := src.file(path)
	if err != nil {
		return err
	}
	info, err := readWMOInfo(b, path, src.file)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return writeJSON(out, info)
}

func readWMOInfo(b []byte, path string, read func(string) ([]byte, error)) (*wmoInfo, error) {
	root, err := wow.ParseWMORoot(b)
	if err != nil {
		return nil, err
	}
	info := &wmoInfo{File: path, Flags: root.Flags, Materials: []wmoMaterial{}, DoodadSets: []wmoSet{}, DoodadModel: []string{}, Groups: []wmoGroup{}}
	var mogn, mogi []byte
	for _, c := range iffChunks(b) {
		switch c.id {
		case "MVER":
			if len(c.data) >= 4 {
				info.Version = int(binary.LittleEndian.Uint32(c.data))
			}
		case "MOHD":
			if len(c.data) >= 60 {
				u := func(o int) int { return int(binary.LittleEndian.Uint32(c.data[o:])) }
				info.Counts.Materials, info.Counts.Groups, info.Counts.Portals, info.Counts.Lights, info.Counts.Doodads = u(0), u(4), u(8), u(12), u(20)
				for i := 0; i < 3; i++ {
					info.BoundsMin[i] = math.Float32frombits(binary.LittleEndian.Uint32(c.data[36+i*4:]))
					info.BoundsMax[i] = math.Float32frombits(binary.LittleEndian.Uint32(c.data[48+i*4:]))
				}
			}
		case "MOGN":
			mogn = c.data
		case "MOGI":
			mogi = c.data
		}
	}
	for _, m := range root.Materials {
		info.Materials = append(info.Materials, wmoMaterial{Texture: m.Texture, Blend: m.Blend, TwoSided: m.TwoSided, Unlit: m.Unlit})
	}
	for _, s := range root.Sets {
		info.DoodadSets = append(info.DoodadSets, wmoSet{Name: s.Name, Doodads: s.Count})
	}
	seen := map[string]bool{}
	for _, d := range root.AllDoodads {
		if d.Model != "" && !seen[strings.ToLower(d.Model)] {
			seen[strings.ToLower(d.Model)] = true
			info.DoodadModel = append(info.DoodadModel, d.Model)
		}
	}
	sort.Strings(info.DoodadModel)
	for i := 0; i < root.NumGroups; i++ {
		g := wmoGroup{Index: i, File: wow.GroupPath(path, i)}
		if o := i * 32; o+32 <= len(mogi) {
			g.Flags = int(binary.LittleEndian.Uint32(mogi[o:]))
			g.Name = cstring(mogn, int(binary.LittleEndian.Uint32(mogi[o+28:])))
		}
		data, err := read(g.File)
		if err != nil {
			g.Missing = err.Error()
		} else {
			readWMOGroup(data, &g)
		}
		g.Interior = g.Flags&0x2000 != 0
		info.Vertices += g.Vertices
		info.Triangles += g.Triangles
		info.Groups = append(info.Groups, g)
	}
	return info, nil
}

// readWMOGroup counts a group file's vertices, triangles (less the collision-only ones) and doodad
// references, and takes its flags from its MOGP.
func readWMOGroup(b []byte, g *wmoGroup) {
	for _, c := range iffChunks(b) {
		if c.id != "MOGP" || len(c.data) < 68 {
			continue
		}
		g.Flags = int(binary.LittleEndian.Uint32(c.data[8:]))
		var mopy []byte
		tris := 0
		for _, s := range iffChunks(c.data[68:]) {
			switch s.id {
			case "MOVT":
				g.Vertices = len(s.data) / 12
			case "MOVI":
				tris = len(s.data) / 6
			case "MOPY":
				mopy = s.data
			case "MODR":
				g.Doodads = len(s.data) / 2
			case "MLIQ":
				g.Liquid = true
			}
		}
		for t := 0; t < tris; t++ {
			if 2*t+1 < len(mopy) && mopy[2*t+1] == 0xFF {
				continue
			}
			g.Triangles++
		}
		return
	}
	g.Missing = "no MOGP chunk"
}
