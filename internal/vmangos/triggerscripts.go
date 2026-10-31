package vmangos

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The Portals and Area Triggers dialog's Export and Import (#943): a map's area triggers as an SQL
// script. The server half is its statements, each trigger's areatrigger_template row and its
// teleport (AreaTriggerSQL, as Save writes them: a DELETE of the old teleport, then the new one's
// INSERT when it has one). The client half is the triggers' AreaTrigger.dbc rows, which the server
// never reads, carried as "-- meld trigger" lines (meldlines.go):
//
//	-- meld trigger <id> <map> <x> <y> <z> <radius> <box x> <box y> <box z> <box yaw>
//
// Import takes the triggers' geometry from those lines and their names and teleports from the
// areatrigger_template and areatrigger_teleport statements, and writes them through SaveAreaTriggers.
// A trigger the script has no areatrigger_template row of (a script exported without a server
// folder) keeps the name and teleport the server has for it.

// triggerLineFields names the "-- meld trigger" line's fields, in order.
var triggerLineFields = []string{"id", "map", "x", "y", "z", "radius", "box length", "box width", "box height", "box turn"}

// triggerLine is a trigger's "-- meld trigger" line.
func triggerLine(a AreaTrigger) string {
	return meldLine("trigger", a.ID, a.MapID, a.X, a.Y, a.Z, a.Radius, a.BoxX, a.BoxY, a.BoxZ, a.BoxYaw)
}

// parseTriggerLine reads a trigger's geometry from a "-- meld trigger" line's fields.
func parseTriggerLine(f []string) (AreaTrigger, error) {
	if len(f) != len(triggerLineFields) {
		return AreaTrigger{}, fmt.Errorf("has %d fields, not %d", len(f), len(triggerLineFields))
	}
	u, err := meldUints(f[:2], triggerLineFields[:2]...)
	if err != nil {
		return AreaTrigger{}, err
	}
	var v [8]float32
	for i := range v {
		x, err := strconv.ParseFloat(f[2+i], 32)
		if err != nil {
			return AreaTrigger{}, fmt.Errorf("%s %q is not a number", triggerLineFields[2+i], f[2+i])
		}
		v[i] = float32(x)
	}
	if u[0] == 0 {
		return AreaTrigger{}, errors.New("has no trigger ID")
	}
	return AreaTrigger{ID: u[0], MapID: u[1], X: v[0], Y: v[1], Z: v[2], Radius: v[3], BoxX: v[4], BoxY: v[5], BoxZ: v[6], BoxYaw: v[7]}, nil
}

// TriggerScript is the SQL script of area triggers (rows, with the server's names and teleports when
// withServer) of the map mapName names in the header. Without the server, the script holds only the
// meld lines: an empty name and no teleport would wipe a server's.
func TriggerScript(rows []AreaTrigger, withServer bool, mapName string, now time.Time) (string, error) {
	if len(rows) == 0 {
		return "", errors.New("no area triggers to export")
	}
	maps := map[uint32]bool{}
	teleports := 0
	for _, a := range rows {
		maps[a.MapID] = true
		if a.Teleport != nil {
			teleports++
		}
	}
	where := "map " + strconv.FormatUint(uint64(rows[0].MapID), 10)
	if mapName != "" {
		where += " (" + commentSafe(mapName) + ")"
	}
	if len(maps) > 1 {
		where = fmt.Sprintf("%d maps", len(maps))
	}
	var b strings.Builder
	fmt.Fprintf(&b, "-- Area triggers exported by Meld on %s: %d %s of %s", now.Format("2006-01-02 15:04"), len(rows), plural(len(rows), "trigger", "triggers"), where)
	if withServer {
		fmt.Fprintf(&b, ", %d with a teleport", teleports)
	}
	b.WriteString(".\n")
	b.WriteString("-- Load it with Import in Meld's Portals and Area Triggers dialog (World > Portals), or run it on the world database.\n")
	b.WriteString("-- The meld lines carry the triggers' rows of the client's AreaTrigger.dbc, which the server never reads; Import writes them into the client's patch, and the server's areatrigger_template from them.\n")
	if !withServer {
		b.WriteString("-- No server rows: the exporting Meld had no VMaNGOS server folder set, so the names and teleports are not in it, and an import keeps the ones the server has.\n")
	}
	for _, a := range rows {
		b.WriteString(triggerLine(a))
	}
	if !withServer {
		return b.String(), nil
	}
	for _, a := range rows {
		name := a.Name
		if name == "" {
			name = "Trigger " + strconv.FormatUint(uint64(a.ID), 10)
		}
		what := "no teleport"
		if t := a.Teleport; t != nil {
			what = fmt.Sprintf("teleports to map %d", t.Map)
		}
		fmt.Fprintf(&b, "\n-- %s (trigger %d, %s)\n", commentSafe(name), a.ID, what)
		b.WriteString(AreaTriggerSQL([]AreaTrigger{a}, nil))
	}
	return b.String(), nil
}

