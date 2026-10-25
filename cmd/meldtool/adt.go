package main

import (
	"flag"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"Meld/internal/adt"
)

// tile is a 1.12 tile read whole: its terrain, textures, liquids and placements.
type tile struct {
	terrain    *adt.Terrain
	textures   *adt.Textures
	liquids    map[[2]int][]adt.Liquid
	placements []adt.Placement
	size       int
}

func loadTile(src *tileSource, name string, forceBig bool) (*tile, error) {
	data, bigAlpha, _, err := src.read(name)
	if err != nil {
		return nil, err
	}
	t := &tile{size: len(data), liquids: map[[2]int][]adt.Liquid{}}
	if t.terrain, err = adt.ParseTerrain(data); err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	if t.textures, err = adt.ParseTextures(data, bigAlpha || forceBig, t.terrain); err != nil {
		return nil, fmt.Errorf("%s: textures: %w", name, err)
	}
	liquids, err := adt.ParseLiquids(data)
	if err != nil {
		return nil, fmt.Errorf("%s: liquids: %w", name, err)
	}
	for _, l := range liquids {
		k := [2]int{l.IndexX, l.IndexY}
		t.liquids[k] = append(t.liquids[k], l)
	}
	if t.placements, err = adt.ParsePlacements(data); err != nil {
		return nil, fmt.Errorf("%s: placements: %w", name, err)
	}
	return t, nil
}

// texChunk is chunk i's textures, or an empty one past the end.
func (t *tile) texChunk(i int) adt.TexChunk {
	if i < len(t.textures.Chunks) {
		return t.textures.Chunks[i]
	}
	return adt.TexChunk{}
}

// chunkDump is one chunk in adt dump's output.
type chunkDump struct {
	Index  string `json:"chunk"`
	Flags  string `json:"flags"`
	AreaID uint32 `json:"areaId"`
	// Holes and NoEffect are a byte per cell row, bit n the cell n columns in.
	Holes     [adt.CellsPerChunk]uint8 `json:"holes"`
	NoEffect  [adt.CellsPerChunk]uint8 `json:"noEffect"`
	Position  [3]float32               `json:"position"`
	HeightMin float32                  `json:"heightMin"`
	HeightMax float32                  `json:"heightMax"`
	// Heights are the 145 samples, given only for --chunk.
	Heights  []float32    `json:"heights,omitempty"`
	Layers   []layerDump  `json:"layers"`
	Liquids  []liquidDump `json:"liquids,omitempty"`
	Shadowed int          `json:"shadowedTexels"`
	Shadow   bool         `json:"shadow"`
}

type layerDump struct {
	Texture string `json:"texture"`
	Flags   string `json:"flags"`
	Effect  uint32 `json:"effect,omitempty"`
	// Covered counts the alpha map's texels above zero, and Mean its mean (0 to 255); none for the
	// base layer.
	Covered int     `json:"covered,omitempty"`
	Mean    float64 `json:"mean,omitempty"`
}

type liquidDump struct {
	Type      int     `json:"type"`
	Cells     int     `json:"cells"`
	HeightMin float32 `json:"heightMin"`
	HeightMax float32 `json:"heightMax"`
}

type placementDump struct {
	Kind      string     `json:"kind"`
	Name      string     `json:"name"`
	UID       uint32     `json:"uid"`
	Position  [3]float32 `json:"position"`
	Rotation  [3]float32 `json:"rotation"`
	Scale     float32    `json:"scale"`
	DoodadSet uint16     `json:"doodadSet,omitempty"`
}

type tileDump struct {
	File   string      `json:"file"`
	Bytes  int         `json:"bytes"`
	M2     int         `json:"m2"`
	WMO    int         `json:"wmo"`
	Chunks []chunkDump `json:"chunks"`
	// Placements are listed only for --placements.
	Placements []placementDump `json:"placements,omitempty"`
}

