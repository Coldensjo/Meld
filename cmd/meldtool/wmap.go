package main

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"

	"Meld/internal/mapfile"
)

// wmapSummary is what wmap info prints: the header as saved, and a count of each blob instead of
// its bytes.
type wmapSummary struct {
	File     string  `json:"file"`
	Version  int     `json:"version"`
	Name     string  `json:"name"`
	Size     int     `json:"size"`
	CellSize float64 `json:"cellSize"`
	SplatRes int     `json:"splatRes"`
	// HeightMin and HeightMax are the lowest and highest height samples.
	HeightMin float32  `json:"heightMin"`
	HeightMax float32  `json:"heightMax"`
	Palette   []string `json:"palette,omitempty"`
	// Objects counts the placed objects by kind (the type's prefix: m2, wmo, helper).
	Objects       map[string]int `json:"objects"`
	AttachedCount int            `json:"attached"`
	// HoleCells counts the cells with a hole (whole or half), LiquidLayers the liquid layers by type.
	HoleCells    int            `json:"holeCells"`
	LiquidLayers map[string]int `json:"liquidLayers,omitempty"`
	// Zones counts the chunks by AreaTable ID, ImpassableChunks the chunks flagged impassable and
	// NoEffectCells the cells that grow no ground effect doodads.
	Zones            map[string]int          `json:"zones,omitempty"`
	ImpassableChunks int                     `json:"impassableChunks"`
	NoEffectCells    int                     `json:"noEffectCells"`
	Shadows          bool                    `json:"shadows"`
	Paths            int                     `json:"paths"`
	Region           *mapfile.ClientRegion   `json:"region,omitempty"`
	Vmangos          *mapfile.VmangosFolder  `json:"vmangos,omitempty"`
	Reference        *mapfile.ReferenceImage `json:"reference,omitempty"`
	Unknown          []string                `json:"unknown,omitempty"`
}

func wmapInfo(args []string, out io.Writer) error {
	if len(args) != 1 {
		return fmt.Errorf("%w: wmap info takes one file", errUsage)
	}
	m, err := mapfile.Load(args[0])
	if err != nil {
		return err
	}
	s, err := summarize(m)
	if err != nil {
		return err
	}
	s.File = args[0]
	return writeJSON(out, s)
}

func summarize(m *mapfile.MapData) (*wmapSummary, error) {
	s := &wmapSummary{
		Version: m.Version, Name: m.Name, Size: m.Size, CellSize: m.CellSize, SplatRes: m.SplatRes,
		Palette: m.Palette, Objects: map[string]int{}, Paths: len(m.Paths),
		Region: m.Region, Vmangos: m.Vmangos, Reference: m.Reference,
	}
	for _, o := range m.Objects {
		kind, _, _ := strings.Cut(o.Type, ":")
		s.Objects[kind]++
		if o.Parent != 0 {
			s.AttachedCount++
		}
	}
	blob := func(name, b64 string) ([]byte, error) {
		b, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		return b, nil
	}
	heights, err := blob("heights", m.Heights)
	if err != nil {
		return nil, err
	}
	s.HeightMin, s.HeightMax = float32(math.Inf(1)), float32(math.Inf(-1))
	for i := 0; i+4 <= len(heights); i += 4 {
		h := math.Float32frombits(binary.LittleEndian.Uint32(heights[i:]))
		s.HeightMin, s.HeightMax = min(s.HeightMin, h), max(s.HeightMax, h)
	}
	holes, err := blob("holes", m.Holes)
	if err != nil {
		return nil, err
	}
	for _, h := range holes {
		if h != 0 {
			s.HoleCells++
		}
	}
	liquids, err := blob("liquids", m.Liquids)
	if err != nil {
		return nil, err
	}
	if len(liquids) >= 4 {
		s.LiquidLayers = map[string]int{}
		n := int(binary.LittleEndian.Uint32(liquids))
		for i := 0; i < n && 4+(i+1)*mapfile.LiquidRecordSize <= len(liquids); i++ {
			s.LiquidLayers[fmt.Sprint(liquids[4+i*mapfile.LiquidRecordSize+4])]++
		}
	}
	areas, err := blob("areaIds", m.AreaIDs)
	if err != nil {
		return nil, err
	}
	if len(areas) > 0 {
		s.Zones = map[string]int{}
		for i := 0; i+4 <= len(areas); i += 4 {
			s.Zones[fmt.Sprint(binary.LittleEndian.Uint32(areas[i:]))]++
		}
	}
	flags, err := blob("chunkFlags", m.ChunkFlags)
	if err != nil {
		return nil, err
	}
	for _, f := range flags {
		if f&mapfile.ChunkImpassable != 0 {
			s.ImpassableChunks++
		}
	}
	noEffect, err := blob("noEffect", m.NoEffect)
	if err != nil {
		return nil, err
	}
	for _, c := range noEffect {
		if c != 0 {
			s.NoEffectCells++
		}
	}
	s.Shadows = m.Shadows != ""
	for name, on := range map[string]bool{"holes": m.HolesUnknown, "liquids": m.LiquidsUnknown, "chunkData": m.ChunkDataUnknown} {
		if on {
			s.Unknown = append(s.Unknown, name)
		}
	}
	sort.Strings(s.Unknown)
	return s, nil
}
