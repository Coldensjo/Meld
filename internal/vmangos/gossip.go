package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// NpcFlagGossip is creature_template.npc_flags' gossip bit (UNIT_NPC_FLAG_GOSSIP in 1.12): with it,
// talking to the creature opens its gossip menu.
const NpcFlagGossip = 0x1

// maxGossipMenu is the largest gossip menu entry: gossip_menu.entry and gossip_menu_option.menu_id
// are unsigned smallints.
const maxGossipMenu = 65535

// lastMenuSQL is the largest gossip menu number in use: not only gossip_menu's, since a menu left
// with no text rows can still be named by a creature template or have options, and a new menu given
// its number would be shared with them.
const lastMenuSQL = "GREATEST((SELECT COALESCE(MAX(`entry`), 0) FROM `gossip_menu`), (SELECT COALESCE(MAX(`menu_id`), 0) FROM `gossip_menu_option`), " +
	"(SELECT COALESCE(MAX(`action_menu_id`), 0) FROM `gossip_menu_option`), (SELECT COALESCE(MAX(`gossip_menu_id`), 0) FROM `creature_template`))"

// GossipText is one text row of a gossip menu: the npc_text it shows, the condition it is shown
// under (0 always), and the first broadcast text of that npc_text, for a man and a woman player.
type GossipText struct {
	TextID    int    `json:"textId"`
	Condition int    `json:"condition"`
	Male      string `json:"male"`
	Female    string `json:"female"`
}

// GossipOption is one gossip_menu_option row: a line the player can pick. Text and BoxText are
// what the server shows: the broadcast text when BroadcastText (BoxBroadcastText) names one, else
// the row's own text. Action is option_id (GOSSIP_OPTION_* in VMaNGOS's GossipDef.h: 1 another
// menu, 3 a vendor, 5 a trainer...) and NpcFlag npc_option_npcflag, the creature flag the option
// needs to show; ActionMenu is the menu a gossip option opens (-1 closes the window), ActionPOI a
// point of interest, ActionScript a gossip_scripts id. A coded box asks for a typed code, BoxMoney
// is copper.
type GossipOption struct {
	ID               int    `json:"id"`
	Icon             int    `json:"icon"`
	Text             string `json:"text"`
	BroadcastText    int    `json:"broadcastText"`
	Action           int    `json:"action"`
	NpcFlag          int    `json:"npcFlag"`
	ActionMenu       int    `json:"actionMenu"`
	ActionPOI        int    `json:"actionPoi"`
	ActionScript     int    `json:"actionScript"`
	BoxCoded         bool   `json:"boxCoded"`
	BoxMoney         int    `json:"boxMoney"`
	BoxText          string `json:"boxText"`
	BoxBroadcastText int    `json:"boxBroadcastText"`
	Condition        int    `json:"condition"`
}

// AILine is a line the creature says on its own: a talk command (SCRIPT_COMMAND_TALK) run by one of
// its creature AI events. Event is creature_ai_events.event_type (EVENT_T_* in VMaNGOS's
// CreatureEventAI.h: 4 aggro, 6 death...), Chance its event_chance, Chat broadcast_text.chat_type
// (CHAT_TYPE_*: 0 say, 1 yell, 2 emote...).
type AILine struct {
	Event  int    `json:"event"`
	Chance int    `json:"chance"`
	Chat   int    `json:"chat"`
	TextID int    `json:"textId"`
	Text   string `json:"text"`
}

// Gossip is what a creature says when a player talks to it: its gossip menu (creature_template's
// gossip_menu_id, 0 for none), how many creature templates share that menu, the menu's text rows
// and options (gossip_menu_option), the creature's npc_flags (an option shows only when they hold
// its NpcFlag) and the lines its AI says on its own, which the editor lists but doesn't change.
type Gossip struct {
	MenuID   int            `json:"menuId"`
	Shared   int            `json:"shared"`
	NpcFlags int            `json:"npcFlags"`
	Texts    []GossipText   `json:"texts"`
	Options  []GossipOption `json:"options"`
	Lines    []AILine       `json:"lines"`
}

// maxGossipIcon and maxGossipAction are the last option_icon and option_id VMaNGOS knows
// (GOSSIP_ICON_DOT_20, GOSSIP_OPTION_UNLEARNPETSKILLS).
const (
	maxGossipIcon   = 20
	maxGossipAction = 17
)