func adtDump(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("adt dump", flag.ContinueOnError)
	clientDir := fs.String("client", "", "client folder, Data folder or .MPQ")
	big := fs.Bool("big-alpha", false, "read 8-bit alpha maps (a tile on disk has no WDT to say)")
	only := fs.String("chunk", "", "dump only chunk x,y, with its heights")
	withPlacements := fs.Bool("placements", false, "list the placements")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 {
		return fmt.Errorf("%w: adt dump takes one tile", errUsage)
	}
	cx, cy := -1, -1
	if *only != "" {
		if cx, cy, err = parseChunk(*only); err != nil {
			return err
		}
	}
	src := &tileSource{dir: *clientDir}
	defer src.close()
	t, err := loadTile(src, pos[0], *big)
	if err != nil {
		return err
	}
	d := tileDump{File: pos[0], Bytes: t.size, Chunks: []chunkDump{}}
	for _, p := range t.placements {
		if p.Kind == adt.WMO {
			d.WMO++
		} else {
			d.M2++
		}
		if *withPlacements {
			d.Placements = append(d.Placements, dumpPlacement(p))
		}
	}
	for i := range t.terrain.Chunks {
		c := &t.terrain.Chunks[i]
		if cx >= 0 && (c.IndexX != cx || c.IndexY != cy) {
			continue
		}
		cd := dumpChunk(c, t.texChunk(i), t.liquids[[2]int{c.IndexX, c.IndexY}])
		if cx >= 0 {
			cd.Heights = c.Heights[:]
		}
		d.Chunks = append(d.Chunks, cd)
	}
	if cx >= 0 && len(d.Chunks) == 0 {
		return fmt.Errorf("%s has no chunk %d,%d", pos[0], cx, cy)
	}
	return writeJSON(out, d)
}

func parseChunk(s string) (x, y int, err error) {
	a, b, ok := strings.Cut(s, ",")
	if ok {
		if x, err = strconv.Atoi(strings.TrimSpace(a)); err == nil {
			y, err = strconv.Atoi(strings.TrimSpace(b))
		}
	}
	if !ok || err != nil || x < 0 || y < 0 || x >= adt.ChunksPerTile || y >= adt.ChunksPerTile {
		return 0, 0, fmt.Errorf("%w: --chunk %q is not x,y with each 0 to 15", errUsage, s)
	}
	return x, y, nil
}

func dumpChunk(c *adt.Chunk, tc adt.TexChunk, liquids []adt.Liquid) chunkDump {
	d := chunkDump{
		Index: fmt.Sprintf("%d,%d", c.IndexX, c.IndexY),
		Flags: fmt.Sprintf("0x%x", c.Flags), AreaID: c.AreaID, Holes: c.Holes, NoEffect: c.NoEffect,
		Position: c.Position, Layers: []layerDump{}, Shadow: c.Shadow != nil,
	}
	d.HeightMin, d.HeightMax = span(c.Heights[:])
	for i, l := range tc.Layers {
		ld := layerDump{Texture: l.Texture, Flags: fmt.Sprintf("0x%x", l.Flags), Effect: l.Effect}
		if i > 0 && i-1 < len(tc.Alpha) {
			sum := 0
			for _, a := range tc.Alpha[i-1] {
				if a > 0 {
					ld.Covered++
				}
				sum += int(a)
			}
			if n := len(tc.Alpha[i-1]); n > 0 {
				ld.Mean = math.Round(float64(sum)/float64(n)*100) / 100
			}
		}
		d.Layers = append(d.Layers, ld)
	}
	for _, l := range liquids {
		ld := liquidDump{Type: l.Type}
		for _, on := range l.Cells {
			if on {
				ld.Cells++
			}
		}
		ld.HeightMin, ld.HeightMax = span(l.Heights[:])
		d.Liquids = append(d.Liquids, ld)
	}
	for _, b := range c.Shadow {
		for ; b != 0; b &= b - 1 {
			d.Shadowed++
		}
	}
	return d
}

func dumpPlacement(p adt.Placement) placementDump {
	kind := "m2"
	if p.Kind == adt.WMO {
		kind = "wmo"
	}
	return placementDump{Kind: kind, Name: p.Name, UID: p.UID, Position: p.Position, Rotation: p.Rotation, Scale: p.Scale, DoodadSet: p.DoodadSet}
}

func span(v []float32) (lo, hi float32) {
	if len(v) == 0 {
		return 0, 0
	}
	lo, hi = v[0], v[0]
	for _, h := range v[1:] {
		lo, hi = min(lo, h), max(hi, h)
	}
	return lo, hi
}

