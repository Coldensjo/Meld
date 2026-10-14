package vmangos

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
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
	// A doodad's path is its file name, .mdl in the table and .m2 in the archives.
	paths := map[uint32]string{}
	for r := 0; r < doodads.records; r++ {
		name := doodads.str(r, 2)
		if name == "" {
			continue
		}
		name = strings.TrimSuffix(strings.TrimSuffix(name, ".mdl"), ".MDL")
		name = strings.TrimSuffix(strings.TrimSuffix(name, ".mdx"), ".MDX")
		paths[doodads.u32(r, 0)] = detailDir + name + ".m2"
	}
	out := map[uint32]GroundEffect{}
	for r := 0; r < textures.records; r++ {
		var e GroundEffect
		for f := 1; f <= 4; f++ {
			if p, ok := paths[textures.u32(r, f)]; ok {
				e.Doodads = append(e.Doodads, p)
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
