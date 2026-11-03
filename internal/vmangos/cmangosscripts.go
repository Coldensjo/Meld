package vmangos

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// A waypoint's script in the CMaNGOS spawn SQL (#1041). A point's script id in Meld names a VMaNGOS
// creature_movement_scripts script; CMaNGOS's creature_movement.ScriptId names a
// dbscripts_on_creature_movement script instead. The two script engines share a mangos ancestor and
// have diverged, so each command is translated by its meaning, and what has no CMaNGOS counterpart is
// listed as not exported:
//   - the commands both have (talk, emote, set a field, move to a point, set or remove flags, remove an
//     aura, cast, play a sound, despawn, set equipment, active object, faction, morph, mount, run,
//     stand state, turn, sheath, summon a creature, idle or random movement), renumbered where CMaNGOS's numbers differ;
//   - the target: VMaNGOS names it by target_type and its parameters, CMaNGOS by a "buddy" and
//     data_flags. Both start a movement script with the creature as source and target, so only a
//     nearest creature of an entry (VMaNGOS's target type 10, a buddy by entry in CMaNGOS) carries
//     over, with VMaNGOS's swap and target-self flags turned into CMaNGOS's buddy combinations. A
//     target by guid does not: the guids differ between the two databases.
//   - a command with a condition is left out, since condition ids differ too, and VMaNGOS's delays
//     are seconds where CMaNGOS's are milliseconds.
//
// The translated scripts are the spawn's own: written under ids from cmangosScriptBase up (the next
// free one, as Meld can't read the CMaNGOS database), commented "Meld: ...", and dropped with the
// spawn's path when it is written again or deleted. dbscripts_on_creature_movement.id and ScriptId are
// MEDIUMINT UNSIGNED, too narrow for cmangosOwnBase.
//
// CMaNGOS's ScriptMgr is GPL: its behaviour is described here, none of its code is copied.

// cmangosScriptBase is the lowest id Meld gives a translated script, above the ids CMaNGOS's own data
// numbers from entries and guids.
const cmangosScriptBase = 16000000

// ScriptStep is one command of a VMaNGOS script (a creature_movement_scripts row), as read for
// another core's script table.
type ScriptStep struct {
	Delay, Priority, Command int
	Data                     [4]int // datalong to datalong4
	TargetType               int
	TargetParam1             int
	TargetParam2             int
	DataFlags                int
	DataInt                  [4]int // dataint to dataint4
	X, Y, Z, O               float64
	ConditionID              int
	Comments                 string
	// TextChatType is the chat type of the broadcast text a talk command's dataint names, -1 when
	// the text is missing or the command is not a talk.
	TextChatType int
}

// movementScriptsSQL reads the rows of creature_movement_scripts ids, with the chat type of a talk's
// first text, in the order the server runs them.
func movementScriptsSQL(ids []int) string {
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	return "SELECT s.id, s.delay, s.priority, s.command, s.datalong, s.datalong2, s.datalong3, s.datalong4, s.target_type, s.target_param1, s.target_param2, " +
		"s.data_flags, s.dataint, s.dataint2, s.dataint3, s.dataint4, s.x, s.y, s.z, s.o, s.condition_id, COALESCE(b.chat_type, -1), " + labelCol("s.comments") +
		" FROM creature_movement_scripts s LEFT JOIN broadcast_text b ON s.command = 0 AND b.entry = s.dataint WHERE s.id IN (" + strings.Join(list, ",") +
		") ORDER BY s.id, s.delay, s.priority, s.command"
}

// parseMovementScripts reads movementScriptsSQL's rows by script id.
func parseMovementScripts(raw []byte) map[int][]ScriptStep {
	out := map[int][]ScriptStep{}
	for _, f := range batchRows(raw, 23) {
		st := ScriptStep{Delay: f.num(1), Priority: f.num(2), Command: f.num(3), TargetType: f.num(8), TargetParam1: f.num(9), TargetParam2: f.num(10),
			DataFlags: f.num(11), X: f.f64(16), Y: f.f64(17), Z: f.f64(18), O: f.f64(19), ConditionID: f.num(20), TextChatType: f.num(21), Comments: f[22]}
		for i := range 4 {
			st.Data[i] = f.num(4 + i)
			st.DataInt[i] = f.num(12 + i)
		}
		if st.Comments == "NULL" {
			st.Comments = ""
		}
		out[f.num(0)] = append(out[f.num(0)], st)
	}
	return out
}