// GreetingSaved is what SaveGreeting changed: the creature's gossip menu now, and the SQL it ran.
type GreetingSaved struct {
	MenuID int    `json:"menuId"`
	SQL    string `json:"sql"`
}

// ReadGossip reads creature template entry's gossip menu.
func ReadGossip(serverRoot string, entry int) (Gossip, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return Gossip{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return Gossip{}, err
	}
	return readGossip(db, entry)
}

func readGossip(db worldDB, entry int) (Gossip, error) {
	var g Gossip
	raw, err := runSQL(db, fmt.Sprintf("SELECT `gossip_menu_id`, `npc_flags` FROM `creature_template` WHERE `entry` = %d ORDER BY `patch` DESC LIMIT 1", entry))
	if err != nil {
		return g, err
	}
	if f := strings.Fields(string(raw)); len(f) == 2 {
		g.MenuID, _ = strconv.Atoi(f[0])
		g.NpcFlags, _ = strconv.Atoi(f[1])
	}
	raw, err = runSQL(db, fmt.Sprintf("SELECT e.event_type, e.event_chance, b.chat_type, b.entry, COALESCE(b.male_text, '') FROM creature_ai_events e "+
		"JOIN creature_ai_scripts s ON s.id IN (e.action1_script, e.action2_script, e.action3_script) AND s.command = 0 "+
		"JOIN broadcast_text b ON b.entry IN (s.dataint, s.dataint2, s.dataint3, s.dataint4) WHERE e.creature_id = %d ORDER BY e.id, s.delay, b.entry", entry))
	if err != nil {
		return g, err
	}
	g.Lines = parseAILines(raw)
	if g.MenuID <= 0 {
		return g, nil
	}
	raw, err = runSQL(db, fmt.Sprintf("SELECT COUNT(DISTINCT `entry`) FROM `creature_template` WHERE `gossip_menu_id` = %d", g.MenuID))
	if err != nil {
		return g, err
	}
	g.Shared, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
	raw, err = runSQL(db, fmt.Sprintf("SELECT g.text_id, g.condition_id, COALESCE(b.male_text, ''), COALESCE(b.female_text, '') FROM gossip_menu g "+
		"LEFT JOIN npc_text t ON t.ID = g.text_id LEFT JOIN broadcast_text b ON b.entry = t.BroadcastTextID0 WHERE g.entry = %d ORDER BY g.condition_id <> 0, g.text_id", g.MenuID))
	if err != nil {
		return g, err
	}
	g.Texts = parseGossipTexts(raw)
	// The text the server shows: the broadcast text when the row names one that exists, else its own.
	raw, err = runSQL(db, fmt.Sprintf("SELECT o.id, o.option_icon, IF(b.entry IS NULL, COALESCE(o.option_text, ''), COALESCE(b.male_text, '')), IF(b.entry IS NULL, 0, b.entry), "+
		"o.option_id, o.npc_option_npcflag, o.action_menu_id, o.action_poi_id, o.action_script_id, o.box_coded, o.box_money, "+
		"IF(x.entry IS NULL, COALESCE(o.box_text, ''), COALESCE(x.male_text, '')), IF(x.entry IS NULL, 0, x.entry), o.condition_id FROM gossip_menu_option o "+
		"LEFT JOIN broadcast_text b ON o.option_broadcast_text <> 0 AND b.entry = o.option_broadcast_text "+
		"LEFT JOIN broadcast_text x ON o.box_broadcast_text <> 0 AND x.entry = o.box_broadcast_text WHERE o.menu_id = %d ORDER BY o.id", g.MenuID))
	if err != nil {
		return g, err
	}
	g.Options = parseGossipOptions(raw)
	return g, nil
}

// parseGossipOptions reads readGossip's option rows.
func parseGossipOptions(raw []byte) []GossipOption {
	var out []GossipOption
	for _, f := range batchRows(raw, 14) {
		out = append(out, GossipOption{
			ID: f.num(0), Icon: f.num(1), Text: f[2], BroadcastText: f.num(3), Action: f.num(4), NpcFlag: f.num(5),
			ActionMenu: f.num(6), ActionPOI: f.num(7), ActionScript: f.num(8), BoxCoded: f.num(9) != 0, BoxMoney: f.num(10),
			BoxText: f[11], BoxBroadcastText: f.num(12), Condition: f.num(13),
		})
	}
	return out
}