// The columns of the server's tables in their order, for a script's INSERT without a column list.
var (
	triggerTemplateColumns = []string{"id", "build", "name", "map_id", "x", "y", "z", "radius", "box_x", "box_y", "box_z", "box_orientation", "cooldown", "condition_id", "script_id", "script_name"}
	triggerTeleportColumns = []string{"id", "patch", "name", "message", "required_level", "required_condition", "target_map", "target_position_x", "target_position_y", "target_position_z", "target_orientation"}
	// triggerGeometryColumns are areatrigger_template's columns the meld lines carry, read from there.
	triggerGeometryColumns = map[string]bool{"map_id": true, "x": true, "y": true, "z": true, "radius": true, "box_x": true, "box_y": true, "box_z": true, "box_orientation": true}
)

// triggerScript is what an exported area triggers script holds.
type triggerScript struct {
	rows []AreaTrigger
	// server are the triggers the script has an areatrigger_template row of (for build 5875 or
	// below), whose names and teleports are the script's.
	server map[uint32]bool
	// others counts the server rows of triggers the script has no meld line of.
	others int
	// skipped counts the statements that are none of the two tables' rows and teleport DELETEs.
	skipped int
	// unknown are the columns the script names that Meld doesn't write, left out.
	unknown []string
}

// scriptValues reads an INSERT's rows of table as maps of column to value, with cols the table's
// order for an INSERT without a column list. A column of neither known nor ignored goes in unknown.
func scriptValues(table string, inserts []sqlInsert, cols []string, known map[string]bool, unknown map[string]bool) ([]sqlRow, error) {
	var out []sqlRow
	for _, st := range inserts {
		names := st.columns
		if names == nil {
			names = cols
		}
		for _, tuple := range st.rows {
			if len(tuple) != len(names) {
				return nil, fmt.Errorf("an %s row has %d values for %d columns", table, len(tuple), len(names))
			}
			r := sqlRow{values: map[string]string{}, null: map[string]bool{}}
			for i, n := range names {
				n = strings.ToLower(n)
				if !known[n] {
					unknown[table+"."+n] = true
					continue
				}
				r.values[n] = tuple[i].text
				r.null[n] = tuple[i].null
			}
			out = append(out, r)
		}
	}
	return out, nil
}

// scriptUint reads column c of r as an unsigned whole number, 0 when the row lacks it.
func scriptUint(table string, r sqlRow, c string) (uint32, error) {
	v, ok := r.values[c]
	if !ok || r.null[c] {
		return 0, nil
	}
	n, err := strconv.ParseUint(strings.TrimSpace(v), 10, 32)
	if err != nil {
		return 0, fmt.Errorf("an %s row's %s %q is not a whole number", table, c, v)
	}
	return uint32(n), nil
}

// scriptFloat reads column c of r as a number, 0 when the row lacks it.
func scriptFloat(table string, r sqlRow, c string) (float32, error) {
	v, ok := r.values[c]
	if !ok || r.null[c] {
		return 0, nil
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(v), 32)
	if err != nil {
		return 0, fmt.Errorf("an %s row's %s %q is not a number", table, c, v)
	}
	return float32(n), nil
}