// MovementScriptsOf reads the VMaNGOS waypoint scripts ids name (creature_movement_scripts), for the
// spawn SQL of a core whose database has other scripts under those ids (CMaNGOS, #1041). An id the
// database lacks is missing from the map.
func MovementScriptsOf(serverRoot string, ids []int) (map[int][]ScriptStep, error) {
	if len(ids) == 0 {
		return map[int][]ScriptStep{}, nil
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, movementScriptsSQL(ids))
	if err != nil {
		return nil, err
	}
	return parseMovementScripts(raw), nil
}

// SpawnPathScriptIDs are the waypoint scripts the paths of the creatures edits keep name, each once,
// for MovementScriptsOf.
func SpawnPathScriptIDs(edits []SpawnEdit) []int {
	seen := map[int]bool{}
	var out []int
	for _, e := range edits {
		if e.Deleted || e.Spawn.Kind == KindObject {
			continue
		}
		for _, p := range e.Spawn.Waypoints {
			if p.ScriptID > 0 && !seen[p.ScriptID] {
				seen[p.ScriptID] = true
				out = append(out, p.ScriptID)
			}
		}
	}
	sort.Ints(out)
	return out
}

// cmangosStep is a dbscripts_on_creature_movement row but its id, delay, priority and comment.
type cmangosStep struct {
	Command       int
	Data          [3]int // datalong to datalong3
	Buddy, Radius int    // buddy_entry, search_radius
	Flags         int    // data_flags
	DataInt       [4]int
	X, Y, Z, O    float64
}

// CMaNGOS's data_flags (doc/script_commands.txt).
const (
	cmangosBuddyAsTarget     = 0x01
	cmangosReverseDirection  = 0x02
	cmangosSourceTargetsSelf = 0x04
	cmangosCommandAdditional = 0x08
)

// cmangosScriptTargets turns a VMaNGOS command's target into a CMaNGOS buddy and its data_flags.
// onTarget says the CMaNGOS command acts on its target where VMaNGOS's acts on its source. Empty why
// when it carries over.
func cmangosScriptTargets(st ScriptStep, onTarget bool) (buddy, radius, flags int, why string) {
	switch st.TargetType {
	case 0:
		// The creature is both source and target in either core.
		return 0, 0, 0, ""
	case 10: // TARGET_T_NEAREST_CREATURE_WITH_ENTRY
	case 11, 14:
		return 0, 0, 0, "it targets a spawn by guid, and the guids differ between the databases"
	default:
		return 0, 0, 0, fmt.Sprintf("its target (VMaNGOS target type %d) has no CMaNGOS counterpart", st.TargetType)
	}
	// VMaNGOS: the creature (c) is source and target, the buddy (b) replaces the target, then 0x02
	// swaps source and target and 0x04 makes the target the source. CMaNGOS names the four pairs.
	src, tgt := 'c', 'b'
	if st.DataFlags&0x02 != 0 {
		src, tgt = tgt, src
	}
	if st.DataFlags&0x04 != 0 || onTarget {
		tgt = src
	}
	switch {
	case src == 'c' && tgt == 'b':
		flags = cmangosBuddyAsTarget
	case src == 'b' && tgt == 'c':
		flags = cmangosBuddyAsTarget | cmangosReverseDirection
	case src == 'c':
		flags = cmangosBuddyAsTarget | cmangosSourceTargetsSelf
	default:
		flags = cmangosBuddyAsTarget | cmangosReverseDirection | cmangosSourceTargetsSelf
	}
	return max(st.TargetParam1, 0), max(st.TargetParam2, 0), flags, ""
}

