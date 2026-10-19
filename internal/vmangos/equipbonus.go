package vmangos

import (
	"sort"
	"strconv"
	"strings"
)

// An item of 1.12 has ten stat slots, and they hold only mana, health and the five attributes
// (ITEM_MOD_*). Every other bonus, healing, spell damage, crit, hit, dodge, attack power, mana per 5
// and the rest, is an "Equip:" effect: the item names a passive spell that applies an aura. The item
// editor's Equip bonuses (#353) list, for each such bonus, the amounts the client has a spell of its
// own for, so the author picks "Healing +22" and Meld finds the spell. The client's item bonus
// spells are passive, have the generic icon (SpellIcon 1) and one aura, or two of the same amount
// where the bonus is two (damage and healing: damage done and healing done; attack power: melee and
// ranged); a spell the world database's items already use as an Equip effect wins an amount over one
// no item uses, and old and test spells (zzOLD…, (Old)…, QA…) and the druids' feral ones are left out.

// Spell.dbc fields of 1.12.1 (MaNGOS's SpellEntry) the bonuses read, besides those of spelltext.go.
const (
	spellFAttributes = 6
	spellIconGeneric = 1
	spellFEffect     = 61 // three fields: Effect
	spellFAura       = 91 // EffectApplyAuraName
	spellFMisc       = 106
)

const (
	spellAttrPassive   = 0x40
	spellEffectAura    = 6
	auraModDamageDone  = 13
	auraModSkill       = 30
	auraModParry       = 47
	auraModDodge       = 49
	auraModBlock       = 51
	auraModCrit        = 52
	auraModHit         = 54
	auraModSpellHit    = 55
	auraModSpellCrit   = 57
	auraModPowerRegen  = 85
	auraModAttackPower = 99
	auraModRangedAP    = 124
	auraModHealingDone = 135
	auraModBlockValue  = 158
	skillDefense       = 95
	schoolMaskMagic    = 126
)

// EquipBonusKind is a bonus an Equip effect gives: its name, "%" when it is a chance, and the
// client's spells that give it alone, one an amount, by amount.
type EquipBonusKind struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Unit    string            `json:"unit"`
	Amounts []EquipBonusSpell `json:"amounts"`
	aura    uint32
	// aura2 is the second effect's aura for a bonus of two (0 for one).
	aura2 uint32
	// misc is the effect's misc value the bonus needs (-1 for any).
	misc int64
}

// EquipBonusSpell is a spell that gives a bonus, and how much.
type EquipBonusSpell struct {
	Spell  int `json:"spell"`
	Amount int `json:"amount"`
}

// equipBonusKinds are the bonuses listed, in the order the editor shows them.
func equipBonusKinds() []EquipBonusKind {
	k := func(id, name, unit string, aura uint32, misc int64) EquipBonusKind {
		return EquipBonusKind{ID: id, Name: name, Unit: unit, aura: aura, misc: misc}
	}
	k2 := func(id, name string, aura, aura2 uint32, misc int64) EquipBonusKind {
		return EquipBonusKind{ID: id, Name: name, aura: aura, aura2: aura2, misc: misc}
	}
	return []EquipBonusKind{
		k("healing", "Healing", "", auraModHealingDone, -1),
		k2("spellpower", "Spell damage and healing", auraModDamageDone, auraModHealingDone, schoolMaskMagic),
		k("fire", "Fire spell damage", "", auraModDamageDone, 1<<2),
		k("nature", "Nature spell damage", "", auraModDamageDone, 1<<3),
		k("frost", "Frost spell damage", "", auraModDamageDone, 1<<4),
		k("shadow", "Shadow spell damage", "", auraModDamageDone, 1<<5),
		k("arcane", "Arcane spell damage", "", auraModDamageDone, 1<<6),
		k("holy", "Holy spell damage", "", auraModDamageDone, 1<<1),
		k("spellcrit", "Spell critical strike chance", "%", auraModSpellCrit, -1),
		k("spellhit", "Spell hit chance", "%", auraModSpellHit, -1),
		k("crit", "Critical strike chance", "%", auraModCrit, -1),
		k("hit", "Hit chance", "%", auraModHit, -1),
		k2("attackpower", "Attack power", auraModAttackPower, auraModRangedAP, -1),
		k("rangedap", "Ranged attack power", "", auraModRangedAP, -1),
		k("dodge", "Dodge chance", "%", auraModDodge, -1),
		k("parry", "Parry chance", "%", auraModParry, -1),
		k("block", "Block chance", "%", auraModBlock, -1),
		k("blockvalue", "Block value", "", auraModBlockValue, -1),
		k("defense", "Defense skill", "", auraModSkill, skillDefense),
		k("mp5", "Mana every 5 sec", "", auraModPowerRegen, 0),
	}
}

