package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/mpq"
)

// Flight paths (#180). The 1.12 client draws the flight master's map from three tables: TaxiNodes.dbc
// (the stops), TaxiPath.dbc (a route from one stop to another, with its price) and TaxiPathNode.dbc
// (the points a route flies through, in order). VMaNGOS reads the stops from the world database's
// taxi_nodes and the routes and their points from its own copies of TaxiPath.dbc and TaxiPathNode.dbc
// (data/5875/dbc), so a save writes the three tables into Meld's patch, the two into the server's
// data, and the stops into taxi_nodes.

// The tables' names in the client's archives.
const (
	TaxiNodesPath    = `DBFilesClient\TaxiNodes.dbc`
	TaxiPathPath     = `DBFilesClient\TaxiPath.dbc`
	TaxiPathNodePath = `DBFilesClient\TaxiPathNode.dbc`
)

// The taxi tables' layouts are dbcTaxiNodes, dbcTaxiPath and dbcTaxiPathNode (1.12's are VMaNGOS's
// DBCfmt.h, checked against the client's files): TaxiNodes is ID, map, x, y, z, the localized name,
// then the Horde and the Alliance mount creature; TaxiPath is ID, from, to and price; TaxiPathNode
// is ID, path, index, map, x, y, z, flags and delay.

// taxiNodeCols are TaxiNodes.dbc's columns: the position's x (y and z follow), the name and its
// locale mask, and the mounts.
type taxiNodeCols struct{ mapID, pos, name, mask, horde, ally int }

// taxiPathCols are TaxiPath.dbc's columns.
type taxiPathCols struct{ from, to, cost int }

// taxiPointCols are TaxiPathNode.dbc's columns: the position's x (y and z follow).
type taxiPointCols struct{ path, index, mapID, pos, flags, delay int }

// MaxTaxiNode is the highest stop ID a 1.12 player can know: the taxi mask is 8 32-bit fields, and
// node i is bit i-1 (VMaNGOS's TaxiMaskSize).
const MaxTaxiNode = 8 * 32

// taxiBuild is the client build taxi_nodes rows are written for (5875 is 1.12.1): the server takes
// each stop's row of the highest build up to its own.
const taxiBuild = 5875

// TaxiNode is a flight stop in the server's coordinates (yards, Z up): where the flight master's map
// shows it and the server finds the stop nearest a flight master. A side without a mount can't use it.
type TaxiNode struct {
	ID    uint32  `json:"id"`
	MapID uint32  `json:"mapId"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
	Name  string  `json:"name"`
	// HordeMount and AllianceMount are the creature templates the flight is ridden on (0: that side
	// can't fly from here): 2224 Wind Rider, 3574 Riding Bat; 541 Riding Gryphon, 3837 Riding Hippogryph.
	HordeMount    uint32 `json:"hordeMount"`
	AllianceMount uint32 `json:"allianceMount"`
}

// TaxiPoint is a point a route flies through, in the server's coordinates. Flags 1 marks the points
// either side of a map change, 2 a stop; Delay is the seconds waited there.
type TaxiPoint struct {
	MapID uint32  `json:"mapId"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
	Flags uint32  `json:"flags"`
	Delay uint32  `json:"delay"`
}

// TaxiRoute is a flight from one stop to another: its price in copper and the points it flies
// through, the first near From and the last near To. The way back is a route of its own.
type TaxiRoute struct {
	ID     uint32      `json:"id"`
	From   uint32      `json:"from"`
	To     uint32      `json:"to"`
	Cost   uint32      `json:"cost"`
	Points []TaxiPoint `json:"points"`
}

// TaxiTables are the client's three taxi tables.
type TaxiTables struct {
	Nodes  []byte
	Paths  []byte
	Points []byte
}

// TaxiNetwork is a map's stops, the routes that start or end at one of them, and the IDs the next
// new stop and route take.
type TaxiNetwork struct {
	Nodes     []TaxiNode  `json:"nodes"`
	Routes    []TaxiRoute `json:"routes"`
	NextNode  uint32      `json:"nextNode"`
	NextRoute uint32      `json:"nextRoute"`
}

