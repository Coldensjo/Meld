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

// GossipText is one text row of a gossip menu: the npc_text it shows, the condition it is shown
// under (0 always), and the first broadcast text of that npc_text, for a man and a woman player.
type GossipText struct {
	TextID    int    `json:"textId"`
	Condition int    `json:"condition"`
	Male      string `json:"male"`
	Female    string `json:"female"`
}

// Gossip is what a creature says when a player talks to it: its gossip menu (creature_template's
// gossip_menu_id, 0 for none), how many creature templates share that menu, the menu's text rows
// and the texts of its options (gossip_menu_option), which the editor lists but doesn't change.
type Gossip struct {
	MenuID  int          `json:"menuId"`
	Shared  int          `json:"shared"`
	Texts   []GossipText `json:"texts"`
	Options []string     `json:"options"`
}

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
	raw, err := runSQL(db, fmt.Sprintf("SELECT `gossip_menu_id` FROM `creature_template` WHERE `entry` = %d ORDER BY `patch` DESC LIMIT 1", entry))
	if err != nil {
		return g, err
	}
	g.MenuID, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
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
	raw, err = runSQL(db, fmt.Sprintf("SELECT COALESCE(NULLIF(o.option_text, ''), b.male_text, '') FROM gossip_menu_option o "+
		"LEFT JOIN broadcast_text b ON b.entry = o.option_broadcast_text WHERE o.menu_id = %d ORDER BY o.id", g.MenuID))
	if err != nil {
		return g, err
	}
	for _, line := range strings.Split(strings.TrimRight(string(raw), "\r\n"), "\n") {
		if line = strings.TrimRight(line, "\r"); line != "" {
			g.Options = append(g.Options, unescapeBatch(line))
		}
	}
	return g, nil
}

// parseGossipTexts reads readGossip's text rows.
func parseGossipTexts(raw []byte) []GossipText {
	var out []GossipText
	for _, line := range strings.Split(strings.TrimRight(string(raw), "\r\n"), "\n") {
		f := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(f) != 4 {
			continue
		}
		id, _ := strconv.Atoi(f[0])
		cond, _ := strconv.Atoi(f[1])
		out = append(out, GossipText{TextID: id, Condition: cond, Male: unescapeBatch(f[2]), Female: unescapeBatch(f[3])})
	}
	return out
}

// greetingSQL sets creature entry's greeting (its gossip menu's unconditioned text) to male and
// female. Broadcast texts and npc_texts are shared between creatures, so it never edits one: it adds
// a broadcast_text and an npc_text, and points the menu at them. A menu other creature templates use
// too is copied first (its text rows and options), so they keep theirs; a creature with no menu gets
// one. The creature gets the gossip flag. g is the creature's gossip as readGossip read it.
func greetingSQL(entry int, g Gossip, male, female string) string {
	if strings.TrimSpace(female) == "" {
		female = male
	}
	var b strings.Builder
	b.WriteString("SET @text_b = (SELECT COALESCE(MAX(`entry`), 0) + 1 FROM `broadcast_text`);\n")
	fmt.Fprintf(&b, "INSERT INTO `broadcast_text` (`entry`, `male_text`, `female_text`) VALUES (@text_b, %s, %s);\n", sqlQuote(male), sqlQuote(female))
	b.WriteString("SET @text_n = (SELECT COALESCE(MAX(`ID`), 0) + 1 FROM `npc_text`);\n")
	b.WriteString("INSERT INTO `npc_text` (`ID`, `BroadcastTextID0`, `Probability0`) VALUES (@text_n, @text_b, 1);\n")
	old := -1 // the text row the greeting replaces
	for _, t := range g.Texts {
		if t.Condition == 0 {
			old = t.TextID
			break
		}
	}
	switch {
	case g.MenuID <= 0:
		b.WriteString("SET @menu = (SELECT COALESCE(MAX(`entry`), 0) + 1 FROM `gossip_menu`);\n")
		b.WriteString("INSERT INTO `gossip_menu` (`entry`, `text_id`, `script_id`, `condition_id`) VALUES (@menu, @text_n, 0, 0);\n")
	case g.Shared > 1:
		b.WriteString("SET @menu = (SELECT COALESCE(MAX(`entry`), 0) + 1 FROM `gossip_menu`);\n")
		fmt.Fprintf(&b, "INSERT INTO `gossip_menu` (`entry`, `text_id`, `script_id`, `condition_id`) SELECT @menu, IF(`text_id` = %d, @text_n, `text_id`), `script_id`, `condition_id` FROM `gossip_menu` WHERE `entry` = %d;\n", old, g.MenuID)
		if old < 0 {
			b.WriteString("INSERT INTO `gossip_menu` (`entry`, `text_id`, `script_id`, `condition_id`) VALUES (@menu, @text_n, 0, 0);\n")
		}
		fmt.Fprintf(&b, "INSERT INTO `gossip_menu_option` (`menu_id`, `id`, `option_icon`, `option_text`, `option_broadcast_text`, `option_id`, `npc_option_npcflag`, `action_menu_id`, `action_poi_id`, `action_script_id`, `box_coded`, `box_money`, `box_text`, `box_broadcast_text`, `condition_id`) "+
			"SELECT @menu, `id`, `option_icon`, `option_text`, `option_broadcast_text`, `option_id`, `npc_option_npcflag`, `action_menu_id`, `action_poi_id`, `action_script_id`, `box_coded`, `box_money`, `box_text`, `box_broadcast_text`, `condition_id` FROM `gossip_menu_option` WHERE `menu_id` = %d;\n", g.MenuID)
	default:
		fmt.Fprintf(&b, "SET @menu = %d;\n", g.MenuID)
		if old >= 0 {
			fmt.Fprintf(&b, "UPDATE `gossip_menu` SET `text_id` = @text_n WHERE `entry` = @menu AND `text_id` = %d;\n", old)
		} else {
			b.WriteString("INSERT INTO `gossip_menu` (`entry`, `text_id`, `script_id`, `condition_id`) VALUES (@menu, @text_n, 0, 0);\n")
		}
	}
	fmt.Fprintf(&b, "UPDATE `creature_template` SET `gossip_menu_id` = @menu, `npc_flags` = `npc_flags` | %d WHERE `entry` = %d;", NpcFlagGossip, entry)
	return b.String()
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
	if g.MenuID <= 0 || g.Shared > 1 {
		raw, err := runSQL(db, "SELECT COALESCE(MAX(`entry`), 0) FROM `gossip_menu`")
		if err != nil {
			return GreetingSaved{}, err
		}
		if n, _ := strconv.Atoi(strings.TrimSpace(string(raw))); n >= maxGossipMenu {
			return GreetingSaved{}, fmt.Errorf("the world database has no free gossip menu entry (the last is %d)", n)
		}
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