// readTriggerScript reads an area triggers script: the triggers from its "-- meld trigger" lines, and
// their names and teleports from its areatrigger_template and areatrigger_teleport statements.
func readTriggerScript(script string) (triggerScript, error) {
	lines, err := readMeldLines(script, "trigger")
	if err != nil {
		return triggerScript{}, err
	}
	s := triggerScript{server: map[uint32]bool{}}
	at := map[uint32]int{}
	for _, l := range lines {
		a, err := parseTriggerLine(l.fields)
		if err != nil {
			return triggerScript{}, fmt.Errorf("line %d (-- meld trigger): %w", l.line, err)
		}
		if _, ok := at[a.ID]; ok {
			return triggerScript{}, fmt.Errorf("line %d: trigger %d is in the script twice", l.line, a.ID)
		}
		at[a.ID] = len(s.rows)
		s.rows = append(s.rows, a)
	}
	if len(s.rows) == 0 {
		return triggerScript{}, errors.New("the script carries no area triggers: Import reads the client's AreaTrigger rows from its \"-- meld trigger\" lines, which only a script exported from Meld's Portals and Area Triggers dialog has")
	}

	templates, skipped, err := parseInserts(script, "areatrigger_template")
	if err != nil {
		return triggerScript{}, err
	}
	teleports, _, err := parseInserts(script, "areatrigger_teleport")
	if err != nil {
		return triggerScript{}, err
	}
	deletes, err := parseDeletes(script, "areatrigger_teleport", "id")
	if err != nil {
		return triggerScript{}, err
	}
	s.skipped = skipped - len(teleports) - len(deletes)

	unknown := map[string]bool{}
	known := map[string]bool{"id": true, "build": true, "name": true}
	for c := range triggerGeometryColumns {
		known[c] = true
	}
	trows, err := scriptValues("areatrigger_template", templates, triggerTemplateColumns, known, unknown)
	if err != nil {
		return triggerScript{}, err
	}
	// The row of the highest build up to 1.12.1's, as the server takes it.
	builds := map[uint32]uint32{}
	for _, r := range trows {
		id, err := scriptUint("areatrigger_template", r, "id")
		if err != nil {
			return triggerScript{}, err
		}
		build, err := scriptUint("areatrigger_template", r, "build")
		if err != nil {
			return triggerScript{}, err
		}
		i, ok := at[id]
		if !ok {
			s.others++
			continue
		}
		if build > triggerBuild {
			continue
		}
		if b, seen := builds[id]; seen && b > build {
			continue
		}
		builds[id] = build
		s.server[id] = true
		s.rows[i].Name = r.values["name"]
	}

	known = map[string]bool{}
	for _, c := range triggerTeleportColumns {
		known[c] = c != "required_condition"
	}
	prows, err := scriptValues("areatrigger_teleport", teleports, triggerTeleportColumns, known, unknown)
	if err != nil {
		return triggerScript{}, err
	}
	patches := map[uint32]uint32{}
	for _, r := range prows {
		id, err := scriptUint("areatrigger_teleport", r, "id")
		if err != nil {
			return triggerScript{}, err
		}
		i, ok := at[id]
		if !ok {
			s.others++
			continue
		}
		if !s.server[id] {
			// A teleport without its trigger's areatrigger_template row is still the script's.
			s.server[id] = true
		}
		patch, err := scriptUint("areatrigger_teleport", r, "patch")
		if err != nil {
			return triggerScript{}, err
		}
		if p, seen := patches[id]; seen && p > patch {
			continue
		}
		patches[id] = patch
		t := &TriggerTeleport{Message: r.values["message"]}
		level, err := scriptUint("areatrigger_teleport", r, "required_level")
		if err != nil {
			return triggerScript{}, err
		}
		t.Level = int(level)
		if t.Map, err = scriptUint("areatrigger_teleport", r, "target_map"); err != nil {
			return triggerScript{}, err
		}
		for c, dst := range map[string]*float32{"target_position_x": &t.X, "target_position_y": &t.Y, "target_position_z": &t.Z, "target_orientation": &t.O} {
			if *dst, err = scriptFloat("areatrigger_teleport", r, c); err != nil {
				return triggerScript{}, err
			}
		}
		a := &s.rows[i]
		a.Teleport = t
		if a.Name == "" {
			a.Name = r.values["name"]
		}
	}
	for _, id := range deletes {
		if _, ok := at[uint32(id)]; ok {
			s.server[uint32(id)] = true
		}
	}
	for n := range unknown {
		s.unknown = append(s.unknown, n)
	}
	sort.Strings(s.unknown)
	return s, nil
}