// parseAILines reads readGossip's creature AI lines.
func parseAILines(raw []byte) []AILine {
	var out []AILine
	for _, f := range batchRows(raw, 5) {
		out = append(out, AILine{Event: f.num(0), Chance: f.num(1), Chat: f.num(2), TextID: f.num(3), Text: f[4]})
	}
	return out
}

// parseGossipTexts reads readGossip's text rows.
func parseGossipTexts(raw []byte) []GossipText {
	var out []GossipText
	for _, f := range batchRows(raw, 4) {
		out = append(out, GossipText{TextID: f.num(0), Condition: f.num(1), Male: f[2], Female: f[3]})
	}
	return out
}

// greetingSQL sets creature entry's greeting (its gossip menu's unconditioned text) to male and
// female. Broadcast texts and npc_texts are shared between creatures, so it never edits one: it adds
// a broadcast_text and an npc_text, and points the menu at them. A menu other creature templates use
// too is copied first (its text rows and options), so they keep theirs; a creature with no menu gets
// one. The creature gets the gossip flag. g is the creature's gossip as readGossip read it.
func greetingSQL(entry int, g Gossip, male, female string) string {
	var b strings.Builder
	newTextSQL(&b, male, female)
	old := -1 // the text row the greeting replaces
	for _, t := range g.Texts {
		if t.Condition == 0 {
			old = t.TextID
			break
		}
	}
	textRowSQL(&b, entry, g, old, "@text_n", 0)
	return b.String()
}

// newTextSQL adds a broadcast_text of male and female (an empty female text follows the male one)
// and an npc_text showing it, as @text_b and @text_n.
func newTextSQL(b *strings.Builder, male, female string) {
	if strings.TrimSpace(female) == "" {
		female = male
	}
	b.WriteString("SET @text_b = (SELECT COALESCE(MAX(`entry`), 0) + 1 FROM `broadcast_text`);\n")
	fmt.Fprintf(b, "INSERT INTO `broadcast_text` (`entry`, `male_text`, `female_text`) VALUES (@text_b, %s, %s);\n", sqlQuote(male), sqlQuote(female))
	b.WriteString("SET @text_n = (SELECT COALESCE(MAX(`ID`), 0) + 1 FROM `npc_text`);\n")
	b.WriteString("INSERT INTO `npc_text` (`ID`, `BroadcastTextID0`, `Probability0`) VALUES (@text_n, @text_b, 1);\n")
}

// textRowSQL changes one text row of creature entry's gossip menu (g, as readGossip read it): the row
// showing npc_text old (-1 for a new row) shows text (an SQL value: "@text_n" or an npc_text ID) under
// condition cond, or is removed when text is "". A menu other creature templates share is copied
// first (its text rows and options), so they keep theirs; a creature with no menu gets one. With a
// text, the creature gets the gossip flag.
func textRowSQL(b *strings.Builder, entry int, g Gossip, old int, text string, cond int) {
	const cols = "INSERT INTO `gossip_menu` (`entry`, `text_id`, `script_id`, `condition_id`) "
	switch {
	case g.MenuID <= 0:
		b.WriteString("SET @menu = " + lastMenuSQL + " + 1;\n")
		if text != "" {
			fmt.Fprintf(b, cols+"VALUES (@menu, %s, 0, %d);\n", text, cond)
		}
	case g.Shared > 1:
		b.WriteString("SET @menu = " + lastMenuSQL + " + 1;\n")
		switch {
		case text == "":
			fmt.Fprintf(b, cols+"SELECT @menu, `text_id`, `script_id`, `condition_id` FROM `gossip_menu` WHERE `entry` = %d AND `text_id` <> %d;\n", g.MenuID, old)
		case old >= 0 && cond != 0:
			fmt.Fprintf(b, cols+"SELECT @menu, IF(`text_id` = %d, %s, `text_id`), `script_id`, IF(`text_id` = %d, %d, `condition_id`) FROM `gossip_menu` WHERE `entry` = %d;\n", old, text, old, cond, g.MenuID)
		default:
			fmt.Fprintf(b, cols+"SELECT @menu, IF(`text_id` = %d, %s, `text_id`), `script_id`, `condition_id` FROM `gossip_menu` WHERE `entry` = %d;\n", old, text, g.MenuID)
		}
		if old < 0 && text != "" {
			fmt.Fprintf(b, cols+"VALUES (@menu, %s, 0, %d);\n", text, cond)
		}
		fmt.Fprintf(b, "INSERT INTO `gossip_menu_option` (`menu_id`, `id`, `option_icon`, `option_text`, `option_broadcast_text`, `option_id`, `npc_option_npcflag`, `action_menu_id`, `action_poi_id`, `action_script_id`, `box_coded`, `box_money`, `box_text`, `box_broadcast_text`, `condition_id`) "+
			"SELECT @menu, `id`, `option_icon`, `option_text`, `option_broadcast_text`, `option_id`, `npc_option_npcflag`, `action_menu_id`, `action_poi_id`, `action_script_id`, `box_coded`, `box_money`, `box_text`, `box_broadcast_text`, `condition_id` FROM `gossip_menu_option` WHERE `menu_id` = %d;\n", g.MenuID)
	default:
		fmt.Fprintf(b, "SET @menu = %d;\n", g.MenuID)
		switch {
		case old < 0 && text != "":
			fmt.Fprintf(b, cols+"VALUES (@menu, %s, 0, %d);\n", text, cond)
		case old < 0:
		case text == "":
			fmt.Fprintf(b, "DELETE FROM `gossip_menu` WHERE `entry` = @menu AND `text_id` = %d;\n", old)
		case cond != 0:
			fmt.Fprintf(b, "UPDATE `gossip_menu` SET `text_id` = %s, `condition_id` = %d WHERE `entry` = @menu AND `text_id` = %d;\n", text, cond, old)
		default:
			fmt.Fprintf(b, "UPDATE `gossip_menu` SET `text_id` = %s WHERE `entry` = @menu AND `text_id` = %d;\n", text, old)
		}
	}
	if text == "" {
		fmt.Fprintf(b, "UPDATE `creature_template` SET `gossip_menu_id` = @menu WHERE `entry` = %d;", entry)
		return
	}
	fmt.Fprintf(b, "UPDATE `creature_template` SET `gossip_menu_id` = @menu, `npc_flags` = `npc_flags` | %d WHERE `entry` = %d;", NpcFlagGossip, entry)
}