// EquipBonuses lists the bonuses with the client's spells for each amount; with serverRoot, the
// spells the world database's items use as Equip effects come first.
func EquipBonuses(serverRoot, dataDir string) ([]EquipBonusKind, error) {
	used := map[int]bool{}
	if serverRoot != "" {
		if db, err := worldDatabase(serverRoot); err == nil && ensureDatabase(db, serverRoot) == nil {
			var parts []string
			for i := 1; i <= 5; i++ {
				parts = append(parts, "SELECT spellid_"+strconv.Itoa(i)+" FROM item_template WHERE spelltrigger_"+strconv.Itoa(i)+" = 1 AND spellid_"+strconv.Itoa(i)+" > 0")
			}
			if raw, err := runSQL(db, "SELECT DISTINCT s FROM ("+strings.Join(parts, " UNION ALL ")+") u(s)"); err == nil {
				for _, f := range strings.Fields(string(raw)) {
					if n, err := strconv.Atoi(f); err == nil {
						used[n] = true
					}
				}
			}
		}
	}
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return nil, err
	}
	return equipBonuses(spellData.spells, used), nil
}

func equipBonuses(t *dbcTable, used map[int]bool) []EquipBonusKind {
	kinds := equipBonusKinds()
	if t.fields <= spellFMisc+2 {
		return kinds
	}
	i32 := func(r, f int) int { return int(int32(t.u32(r, f))) }
	amountOf := func(r, e int) int { return i32(r, spellFEffectBase+e) + max(i32(r, spellFEffectDice+e), 1) }
	// best[kind][amount]: the spell found, the best scored (used by an item, then described), then the lowest ID.
	type pick struct{ spell, score int }
	best := make([]map[int]pick, len(kinds))
	for i := range best {
		best[i] = map[int]pick{}
	}
	for r := 0; r < t.records; r++ {
		if t.u32(r, spellFAttributes)&spellAttrPassive == 0 || t.u32(r, spellFIcon) != spellIconGeneric || t.u32(r, spellFEffect) != spellEffectAura || t.u32(r, spellFEffect+2) != 0 {
			continue
		}
		name := strings.ToLower(t.str(r, spellFName))
		if strings.HasPrefix(name, "zz") || strings.HasPrefix(name, "(old)") || strings.HasPrefix(name, "qa") || strings.Contains(name, "test") || strings.Contains(name, "feral") {
			continue
		}
		// One value, not a range: BasePoints plus a die of one side.
		if i32(r, spellFEffectDie) > 1 {
			continue
		}
		amount := amountOf(r, 0)
		if amount <= 0 {
			continue
		}
		aura, misc := t.u32(r, spellFAura), int64(i32(r, spellFMisc))
		// A second effect only as the second aura of a bonus of two, of the same amount.
		aura2 := uint32(0)
		if t.u32(r, spellFEffect+1) != 0 {
			if t.u32(r, spellFEffect+1) != spellEffectAura || amountOf(r, 1) != amount {
				continue
			}
			aura2 = t.u32(r, spellFAura+1)
		}
		for i, k := range kinds {
			if k.aura != aura || k.aura2 != aura2 || (k.misc >= 0 && k.misc != misc) {
				continue
			}
			id := int(t.u32(r, 0))
			p := pick{spell: id}
			if used[id] {
				p.score += 2
			}
			if t.str(r, spellFDescription) != "" {
				p.score++
			}
			if old, ok := best[i][amount]; !ok || p.score > old.score || (p.score == old.score && p.spell < old.spell) {
				best[i][amount] = p
			}
		}
	}
	for i := range kinds {
		for amount, p := range best[i] {
			kinds[i].Amounts = append(kinds[i].Amounts, EquipBonusSpell{Spell: p.spell, Amount: amount})
		}
		sort.Slice(kinds[i].Amounts, func(a, b int) bool { return kinds[i].Amounts[a].Amount < kinds[i].Amounts[b].Amount })
	}
	return kinds
}