// TaxiEdit is what the Flight Paths window saves: stops and routes changed or added (whole, by ID)
// and the IDs of those removed.
type TaxiEdit struct {
	Nodes        []TaxiNode  `json:"nodes"`
	RemoveNodes  []uint32    `json:"removeNodes"`
	Routes       []TaxiRoute `json:"routes"`
	RemoveRoutes []uint32    `json:"removeRoutes"`
}

// LoadTaxiTables reads the client's taxi tables as the game sees them, Meld's patch included.
func LoadTaxiTables(dataDir string) (TaxiTables, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return TaxiTables{}, err
	}
	defer set.Close()
	var t TaxiTables
	for _, f := range []struct {
		to   *[]byte
		path string
	}{{&t.Nodes, TaxiNodesPath}, {&t.Paths, TaxiPathPath}, {&t.Points, TaxiPathNodePath}} {
		if *f.to, err = set.ReadFile(f.path); err != nil {
			return TaxiTables{}, err
		}
	}
	return t, nil
}

// taxiPathTable parses TaxiPath.dbc and checks it has a layout Meld knows.
func taxiPathTable(dbc []byte) (*dbcTable, taxiPathCols, error) {
	t, err := parseExact(dbc, dbcTaxiPath)
	if err != nil {
		return nil, taxiPathCols{}, err
	}
	return t, taxiPathCols{t.col("From"), t.col("To"), t.col("Cost")}, nil
}

type taxiParsed struct {
	nodes, paths, points *dbcTable
	nc                   taxiNodeCols
	pc                   taxiPathCols
	tc                   taxiPointCols
}

func parseTaxi(tt TaxiTables) (taxiParsed, error) {
	var p taxiParsed
	var err error
	if p.nodes, err = parseExact(tt.Nodes, dbcTaxiNodes); err != nil {
		return p, err
	}
	n := p.nodes
	p.nc = taxiNodeCols{n.col("MapID"), n.at("Pos", 0), n.col("Name"), n.mask("Name"), n.col("HordeMount"), n.col("AllianceMount")}
	if p.paths, p.pc, err = taxiPathTable(tt.Paths); err != nil {
		return p, err
	}
	if p.points, err = parseExact(tt.Points, dbcTaxiPathNode); err != nil {
		return p, err
	}
	t := p.points
	p.tc = taxiPointCols{t.col("Path"), t.col("Index"), t.col("MapID"), t.at("Pos", 0), t.col("Flags"), t.col("Delay")}
	return p, nil
}

func (p taxiParsed) node(r int) TaxiNode {
	t, c := p.nodes, p.nc
	return TaxiNode{
		ID: t.u32(r, 0), MapID: t.u32(r, c.mapID), X: t.f32(r, c.pos), Y: t.f32(r, c.pos+1), Z: t.f32(r, c.pos+2),
		Name: t.str(r, c.name), HordeMount: t.u32(r, c.horde), AllianceMount: t.u32(r, c.ally),
	}
}

// path is TaxiPath row r: its ID, its stops and its price.
func (p taxiParsed) path(r int) (id, from, to, cost uint32) {
	t, c := p.paths, p.pc
	return t.u32(r, 0), t.u32(r, c.from), t.u32(r, c.to), t.u32(r, c.cost)
}

// pathRecord is a TaxiPath record.
func (p taxiParsed) pathRecord(id, from, to, cost uint32) []uint32 {
	rec := make([]uint32, p.paths.fields)
	rec[0], rec[p.pc.from], rec[p.pc.to], rec[p.pc.cost] = id, from, to, cost
	return rec
}

// pointRecord is a TaxiPathNode record.
func (p taxiParsed) pointRecord(id, path, index uint32, pt TaxiPoint) []uint32 {
	c, f := p.tc, math.Float32bits
	rec := make([]uint32, p.points.fields)
	rec[0], rec[c.path], rec[c.index], rec[c.mapID] = id, path, index, pt.MapID
	rec[c.pos], rec[c.pos+1], rec[c.pos+2], rec[c.flags], rec[c.delay] = f(pt.X), f(pt.Y), f(pt.Z), pt.Flags, pt.Delay
	return rec
}

