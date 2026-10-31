package vmangos

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The Flight Paths window's Export and Import (#944): a map's flight stops and routes as an SQL
// script. The server half is the stops' taxi_nodes rows, as Save writes them (TaxiSQL), which hold
// every field of a stop's TaxiNodes.dbc row too, so the import reads the stops from them. The routes
// are no SQL rows: the server reads them from its own copies of TaxiPath.dbc and TaxiPathNode.dbc, so
// they are carried as "-- meld" lines (meldlines.go), a route's line and then its points in order:
//
//	-- meld route <id> <from stop> <to stop> <price in copper>
//	-- meld point <route> <map> <x> <y> <z> <flags> <delay>
//
// Import writes them through SaveTaxi: the client's three tables, taxi_nodes, and the server's copies
// of the route tables.

var (
	taxiRouteFields = []string{"route ID", "from stop", "to stop", "price"}
	taxiPointLine   = []string{"route ID", "map", "x", "y", "z", "flags", "delay"}
	// taxiNodeColumns are taxi_nodes' columns in their order, for an INSERT without a column list.
	taxiNodeColumns = []string{"id", "build", "map_id", "x", "y", "z", "name", "mount_creature_id1", "mount_creature_id2"}
)

// TaxiScript is the SQL script of the flight stops nodes and the routes routes (each with its points)
// of the map mapName names in the header.
func TaxiScript(nodes []TaxiNode, routes []TaxiRoute, mapName string, now time.Time) (string, error) {
	if len(nodes) == 0 && len(routes) == 0 {
		return "", errors.New("no flight stops or routes to export")
	}
	in := map[uint32]bool{}
	maps := map[uint32]bool{}
	for _, n := range nodes {
		in[n.ID] = true
		maps[n.MapID] = true
	}
	where := ""
	if len(maps) == 1 {
		where = " of map " + strconv.FormatUint(uint64(nodes[0].MapID), 10)
		if mapName != "" {
			where += " (" + commentSafe(mapName) + ")"
		}
	} else if len(maps) > 1 {
		where = fmt.Sprintf(" of %d maps", len(maps))
	}
	var outside []string
	seen := map[uint32]bool{}
	points := 0
	for _, r := range routes {
		points += len(r.Points)
		for _, s := range []uint32{r.From, r.To} {
			if !in[s] && !seen[s] {
				seen[s] = true
				outside = append(outside, strconv.FormatUint(uint64(s), 10))
			}
		}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "-- Flight paths exported by Meld on %s: %d %s and %d %s (%d points)%s.\n", now.Format("2006-01-02 15:04"),
		len(nodes), plural(len(nodes), "stop", "stops"), len(routes), plural(len(routes), "route", "routes"), points, where)
	b.WriteString("-- Load it with Import in Meld's Flight Paths window (World > Flight Paths). Run on the world database, it writes only the stops' taxi_nodes rows:\n")
	b.WriteString("-- the server reads the routes from its data folder's TaxiPath.dbc and TaxiPathNode.dbc, which the meld lines carry, and Import writes them there and into the client's patch.\n")
	if len(outside) > 0 {
		fmt.Fprintf(&b, "-- Some routes fly from or to %s %s, which this script doesn't hold: the client they are imported into needs them already.\n", plural(len(outside), "stop", "stops"), strings.Join(outside, ", "))
	}
	for _, r := range routes {
		fmt.Fprintf(&b, "\n-- Route %d: stop %d to %d, %d points\n", r.ID, r.From, r.To, len(r.Points))
		b.WriteString(meldLine("route", r.ID, r.From, r.To, r.Cost))
		for _, p := range r.Points {
			b.WriteString(meldLine("point", r.ID, p.MapID, p.X, p.Y, p.Z, p.Flags, p.Delay))
		}
	}
	if len(nodes) > 0 {
		b.WriteString("\n-- The stops (taxi_nodes, build 5875).\n")
		b.WriteString(TaxiSQL(nodes, nil, nil))
	}
	return b.String(), nil
}

