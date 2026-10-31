package vmangos

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// File › Check Map's world links (#953): the flight stops of the open map with their routes, and the
// teleports that start on the map (its area triggers, the gossip, spells and scripts of its spawns'
// templates) or land on it from anywhere (area triggers, teleport spells and gossip scripts aimed at
// it), each with whether the client knows its target map and, on another map, the ground under its
// target from the client's tiles. The editor decides what is wrong: it matches a flight master to its
// stop the server's way and measures a destination on the open map against its own terrain and models.

// spellEffectSendTaxi is SPELL_EFFECT_SEND_TAXI: a spell that flies the player along a route of its own.
const spellEffectSendTaxi = 123

// LinkSpawn is a template the map spawns, with one spawn's guid (the scripts a game object runs on
// use are keyed by it).
type LinkSpawn struct {
	Kind  string `json:"kind"`
	Entry int    `json:"entry"`
	Guid  int    `json:"guid"`
}

// LinkQuery is the open map's ID and the templates its spawns use.
type LinkQuery struct {
	MapID  int         `json:"mapId"`
	Spawns []LinkSpawn `json:"spawns"`
}

// LinkNode is a flight stop on the open map and how many routes start and end at it. Network says
// whether the server counts it among the stops a flight master can stand at: not when every route
// from it is a spell's own flight (ObjectMgr's taxi mask, DBCStores.cpp).
type LinkNode struct {
	TaxiNode
	From    int  `json:"from"`
	To      int  `json:"to"`
	Network bool `json:"network"`
}

// PortalLink is a teleport and where it lands. Kind is "trigger" for an area trigger on the open map
// (At its position), "creature" or "object" for a spawned template's teleport (Entry, Guid), and
// "into" for a teleport from elsewhere that lands on the open map.
type PortalLink struct {
	Kind    string          `json:"kind"`
	Label   string          `json:"label"`
	Trigger uint32          `json:"trigger"`
	Entry   int             `json:"entry"`
	Guid    int             `json:"guid"`
	At      [3]float32      `json:"at"`
	Dest    TriggerTeleport `json:"dest"`
	// MapKnown says whether the client's Map.dbc has the target map (the open map always counts),
	// MapName names it.
	MapKnown bool   `json:"mapKnown"`
	MapName  string `json:"mapName"`
	// Ground is the client's ground under the target on another map (nil when it can't be read:
	// no tile there, a map of one building, a hole), and InBuilding whether the target lies inside a
	// building the tile places, where its floor is unread. OutsideBuilding says the target map is one
	// building (a dungeon or raid, whose WDT places a single WMO and has no tiles) and the target lies
	// more than a few yards outside its bounds, in the void.
	Ground          *float32 `json:"ground"`
	InBuilding      bool     `json:"inBuilding"`
	OutsideBuilding bool     `json:"outsideBuilding"`
}

// LinkReport is what a LinkQuery found; Error says why a part is missing (the rest stands).
type LinkReport struct {
	Checked bool         `json:"checked"`
	Nodes   []LinkNode   `json:"nodes"`
	Portals []PortalLink `json:"portals"`
	Error   string       `json:"error"`
}

func emptyLinkReport() LinkReport {
	return LinkReport{Nodes: []LinkNode{}, Portals: []PortalLink{}}
}

