package main

import (
	"errors"

	"Meld/internal/vmangos"
)

// Tools › Characters and Accounts (#855): the realm's accounts and their characters, in the server's
// login and character databases (internal/vmangos/accounts.go), with a character's equipment
// (inventory.go, #874) and its look, skills, spells and reputation (charsheet.go, #875).

// serverRoot is the VMaNGOS server folder, for a binding that reads the server's databases only; ""
// while an external database (#856) is connected without a folder set.
func (a *App) serverRoot() (string, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" && !externalOn() {
		return "", errors.New("set the VMaNGOS server folder first (Edit › Preferences › Folders)")
	}
	return server, nil
}

// ListAccounts lists the realm's accounts, each with its count of characters.
func (a *App) ListAccounts() ([]vmangos.Account, error) {
	server, err := a.serverRoot()
	if err != nil {
		return nil, err
	}
	return vmangos.ListAccounts(server)
}

// CreateAccount adds an account with a password and GM level, and returns its id.
func (a *App) CreateAccount(name, password string, gmLevel int) (int, error) {
	s, err := a.serverSession()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateAccount(s.ServerRoot, name, password, gmLevel)
}

// SetAccount changes an account's GM level and, unless password is empty, its password.
func (a *App) SetAccount(id, gmLevel int, password string) error {
	s, err := a.serverSession()
	if err != nil {
		return err
	}
	return vmangos.SetAccount(s.ServerRoot, id, gmLevel, password)
}

// DeleteAccount removes an account with its characters (which needs the world server stopped), or one
// without characters that is not logged in.
func (a *App) DeleteAccount(id int) error {
	s, err := a.serverSession()
	if err != nil {
		return err
	}
	return vmangos.DeleteAccount(s.ServerRoot, id, s.WorldRunning)
}

// DeleteCharacter deletes a character and everything that is its (#876), with the world server
// stopped, and returns its name.
func (a *App) DeleteCharacter(guid int) (string, error) {
	s, err := a.serverSession()
	if err != nil {
		return "", err
	}
	return vmangos.DeleteCharacter(s.ServerRoot, guid, s.WorldRunning)
}

// ListCharacters lists an account's characters.
func (a *App) ListCharacters(account int) ([]vmangos.AccountCharacter, error) {
	server, err := a.serverRoot()
	if err != nil {
		return nil, err
	}
	return vmangos.ListCharacters(server, account)
}

// ReadCharacter reads a character's row for the editor.
func (a *App) ReadCharacter(guid int) (vmangos.CharacterRecord, error) {
	server, err := a.serverRoot()
	if err != nil {
		return vmangos.CharacterRecord{}, err
	}
	return vmangos.ReadCharacter(server, guid)
}

// SaveCharacter writes a character's changed values (by column) while it is out of the world, and
// returns the SQL it ran, or the value it refused.
func (a *App) SaveCharacter(guid int, values map[string]string) (TemplateSaved, error) {
	s, err := a.serverSession()
	if err != nil {
		return TemplateSaved{}, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return TemplateSaved{}, err
	}
	return templateSaved(vmangos.SaveCharacter(s.ServerRoot, dataDir, guid, values, s.WorldRunning))
}

// CharacterLooks lists the skins, faces and hair a race and gender may have (#875).
func (a *App) CharacterLooks(race, gender int) (vmangos.CharLooks, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.CharLooks{}, err
	}
	return vmangos.CharacterLooks(dataDir, race, gender)
}

// ReadCharacterSkills reads a character's skills, with the skill lines its race and class may have.
func (a *App) ReadCharacterSkills(guid int) (vmangos.CharacterSkills, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.CharacterSkills{}, err
	}
	return vmangos.ReadCharacterSkills(server, dataDir, guid)
}

// SaveCharacterSkills makes a character's skills the ones given while it is out of the world, and
// returns the SQL it ran, or the skill it refused.
func (a *App) SaveCharacterSkills(guid int, skills []vmangos.CharacterSkill) (TemplateSaved, error) {
	s, err := a.serverSession()
	if err != nil {
		return TemplateSaved{}, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return TemplateSaved{}, err
	}
	return templateSaved(vmangos.SaveCharacterSkills(s.ServerRoot, dataDir, guid, skills, s.WorldRunning))
}

// ReadCharacterSpells reads the spells a character knows.
func (a *App) ReadCharacterSpells(guid int) ([]vmangos.CharacterSpell, error) {
	server, err := a.serverRoot()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadCharacterSpells(server, guid)
}

// StartingSpells lists the spells the server gives a new character of a race and class.
func (a *App) StartingSpells(race, class int) ([]int, error) {
	server, err := a.serverRoot()
	if err != nil {
		return nil, err
	}
	return vmangos.StartingSpells(server, race, class)
}

// SaveCharacterSpells makes the spells a character knows the ones given while it is out of the
// world, and returns the SQL it ran, or the spell it refused.
func (a *App) SaveCharacterSpells(guid int, spells []vmangos.CharacterSpell) (TemplateSaved, error) {
	s, err := a.serverSession()
	if err != nil {
		return TemplateSaved{}, err
	}
	return templateSaved(vmangos.SaveCharacterSpells(s.ServerRoot, guid, spells, s.WorldRunning))
}

// ReadCharacterReputation reads a character's standing with every faction.
func (a *App) ReadCharacterReputation(guid int) ([]vmangos.CharacterReputation, error) {
	server, err := a.serverRoot()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadCharacterReputation(server, guid)
}

// SaveCharacterReputation writes a character's standings and faction flags while it is out of the
// world, and returns the SQL it ran, or the faction it refused.
func (a *App) SaveCharacterReputation(guid int, reps []vmangos.CharacterReputation) (TemplateSaved, error) {
	s, err := a.serverSession()
	if err != nil {
		return TemplateSaved{}, err
	}
	return templateSaved(vmangos.SaveCharacterReputation(s.ServerRoot, guid, reps, s.WorldRunning))
}

// ReadInventory reads a character's equipment, bags, bank and keyring (#874, #879).
func (a *App) ReadInventory(guid int) (vmangos.Inventory, error) {
	server, err := a.serverRoot()
	if err != nil {
		return vmangos.Inventory{}, err
	}
	return vmangos.ReadInventory(server, a.optionalDataDir(), guid)
}

// InventoryItemTemplate reads what the equipment editor needs of an item it adds.
func (a *App) InventoryItemTemplate(entry int) (vmangos.InventoryTemplate, error) {
	server, err := a.serverRoot()
	if err != nil {
		return vmangos.InventoryTemplate{}, err
	}
	return vmangos.InventoryItemTemplate(server, a.optionalDataDir(), entry)
}

// SaveInventory makes a character's equipment, bags, bank and keyring the items given, while it is
// out of the world (and, to add items, while the world server is stopped), and returns the SQL it
// ran, or the place ("container:slot") of an item it refused.
func (a *App) SaveInventory(guid int, items []vmangos.InventoryItem) (TemplateSaved, error) {
	s, err := a.serverSession()
	if err != nil {
		return TemplateSaved{}, err
	}
	return templateSaved(vmangos.SaveInventory(s.ServerRoot, a.optionalDataDir(), guid, items, s.WorldRunning))
}

// optionalDataDir is the client's Data folder, or "" when no client is set: the equipment editor
// reads the random properties' names and enchantments from it, and works without them.
func (a *App) optionalDataDir() string {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return ""
	}
	return dataDir
}