// SaveGreeting sets what creature template entry says when a player talks to it (greetingSQL), and
// returns its gossip menu now with the SQL it ran.
func SaveGreeting(serverRoot string, entry int, male, female string) (GreetingSaved, error) {
	if strings.TrimSpace(male) == "" {
		return GreetingSaved{}, fmt.Errorf("the greeting is empty")
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return GreetingSaved{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return GreetingSaved{}, err
	}
	g, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	if err := openMenuSlot(db, g); err != nil {
		return GreetingSaved{}, err
	}
	sql := greetingSQL(entry, g, male, female)
	if err := runScript(db, sql); err != nil {
		return GreetingSaved{}, err
	}
	after, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	return GreetingSaved{MenuID: after.MenuID, SQL: sql}, nil
}

// maxCondition is the largest conditions.condition_entry (gossip_menu.condition_id is a mediumint).
const maxCondition = 16777215

// conditionTextSQL sets one conditioned text of creature entry's gossip menu (g, as readGossip read
// it): the row showing npc_text old (-1 for a new row) shows male and female under condition cond.
// As greetingSQL does, it never edits a broadcast_text or npc_text: a changed text is a new one, and
// with keep (the text is the row's own, only its condition changes) the row keeps its npc_text.
func conditionTextSQL(entry int, g Gossip, old, cond int, male, female string, keep bool) string {
	var b strings.Builder
	text := "@text_n"
	if keep && old >= 0 {
		text = strconv.Itoa(old)
	} else {
		newTextSQL(&b, male, female)
	}
	textRowSQL(&b, entry, g, old, text, cond)
	return b.String()
}

// openMenuSlot fails when g's save needs a new gossip menu (it has none, or shares one) and the
// world database has no free entry left.
func openMenuSlot(db worldDB, g Gossip) error {
	if g.MenuID > 0 && g.Shared <= 1 {
		return nil
	}
	raw, err := runSQL(db, "SELECT "+lastMenuSQL)
	if err != nil {
		return err
	}
	if n, _ := strconv.Atoi(strings.TrimSpace(string(raw))); n >= maxGossipMenu {
		return fmt.Errorf("the world database has no free gossip menu entry (the last is %d)", n)
	}
	return nil
}

// conditionRow finds the conditioned text row of g showing npc_text id.
func conditionRow(g Gossip, id int) (GossipText, bool) {
	for _, t := range g.Texts {
		if t.TextID == id && t.Condition != 0 {
			return t, true
		}
	}
	return GossipText{}, false
}

// SaveConditionText sets a text creature template entry's gossip menu shows under a condition
// (conditionTextSQL): the row showing npc_text textID, or a new row when textID is 0, now shows male
// and female (an empty female text uses the male one) when condition cond holds. It returns the
// creature's gossip menu now with the SQL it ran.
func SaveConditionText(serverRoot string, entry, textID, cond int, male, female string) (GreetingSaved, error) {
	if strings.TrimSpace(male) == "" {
		return GreetingSaved{}, fmt.Errorf("the text is empty")
	}
	if cond <= 0 || cond > maxCondition {
		return GreetingSaved{}, fmt.Errorf("condition %d is out of range (1 to %d; a text with no condition is the greeting)", cond, maxCondition)
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return GreetingSaved{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return GreetingSaved{}, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT COUNT(*) FROM `conditions` WHERE `condition_entry` = %d", cond))
	if err != nil {
		return GreetingSaved{}, err
	}
	if strings.TrimSpace(string(raw)) == "0" {
		return GreetingSaved{}, fmt.Errorf("the world database has no condition %d (the conditions table)", cond)
	}
	g, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	old, keep := -1, false
	if textID > 0 {
		t, ok := conditionRow(g, textID)
		if !ok {
			return GreetingSaved{}, fmt.Errorf("creature %d's gossip menu has no conditioned text %d", entry, textID)
		}
		f := female
		if strings.TrimSpace(f) == "" {
			f = male
		}
		old, keep = textID, t.Male == male && t.Female == f
	}
	if err := openMenuSlot(db, g); err != nil {
		return GreetingSaved{}, err
	}
	sql := conditionTextSQL(entry, g, old, cond, male, female, keep)
	if err := runScript(db, sql); err != nil {
		return GreetingSaved{}, err
	}
	after, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	return GreetingSaved{MenuID: after.MenuID, SQL: sql}, nil
}

// DeleteConditionText removes the conditioned text row showing npc_text textID from creature
// template entry's gossip menu (a shared menu is copied without it), leaving the npc_text, which
// other menus may show. It returns the creature's gossip menu now with the SQL it ran.
func DeleteConditionText(serverRoot string, entry, textID int) (GreetingSaved, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return GreetingSaved{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return GreetingSaved{}, err
	}
	g, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	if _, ok := conditionRow(g, textID); !ok || g.MenuID <= 0 {
		return GreetingSaved{}, fmt.Errorf("creature %d's gossip menu has no conditioned text %d", entry, textID)
	}
	if err := openMenuSlot(db, g); err != nil {
		return GreetingSaved{}, err
	}
	var b strings.Builder
	textRowSQL(&b, entry, g, textID, "", 0)
	sql := b.String()
	if err := runScript(db, sql); err != nil {
		return GreetingSaved{}, err
	}
	after, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	return GreetingSaved{MenuID: after.MenuID, SQL: sql}, nil
}

// checkGossipOptions checks options typed into the editor against gossip_menu_option's columns and
// the icons and actions VMaNGOS knows.
func checkGossipOptions(opts []GossipOption) error {
	seen := map[int]bool{}
	for _, o := range opts {
		switch {
		case o.ID < 0 || o.ID > maxGossipMenu:
			return fmt.Errorf("option number %d is out of range (0 to %d)", o.ID, maxGossipMenu)
		case seen[o.ID]:
			return fmt.Errorf("two options are numbered %d", o.ID)
		case strings.TrimSpace(o.Text) == "":
			return fmt.Errorf("option %d has no text", o.ID)
		case o.Icon < 0 || o.Icon > maxGossipIcon:
			return fmt.Errorf("option %d: icon %d is not one the server knows (0 to %d)", o.ID, o.Icon, maxGossipIcon)
		case o.Action < 0 || o.Action > maxGossipAction:
			return fmt.Errorf("option %d: action %d is not one the server knows (0 to %d)", o.ID, o.Action, maxGossipAction)
		case o.NpcFlag < 0 || int64(o.NpcFlag) > 0xFFFFFFFF:
			return fmt.Errorf("option %d: the creature flag is out of range", o.ID)
		case o.ActionMenu < -1 || o.ActionMenu > 8388607:
			return fmt.Errorf("option %d: menu %d is out of range", o.ID, o.ActionMenu)
		case o.ActionPOI < 0 || o.ActionPOI > 16777215 || o.ActionScript < 0 || o.ActionScript > 16777215 || o.Condition < 0 || o.Condition > 16777215:
			return fmt.Errorf("option %d: a point of interest, script or condition is out of range", o.ID)
		case o.BoxMoney < 0 || int64(o.BoxMoney) > 0xFFFFFFFF:
			return fmt.Errorf("option %d: the box's cost is out of range", o.ID)
		}
		seen[o.ID] = true
	}
	return nil
}

// optionsSQL replaces the options of creature entry's gossip menu with opts. As greetingSQL does, it
// never edits a broadcast_text: an option keeps its broadcast text only while its text is still the
// one that broadcast text showed (shown, by broadcast ID), else the text goes into the option's own
// option_text (box_text), which VMaNGOS shows when the broadcast ID is 0. A menu other creature
// templates share is copied first (its text rows), so they keep their options. g is the creature's
// gossip as readGossip read it, and must have a menu.
func optionsSQL(entry int, g Gossip, opts []GossipOption, shown map[int]string) string {
	var b strings.Builder
	if g.Shared > 1 {
		b.WriteString("SET @menu = " + lastMenuSQL + " + 1;\n")
		fmt.Fprintf(&b, "INSERT INTO `gossip_menu` (`entry`, `text_id`, `script_id`, `condition_id`) SELECT @menu, `text_id`, `script_id`, `condition_id` FROM `gossip_menu` WHERE `entry` = %d;\n", g.MenuID)
		fmt.Fprintf(&b, "UPDATE `creature_template` SET `gossip_menu_id` = @menu WHERE `entry` = %d;\n", entry)
	} else {
		fmt.Fprintf(&b, "SET @menu = %d;\n", g.MenuID)
		b.WriteString("DELETE FROM `gossip_menu_option` WHERE `menu_id` = @menu;\n")
	}
	// A broadcast text is kept as '' own text and its ID, an edited one as its own text and ID 0.
	text := func(s string, id int) (string, int) {
		if t, ok := shown[id]; id > 0 && ok && t == s {
			return "''", id
		}
		return sqlQuote(s), 0
	}
	for _, o := range opts {
		ot, ob := text(o.Text, o.BroadcastText)
		bt, bb := text(o.BoxText, o.BoxBroadcastText)
		coded := 0
		if o.BoxCoded {
			coded = 1
		}
		fmt.Fprintf(&b, "INSERT INTO `gossip_menu_option` (`menu_id`, `id`, `option_icon`, `option_text`, `option_broadcast_text`, `option_id`, `npc_option_npcflag`, `action_menu_id`, `action_poi_id`, `action_script_id`, `box_coded`, `box_money`, `box_text`, `box_broadcast_text`, `condition_id`) "+
			"VALUES (@menu, %d, %d, %s, %d, %d, %d, %d, %d, %d, %d, %d, %s, %d, %d);\n",
			o.ID, o.Icon, ot, ob, o.Action, o.NpcFlag, o.ActionMenu, o.ActionPOI, o.ActionScript, coded, o.BoxMoney, bt, bb, o.Condition)
	}
	return strings.TrimRight(b.String(), "\n")
}

// SaveGossipOptions replaces the options of creature template entry's gossip menu (optionsSQL), and
// returns its gossip menu now with the SQL it ran. A creature with no menu needs a greeting first.
func SaveGossipOptions(serverRoot string, entry int, opts []GossipOption) (GreetingSaved, error) {
	if err := checkGossipOptions(opts); err != nil {
		return GreetingSaved{}, err
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return GreetingSaved{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return GreetingSaved{}, err
	}
	g, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	if g.MenuID <= 0 {
		return GreetingSaved{}, fmt.Errorf("creature %d has no gossip menu yet: save a greeting first", entry)
	}
	if err := openMenuSlot(db, g); err != nil {
		return GreetingSaved{}, err
	}
	// The texts the menu's broadcast texts showed, to tell a kept text from an edited one.
	shown := map[int]string{}
	for _, o := range g.Options {
		if o.BroadcastText > 0 {
			shown[o.BroadcastText] = o.Text
		}
		if o.BoxBroadcastText > 0 {
			shown[o.BoxBroadcastText] = o.BoxText
		}
	}
	sql := optionsSQL(entry, g, opts, shown)
	if err := runScript(db, sql); err != nil {
		return GreetingSaved{}, err
	}
	after, err := readGossip(db, entry)
	if err != nil {
		return GreetingSaved{}, err
	}
	return GreetingSaved{MenuID: after.MenuID, SQL: sql}, nil
}
