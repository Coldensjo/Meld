package vmangos

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Deleting a character (#876), as the world server's `.character erase` does it (Player::DeleteFromDB
// with deleteFinally, so CharDelete.Method's keeping of deleted characters doesn't apply): it leaves
// its guild and group, its petitions and signatures go, its cash-on-delivery mail with items goes back
// to the senders, and its rows go from every table that holds them. The world server keeps the names,
// guilds and groups of all characters in memory while it runs, so a delete needs it stopped; at its
// next start it reads them again.

// errDeleteRunning refuses a delete while the world server runs.
var errDeleteRunning = errors.New("stop the world server to delete a character: it keeps the names, guilds and groups of all characters while it runs, and would not see the delete")

// mailDeliveryDelay is mangosd.conf's MailDeliveryDelay, the seconds before returned items reach a
// character on another account (an hour when unset).
func mailDeliveryDelay(serverRoot string) int {
	v, _ := confValue(serverRoot, "MailDeliveryDelay")
	if n, err := strconv.Atoi(v); err == nil && n >= 0 {
		return n
	}
	return 3600
}

// realmID is mangosd.conf's RealmID, the realm the character database belongs to (1 when unset).
func realmID(serverRoot string) int {
	v, _ := confValue(serverRoot, "RealmID")
	if n, err := strconv.Atoi(v); err == nil && n > 0 {
		return n
	}
	return 1
}

// DeleteCharacter deletes character guid and everything that is its, with the world server stopped
// (worldRunning), and returns its name. The account's count of characters on the realm list is
// updated, as World::UpdateRealmCharCount does.
func DeleteCharacter(serverRoot string, guid int, worldRunning func() bool) (string, error) {
	if worldRunning() {
		return "", errDeleteRunning
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT account, name FROM characters WHERE guid = %d", guid))
	if err != nil {
		return "", err
	}
	rows := batchRows(raw, 2)
	if len(rows) == 0 {
		return "", fmt.Errorf("there is no character %d", guid)
	}
	account, name := rows[0].num(0), rows[0][1]
	if err := runScript(db, deleteCharacterSQL(guid, account, time.Now().Unix(), mailDeliveryDelay(serverRoot))); err != nil {
		return "", err
	}
	if err := recountCharacters(serverRoot, db, account); err != nil {
		return name, fmt.Errorf("the character was deleted, but %w", err)
	}
	return name, nil
}

// recountCharacters writes account's count of characters into the realm list (realmcharacters, for
// mangosd.conf's RealmID), as World::UpdateRealmCharCount does after a character is made or deleted.
func recountCharacters(serverRoot string, db worldDB, account int) error {
	if account == 0 {
		return nil
	}
	out, err := runSQL(db, fmt.Sprintf("SELECT COUNT(*) FROM characters WHERE account = %d", account))
	if err != nil {
		return err
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return fmt.Errorf("its account's characters were not counted: %q", out)
	}
	login, err := loginDatabase(serverRoot)
	if err != nil {
		return err
	}
	_, err = runSQL(login, fmt.Sprintf("REPLACE INTO realmcharacters (numchars, acctid, realmid) VALUES (%d, %d, %d)", n, account, realmID(serverRoot)))
	return err
}

// characterTables are the tables Player::DeleteFromDB clears of a character's rows, by the column
// that names it, with those the server's CharacterDatabaseCleaner later finds orphaned
// (character_account_data, character_honor_cp, character_stats, item_loot, corpse).
var characterTables = [][2]string{
	{"characters", "guid"},
	{"character_account_data", "guid"},
	{"character_action", "guid"},
	{"character_aura", "guid"},
	{"character_battleground_data", "guid"},
	{"character_deleted_items", "player_guid"},
	{"character_gifts", "guid"},
	{"character_homebind", "guid"},
	{"character_honor_cp", "guid"},
	{"character_instance", "guid"},
	{"group_instance", "leader_guid"},
	{"character_inventory", "guid"},
	{"character_queststatus", "guid"},
	{"character_reputation", "guid"},
	{"character_skills", "guid"},
	{"character_forgotten_skills", "guid"},
	{"character_spell", "guid"},
	{"character_spell_cooldown", "guid"},
	{"character_stats", "guid"},
	{"item_instance", "owner_guid"},
	{"item_loot", "owner_guid"},
	{"mail", "receiver_guid"},
	{"mail_items", "receiver_guid"},
	{"character_pet", "owner_guid"},
	{"corpse", "player_guid"},
}

// deleteCharacterSQL is the script that deletes character g of account acct, at Unix time now, with
// the mail delivery delay: the steps of Player::DeleteFromDB in its order. It runs in one transaction
// (runScript), with the world server stopped, so no step has to tell a running server.
func deleteCharacterSQL(g, acct int, now int64, delay int) string {
	var b strings.Builder
	w := func(format string, args ...any) { fmt.Fprintf(&b, format+"\n", args...) }

	// Its guild (Guild::DelMember): the member of the best rank leads in its place, and a guild left
	// with no members is disbanded (Guild::Disband).
	w("SET @guild = (SELECT guild_id FROM guild_member WHERE guid = %d);", g)
	w("DELETE FROM guild_member WHERE guid = %d;", g)
	w("SET @leader = (SELECT guid FROM guild_member WHERE guild_id = @guild ORDER BY `rank`, guid LIMIT 1);")
	w("UPDATE guild_member SET `rank` = 0 WHERE guid = @leader AND (SELECT leader_guid FROM guild WHERE guild_id = @guild) = %d;", g)
	w("UPDATE guild SET leader_guid = @leader WHERE guild_id = @guild AND leader_guid = %d AND @leader IS NOT NULL;", g)
	for _, t := range []string{"guild_rank", "guild_eventlog", "guild"} {
		w("DELETE FROM %s WHERE guild_id = @guild AND @leader IS NULL;", t)
	}

	// Its group (Group::RemoveMember): a group left with fewer than two members is disbanded;
	// otherwise, if it led, the first member leads (Group::_chooseLeader, everyone offline), taking
	// the group's instance binds and adding its own (Group::_setLeader, ConvertInstancesToGroup).
	w("SET @group = (SELECT group_id FROM group_member WHERE member_guid = %d);", g)
	w("SET @groupLeader = (SELECT leader_guid FROM `groups` WHERE group_id = @group);")
	w("DELETE FROM group_member WHERE member_guid = %d;", g)
	w("SET @left = (SELECT COUNT(*) FROM group_member WHERE group_id = @group);")
	w("SET @newLeader = IF(@left >= 2 AND @groupLeader = %d, (SELECT MIN(member_guid) FROM group_member WHERE group_id = @group), NULL);", g)
	w("DELETE FROM group_instance WHERE leader_guid = @groupLeader AND @left < 2;")
	w("DELETE FROM group_member WHERE group_id = @group AND @left < 2;")
	w("DELETE FROM `groups` WHERE group_id = @group AND @left < 2;")
	w("DELETE FROM group_instance WHERE leader_guid = %d AND @newLeader IS NOT NULL AND (permanent = 1 OR instance IN (SELECT instance FROM character_instance WHERE guid = @newLeader));", g)
	w("UPDATE group_instance SET leader_guid = @newLeader WHERE leader_guid = %d AND @newLeader IS NOT NULL;", g)
	w("INSERT IGNORE INTO group_instance (leader_guid, instance, permanent) SELECT guid, instance, permanent FROM character_instance WHERE guid = @newLeader;")
	w("DELETE FROM character_instance WHERE guid = @newLeader AND permanent = 0;")
	w("UPDATE `groups` SET leader_guid = @newLeader WHERE group_id = @group AND @newLeader IS NOT NULL;")

	// Its petitions and signatures (Player::RemovePetitionsAndSigns).
	w("DELETE FROM petition WHERE owner_guid = %d;", g)
	w("DELETE FROM petition_sign WHERE owner_guid = %d OR player_guid = %d;", g, g)

	// Cash-on-delivery mail with items from a character goes back to it, with the items and money
	// (MailDraft::SendReturnToSender): from the deleted character, marked returned, after the delivery
	// delay when the sender is on another account. The rest of its mail is deleted below with its items.
	w("DROP TEMPORARY TABLE IF EXISTS meld_returned;")
	w("CREATE TEMPORARY TABLE meld_returned SELECT m.id, m.sender_guid AS sender, IF(s.account <> %d, %d, 0) AS delay FROM mail m JOIN characters s ON s.guid = m.sender_guid "+
		"WHERE m.receiver_guid = %d AND m.has_items <> 0 AND m.cod <> 0 AND m.message_type = 0 AND m.sender_guid <> %d AND s.account <> 0;", acct, delay, g, g)
	w("UPDATE item_instance i JOIN mail_items mi ON mi.item_guid = i.guid JOIN meld_returned r ON r.id = mi.mail_id SET i.owner_guid = r.sender;")
	w("UPDATE mail_items mi JOIN meld_returned r ON r.id = mi.mail_id SET mi.receiver_guid = r.sender;")
	w("UPDATE mail m JOIN meld_returned r ON r.id = m.id SET m.sender_guid = %d, m.receiver_guid = r.sender, m.stationery = 41, m.cod = 0, m.checked = 2, "+
		"m.deliver_time = %d + r.delay, m.expire_time = %d + r.delay + %d;", g, now, now, 30*24*3600)
	w("DROP TEMPORARY TABLE meld_returned;")

	// Its pets (Pet::DeleteFromDB), then its own rows.
	for _, t := range []string{"pet_aura", "pet_spell", "pet_spell_cooldown"} {
		w("DELETE x FROM %s x JOIN character_pet p ON p.id = x.guid WHERE p.owner_guid = %d;", t, g)
	}
	for _, t := range characterTables {
		w("DELETE FROM %s WHERE %s = %d;", t[0], t[1], g)
	}
	w("DELETE FROM character_social WHERE guid = %d OR friend = %d;", g, g)
	w("DELETE FROM guild_eventlog WHERE player_guid1 = %d OR player_guid2 = %d;", g, g)
	return strings.TrimSuffix(b.String(), "\n")
}