// routePoints lists every path's points by path ID, in their index order.
func (p taxiParsed) routePoints() map[uint32][]TaxiPoint {
	type indexed struct {
		index uint32
		pt    TaxiPoint
	}
	by := map[uint32][]indexed{}
	t, c := p.points, p.tc
	for r := 0; r < t.records; r++ {
		path := t.u32(r, c.path)
		by[path] = append(by[path], indexed{t.u32(r, c.index), TaxiPoint{MapID: t.u32(r, c.mapID), X: t.f32(r, c.pos), Y: t.f32(r, c.pos+1), Z: t.f32(r, c.pos+2),
			Flags: t.u32(r, c.flags), Delay: t.u32(r, c.delay)}})
	}
	out := make(map[uint32][]TaxiPoint, len(by))
	for path, list := range by {
		sort.SliceStable(list, func(i, j int) bool { return list[i].index < list[j].index })
		pts := make([]TaxiPoint, len(list))
		for i, x := range list {
			pts[i] = x.pt
		}
		out[path] = pts
	}
	return out
}

// ReadTaxiNetwork lists map mapID's stops by ID and the routes from or to them by ID, and the next
// free IDs: a stop's above the client's and the server's (serverMaxNode, taxi_nodes' highest), a
// route's above the client's.
func ReadTaxiNetwork(tt TaxiTables, mapID, serverMaxNode uint32) (TaxiNetwork, error) {
	p, err := parseTaxi(tt)
	if err != nil {
		return TaxiNetwork{}, err
	}
	net := TaxiNetwork{Nodes: []TaxiNode{}, Routes: []TaxiRoute{}}
	onMap := map[uint32]bool{}
	topNode := serverMaxNode
	for r := 0; r < p.nodes.records; r++ {
		n := p.node(r)
		topNode = max(topNode, n.ID)
		if n.MapID == mapID {
			net.Nodes = append(net.Nodes, n)
			onMap[n.ID] = true
		}
	}
	points := p.routePoints()
	var topRoute uint32
	for r := 0; r < p.paths.records; r++ {
		id, from, to, cost := p.path(r)
		topRoute = max(topRoute, id)
		if !onMap[from] && !onMap[to] {
			continue
		}
		pts := points[id]
		if pts == nil {
			pts = []TaxiPoint{}
		}
		net.Routes = append(net.Routes, TaxiRoute{ID: id, From: from, To: to, Cost: cost, Points: pts})
	}
	sort.Slice(net.Nodes, func(i, j int) bool { return net.Nodes[i].ID < net.Nodes[j].ID })
	sort.Slice(net.Routes, func(i, j int) bool { return net.Routes[i].ID < net.Routes[j].ID })
	net.NextNode = topNode + 1
	net.NextRoute = topRoute + 1
	return net, nil
}

func finite(vs ...float32) bool {
	for _, v := range vs {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return false
		}
	}
	return true
}

func checkTaxiNode(n TaxiNode) error {
	if n.ID == 0 || n.ID > MaxTaxiNode {
		return fmt.Errorf("flight stop %d: the ID must be 1 to %d (the client's taxi mask)", n.ID, MaxTaxiNode)
	}
	if strings.TrimSpace(n.Name) == "" || strings.ContainsRune(n.Name, 0) {
		return fmt.Errorf("flight stop %d needs a name", n.ID)
	}
	if len(n.Name) > 256 {
		return fmt.Errorf("flight stop %d: the name is longer than 256 characters", n.ID)
	}
	if !finite(n.X, n.Y, n.Z) {
		return fmt.Errorf("flight stop %d has a position that is not a number", n.ID)
	}
	if n.HordeMount > 65535 || n.AllianceMount > 65535 {
		return fmt.Errorf("flight stop %d: a mount must be a creature entry up to 65535", n.ID)
	}
	return nil
}

func checkTaxiRoute(r TaxiRoute) error {
	if r.ID == 0 {
		return errors.New("a flight route needs an ID")
	}
	if r.From == r.To && r.From != 0 {
		return fmt.Errorf("flight route %d starts and ends at stop %d", r.ID, r.From)
	}
	if len(r.Points) < 2 {
		return fmt.Errorf("flight route %d needs at least two points", r.ID)
	}
	for _, pt := range r.Points {
		if !finite(pt.X, pt.Y, pt.Z) {
			return fmt.Errorf("flight route %d has a point that is not a number", r.ID)
		}
	}
	return nil
}

