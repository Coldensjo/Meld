package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// regionInput is one input of a region edit that region-diff can swap for the client's own.
type regionInput struct {
	name  string
	apply func(e *vmangos.RegionEdit, client *vmangos.RegionView)
}

// regionInputs are the inputs the page's edit carries, each swapped for what the client has: the edit
// built without it keeps the client's copy (Paint, Headers and Liquids left out do exactly that), and
// heights and objects are the client's own view.
var regionInputs = []regionInput{
	{"heights", func(e *vmangos.RegionEdit, c *vmangos.RegionView) { e.Heights = vmangos.EncodeHeights(c.Heights) }},
	{"objects", func(e *vmangos.RegionEdit, c *vmangos.RegionView) { e.Objects = c.Objects }},
	{"paint effects", func(e *vmangos.RegionEdit, _ *vmangos.RegionView) {
		e.Paint = copyPaint(e.Paint, func(p *vmangos.RegionPaint) { p.Effects = nil })
	}},
	{"paint flags", func(e *vmangos.RegionEdit, _ *vmangos.RegionView) {
		e.Paint = copyPaint(e.Paint, func(p *vmangos.RegionPaint) { p.Flags = nil })
	}},
	{"paint no-effect cells", func(e *vmangos.RegionEdit, _ *vmangos.RegionView) {
		e.Paint = copyPaint(e.Paint, func(p *vmangos.RegionPaint) { p.NoEffect = nil })
	}},
	{"paint (textures and weights)", func(e *vmangos.RegionEdit, _ *vmangos.RegionView) { e.Paint = nil }},
	{"headers", func(e *vmangos.RegionEdit, _ *vmangos.RegionView) { e.Headers = nil }},
	{"liquids", func(e *vmangos.RegionEdit, _ *vmangos.RegionView) {
		e.HasLiquids, e.PartialLiquids, e.Liquids = false, false, nil
	}},
}

func copyPaint(in []vmangos.RegionPaint, f func(*vmangos.RegionPaint)) []vmangos.RegionPaint {
	out := make([]vmangos.RegionPaint, len(in))
	copy(out, in)
	for i := range out {
		f(&out[i])
	}
	return out
}

// tileDiff is one tile of the edit that differs from the client's copy, and which inputs make it.
type tileDiff struct {
	Tile string `json:"tile"`
	// Causes are the inputs that, swapped alone for the client's own, make the tile equal the client's copy.
	Causes []string `json:"causes,omitempty"`
	// Only is set when no single input does: the tiles differ through several together (Together lists
	// those that, all swapped, make it equal), or through something the inputs do not name.
	Together []string `json:"together,omitempty"`
	Note     string   `json:"note,omitempty"`
}

type regionDiffReport struct {
	Map   string     `json:"map"`
	X     int        `json:"x"`
	Y     int        `json:"y"`
	Size  int        `json:"size"`
	Same  int        `json:"sameTiles"`
	Tiles []tileDiff `json:"differingTiles"`
}

// tileFiles builds the edit and gives its tile files by tile name ("x_y").
func tileFiles(dataDir string, e vmangos.RegionEdit) (map[string][]byte, error) {
	files, err := vmangos.BuildRegion(dataDir, e)
	if err != nil {
		return nil, err
	}
	out := map[string][]byte{}
	for _, f := range files {
		if strings.EqualFold(f.Name[max(0, len(f.Name)-4):], ".adt") {
			out[tileName(f)] = f.Data
		}
	}
	return out, nil
}

func tileName(f mpq.File) string {
	n := strings.ReplaceAll(f.Name, `\`, "/")
	n = n[strings.LastIndex(n, "/")+1:]
	n = strings.TrimSuffix(n, n[strings.LastIndex(n, "."):])
	parts := strings.Split(n, "_")
	if len(parts) < 3 {
		return n
	}
	return parts[len(parts)-2] + "_" + parts[len(parts)-1]
}

// regionDiffRun is the command without the files around it: the edit, the Data folder, the report.
func regionDiffRun(e vmangos.RegionEdit, dataDir string) (*regionDiffReport, error) {
	client, err := vmangos.ReadRegion(dataDir, e.MapName, e.X, e.Y, e.Size)
	if err != nil {
		return nil, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	full, err := tileFiles(dataDir, e)
	if err != nil {
		return nil, err
	}
	// The client's copy of each tile, by the name the build gave it.
	built, err := vmangos.BuildRegion(dataDir, e)
	if err != nil {
		return nil, err
	}
	have := map[string][]byte{}
	for _, f := range built {
		if t := tileName(f); full[t] != nil {
			if b, err := set.ReadFile(f.Name); err == nil {
				have[t] = b
			}
		}
	}
	differs := func(files map[string][]byte, t string) bool {
		b, ok := have[t]
		return !ok || !bytes.Equal(files[t], b)
	}
	rep := &regionDiffReport{Map: e.MapName, X: e.X, Y: e.Y, Size: e.Size}
	// Each input swapped alone, and all of them together.
	alone := make([]map[string][]byte, len(regionInputs))
	for i, in := range regionInputs {
		v := e
		in.apply(&v, client)
		if alone[i], err = tileFiles(dataDir, v); err != nil {
			return nil, fmt.Errorf("without %s: %w", in.name, err)
		}
	}
	all := e
	for _, in := range regionInputs {
		in.apply(&all, client)
	}
	allFiles, err := tileFiles(dataDir, all)
	if err != nil {
		return nil, fmt.Errorf("without every input: %w", err)
	}
	names := make([]string, 0, len(full))
	for t := range full {
		names = append(names, t)
	}
	sort.Strings(names)
	for _, t := range names {
		if !differs(full, t) {
			rep.Same++
			continue
		}
		d := tileDiff{Tile: t}
		for i, in := range regionInputs {
			if !differs(alone[i], t) {
				d.Causes = append(d.Causes, in.name)
			}
		}
		if len(d.Causes) == 0 {
			if differs(allFiles, t) {
				d.Note = "still differs with every input swapped for the client's: the compile itself rewrites it"
			} else {
				d.Note = "no single input makes it differ; several together do"
				for i, in := range regionInputs {
					// An input that changes the tile when swapped alone is one of several.
					if !bytes.Equal(alone[i][t], full[t]) {
						d.Together = append(d.Together, in.name)
					}
				}
			}
		}
		rep.Tiles = append(rep.Tiles, d)
	}
	return rep, nil
}

// regionDiff is `meldtool region-diff <edit.json> <dataDir>`: the page's region edit (dumped by
// P.dumpRegionEdit) built over the client's Data folder, and per tile that differs from the copy the
// client reads, the inputs that make it differ (#1034).
func regionDiff(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("region-diff", flag.ContinueOnError)
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 2 {
		return fmt.Errorf("%w: region-diff takes an edit file and a Data folder", errUsage)
	}
	raw, err := os.ReadFile(pos[0])
	if err != nil {
		return err
	}
	var e vmangos.RegionEdit
	if err := json.Unmarshal(raw, &e); err != nil {
		return fmt.Errorf("%s: %w", pos[0], err)
	}
	rep, err := regionDiffRun(e, pos[1])
	if err != nil {
		return err
	}
	return writeJSON(out, rep)
}