// taxiScript is what an exported flight paths script holds.
type taxiScript struct {
	nodes  []TaxiNode
	routes []TaxiRoute
	// skipped counts the statements that are no taxi_nodes rows; unknown are the columns of those
	// rows Meld doesn't write, left out.
	skipped int
	unknown []string
}

// readTaxiScript reads a flight paths script: the stops from its taxi_nodes rows (each stop's row of
// the highest build up to 1.12.1's, as the server takes it), the routes and their points from its
// "-- meld route" and "-- meld point" lines.
func readTaxiScript(script string) (taxiScript, error) {
	var s taxiScript
	routeLines, err := readMeldLines(script, "route")
	if err != nil {
		return s, err
	}
	at := map[uint32]int{}
	for _, l := range routeLines {
		if len(l.fields) != len(taxiRouteFields) {
			return s, fmt.Errorf("line %d (-- meld route): has %d fields, not %d", l.line, len(l.fields), len(taxiRouteFields))
		}
		u, err := meldUints(l.fields, taxiRouteFields...)
		if err != nil {
			return s, fmt.Errorf("line %d (-- meld route): %w", l.line, err)
		}
		if _, ok := at[u[0]]; ok {
			return s, fmt.Errorf("line %d: route %d is in the script twice", l.line, u[0])
		}
		at[u[0]] = len(s.routes)
		s.routes = append(s.routes, TaxiRoute{ID: u[0], From: u[1], To: u[2], Cost: u[3], Points: []TaxiPoint{}})
	}
	pointLines, err := readMeldLines(script, "point")
	if err != nil {
		return s, err
	}
	for _, l := range pointLines {
		f := l.fields
		if len(f) != len(taxiPointLine) {
			return s, fmt.Errorf("line %d (-- meld point): has %d fields, not %d", l.line, len(f), len(taxiPointLine))
		}
		u, err := meldUints([]string{f[0], f[1], f[5], f[6]}, "route ID", "map", "flags", "delay")
		if err != nil {
			return s, fmt.Errorf("line %d (-- meld point): %w", l.line, err)
		}
		var v [3]float32
		for i := range v {
			x, err := strconv.ParseFloat(f[2+i], 32)
			if err != nil {
				return s, fmt.Errorf("line %d (-- meld point): %s %q is not a number", l.line, taxiPointLine[2+i], f[2+i])
			}
			v[i] = float32(x)
		}
		i, ok := at[u[0]]
		if !ok {
			return s, fmt.Errorf("line %d: a point of route %d, which has no \"-- meld route\" line", l.line, u[0])
		}
		r := &s.routes[i]
		r.Points = append(r.Points, TaxiPoint{MapID: u[1], X: v[0], Y: v[1], Z: v[2], Flags: u[2], Delay: u[3]})
	}

	inserts, skipped, err := parseInserts(script, "taxi_nodes")
	if err != nil {
		return s, err
	}
	s.skipped = skipped
	known := map[string]bool{}
	for _, c := range taxiNodeColumns {
		known[c] = true
	}
	unknown := map[string]bool{}
	rows, err := scriptValues("taxi_nodes", inserts, taxiNodeColumns, known, unknown)
	if err != nil {
		return s, err
	}
	builds := map[uint32]uint32{}
	node := map[uint32]int{}
	for _, r := range rows {
		var n TaxiNode
		var build uint32
		for c, dst := range map[string]*uint32{"id": &n.ID, "build": &build, "map_id": &n.MapID, "mount_creature_id1": &n.HordeMount, "mount_creature_id2": &n.AllianceMount} {
			if *dst, err = scriptUint("taxi_nodes", r, c); err != nil {
				return s, err
			}
		}
		for c, dst := range map[string]*float32{"x": &n.X, "y": &n.Y, "z": &n.Z} {
			if *dst, err = scriptFloat("taxi_nodes", r, c); err != nil {
				return s, err
			}
		}
		n.Name = r.values["name"]
		if build > taxiBuild {
			continue
		}
		if b, ok := builds[n.ID]; ok {
			if b > build {
				continue
			}
			builds[n.ID] = build
			s.nodes[node[n.ID]] = n
			continue
		}
		builds[n.ID] = build
		node[n.ID] = len(s.nodes)
		s.nodes = append(s.nodes, n)
	}
	for n := range unknown {
		s.unknown = append(s.unknown, n)
	}
	sort.Strings(s.unknown)
	if len(s.nodes) == 0 && len(s.routes) == 0 {
		return s, errors.New("the script carries no flight stops or routes: Import reads the stops from its taxi_nodes rows and the routes from its \"-- meld route\" lines, which a script exported from Meld's Flight Paths window has")
	}
	return s, nil
}