// dbcFile is a DBC table of n records of fields 32-bit fields with the string block strs.
func dbcFile(fields, n int, records, strs []byte) []byte {
	out := make([]byte, 0, 20+len(records)+len(strs))
	out = append(out, "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(n))
	out = binary.LittleEndian.AppendUint32(out, uint32(fields))
	out = binary.LittleEndian.AppendUint32(out, uint32(fields*4))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(strs)))
	out = append(out, records...)
	return append(out, strs...)
}

func appendFields(b []byte, fields ...uint32) []byte {
	for _, v := range fields {
		b = binary.LittleEndian.AppendUint32(b, v)
	}
	return b
}

// SetTaxi returns the taxi tables with the stops of nodes and the routes of routes written (each
// replacing the record of its ID, or added at the end when new; a route's points replace all of its
// old ones, numbered from 0) and the stops of removeNodes and the routes of removeRoutes (with their
// points) taken out. It refuses a write that leaves a route at a stop that isn't there, two routes
// between the same stops the same way (the server keeps one), or a stop the client can't mark known.
// A route from stop 0 to stop 0 is a transport's path (#955), which no flight uses.
func SetTaxi(tt TaxiTables, nodes []TaxiNode, removeNodes []uint32, routes []TaxiRoute, removeRoutes []uint32) (TaxiTables, error) {
	p, err := parseTaxi(tt)
	if err != nil {
		return TaxiTables{}, err
	}
	goneNode := map[uint32]bool{}
	for _, id := range removeNodes {
		goneNode[id] = true
	}
	goneRoute := map[uint32]bool{}
	for _, id := range removeRoutes {
		goneRoute[id] = true
	}

	// Stops: edited in place, new ones at the end. A new or renamed name goes at the end of the
	// string block; the old string stays, unused.
	nodeRecs := append([]byte(nil), tt.Nodes[20:p.nodes.strsAt]...)
	strs := append([]byte(nil), tt.Nodes[p.nodes.strsAt:]...)
	nodeAt := map[uint32]int{}
	for r := 0; r < p.nodes.records; r++ {
		nodeAt[p.nodes.u32(r, 0)] = r
	}
	nodeCount := p.nodes.records
	seen := map[uint32]bool{}
	for _, n := range nodes {
		if err := checkTaxiNode(n); err != nil {
			return TaxiTables{}, err
		}
		if goneNode[n.ID] {
			return TaxiTables{}, fmt.Errorf("flight stop %d is both saved and removed", n.ID)
		}
		if seen[n.ID] {
			return TaxiTables{}, fmt.Errorf("flight stop %d is listed twice", n.ID)
		}
		seen[n.ID] = true
		r, ok := nodeAt[n.ID]
		if !ok {
			// A new record starts from the first one's locale mask, with the other locales empty.
			r = nodeCount
			nodeCount++
			nodeAt[n.ID] = r
			rec := make([]uint32, p.nodes.fields)
			if p.nodes.records > 0 {
				rec[p.nc.mask] = p.nodes.u32(0, p.nc.mask)
			}
			nodeRecs = appendFields(nodeRecs, rec...)
		}
		at := r * p.nodes.recSize
		put := func(f int, v uint32) { binary.LittleEndian.PutUint32(nodeRecs[at+f*4:], v) }
		if !ok || r >= p.nodes.records || p.nodes.str(r, p.nc.name) != n.Name || p.nodes.u32(r, p.nc.name) == 0 {
			put(p.nc.name, uint32(len(strs)))
			strs = append(strs, n.Name...)
			strs = append(strs, 0)
		}
		f := math.Float32bits
		put(0, n.ID)
		put(p.nc.mapID, n.MapID)
		put(p.nc.pos, f(n.X))
		put(p.nc.pos+1, f(n.Y))
		put(p.nc.pos+2, f(n.Z))
		put(p.nc.horde, n.HordeMount)
		put(p.nc.ally, n.AllianceMount)
	}
	var keptNodes []byte
	kept := 0
	exists := map[uint32]bool{}
	for r := 0; r < nodeCount; r++ {
		id := binary.LittleEndian.Uint32(nodeRecs[r*p.nodes.recSize:])
		if goneNode[id] {
			continue
		}
		exists[id] = true
		keptNodes = append(keptNodes, nodeRecs[r*p.nodes.recSize:(r+1)*p.nodes.recSize]...)
		kept++
	}
	for id := range goneNode {
		if _, ok := nodeAt[id]; !ok {
			return TaxiTables{}, fmt.Errorf("flight stop %d is not in the table", id)
		}
	}
	outNodes := dbcFile(p.nodes.fields, kept, keptNodes, strs)

	// Routes: edited in place, new ones at the end.
	saved := map[uint32]TaxiRoute{}
	var added []uint32
	for _, r := range routes {
		if err := checkTaxiRoute(r); err != nil {
			return TaxiTables{}, err
		}
		if goneRoute[r.ID] {
			return TaxiTables{}, fmt.Errorf("flight route %d is both saved and removed", r.ID)
		}
		if _, ok := saved[r.ID]; ok {
			return TaxiTables{}, fmt.Errorf("flight route %d is listed twice", r.ID)
		}
		saved[r.ID] = r
		if _, ok := p.paths.row(r.ID); !ok {
			added = append(added, r.ID)
		}
	}
	for id := range goneRoute {
		if _, ok := p.paths.row(id); !ok {
			return TaxiTables{}, fmt.Errorf("flight route %d is not in the table", id)
		}
	}
	var pathRecs []byte
	pathCount := 0
	pairs := map[[2]uint32]uint32{}
	// The client's own table is taken as it is: only a route this write saves, or one at a stop it
	// removes, is checked.
	// A transport's new path (#955) runs from stop 0 to stop 0: it is no flight, and no stop is checked.
	keep := func(id, from, to, cost uint32) error {
		_, edited := saved[id]
		transport := from == 0 && to == 0
		for _, stop := range []uint32{from, to} {
			if !transport && (goneNode[stop] || (edited && !exists[stop])) {
				return fmt.Errorf("flight route %d uses stop %d, which is not in the table: remove the route too", id, stop)
			}
		}
		pair := [2]uint32{from, to}
		if other, ok := pairs[pair]; ok && !transport {
			if _, otherEdited := saved[other]; edited || otherEdited {
				return fmt.Errorf("flight routes %d and %d both fly from stop %d to %d: the server keeps one", other, id, from, to)
			}
		}
		pairs[pair] = id
		pathRecs = appendFields(pathRecs, p.pathRecord(id, from, to, cost)...)
		pathCount++
		return nil
	}
	for r := 0; r < p.paths.records; r++ {
		id, from, to, cost := p.path(r)
		if goneRoute[id] {
			continue
		}
		if s, ok := saved[id]; ok {
			from, to, cost = s.From, s.To, s.Cost
		}
		if err := keep(id, from, to, cost); err != nil {
			return TaxiTables{}, err
		}
	}
	for _, id := range added {
		s := saved[id]
		if err := keep(id, s.From, s.To, s.Cost); err != nil {
			return TaxiTables{}, err
		}
	}
	outPaths := dbcFile(p.paths.fields, pathCount, pathRecs, tt.Paths[p.paths.strsAt:])

	// Points: a saved or removed route's old points go; a saved route's new ones are added at the
	// end, reusing its old IDs first, then IDs past the table's highest.
	var pointRecs []byte
	pointCount := 0
	var topPoint uint32
	reuse := map[uint32][]uint32{}
	for r := 0; r < p.points.records; r++ {
		id, path := p.points.u32(r, 0), p.points.u32(r, p.tc.path)
		topPoint = max(topPoint, id)
		if _, ok := saved[path]; ok {
			reuse[path] = append(reuse[path], id)
			continue
		}
		if goneRoute[path] {
			continue
		}
		pointRecs = append(pointRecs, tt.Points[20+r*p.points.recSize:20+(r+1)*p.points.recSize]...)
		pointCount++
	}
	order := make([]uint32, 0, len(saved))
	for id := range saved {
		order = append(order, id)
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })
	for _, path := range order {
		ids := reuse[path]
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		for i, pt := range saved[path].Points {
			var id uint32
			if i < len(ids) {
				id = ids[i]
			} else {
				topPoint++
				id = topPoint
			}
			pointRecs = appendFields(pointRecs, p.pointRecord(id, path, uint32(i), pt)...)
			pointCount++
		}
	}
	outPoints := dbcFile(p.points.fields, pointCount, pointRecs, tt.Points[p.points.strsAt:])
	return TaxiTables{Nodes: outNodes, Paths: outPaths, Points: outPoints}, nil
}