// TriggerImportRow is a trigger of a script as the import plan lists it.
type TriggerImportRow struct {
	ID    uint32 `json:"id"`
	MapID uint32 `json:"mapId"`
	Name  string `json:"name"`
	// Exists says the client has a trigger of this ID, which the import replaces; OtherMap that it is
	// on another map, WasMap, and Was the server's name for it when another, for a plan that says
	// when the ID is another trigger's on this client.
	Exists   bool   `json:"exists"`
	OtherMap bool   `json:"otherMap"`
	WasMap   uint32 `json:"wasMap"`
	Was      string `json:"was"`
	// Teleport is where the trigger sends a player after the import, or nil.
	Teleport *TriggerTeleport `json:"teleport"`
	// Kept says the script has no server row of the trigger, so the server's name and teleport stay.
	Kept bool `json:"kept"`
}

// TriggerImport is what importing an area triggers script would write.
type TriggerImport struct {
	Triggers []TriggerImportRow `json:"triggers"`
	// Maps are the maps the triggers are on, each once; MissingMaps those this client's Map.dbc lacks.
	Maps        []uint32 `json:"maps"`
	MissingMaps []uint32 `json:"missingMaps"`
	// Teleports counts the triggers that teleport after the import; MissingTargets are the maps they
	// send a player to that this client's Map.dbc lacks, which a server built from it lacks too.
	Teleports      int      `json:"teleports"`
	MissingTargets []uint32 `json:"missingTargets"`
	// Server says a server folder is set, so areatrigger_template and areatrigger_teleport are written
	// too; without one, the names and teleports are left out.
	Server  bool     `json:"server"`
	Others  int      `json:"others"`
	Skipped int      `json:"skipped"`
	Unknown []string `json:"unknown"`
	// Refused are the problems that stop the import; nothing is written while there is one.
	Refused []string `json:"refused"`
}

// PlanTriggerImport says what importing an area triggers script into a client (its AreaTrigger.dbc,
// dbc, and maps, its Map.dbc's IDs, nil for unchecked) would write, and returns the triggers the
// import writes. server, nil without a server folder, gives the server's names and teleports of the
// IDs asked for: a trigger the script has no server row of keeps them, and a replaced one's name is
// listed.
func PlanTriggerImport(dbc []byte, script string, maps map[uint32]bool, server func(ids []uint32) (map[uint32]AreaTrigger, error)) (TriggerImport, []AreaTrigger, error) {
	t, err := areaTriggerTable(dbc)
	if err != nil {
		return TriggerImport{}, nil, err
	}
	s, err := readTriggerScript(script)
	if err != nil {
		return TriggerImport{}, nil, err
	}
	plan := TriggerImport{Server: server != nil, Others: s.others, Skipped: s.skipped, Unknown: s.unknown}
	have := map[uint32]AreaTrigger{}
	if server != nil {
		ids := make([]uint32, len(s.rows))
		for i, a := range s.rows {
			ids[i] = a.ID
		}
		if have, err = server(ids); err != nil {
			return TriggerImport{}, nil, fmt.Errorf("world database: %w", err)
		}
	}
	rows := make([]AreaTrigger, len(s.rows))
	onMap := map[uint32]bool{}
	targets := map[uint32]bool{}
	for i, a := range s.rows {
		cur, onServer := have[a.ID]
		p := TriggerImportRow{ID: a.ID, MapID: a.MapID}
		if !s.server[a.ID] {
			p.Kept = true
			a.Name, a.Teleport = cur.Name, cur.Teleport
		} else if onServer && cur.Name != a.Name {
			p.Was = cur.Name
		}
		if r, ok := t.row(a.ID); ok {
			p.Exists = true
			if m := t.u32(r, 1); m != a.MapID {
				p.OtherMap, p.WasMap = true, m
			}
		}
		p.Name, p.Teleport = a.Name, a.Teleport
		rows[i] = a
		plan.Triggers = append(plan.Triggers, p)
		if !onMap[a.MapID] {
			onMap[a.MapID] = true
			plan.Maps = append(plan.Maps, a.MapID)
			if maps != nil && !maps[a.MapID] {
				plan.MissingMaps = append(plan.MissingMaps, a.MapID)
			}
		}
		if tp := a.Teleport; tp != nil {
			plan.Teleports++
			if maps != nil && !maps[tp.Map] && !targets[tp.Map] {
				targets[tp.Map] = true
				plan.MissingTargets = append(plan.MissingTargets, tp.Map)
			}
		}
	}
	if _, err := SetAreaTriggers(dbc, rows, nil); err != nil {
		plan.Refused = append(plan.Refused, err.Error())
	}
	return plan, rows, nil
}
