package vmangos

import (
	"fmt"
	"sort"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
)

// LiquidTypeEntry is a row of the client's LiquidType.dbc: every liquid the client knows, including
// the ones only a dungeon's building uses (Naxxramas's slime). Kind is the row's type column as the
// 1.12 client numbers it: 0 magma, 2 slime, 3 water (ocean is the water row with ID 2); a 3.3.5a
// client's column, which numbers them another way, is given in those numbers (liquidKind112). Spell
// is the aura the liquid gives a swimmer.
type LiquidTypeEntry struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Kind  int    `json:"kind"`
	Spell int    `json:"spell"`
}

// liquidKind112 is a LiquidType.dbc row's type column in the 1.12 client's numbers. The 3.3.5a
// client numbers the kinds 0 water, 1 ocean, 2 magma, 3 slime; read as 1.12's they would turn every
// lake into lava. Its ocean rows come out as water, as 1.12's one ocean row is (the page tells that
// one by its ID).
func liquidKind112(build clientbuild.Build, kind int) int {
	if build != clientbuild.WotLK {
		return kind
	}
	switch kind {
	case 2:
		return 0 // magma
	case 3:
		return 2 // slime
	}
	return 3 // water and ocean
}

// LoadLiquidTypes reads LiquidType.dbc from the client at dataDir, in ID order.
func LoadLiquidTypes(dataDir string) ([]LiquidTypeEntry, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(dbcLiquidType.file())
	if err != nil {
		return nil, fmt.Errorf("LiquidType.dbc: %w", err)
	}
	t, err := parseTable(b, dbcLiquidType)
	if err != nil {
		return nil, err
	}
	name, kind, spell := t.col("Name"), t.col("Kind"), t.col("Spell")
	if t.fields <= kind {
		return nil, fmt.Errorf("LiquidType.dbc has %d fields; the 1.12 layout has 4", t.fields)
	}
	out := make([]LiquidTypeEntry, 0, t.records)
	for r := 0; r < t.records; r++ {
		e := LiquidTypeEntry{ID: int(t.u32(r, 0)), Name: t.str(r, name), Kind: liquidKind112(t.l.build, int(t.u32(r, kind)))}
		if t.fields > spell {
			e.Spell = int(t.u32(r, spell))
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