// TaxiImportStop is a stop of a script as the import plan lists it.
type TaxiImportStop struct {
	ID    uint32 `json:"id"`
	MapID uint32 `json:"mapId"`
	Name  string `json:"name"`
	// Exists says the client has a stop of this ID, which the import replaces, and Same that it is the
	// script's already; Was is its name and WasMap its map when another.
	Exists bool   `json:"exists"`
	Same   bool   `json:"same"`
	Was    string `json:"was"`
	WasMap uint32 `json:"wasMap"`
}

// TaxiImportRoute is a route of a script as the import plan lists it.
type TaxiImportRoute struct {
	ID     uint32 `json:"id"`
	From   uint32 `json:"from"`
	To     uint32 `json:"to"`
	Cost   uint32 `json:"cost"`
	Points int    `json:"points"`
	// FromName and ToName are the stops' names, the script's or else the client's.
	FromName string `json:"fromName"`
	ToName   string `json:"toName"`
	// Exists says the client has a route of this ID, which the import replaces, and Same that it is the
	// script's already (it is left as it is); OtherWay that it flies between other stops, WasFrom to
	// WasTo.
	Exists   bool   `json:"exists"`
	Same     bool   `json:"same"`
	OtherWay bool   `json:"otherWay"`
	WasFrom  uint32 `json:"wasFrom"`
	WasTo    uint32 `json:"wasTo"`
	// Replaces is the client's route of another ID that flies between the same stops the same way,
	// which the import takes out, since the server keeps one; 0 for none.
	Replaces uint32 `json:"replaces"`
}

// TaxiImport is what importing a flight paths script would write.
type TaxiImport struct {
	Stops  []TaxiImportStop  `json:"stops"`
	Routes []TaxiImportRoute `json:"routes"`
	// Maps are the maps the stops and the routes' points are on, each once; MissingMaps those this
	// client's Map.dbc lacks.
	Maps        []uint32 `json:"maps"`
	MissingMaps []uint32 `json:"missingMaps"`
	// Server says a server folder is set, so taxi_nodes and the server's route tables are written too.
	Server  bool     `json:"server"`
	Skipped int      `json:"skipped"`
	Unknown []string `json:"unknown"`
	// Refused are the problems that stop the import; nothing is written while there is one.
	Refused []string `json:"refused"`
}

func sameRoute(a, b TaxiRoute) bool {
	if a.From != b.From || a.To != b.To || a.Cost != b.Cost || len(a.Points) != len(b.Points) {
		return false
	}
	for i := range a.Points {
		if a.Points[i] != b.Points[i] {
			return false
		}
	}
	return true
}