// linkNodes is mapID's stops with their route counts. spellPaths are the routes spells fly on.
func linkNodes(tt TaxiTables, mapID uint32, spellPaths map[uint32]bool) ([]LinkNode, error) {
	p, err := parseTaxi(tt)
	if err != nil {
		return nil, err
	}
	from, to := map[uint32]int{}, map[uint32]int{}
	plain := map[uint32]bool{} // has a route from it that is not a spell's
	for r := 0; r < p.paths.records; r++ {
		id, f, t := p.paths.u32(r, 0), p.paths.u32(r, 1), p.paths.u32(r, 2)
		from[f]++
		to[t]++
		if !spellPaths[id] {
			plain[f] = true
		}
	}
	out := []LinkNode{}
	for r := 0; r < p.nodes.records; r++ {
		n := p.node(r)
		if n.MapID != mapID {
			continue
		}
		out = append(out, LinkNode{TaxiNode: n, From: from[n.ID], To: to[n.ID], Network: from[n.ID] == 0 || plain[n.ID]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// spellPathsSQL selects the routes spells fly the player on.
func spellPathsSQL() string {
	var parts []string
	for i := 1; i <= 3; i++ {
		n := strconv.Itoa(i)
		parts = append(parts, fmt.Sprintf("SELECT effectMiscValue%s FROM spell_template WHERE effect%s = %d", n, n, spellEffectSendTaxi))
	}
	return strings.Join(parts, " UNION ")
}

// intoTeleportsSQL selects the teleports from anywhere that land on mapID: area triggers (newest
// patch), teleport spells and gossip scripts' teleports, as kind, id, label, map, x, y, z, o.
func intoTeleportsSQL(mapID int) string {
	trig := fmt.Sprintf("SELECT 't', t.id, %s, t.target_map, t.target_position_x, t.target_position_y, t.target_position_z, t.target_orientation FROM areatrigger_teleport t "+
		"JOIN (SELECT id, MAX(patch) AS patch FROM areatrigger_teleport GROUP BY id) n ON n.id = t.id AND n.patch = t.patch WHERE t.target_map = %d", labelCol("COALESCE(t.name, '')"), mapID)
	spell := fmt.Sprintf("SELECT 's', p.id, %[1]s, %[2]s FROM spell_target_position p JOIN spell_template st ON st.entry = p.id AND st.build = (SELECT MAX(build) FROM spell_template WHERE entry = p.id AND build <= %[3]d)"+
		" AND %[4]d IN (st.effect1, st.effect2, st.effect3) WHERE p.target_map = %[5]d AND p.build_min <= %[3]d AND p.build_max >= %[3]d",
		labelCol("COALESCE(st.name, '')"), spellDestCols, triggerBuild, spellEffectTeleport, mapID)
	gossip := fmt.Sprintf("SELECT 'g', s.id, %s, s.datalong, s.x, s.y, s.z, s.o FROM gossip_scripts s WHERE s.command = %d AND s.datalong = %d",
		labelCol("COALESCE(s.comments, '')"), scriptTeleportTo, mapID)
	return trig + " UNION ALL " + spell + " UNION ALL " + gossip
}

// spawnTeleportsScript is one script of spawnTeleportSQL a template, each after a "#<i>" row naming
// the spawn it is for.
func spawnTeleportsScript(spawns []LinkSpawn) string {
	var b strings.Builder
	for i, s := range spawns {
		kind := "creature"
		if s.Kind == "object" {
			kind = "object"
		}
		fmt.Fprintf(&b, "SELECT '#%d';\n%s;\n", i, spawnTeleportSQL(kind, s.Entry, s.Guid))
	}
	return b.String()
}

// parseSpawnTeleportsScript reads spawnTeleportsScript's output into each spawn's teleports.
func parseSpawnTeleportsScript(raw []byte, spawns []LinkSpawn) []PortalLink {
	out := []PortalLink{}
	cur := -1
	seen := map[string]bool{}
	for _, f := range batchLines(raw) {
		if len(f) == 1 && strings.HasPrefix(f[0], "#") {
			cur, _ = strconv.Atoi(f[0][1:])
			continue
		}
		if len(f) != 6 || cur < 0 || cur >= len(spawns) {
			continue
		}
		s := spawns[cur]
		kind := "creature"
		if s.Kind == "object" {
			kind = "object"
		}
		l := PortalLink{Kind: kind, Label: f[0], Entry: s.Entry, Guid: s.Guid, Dest: TriggerTeleport{Map: f.u32(1), X: f.f32(2), Y: f.f32(3), Z: f.f32(4), O: f.f32(5)}}
		k := fmt.Sprintf("%s:%d:%s:%v", kind, s.Entry, l.Label, l.Dest)
		if !seen[k] {
			seen[k] = true
			out = append(out, l)
		}
	}
	return out
}

// querySQL runs a script of queries against the world database on mariadb's stdin, which takes a
// script longer than a command line may be, and returns their batch output. A variable for tests.
var querySQL = func(db worldDB, script string) ([]byte, error) {
	guardTestDatabase("query script on " + db.host + ":" + db.port + "/" + db.name)
	args := db.args("")
	args = append([]string{"-B", "-N"}, args[:len(args)-2]...)
	cmd := exec.Command("mariadb", args...)
	cmd.Env = append(os.Environ(), db.env()...)
	hideConsole(cmd)
	cmd.Stdin = strings.NewReader(script)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("mariadb: %w: %s", err, mariadbError(errOut.String()))
	}
	return out.Bytes(), nil
}

// tileGround is a client tile read for the ground under teleport targets.
type tileGround struct {
	terrain *adt.Terrain
	places  []adt.Placement
}

// groundAt is the tile's ground at (lx, lz), the editor's offset into the tile (east, south), from
// the four triangles of its cell; false over a hole or where the tile has no chunk.
func (g *tileGround) groundAt(lx, lz float64) (float32, bool) {
	const chunk = adt.TileSize / adt.ChunksPerTile
	const cell = chunk / adt.CellsPerChunk
	cx, cz := int(lx/chunk), int(lz/chunk)
	ch := g.terrain.At(min(cx, adt.ChunksPerTile-1), min(cz, adt.ChunksPerTile-1))
	if ch == nil {
		return 0, false
	}
	ox, oz := lx-float64(ch.IndexX)*chunk, lz-float64(ch.IndexY)*chunk
	q, r := min(int(ox/cell), adt.CellsPerChunk-1), min(int(oz/cell), adt.CellsPerChunk-1)
	if ch.Holes[r]&(1<<q) != 0 {
		return 0, false
	}
	u, v := ox/cell-float64(q), oz/cell-float64(r)
	h := func(i int) float64 { return float64(ch.Heights[i]) }
	a, b, c, d, m := h(r*17+q), h(r*17+q+1), h((r+1)*17+q), h((r+1)*17+q+1), h(r*17+9+q)
	// The corners and the middle as (u, v, height), then the triangle the point is in.
	type pt struct{ u, v, h float64 }
	mid := pt{0.5, 0.5, m}
	var p1, p2 pt
	switch {
	case v <= u && v <= 1-u:
		p1, p2 = pt{0, 0, a}, pt{1, 0, b}
	case v >= u && v >= 1-u:
		p1, p2 = pt{0, 1, c}, pt{1, 1, d}
	case u <= v:
		p1, p2 = pt{0, 0, a}, pt{0, 1, c}
	default:
		p1, p2 = pt{1, 0, b}, pt{1, 1, d}
	}
	det := (p2.v-mid.v)*(p1.u-mid.u) + (mid.u-p2.u)*(p1.v-mid.v)
	w1 := ((p2.v-mid.v)*(u-mid.u) + (mid.u-p2.u)*(v-mid.v)) / det
	w2 := ((mid.v-p1.v)*(u-mid.u) + (p1.u-mid.u)*(v-mid.v)) / det
	return float32(w1*p1.h + w2*p2.h + (1-w1-w2)*mid.h), true
}

// buildingMargin is how far (yards) outside a building's bounds a target may lie and still count as
// inside it.
const buildingMargin = 3

// inExtents says whether the placement-space point (x, y, z) lies inside the bounds lo..hi, with
// buildingMargin.
func inExtents(lo, hi [3]float32, x, y, z float32) bool {
	const m = buildingMargin
	return x >= lo[0]-m && x <= hi[0]+m && y >= lo[1]-m && y <= hi[1]+m && z >= lo[2]-m && z <= hi[2]+m
}

// inBuilding says whether the placement-space point (x, y, z) lies inside a WMO the tile places,
// with a margin of a few yards.
func (g *tileGround) inBuilding(x, y, z float32) bool {
	for _, p := range g.places {
		if p.Kind == adt.WMO && inExtents(p.Extents[0], p.Extents[1], x, y, z) {
			return true
		}
	}
	return false
}

// destTile is the tile under a server point and the editor's offset into it.
func destTile(sx, sy float64) (tx, ty int, lx, lz float64) {
	ex, ez := adt.ZeroPoint-sy, adt.ZeroPoint-sx
	tx, ty = int(math.Floor(ex/adt.TileSize)), int(math.Floor(ez/adt.TileSize))
	return tx, ty, ex - float64(tx)*adt.TileSize, ez - float64(ty)*adt.TileSize
}

// groundReader reads the client's tiles, and each map's WDT for a map of one building, on demand,
// each once.
type groundReader struct {
	read  func(name string) ([]byte, error)
	tiles map[string]*tileGround
	// globals is each map folder's one building (nil when the map has tiles or no WDT).
	globals map[string]*GlobalWMO
}

// global is the one building of the map in folder dir, or nil when the map isn't one building.
func (g *groundReader) global(dir string) *GlobalWMO {
	key := strings.ToLower(dir)
	if w, ok := g.globals[key]; ok {
		return w
	}
	var w *GlobalWMO
	if raw, err := g.read(fmt.Sprintf(`World\Maps\%s\%s.wdt`, dir, dir)); err == nil {
		if gw, ok := ParseGlobalWMO(raw); ok {
			w = &gw
		}
	}
	g.globals[key] = w
	return w
}

// at fills in a link's ground and building from its target map's tile (dir its folder), or, on a
// map of one building, whether the target lies outside that building's bounds.
func (g *groundReader) at(l *PortalLink, dir string) {
	if dir == "" {
		return
	}
	px, py, pz := float32(adt.ZeroPoint)-l.Dest.Y, l.Dest.Z, float32(adt.ZeroPoint)-l.Dest.X
	if w := g.global(dir); w != nil {
		// Inside the bounds the floor can't be told without the building's groups, so only a
		// target outside them is flagged. The WDT's bounds are the file frame less ZeroPoint
		// (wmoonly.go); a WDT with no bounds (all zero) says nothing.
		if w.Min != w.Max {
			l.OutsideBuilding = !inExtents(globalToFile(w.Min), globalToFile(w.Max), px, py, pz)
		}
		return
	}
	tx, ty, lx, lz := destTile(float64(l.Dest.X), float64(l.Dest.Y))
	if tx < 0 || ty < 0 || tx >= 64 || ty >= 64 {
		return
	}
	name := adt.TilePath(dir, tx, ty, "")
	t, ok := g.tiles[name]
	if !ok {
		if raw, err := g.read(name); err == nil {
			if ter, err := adt.ParseTerrain(raw); err == nil {
				places, _ := adt.ParsePlacements(raw)
				t = &tileGround{terrain: ter, places: places}
			}
		}
		g.tiles[name] = t
	}
	if t == nil {
		return
	}
	l.InBuilding = t.inBuilding(px, py, pz)
	if h, ok := t.groundAt(lx, lz); ok {
		l.Ground = &h
	}
}

// checkLinks reads the open map's world links (LinkReport). A part that fails is left out, and the
// report says why.
func checkLinks(db worldDB, dataDir string, q LinkQuery) LinkReport {
	r := emptyLinkReport()
	if dataDir == "" {
		r.Error = "no client folder is set"
		return r
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		r.Error = err.Error()
		return r
	}
	defer set.Close()
	r.Checked = true
	var errs []string
	fail := func(what string, err error) { errs = append(errs, what+": "+err.Error()) }
	mapID := uint32(q.MapID)

	// The flight stops.
	var tt TaxiTables
	var terr error
	for _, f := range []struct {
		to   *[]byte
		path string
	}{{&tt.Nodes, TaxiNodesPath}, {&tt.Paths, TaxiPathPath}, {&tt.Points, TaxiPathNodePath}} {
		if terr == nil {
			*f.to, terr = set.ReadFile(f.path)
		}
	}
	if terr != nil {
		fail("flight paths", terr)
	} else {
		spell := map[uint32]bool{}
		raw, err := runSQL(db, spellPathsSQL())
		if err != nil {
			fail("spell flights", err)
		}
		for _, f := range batchRows(raw, 1) {
			spell[f.u32(0)] = true
		}
		if nodes, err := linkNodes(tt, mapID, spell); err != nil {
			fail("flight paths", err)
		} else {
			r.Nodes = nodes
		}
	}

	// The area triggers on the map with a teleport, and the names of every trigger for those landing here.
	triggerMap := map[uint32]uint32{}
	if dbc, err := set.ReadFile(AreaTriggerPath); err != nil {
		fail("area triggers", err)
	} else if t, err := areaTriggerTable(dbc); err != nil {
		fail("area triggers", err)
	} else {
		for i := 0; i < t.records; i++ {
			triggerMap[t.u32(i, 0)] = t.u32(i, 1)
		}
		triggers, _ := ReadAreaTriggers(dbc, mapID)
		if _, err := triggerExtras(db, triggers); err != nil {
			fail("area triggers", err)
		}
		for _, a := range triggers {
			if a.Teleport == nil {
				continue
			}
			r.Portals = append(r.Portals, PortalLink{Kind: "trigger", Label: triggerLabel(a.ID, a.Name), Trigger: a.ID, At: [3]float32{a.X, a.Y, a.Z}, Dest: *a.Teleport})
		}
	}

	// The spawns' teleports.
	if len(q.Spawns) > 0 {
		raw, err := querySQL(db, spawnTeleportsScript(q.Spawns))
		if err != nil {
			fail("the spawns' teleports", err)
		}
		r.Portals = append(r.Portals, parseSpawnTeleportsScript(raw, q.Spawns)...)
	}

	// Those from elsewhere that land here: a trigger on the map is already listed.
	maps := map[uint32]MapEntry{}
	if b, err := set.ReadFile(`DBFilesClient\Map.dbc`); err == nil {
		if list, err := ReadMapEntries(b); err == nil {
			for _, m := range list {
				maps[m.ID] = m
			}
		}
	}
	raw, err := runSQL(db, intoTeleportsSQL(q.MapID))
	if err != nil {
		fail("teleports to the map", err)
	}
	for _, f := range batchRows(raw, 8) {
		id := f.u32(1)
		l := PortalLink{Kind: "into", Dest: TriggerTeleport{Map: f.u32(3), X: f.f32(4), Y: f.f32(5), Z: f.f32(6), O: f.f32(7)}}
		switch f[0] {
		case "t":
			from, ok := triggerMap[id]
			if ok && from == mapID {
				continue
			}
			l.Trigger = id
			l.Label = triggerLabel(id, f[2])
			if m, known := maps[from]; ok && known {
				l.Label += " on " + m.Name
			}
		case "s":
			l.Label = fmt.Sprintf("Spell %d (%s)", id, f[2])
		default:
			l.Label = fmt.Sprintf("Gossip script %d", id)
			if f[2] != "" {
				l.Label += " (" + f[2] + ")"
			}
		}
		r.Portals = append(r.Portals, l)
	}

	// Each target's map, and the ground under those on another map.
	g := &groundReader{read: set.ReadFile, tiles: map[string]*tileGround{}, globals: map[string]*GlobalWMO{}}
	for i := range r.Portals {
		l := &r.Portals[i]
		m, ok := maps[l.Dest.Map]
		l.MapKnown = ok || l.Dest.Map == mapID
		l.MapName = m.Name
		if ok && l.Dest.Map != mapID {
			g.at(l, m.Dir)
		}
	}
	r.Error = strings.Join(errs, "; ")
	return r
}

// triggerLabel names an area trigger.
func triggerLabel(id uint32, name string) string {
	if name == "" {
		return fmt.Sprintf("Area trigger %d", id)
	}
	return fmt.Sprintf("Area trigger %d (%s)", id, name)
}
