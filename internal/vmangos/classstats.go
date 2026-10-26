package vmangos

import (
	"fmt"
	"strconv"
)

// ClassLevelStats is a creature_classlevelstats row: what the server gives a creature of a class at
// a level before the template's multipliers (health × health_multiplier, melee damage ×
// damage_multiplier, armour × armor_multiplier).
type ClassLevelStats struct {
	Level       int     `json:"level"`
	Health      int     `json:"health"`
	Mana        int     `json:"mana"`
	MeleeDamage float64 `json:"meleeDamage"`
	Armor       int     `json:"armor"`
}

// ReadClassLevelStats reads the rows of unit class class from level from to level to.
func ReadClassLevelStats(serverRoot string, class, from, to int) ([]ClassLevelStats, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT `level`, `health`, `mana`, `melee_damage`, `armor` FROM `creature_classlevelstats` WHERE `class` = %d AND `level` BETWEEN %d AND %d ORDER BY `level`", class, from, to))
	if err != nil {
		return nil, err
	}
	return parseClassLevelStats(raw), nil
}

func parseClassLevelStats(raw []byte) []ClassLevelStats {
	var out []ClassLevelStats
	for _, f := range batchRows(raw, 5) {
		lvl, _ := strconv.Atoi(f[0])
		hp, _ := strconv.Atoi(f[1])
		mana, _ := strconv.Atoi(f[2])
		dmg, _ := strconv.ParseFloat(f[3], 64)
		armor, _ := strconv.Atoi(f[4])
		out = append(out, ClassLevelStats{Level: lvl, Health: hp, Mana: mana, MeleeDamage: dmg, Armor: armor})
	}
	return out
}
