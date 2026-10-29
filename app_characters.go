package main

import (
	"errors"

	"Meld/internal/vmangos"
)

// Tools › Characters and Accounts (#855): the realm's accounts and their characters, in the server's
// login and character databases (internal/vmangos/accounts.go).

// serverRoot is the VMaNGOS server folder, for a binding that reads the server's databases only.
func (a *App) serverRoot() (string, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" {
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

// DeleteAccount removes an account that has no characters and is not logged in.
func (a *App) DeleteAccount(id int) error {
	s, err := a.serverSession()
	if err != nil {
		return err
	}
	return vmangos.DeleteAccount(s.ServerRoot, id, s.WorldRunning)
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
	return templateSaved(vmangos.SaveCharacter(s.ServerRoot, guid, values, s.WorldRunning))
}

// ReadInventory reads a character's equipment and bags (#874).
func (a *App) ReadInventory(guid int) (vmangos.Inventory, error) {
	server, err := a.serverRoot()
	if err != nil {
		return vmangos.Inventory{}, err
	}
	return vmangos.ReadInventory(server, guid)
}

// InventoryItemTemplate reads what the equipment editor needs of an item it adds.
func (a *App) InventoryItemTemplate(entry int) (vmangos.InventoryTemplate, error) {
	server, err := a.serverRoot()
	if err != nil {
		return vmangos.InventoryTemplate{}, err
	}
	return vmangos.InventoryItemTemplate(server, entry)
}

// SaveInventory makes a character's equipment and bags the items given, while it is out of the world
// (and, to add items, while the world server is stopped), and returns the SQL it ran, or the place
// ("container:slot") of an item it refused.
func (a *App) SaveInventory(guid int, items []vmangos.InventoryItem) (TemplateSaved, error) {
	s, err := a.serverSession()
	if err != nil {
		return TemplateSaved{}, err
	}
	return templateSaved(vmangos.SaveInventory(s.ServerRoot, guid, items, s.WorldRunning))
}