// PlanTaxiImport says what importing a flight paths script into a client (its taxi tables tt, and
// maps, its Map.dbc's IDs, nil for unchecked) would write, and returns the edit SaveTaxi writes: every
// stop of the script (an unchanged one writes the client's tables as they are, and its taxi_nodes row
// for a server that lacks it), the routes that differ from the client's, and the client's routes the
// script's replace between the same stops.
func PlanTaxiImport(tt TaxiTables, script string, maps map[uint32]bool, server bool) (TaxiImport, TaxiEdit, error) {
	p, err := parseTaxi(tt)
	if err != nil {
		return TaxiImport{}, TaxiEdit{}, err
	}
	s, err := readTaxiScript(script)
	if err != nil {
		return TaxiImport{}, TaxiEdit{}, err
	}
	plan := TaxiImport{Stops: []TaxiImportStop{}, Routes: []TaxiImportRoute{}, Server: server, Skipped: s.skipped, Unknown: s.unknown}
	edit := TaxiEdit{Nodes: []TaxiNode{}, RemoveNodes: []uint32{}, Routes: []TaxiRoute{}, RemoveRoutes: []uint32{}}

	onMap := map[uint32]bool{}
	addMap := func(m uint32) {
		if onMap[m] {
			return
		}
		onMap[m] = true
		plan.Maps = append(plan.Maps, m)
		if maps != nil && !maps[m] {
			plan.MissingMaps = append(plan.MissingMaps, m)
		}
	}
	names := map[uint32]string{}
	have := map[uint32]TaxiNode{}
	for r := 0; r < p.nodes.records; r++ {
		n := p.node(r)
		have[n.ID] = n
		names[n.ID] = n.Name
	}
	for _, n := range s.nodes {
		names[n.ID] = n.Name
		ps := TaxiImportStop{ID: n.ID, MapID: n.MapID, Name: n.Name}
		if cur, ok := have[n.ID]; ok {
			ps.Exists = true
			ps.Same = cur == n
			if cur.Name != n.Name || cur.MapID != n.MapID {
				ps.Was, ps.WasMap = cur.Name, cur.MapID
			}
		}
		plan.Stops = append(plan.Stops, ps)
		edit.Nodes = append(edit.Nodes, n)
		addMap(n.MapID)
	}

	points := p.routePoints()
	byID := map[uint32]TaxiRoute{}
	byPair := map[[2]uint32]uint32{}
	for r := 0; r < p.paths.records; r++ {
		id := p.paths.u32(r, 0)
		cr := TaxiRoute{ID: id, From: p.paths.u32(r, 1), To: p.paths.u32(r, 2), Cost: p.paths.u32(r, 3), Points: points[id]}
		byID[id] = cr
		byPair[[2]uint32{cr.From, cr.To}] = id
	}
	imported := map[uint32]bool{}
	for _, r := range s.routes {
		imported[r.ID] = true
	}
	removed := map[uint32]bool{}
	for _, r := range s.routes {
		pr := TaxiImportRoute{ID: r.ID, From: r.From, To: r.To, Cost: r.Cost, Points: len(r.Points), FromName: names[r.From], ToName: names[r.To]}
		if cur, ok := byID[r.ID]; ok {
			pr.Exists = true
			pr.Same = sameRoute(cur, r)
			if cur.From != r.From || cur.To != r.To {
				pr.OtherWay, pr.WasFrom, pr.WasTo = true, cur.From, cur.To
			}
		}
		if other, ok := byPair[[2]uint32{r.From, r.To}]; ok && other != r.ID && !imported[other] && !removed[other] {
			pr.Replaces = other
			removed[other] = true
			edit.RemoveRoutes = append(edit.RemoveRoutes, other)
		}
		if !pr.Same {
			edit.Routes = append(edit.Routes, r)
		}
		plan.Routes = append(plan.Routes, pr)
		for _, pt := range r.Points {
			addMap(pt.MapID)
		}
	}
	if _, err := SetTaxi(tt, edit.Nodes, edit.RemoveNodes, edit.Routes, edit.RemoveRoutes); err != nil {
		plan.Refused = append(plan.Refused, err.Error())
	}
	return plan, edit, nil
}
