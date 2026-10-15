package vmangos

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// Ground effects are the grass tufts, flowers and pebbles the game scatters over the ground: each
// texture layer of a tile carries a GroundEffectTexture.dbc ID, whose row names up to four
// GroundEffectDoodad.dbc models and how densely they grow. The tables carry no texture names, so
// which effect a texture should have is learned from the client's own tiles: every texture layer
// Blizzard painted votes for its effect.

// GroundEffect is one GroundEffectTexture row: the detail models it grows and how many.
type GroundEffect struct {
	// Doodads are the models' archive paths (World\NoDXT\Detail\...m2), one to four.
	Doodads []string `json:"doodads"`
	// Slots are the row's four doodad slots in order, each an index into Doodads, or -1 for an empty
	// slot or one naming no model. The client keeps the slot pattern: the nth doodad of a cell takes
	// slot (n + the cell's turn) & 3, and an empty one places nothing.
	Slots [4]int `json:"slots"`
	// Density is the row's amount: 8 for most grass, up to 24.
	Density int `json:"density"`
	// Terrain is the TerrainType.dbc ID the row gives (footstep sounds).
	Terrain int `json:"terrain"`
}

// GroundEffectTables is what the editor needs of the ground effects.
type GroundEffectTables struct {
	// Effects by GroundEffectTexture ID; rows that grow nothing are left out.
	Effects map[uint32]GroundEffect `json:"effects"`
	// Textures is the effect each tileset texture (lower-case path) carries in the client's own
	// tiles: the one most of its layers use.
	Textures map[string]uint32 `json:"textures"`
}