// adtDiff compares two tiles chunk by chunk, as the export tests do, and prints a line per
// difference: the chunk header (flags, area, holes, no-effect cells), heights past --eps, texture
// layers and alpha maps, liquids and shadows, then the placements by UID.
func adtDiff(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("adt diff", flag.ContinueOnError)
	clientDir := fs.String("client", "", "client folder, Data folder or .MPQ")
	big := fs.Bool("big-alpha", false, "read 8-bit alpha maps (a tile on disk has no WDT to say)")
	clientB := fs.String("client-b", "", "where b comes from, when not --client (such as terrain.MPQ against patch-3.MPQ)")
	eps := fs.Float64("eps", 0.001, "the height difference that counts")
	placeEps := fs.Float64("place-eps", 0.01, "the placement position, rotation and scale difference that counts (a float32 at 17000 yards is only good to 0.002)")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 2 {
		return fmt.Errorf("%w: adt diff takes two tiles", errUsage)
	}
	src := &tileSource{dir: *clientDir}
	defer src.close()
	a, err := loadTile(src, pos[0], *big)
	if err != nil {
		return err
	}
	srcB := src
	if *clientB != "" {
		srcB = &tileSource{dir: *clientB}
		defer srcB.close()
	}
	b, err := loadTile(srcB, pos[1], *big)
	if err != nil {
		return err
	}
	lines := diffTiles(a, b, float32(*eps), float32(*placeEps))
	for _, l := range lines {
		fmt.Fprintln(out, l)
	}
	if len(lines) > 0 {
		fmt.Fprintf(out, "%d differences\n", len(lines))
		return errDiffer
	}
	fmt.Fprintln(out, "same")
	return nil
}

func diffTiles(a, b *tile, eps, placeEps float32) []string {
	var lines []string
	add := func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) }
	bIndex := map[[2]int]int{}
	for i, c := range b.terrain.Chunks {
		bIndex[[2]int{c.IndexX, c.IndexY}] = i
	}
	seen := map[[2]int]bool{}
	for i := range a.terrain.Chunks {
		ca := &a.terrain.Chunks[i]
		k := [2]int{ca.IndexX, ca.IndexY}
		seen[k] = true
		j, ok := bIndex[k]
		if !ok {
			add("chunk %d,%d: only in a", k[0], k[1])
			continue
		}
		cb := &b.terrain.Chunks[j]
		p := fmt.Sprintf("chunk %d,%d:", k[0], k[1])
		if ca.Flags != cb.Flags {
			add("%s flags 0x%x -> 0x%x", p, ca.Flags, cb.Flags)
		}
		if ca.AreaID != cb.AreaID {
			add("%s area %d -> %d", p, ca.AreaID, cb.AreaID)
		}
		if ca.Holes != cb.Holes {
			add("%s holes %v -> %v", p, ca.Holes, cb.Holes)
		}
		if ca.NoEffect != cb.NoEffect {
			add("%s noEffect %v -> %v", p, ca.NoEffect, cb.NoEffect)
		}
		n, worst, at := 0, float32(0), 0
		for s := range ca.Heights {
			d := float32(math.Abs(float64(ca.Heights[s] - cb.Heights[s])))
			if d > eps {
				n++
				if d > worst {
					worst, at = d, s
				}
			}
		}
		if n > 0 {
			add("%s %d heights differ, most %.4g at sample %d (%.4g -> %.4g)", p, n, worst, at, ca.Heights[at], cb.Heights[at])
		}
		diffTextures(p, a.texChunk(i), b.texChunk(j), add)
		diffLiquids(p, a.liquids[k], b.liquids[k], eps, add)
		if d := shadowDiff(ca.Shadow, cb.Shadow); d != "" {
			add("%s shadow %s", p, d)
		}
	}
	for _, c := range b.terrain.Chunks {
		if !seen[[2]int{c.IndexX, c.IndexY}] {
			add("chunk %d,%d: only in b", c.IndexX, c.IndexY)
		}
	}
	diffPlacements(a.placements, b.placements, placeEps, add)
	return lines
}