// TaxiSQL writes the stops of nodes into the world database's taxi_nodes (a row for build 5875,
// which the server takes over older builds' rows) and takes the stops of removeNodes out of it and
// of locales_taxi_node, and the routes of removeRoutes out of taxi_path_transitions. No transaction
// of its own: runScript wraps the script in one.
func TaxiSQL(nodes []TaxiNode, removeNodes, removeRoutes []uint32) string {
	var b strings.Builder
	ids := func(list []uint32) string {
		s := make([]string, len(list))
		for i, v := range list {
			s[i] = strconv.FormatUint(uint64(v), 10)
		}
		return strings.Join(s, ", ")
	}
	if len(removeNodes) > 0 {
		in := ids(removeNodes)
		fmt.Fprintf(&b, "DELETE FROM `taxi_nodes` WHERE `id` IN (%s);\nDELETE FROM `locales_taxi_node` WHERE `entry` IN (%s);\n", in, in)
	}
	if len(removeRoutes) > 0 {
		in := ids(removeRoutes)
		fmt.Fprintf(&b, "DELETE FROM `taxi_path_transitions` WHERE `in_path` IN (%s) OR `out_path` IN (%s);\n", in, in)
	}
	for _, n := range nodes {
		fmt.Fprintf(&b, "REPLACE INTO `taxi_nodes` (`id`, `build`, `map_id`, `x`, `y`, `z`, `name`, `mount_creature_id1`, `mount_creature_id2`) VALUES (%d, %d, %d, %s, %s, %s, %s, %d, %d);\n",
			n.ID, taxiBuild, n.MapID, num32(n.X), num32(n.Y), num32(n.Z), sqlQuote(n.Name), n.HordeMount, n.AllianceMount)
	}
	return b.String()
}