// cmangosScriptStep translates one VMaNGOS waypoint script command. ok is false when it can't be
// written, with why; lost lists what a written command leaves out.
func cmangosScriptStep(st ScriptStep) (out cmangosStep, lost []string, ok bool, why string) {
	if st.ConditionID != 0 {
		return out, nil, false, fmt.Sprintf("it has condition %d, and condition ids differ between the databases", st.ConditionID)
	}
	d, di := st.Data, st.DataInt
	onTarget := false
	switch st.Command {
	case 0: // talk: broadcast texts, which CMaNGOS reads first by the same ids
		if di[0] <= 0 {
			return out, nil, false, "it names no text"
		}
		out.Command, out.DataInt = 0, di
		if st.TextChatType >= 0 && st.TextChatType != d[0] {
			lost = append(lost, fmt.Sprintf("its chat type %d (CMaNGOS uses the text's own, %d)", d[0], st.TextChatType))
		}
	case 1: // emote: one of up to four at random
		out.Command, out.Data[0], out.DataInt = 1, d[0], [4]int{d[1], d[2], d[3], 0}
		if di[0] != 0 {
			lost = append(lost, "its is_targeted option")
		}
	case 2: // set a field
		out.Command, out.Data[0], out.Data[1] = 2, d[0], d[1]
	case 3: // move to a point
		if d[0] != 0 {
			return out, nil, false, fmt.Sprintf("its coordinates are relative to its target (type %d)", d[0])
		}
		out.Command, out.X, out.Y, out.Z, out.O = 3, st.X, st.Y, st.Z, st.O
		if d[3]&0x2 != 0 { // SF_MOVETO_POINT_MOVEGEN: the point movement replaces the path's
			out.Data[1] = 0x2
		}
		switch { // MoveOptions to ForcedMovement
		case d[2]&0x008 != 0:
			out.Data[2] = 3
		case d[2]&0x004 != 0:
			out.Data[2] = 2
		case d[2]&0x002 != 0:
			out.Data[2] = 1
		}
		if d[1] != 0 {
			lost = append(lost, fmt.Sprintf("its travel time (%d ms)", d[1]))
		}
	case 4: // modify flags: CMaNGOS sets and removes in two commands, and can't toggle
		switch d[2] {
		case 1:
			out.Command = 4
		case 2:
			out.Command = 5
		default:
			return out, nil, false, "it toggles flags, which CMaNGOS can't"
		}
		out.Data[0], out.Data[1] = d[0], d[1]
	case 14: // remove an aura
		out.Command, out.Data[0] = 14, d[0]
	case 15: // cast: VMaNGOS's CF_TRIGGERED is CMaNGOS's TRIGGERED_OLD_TRIGGERED
		out.Command, out.Data[0] = 15, d[0]
		if d[1]&0x2 != 0 {
			out.Data[1] = 1
		}
		if rest := d[1] &^ 0x2; rest != 0 {
			lost = append(lost, fmt.Sprintf("its cast flags 0x%x", rest))
		}
	case 16: // play a sound: to the target only, distance dependent, the whole zone
		out.Command, out.Data[0] = 16, d[0]
		for _, m := range [][2]int{{0x1, 0x1}, {0x2, 0x2}, {0x4, 0x8}} {
			if d[1]&m[0] != 0 {
				out.Data[1] |= m[1]
			}
		}
	case 18: // despawn, which CMaNGOS does to its target
		out.Command, out.Data[0], onTarget = 18, d[0], true
		if d[1] != 0 {
			lost = append(lost, fmt.Sprintf("its respawn delay (%d)", d[1]))
		}
	case 19: // set equipment
		out.Command, out.Data[0], out.DataInt = 42, d[0], [4]int{di[0], di[1], di[2], 0}
	case 21, 25, 28: // active object, run, stand state
		out.Command, out.Data[0] = st.Command, d[0]
	case 22: // faction, with the same restore flags
		out.Command, out.Data[0], out.Data[1] = 22, d[0], d[1]
	case 23, 24: // morph and mount: an entry, or with the additional flag a display
		out.Command, out.Data[0] = st.Command, d[0]
		if d[1] != 0 {
			out.Flags = cmangosCommandAdditional
		}
		if st.Command == 24 && d[2] != 0 {
			lost = append(lost, "its permanent option")
		}
	case 35: // turn: to the target, or to the given facing (CMaNGOS's move to 0, 0, 0)
		if d[0] == 1 {
			out.Command, out.O = 3, st.O
		} else {
			out.Command = 36
		}
	case 20: // movement: idle, or random within a distance (around where it stands, or its spawn point)
		switch d[0] {
		case 0:
			out.Command = 20
		case 1:
			out.Command, out.Data[0], out.Data[1] = 20, 1, int(math.Round(st.X))
			if d[1] != 0 {
				out.Flags = cmangosCommandAdditional
			}
			if d[3] != 0 { // clear: the random movement replaces the path
				out.DataInt[1] = 1
			}
		default:
			return out, nil, false, fmt.Sprintf("its movement type %d has no CMaNGOS counterpart here", d[0])
		}
	case 51: // sheath state
		out.Command, out.Data[0] = 54, d[0]
	case 10: // summon a creature at a point
		out.Command, out.Data[0], out.Data[1], out.X, out.Y, out.Z, out.O = 10, d[0], d[1], st.X, st.Y, st.Z, st.O
		if di[0]&0x01 != 0 {
			out.DataInt[0] = 1
		}
		if di[0]&0x02 != 0 {
			out.Flags = cmangosCommandAdditional
		}
		if di[0]&^0x03 != 0 {
			lost = append(lost, "its unique or null-AI options")
		}
		if di[1] != 0 {
			lost = append(lost, fmt.Sprintf("the script it starts on the creature (%d)", di[1]))
		}
		if di[2] >= 0 {
			lost = append(lost, "the target the creature attacks")
		}
		if di[3] > 1 {
			lost = append(lost, fmt.Sprintf("its despawn type %d", di[3]))
		}
	default:
		return out, nil, false, "CMaNGOS has no like command"
	}
	buddy, radius, flags, why := cmangosScriptTargets(st, onTarget)
	if why != "" {
		return cmangosStep{}, nil, false, why
	}
	out.Buddy, out.Radius, out.Flags = buddy, radius, out.Flags|flags
	if st.DataFlags&0x08 != 0 {
		lost = append(lost, "ending the script when it fails")
	}
	return out, lost, true, ""
}