func diffTextures(p string, a, b adt.TexChunk, add func(string, ...any)) {
	names := func(t adt.TexChunk) []string {
		out := make([]string, len(t.Layers))
		for i, l := range t.Layers {
			out[i] = l.Texture
		}
		return out
	}
	na, nb := names(a), names(b)
	if strings.Join(na, "|") != strings.Join(nb, "|") {
		add("%s layers %v -> %v", p, na, nb)
		return
	}
	for i := range a.Layers {
		la, lb := a.Layers[i], b.Layers[i]
		if la.Flags != lb.Flags {
			add("%s layer %d flags 0x%x -> 0x%x", p, i, la.Flags, lb.Flags)
		}
		if la.Effect != lb.Effect {
			add("%s layer %d effect %d -> %d", p, i, la.Effect, lb.Effect)
		}
	}
	for i := 0; i < len(a.Alpha) && i < len(b.Alpha); i++ {
		n, worst := 0, 0
		for t := 0; t < len(a.Alpha[i]) && t < len(b.Alpha[i]); t++ {
			if d := int(a.Alpha[i][t]) - int(b.Alpha[i][t]); d != 0 {
				n++
				worst = max(worst, d, -d)
			}
		}
		if n > 0 {
			add("%s layer %d alpha: %d texels differ, most by %d", p, i+1, n, worst)
		}
	}
}

func diffLiquids(p string, a, b []adt.Liquid, eps float32, add func(string, ...any)) {
	byType := func(ls []adt.Liquid) map[int]*adt.Liquid {
		out := map[int]*adt.Liquid{}
		for i := range ls {
			out[ls[i].Type] = &ls[i]
		}
		return out
	}
	ma, mb := byType(a), byType(b)
	for ty, la := range ma {
		lb, ok := mb[ty]
		if !ok {
			add("%s liquid %d only in a", p, ty)
			continue
		}
		if la.Cells != lb.Cells {
			add("%s liquid %d cells differ", p, ty)
		}
		n := 0
		for v := range la.Heights {
			if float32(math.Abs(float64(la.Heights[v]-lb.Heights[v]))) > eps {
				n++
			}
		}
		if n > 0 {
			add("%s liquid %d: %d surface heights differ", p, ty, n)
		}
		if la.Depth != lb.Depth {
			add("%s liquid %d depths differ", p, ty)
		}
	}
	for ty := range mb {
		if _, ok := ma[ty]; !ok {
			add("%s liquid %d only in b", p, ty)
		}
	}
}

func shadowDiff(a, b []byte) string {
	switch {
	case a == nil && b == nil:
		return ""
	case a == nil:
		return "only in b"
	case b == nil:
		return "only in a"
	case len(a) != len(b):
		return fmt.Sprintf("%d bytes -> %d", len(a), len(b))
	}
	n := 0
	for i := range a {
		for x := a[i] ^ b[i]; x != 0; x &= x - 1 {
			n++
		}
	}
	if n == 0 {
		return ""
	}
	return fmt.Sprintf("%d texels differ", n)
}

func diffPlacements(a, b []adt.Placement, eps float32, add func(string, ...any)) {
	key := func(p adt.Placement) string { return fmt.Sprintf("%d/%d", p.Kind, p.UID) }
	mb := map[string]adt.Placement{}
	for _, p := range b {
		mb[key(p)] = p
	}
	ma := map[string]bool{}
	for _, pa := range a {
		ma[key(pa)] = true
		d := dumpPlacement(pa)
		pb, ok := mb[key(pa)]
		if !ok {
			add("%s %d (%s): only in a", d.Kind, pa.UID, pa.Name)
			continue
		}
		if !strings.EqualFold(pa.Name, pb.Name) {
			add("%s %d: name %s -> %s", d.Kind, pa.UID, pa.Name, pb.Name)
		}
		if far(pa.Position, pb.Position, eps) || far(pa.Rotation, pb.Rotation, eps) || math.Abs(float64(pa.Scale-pb.Scale)) > float64(eps) {
			add("%s %d (%s): moved %v %v %.4g -> %v %v %.4g", d.Kind, pa.UID, pa.Name, pa.Position, pa.Rotation, pa.Scale, pb.Position, pb.Rotation, pb.Scale)
		}
		if pa.DoodadSet != pb.DoodadSet || pa.NameSet != pb.NameSet {
			add("%s %d: sets %d/%d -> %d/%d", d.Kind, pa.UID, pa.DoodadSet, pa.NameSet, pb.DoodadSet, pb.NameSet)
		}
	}
	for _, pb := range b {
		if !ma[key(pb)] {
			add("%s %d (%s): only in b", dumpPlacement(pb).Kind, pb.UID, pb.Name)
		}
	}
}

func far(a, b [3]float32, eps float32) bool {
	for i := range a {
		if float32(math.Abs(float64(a[i]-b[i]))) > eps {
			return true
		}
	}
	return false
}