// ServerTaxiMax is the world database's highest taxi_nodes ID, so a new stop's ID is free on the
// server too.
func ServerTaxiMax(serverRoot string) (uint32, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return 0, err
	}
	raw, err := runSQL(db, "SELECT COALESCE(MAX(`id`), 0) FROM `taxi_nodes`")
	if err != nil {
		return 0, err
	}
	return atou(string(raw)), nil
}

// InstallServerTaxi copies the route tables (and TaxiNodes.dbc, which the server doesn't read, so its
// copy stays the client's) into the server's data, keeping the first copy of each it replaces as a
// backup. It returns the folder written.
func InstallServerTaxi(serverDir string, tt TaxiTables) (string, error) {
	for _, f := range []struct {
		name string
		data []byte
	}{{"TaxiNodes.dbc", tt.Nodes}, {"TaxiPath.dbc", tt.Paths}, {"TaxiPathNode.dbc", tt.Points}} {
		if _, err := installServerDBC(serverDir, f.name, f.data); err != nil {
			return "", err
		}
	}
	return filepath.Join(serverDir, "data", "5875", "dbc"), nil
}

// installServerDBC writes a DBC table into the server's data (data/5875/dbc), keeping the first copy
// it replaces as a backup.
func installServerDBC(serverDir, name string, dbc []byte) (string, error) {
	if err := CheckServer(serverDir); err != nil {
		return "", err
	}
	dir := filepath.Join(serverDir, "data", "5875", "dbc")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(dir, name)
	if err := checkFree(target); err != nil {
		return "", err
	}
	if _, err := os.Stat(target); err == nil {
		if err := backup(target, target+BackupSuffix); err != nil {
			return "", err
		}
	}
	tmp := target + ".tmp"
	if err := writeSynced(tmp, dbc); err != nil {
		return "", err
	}
	if err := replaceFile(tmp, target); err != nil {
		return "", err
	}
	return target, nil
}