// cmangosDropScriptsSQL removes the scripts Meld wrote for guid's path, before the path goes.
func cmangosDropScriptsSQL(guid int) string {
	return fmt.Sprintf("DELETE `d` FROM `dbscripts_on_creature_movement` `d` JOIN `creature_movement` `m` ON `m`.`ScriptId` = `d`.`id` "+
		"WHERE `m`.`Id` = %d AND `d`.`id` >= %d AND `d`.`comments` LIKE 'Meld:%%';", guid, cmangosScriptBase)
}

// cmangosPathScripts translates the scripts of s's path. ids maps a VMaNGOS script id to its offset
// from @meld_script (absent: the point gets none); lines are the statements that write them, before
// the path, and skipped what isn't exported.
func cmangosPathScripts(s Spawn) (ids map[int]int, lines, skipped []string) {
	ids = map[int]int{}
	var rows []string
	unread, seen := false, map[int]bool{}
	for _, p := range s.Path {
		id := p.ScriptID
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		if s.PathScripts == nil {
			unread = true
			continue
		}
		steps, ok := s.PathScripts[id]
		if !ok || len(steps) == 0 {
			skipped = append(skipped, fmt.Sprintf("its waypoints' script %d; the VMaNGOS world database has no such script", id))
			continue
		}
		next := len(ids)
		var parts []string
		written := 0
		for _, st := range steps {
			c, lost, ok, why := cmangosScriptStep(st)
			if !ok {
				parts = append(parts, fmt.Sprintf("command %d at %ds, as %s", st.Command, st.Delay, why))
				continue
			}
			for _, l := range lost {
				parts = append(parts, fmt.Sprintf("command %d at %ds: %s", st.Command, st.Delay, l))
			}
			note := fmt.Sprintf("Meld: guid %d, VMaNGOS waypoint script %d", s.GUID, id)
			if st.Comments != "" {
				note += ": " + st.Comments
			}
			if r := []rune(note); len(r) > 255 {
				note = string(r[:255])
			}
			rows = append(rows, fmt.Sprintf("(@meld_script + %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, 0, %s, %s, %s, %s, 0, 0, %s)",
				next, max(st.Delay, 0)*1000, max(st.Priority, 0), c.Command, max(c.Data[0], 0), max(c.Data[1], 0), max(c.Data[2], 0), c.Buddy, c.Radius, c.Flags,
				c.DataInt[0], c.DataInt[1], c.DataInt[2], c.DataInt[3], num(c.X), num(c.Y), num(c.Z), num(c.O), sqlQuote(note)))
			written++
		}
		if len(parts) > 0 {
			skipped = append(skipped, fmt.Sprintf("its waypoints' script %d, in part (%s)", id, strings.Join(parts, "; ")))
		}
		if written > 0 {
			ids[id] = next
		}
	}
	if unread {
		skipped = append(skipped, "its waypoints' scripts; they couldn't be read from the VMaNGOS world database")
	}
	if len(rows) == 0 {
		return ids, nil, skipped
	}
	return ids, []string{
		fmt.Sprintf("SET @meld_script = (SELECT GREATEST(COALESCE(MAX(`id`), 0) + 1, %d) FROM `dbscripts_on_creature_movement`);", cmangosScriptBase),
		"INSERT INTO `dbscripts_on_creature_movement` (`id`, `delay`, `priority`, `command`, `datalong`, `datalong2`, `datalong3`, `buddy_entry`, `search_radius`, " +
			"`data_flags`, `dataint`, `dataint2`, `dataint3`, `dataint4`, `datafloat`, `x`, `y`, `z`, `o`, `speed`, `condition_id`, `comments`) VALUES " + strings.Join(rows, ", ") + ";",
	}, skipped
}
