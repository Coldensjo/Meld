package vmangos

import (
	"fmt"
	"sort"

	"Meld/internal/mpq"
)

// LiquidTypeEntry is a row of the client's LiquidType.dbc: every liquid the client knows, including
// the ones only a dungeon's building uses (Naxxramas's slime). Kind is the row's type column: 0 magma,
// 2 slime, 3 water (ocean is the water row with ID 2); Spell is the aura the liquid gives a swimmer.
type LiquidTypeEntry struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Kind  int    `json:"kind"`
	Spell int    `json:"spell"`
}

// LoadLiquidTypes reads LiquidType.dbc from the client at dataDir, in ID order.
func LoadLiquidTypes(dataDir string) ([]LiquidTypeEntry, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(`DBFilesClient\LiquidType.dbc`)
	if err != nil {
		return nil, fmt.Errorf("LiquidType.dbc: %w", err)
	}
	t, err := parseDBC(b)
	if err != nil {
		return nil, err
	}
	if t.fields < 3 {
		return nil, fmt.Errorf("LiquidType.dbc has %d fields; the 1.12 layout has 4", t.fields)
	}
	out := make([]LiquidTypeEntry, 0, t.records)
	for r := 0; r < t.records; r++ {
		e := LiquidTypeEntry{ID: int(t.u32(r, 0)), Name: t.str(r, 1), Kind: int(t.u32(r, 2))}
		if t.fields > 3 {
			e.Spell = int(t.u32(r, 3))
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
