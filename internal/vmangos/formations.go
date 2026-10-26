package vmangos

import (
	"fmt"
	"math"
	"strconv"
)

// Formation flags (creature_groups.flags, VMaNGOS's OptionFlags in CreatureGroups.h). The server ORs
// the members' flags into the group's options.
const (
	// FormationMove makes the followers walk the leader's path in their slots.
	FormationMove = 0x001
	// FormationAggro makes the group fight together.
	FormationAggro = 0x002
	// FormationDefault is what VMaNGOS's own .formation command gives a new member.
	FormationDefault = FormationMove | FormationAggro
)

// formationRow is a creature_groups row: a member of the formation led by leader, its slot dist yards
// from the leader at angle radians from the leader's facing, and its flags.
type formationRow struct {
	leader, member int
	dist, angle    float32
	flags          int
}

// formationsSQL lists the creature_groups rows of the guids in list, as members or as leaders.
func formationsSQL(list string) string {
	return fmt.Sprintf("SELECT leader_guid, member_guid, dist, angle, flags FROM creature_groups "+
		"WHERE member_guid IN (%s) OR leader_guid IN (%s) ORDER BY leader_guid, member_guid", list, list)
}

// readFormations gives the region's creatures their formation (creature_groups): a member gets its
// leader and its slot, and a leader with members gets its own guid as Leader, so the editor can draw
// and edit the group. The leader's own row, which VMaNGOS's data often has, carries no slot the
// server uses.
func readFormations(db worldDB, spawns []WorldSpawn) error {
	guids := map[int]bool{}
	for _, s := range spawns {
		if s.Kind != KindObject {
			guids[s.GUID] = true
		}
	}
	if len(guids) == 0 {
		return nil
	}
	raw, err := runSQL(db, formationsSQL(intList(guids)))
	if err != nil {
		return err
	}
	rows := parseFormations(raw)
	byMember := map[int]formationRow{}
	leaders := map[int]bool{}
	for _, r := range rows {
		byMember[r.member] = r
		if r.member != r.leader {
			leaders[r.leader] = true
		}
	}
	for i := range spawns {
		s := &spawns[i]
		if s.Kind == KindObject {
			continue
		}
		if r, ok := byMember[s.GUID]; ok {
			s.Leader, s.FollowDist, s.FollowAngle, s.GroupFlags = r.leader, r.dist, r.angle, r.flags
		} else if leaders[s.GUID] {
			// A leader without its own row: its flags are its members' (the group's options).
			s.Leader = s.GUID
			for _, r := range rows {
				if r.leader == s.GUID {
					s.GroupFlags |= r.flags
				}
			}
		}
	}
	return nil
}

// parseFormations reads formationsSQL's rows.
func parseFormations(raw []byte) []formationRow {
	var out []formationRow
	for _, f := range batchRows(raw, 5) {
		leader, err1 := strconv.Atoi(f[0])
		member, err2 := strconv.Atoi(f[1])
		dist, err3 := strconv.ParseFloat(f[2], 32)
		angle, err4 := strconv.ParseFloat(f[3], 32)
		flags, err5 := strconv.Atoi(f[4])
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil || leader <= 0 || member <= 0 {
			continue
		}
		out = append(out, formationRow{leader: leader, member: member, dist: float32(dist), angle: float32(angle), flags: flags})
	}
	return out
}

// slotAngle is a formation slot's angle as creature_groups holds it (an unsigned float): in [0, 2π).
func slotAngle(a float64) float64 {
	if math.IsNaN(a) || math.IsInf(a, 0) {
		return 0
	}
	a = math.Mod(a, 2*math.Pi)
	if a < 0 {
		a += 2 * math.Pi
	}
	return a
}

// formationSQL is the SQL for a creature's formation when it changed from orig's (nil for a spawn
// the database doesn't have): its creature_groups row replaced, or removed when it left. A leader
// that no longer leads takes the rest of its group's rows with it, members outside the region too.
func formationSQL(s Spawn, orig *Spawn) []string {
	var was Spawn
	if orig != nil {
		was = *orig
	}
	if s.Leader == was.Leader && math.Abs(s.FollowDist-was.FollowDist) < 1e-4 && math.Abs(s.FollowAngle-was.FollowAngle) < 1e-4 && s.GroupFlags == was.GroupFlags {
		return nil
	}
	var out []string
	if was.Leader == s.GUID && s.Leader != s.GUID {
		out = append(out, fmt.Sprintf("DELETE FROM `creature_groups` WHERE `leader_guid` = %d OR `member_guid` = %d;", s.GUID, s.GUID))
	} else if s.Leader == 0 {
		out = append(out, fmt.Sprintf("DELETE FROM `creature_groups` WHERE `member_guid` = %d;", s.GUID))
	}
	if s.Leader != 0 {
		out = append(out, fmt.Sprintf("REPLACE INTO `creature_groups` (`leader_guid`, `member_guid`, `dist`, `angle`, `flags`) VALUES (%d, %d, %s, %s, %d);",
			s.Leader, s.GUID, num(max(s.FollowDist, 0)), num(slotAngle(s.FollowAngle)), max(s.GroupFlags, 0)))
	}
	return out
}