// detailDir is where the game keeps the detail doodads the DBC names by file name alone.
const detailDir = `World\NoDXT\Detail\`

// noDoodad is an empty GroundEffectTexture slot. 0 is not empty: it is ElwFlo01's internal ID, which
// sixteen of the client's slots name.
const noDoodad = 0xFFFFFFFF

// detailPaths maps each GroundEffectDoodad row's internal ID (field 1) to its model's archive path. A
// GroundEffectTexture slot names a doodad by that ID, not by the row ID (field 0, mostly one more),
// as the client's CMapChunk::CreateDetailDoodads looks it up (after Benilla's ground_effects.rs, MIT/
// Apache); keyed by the row ID, 264 of the client's effects mix models of other zones, by the internal
// ID 29. A path is the file name, .mdl in the table and .m2 in the archives.
func detailPaths(doodads *dbcTable) map[uint32]string {
	paths := map[uint32]string{}
	for r := 0; r < doodads.records; r++ {
		name := doodads.str(r, 2)
		if name == "" {
			continue
		}
		name = strings.TrimSuffix(strings.TrimSuffix(name, ".mdl"), ".MDL")
		name = strings.TrimSuffix(strings.TrimSuffix(name, ".mdx"), ".MDX")
		paths[doodads.u32(r, 1)] = detailDir + name + ".m2"
	}
	return paths
}

// readGroundEffectDBCs reads the two tables from the client.
func readGroundEffectDBCs(set *mpq.Set) (map[uint32]GroundEffect, error) {
	read := func(name string) (*dbcTable, error) {
		b, err := set.ReadFile(`DBFilesClient\` + name)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		return parseDBC(b)
	}
	doodads, err := read("GroundEffectDoodad.dbc")
	if err != nil {
		return nil, err
	}
	textures, err := read("GroundEffectTexture.dbc")
	if err != nil {
		return nil, err
	}
	if doodads.fields < 3 || textures.fields < 7 {
		return nil, fmt.Errorf("ground effect tables have %d and %d fields; the 1.12 layout has 3 and 7", doodads.fields, textures.fields)
	}
	paths := detailPaths(doodads)
	out := map[uint32]GroundEffect{}
	for r := 0; r < textures.records; r++ {
		var e GroundEffect
		for f := 1; f <= 4; f++ {
			e.Slots[f-1] = -1
			if id := textures.u32(r, f); id != noDoodad {
				if p, ok := paths[id]; ok {
					e.Slots[f-1] = len(e.Doodads)
					e.Doodads = append(e.Doodads, p)
				}
			}
		}
		if len(e.Doodads) == 0 {
			continue
		}
		e.Density = int(textures.u32(r, 5))
		e.Terrain = int(textures.u32(r, 6))
		out[textures.u32(r, 0)] = e
	}
	return out, nil
}

// learnTextureEffects reads every tile of every map in the client and returns, per texture, the
// effect most of its layers carry. progress is told every so often, for the status bar.
func learnTextureEffects(set *mpq.Set, progress func(string)) map[string]uint32 {
	var tiles []string
	for _, name := range set.List() {
		low := strings.ToLower(name)
		if strings.HasPrefix(low, `world\maps\`) && strings.HasSuffix(low, ".adt") {
			tiles = append(tiles, name)
		}
	}
	sort.Strings(tiles)
	votes := map[string]map[uint32]int{}
	for i, name := range tiles {
		if progress != nil && i%100 == 0 {
			progress(fmt.Sprintf("Learning ground effects from the client's tiles… %d of %d", i, len(tiles)))
		}
		root, err := set.ReadFile(name)
		if err != nil {
			continue
		}
		effects, err := adt.LayerEffects(root)
		if err != nil {
			continue
		}
		for tex, e := range effects {
			if votes[tex] == nil {
				votes[tex] = map[uint32]int{}
			}
			votes[tex][e]++
		}
	}
	out := map[string]uint32{}
	for tex, v := range votes {
		best, n := uint32(0), 0
		for e, c := range v {
			if c > n || (c == n && e < best) {
				best, n = e, c
			}
		}
		out[tex] = best
	}
	return out
}

// LoadGroundEffects reads the ground effect tables of the client at dataDir. The texture-to-effect
// pairs are learned from the client's tiles once and kept in cacheDir, keyed by the client folder.
func LoadGroundEffects(dataDir, cacheDir string, progress func(string)) (*GroundEffectTables, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	effects, err := readGroundEffectDBCs(set)
	if err != nil {
		return nil, err
	}
	t := &GroundEffectTables{Effects: effects}
	sum := sha1.Sum([]byte(strings.ToLower(filepath.Clean(dataDir))))
	cache := filepath.Join(cacheDir, "Meld", "groundeffects", hex.EncodeToString(sum[:])[:12]+".json")
	if b, err := os.ReadFile(cache); err == nil {
		if json.Unmarshal(b, &t.Textures) == nil && len(t.Textures) > 0 {
			return t, nil
		}
	}
	t.Textures = learnTextureEffects(set, progress)
	if b, err := json.Marshal(t.Textures); err == nil {
		if os.MkdirAll(filepath.Dir(cache), 0o755) == nil {
			_ = os.WriteFile(cache, b, 0o644)
		}
	}
	return t, nil
}

// AddGroundEffect returns GroundEffectTexture.dbc with a new row growing `doodads` (archive paths, as
// GroundEffectTables names them; each must be a GroundEffectDoodad row already) at `density`, with the
// footstep sounds of TerrainType `terrain`, and the new row's ID (the first past the table's).
func AddGroundEffect(doodadDBC, textureDBC []byte, doodads []string, density, terrain uint32) ([]byte, uint32, error) {
	if len(doodads) == 0 || len(doodads) > 4 {
		return nil, 0, fmt.Errorf("a ground effect grows one to four models, not %d", len(doodads))
	}
	if density == 0 || density > 64 {
		return nil, 0, fmt.Errorf("density %d is outside 1 to 64", density)
	}
	dt, err := parseDBC(doodadDBC)
	if err != nil {
		return nil, 0, err
	}
	tt, err := parseDBC(textureDBC)
	if err != nil {
		return nil, 0, err
	}
	if dt.fields < 3 || tt.fields != 7 {
		return nil, 0, errors.New("the ground effect tables aren't the 1.12 client's")
	}
	// A slot names the doodad's internal ID (see detailPaths); a model listed twice takes its lower one.
	ids := map[string]uint32{}
	for id, p := range detailPaths(dt) {
		low := strings.ToLower(p)
		if old, ok := ids[low]; !ok || id < old {
			ids[low] = id
		}
	}
	var next uint32
	for r := 0; r < tt.records; r++ {
		next = max(next, tt.u32(r, 0))
	}
	next++
	row := []uint32{next, noDoodad, noDoodad, noDoodad, noDoodad, density, terrain}
	for i, d := range doodads {
		id, ok := ids[strings.ToLower(d)]
		if !ok {
			return nil, 0, fmt.Errorf("%s is not a ground effect model of the client", d)
		}
		row[1+i] = id
	}
	out, err := setRecords(textureDBC, [][]uint32{row})
	return out, next, err
}
