package vmangos

import "testing"

// bonusSpell is a Spell.dbc row of an aura (or two) of amount, passive with the generic icon unless
// changed.
func bonusSpell(id int, name string, aura, aura2 uint32, misc int, amount int) []any {
	row := make([]any, spellFDescription+1)
	for i := range row {
		row[i] = 0
	}
	row[0], row[spellFAttributes], row[spellFIcon], row[spellFName], row[spellFDescription] = id, spellAttrPassive, spellIconGeneric, name, "+$s1."
	row[spellFEffect], row[spellFAura], row[spellFMisc], row[spellFEffectBase], row[spellFEffectDice] = spellEffectAura, int(aura), misc, amount-1, 1
	if aura2 != 0 {
		row[spellFEffect+1], row[spellFAura+1], row[spellFMisc+1], row[spellFEffectBase+1], row[spellFEffectDice+1] = spellEffectAura, int(aura2), misc, amount-1, 1
	}
	return row
}

func TestEquipBonuses(t *testing.T) {
	talent := bonusSpell(5, "Wand Specialization", auraModDamageDone, 0, schoolMaskMagic, 8)
	talent[spellFIcon] = 294
	old := bonusSpell(6, "zzOLD Healing", auraModHealingDone, 0, 0, 22)
	tab := testDBC(t, spellFDescription+1,
		bonusSpell(10, "Increase Healing 22", auraModHealingDone, 0, schoolMaskMagic, 22),
		bonusSpell(11, "Increase Healing 22 again", auraModHealingDone, 0, schoolMaskMagic, 22),
		bonusSpell(12, "Increase Spell Dam 14", auraModDamageDone, auraModHealingDone, schoolMaskMagic, 14),
		bonusSpell(13, "Increase Fire Dam 7", auraModDamageDone, 0, 1<<2, 7),
		bonusSpell(14, "Attack Power 20", auraModAttackPower, auraModRangedAP, 0, 20),
		bonusSpell(15, "Increased Critical 1", auraModCrit, 0, 0, 1),
		talent, old,
	)
	kinds := equipBonuses(tab, map[int]bool{11: true})
	got := map[string][]EquipBonusSpell{}
	for _, k := range kinds {
		got[k.ID] = k.Amounts
	}
	want := map[string]EquipBonusSpell{"healing": {11, 22}, "spellpower": {12, 14}, "fire": {13, 7}, "attackpower": {14, 20}, "crit": {15, 1}}
	for id, w := range want {
		if len(got[id]) != 1 || got[id][0] != w {
			t.Errorf("%s: %+v, want %+v", id, got[id], w)
		}
	}
	// The talent (its own icon) and the old spell are no bonus; a spell of two auras is not one of its first alone.
	for _, id := range []string{"frost", "rangedap", "spellcrit"} {
		if len(got[id]) != 0 {
			t.Errorf("%s: %+v", id, got[id])
		}
	}
}
