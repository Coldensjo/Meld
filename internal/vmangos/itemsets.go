package vmangos

import (
	"sync"

	"Meld/internal/mpq"
)

// ItemSet is one row of the client's ItemSet.dbc, the set an item_template's set_id names (#355):
// its name, the member items, the bonus spells with the number of members each needs, and the skill
// the set requires.
type ItemSet struct {
	ID                int            `json:"id"`
	Name              string         `json:"name"`
	Items             []int          `json:"items"`
	Bonuses           []ItemSetBonus `json:"bonuses"`
	RequiredSkill     int            `json:"requiredSkill"`
	RequiredSkillRank int            `json:"requiredSkillRank"`
}

// ItemSetBonus is a set bonus: the spell, and how many of the set's members must be worn for it.
type ItemSetBonus struct {
	Spell     int `json:"spell"`
	Threshold int `json:"threshold"`
}

// parseItemSet reads row r of ItemSet.dbc (dbcItemSet; 1.12's is VMaNGOS ItemSetEntry), leaving out
// the empty item and spell slots.
func parseItemSet(t *dbcTable, r int) ItemSet {
	items, spells, thresholds := t.at("Item", 0), t.at("Spell", 0), t.at("Threshold", 0)
	s := ItemSet{ID: int(t.u32(r, 0)), Name: t.str(r, t.col("Name")), Items: []int{}, Bonuses: []ItemSetBonus{}}
	for i := 0; i < t.l.count("Item") && items+i < t.fields; i++ {
		if id := t.u32(r, items+i); id != 0 {
			s.Items = append(s.Items, int(id))
		}
	}
	for i := 0; i < t.l.count("Spell") && thresholds+i < t.fields; i++ {
		if spell := t.u32(r, spells+i); spell != 0 {
			s.Bonuses = append(s.Bonuses, ItemSetBonus{Spell: int(spell), Threshold: int(t.u32(r, thresholds+i))})
		}
	}
	if skill, rank := t.col("Skill"), t.col("SkillRank"); t.fields > rank {
		s.RequiredSkill = int(t.u32(r, skill))
		s.RequiredSkillRank = int(t.u32(r, rank))
	}
	return s
}

// itemSets is ItemSet.dbc, read once per client data folder.
var itemSets struct {
	sync.Mutex
	dir string
	t   *dbcTable
}

// ItemSets gives the client's item sets of the given IDs, leaving out the IDs it doesn't have.
func ItemSets(dataDir string, ids []int) ([]ItemSet, error) {
	itemSets.Lock()
	defer itemSets.Unlock()
	if itemSets.t == nil || itemSets.dir != dataDir {
		set, err := mpq.OpenDataDir(dataDir)
		if err != nil {
			return nil, err
		}
		b, err := set.ReadFile(dbcItemSet.file())
		set.Close()
		if err != nil {
			return nil, err
		}
		t, err := parseTable(b, dbcItemSet)
		if err != nil {
			return nil, err
		}
		itemSets.dir, itemSets.t = dataDir, t
	}
	out := make([]ItemSet, 0, len(ids))
	for _, id := range ids {
		if r, ok := itemSets.t.row(uint32(id)); ok && id != 0 {
			out = append(out, parseItemSet(itemSets.t, r))
		}
	}
	return out, nil
}
