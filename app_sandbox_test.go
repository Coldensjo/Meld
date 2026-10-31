package main

import (
	"errors"
	"path/filepath"
	"testing"

	"Meld/internal/vmangos"
	"Meld/internal/wow"
)

// While the probes' throwaway client is on, every binding that writes the world database refuses
// before it reaches the database (#383): the throwaway client has no throwaway database, so the write
// would land in the owner's. The server folder is one that doesn't exist, so a binding that got past
// the guard fails with another error rather than writing anything.
func TestSandboxRefusesWorldDatabaseWrites(t *testing.T) {
	dir := t.TempDir()
	a := &App{wow: wow.NewClient()}
	a.cfg.VmangosPath = filepath.Join(dir, "no-server")
	a.cfg.WowPath = filepath.Join(dir, "no-client")
	a.sandboxData = filepath.Join(dir, "sandbox", "Data")
	missing := filepath.Join(dir, "missing.sql")

	calls := map[string]func() error{
		"SaveCreature":        func() error { _, err := a.SaveCreature(-1, 0, nil); return err },
		"SaveCreatureQuests":  func() error { _, err := a.SaveCreatureQuests(-1, vmangos.QuestLists{}); return err },
		"SaveCreatureSpells":  func() error { _, err := a.SaveCreatureSpells(-1, nil); return err },
		"SaveConditionText":   func() error { _, err := a.SaveConditionText(-1, 0, 1, "", ""); return err },
		"DeleteConditionText": func() error { _, err := a.DeleteConditionText(-1, 0); return err },
		"SaveGossipOptions":   func() error { _, err := a.SaveGossipOptions(-1, nil); return err },
		"SaveAILine":          func() error { _, err := a.SaveAILine(-1, 0, 0, 0, "x"); return err },
		"SaveGreeting":        func() error { _, err := a.SaveGreeting(-1, "", ""); return err },
		"SaveItem":            func() error { _, err := a.SaveItem(-1, 0, nil); return err },
		"SaveObject":          func() error { _, err := a.SaveObject(-1, 0, nil); return err },
		"SaveObjectLoot":      func() error { _, err := a.SaveObjectLoot(-1, nil); return err },
		"SaveObjectQuests":    func() error { _, err := a.SaveObjectQuests(-1, vmangos.QuestLists{}); return err },
		"SavePages":           func() error { _, err := a.SavePages(-1, nil); return err },
		"SaveQuest":           func() error { _, err := a.SaveQuest(-1, 0, nil); return err },
		"SaveQuestGivers":     func() error { _, err := a.SaveQuestGivers(-1, vmangos.QuestGivers{}, nil); return err },
		"SaveVendor":          func() error { _, err := a.SaveVendor(-1, nil); return err },
		"CreateCreature":      func() error { _, err := a.CreateCreature(0, "Probe"); return err },
		"CreateItem":          func() error { _, err := a.CreateItem(0, "Probe"); return err },
		"CreateItemOfKind":    func() error { _, err := a.CreateItemOfKind(0, 0, 0, "Probe"); return err },
		"CreateObject":        func() error { _, err := a.CreateObject(0, "Probe"); return err },
		"CreateQuest":         func() error { _, err := a.CreateQuest(0, "Probe"); return err },
		"DeleteQuest":         func() error { _, err := a.DeleteQuest(-1); return err },
		"DeleteItem":          func() error { _, err := a.DeleteItem(-1); return err },
		"ImportItems":         func() error { _, err := a.ImportItems(missing); return err },
		"ImportCreatures":     func() error { _, err := a.ImportCreatures(missing); return err },
		"ImportObjects":       func() error { _, err := a.ImportObjects(missing); return err },
		"ImportQuests":        func() error { _, err := a.ImportQuests(missing); return err },
		"ImportAreas":         func() error { _, err := a.ImportAreas(missing); return err },
		"ImportAreaTriggers":  func() error { _, err := a.ImportAreaTriggers(missing); return err },
		"ImportTaxi":          func() error { _, err := a.ImportTaxi(missing); return err },
		"ImportSpells":        func() error { _, err := a.ImportSpells(missing); return err },
		"SaveSpell":           func() error { _, err := a.SaveSpell(-1, 0, nil, "", nil); return err },
		"CreateSpell":         func() error { _, err := a.CreateSpell(0, "", "Probe"); return err },
		"ApplySpawnEdits":     func() error { _, err := a.ApplySpawnEdits("Azeroth", 32, 48, 1, nil); return err },
		"SaveAreas":           func() error { _, err := a.SaveAreas(nil, nil); return err },
		"SaveAreaTriggers":    func() error { _, err := a.SaveAreaTriggers(nil, nil); return err },
		"SaveTaxi":            func() error { _, err := a.SaveTaxi(vmangos.TaxiEdit{}); return err },
		"EquipmentFor":        func() error { _, err := a.EquipmentFor([3]int{1, 0, 0}); return err },
	}
	for name, call := range calls {
		if err := call(); !errors.Is(err, errSandboxed) {
			t.Errorf("%s with the sandbox on: got %v, want errSandboxed", name, err)
		}
	}
}
