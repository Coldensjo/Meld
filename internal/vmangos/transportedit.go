package vmangos

import (
	"errors"
	"fmt"
	"strings"
)

// Making and editing boats and zeppelins (#955). A transport is three things the server reads when it
// starts (there is no reload): its gameobject_template row of type 15 (data0 the taxi path, data1 the
// speed in yards a second, data2 the acceleration), its `transports` row (the name and the period,
// which must be the client's, TransportPeriod) and its path in TaxiPath.dbc and TaxiPathNode.dbc,
// which the client reads too: it sails the boat from its own copy of the path. A new path runs from
// stop 0 to stop 0 in TaxiPath.dbc, since no flight uses it (the client's own run between its
// "Transport, ..." stops, which keep theirs when edited).

// transportFlags is the flags of the client's own transports' templates: 0x20 (no despawn) and 0x08
// (transport).
const transportFlags = 0x28

// maxTransportPeriod is the largest period the `transports` table holds (a MEDIUMINT UNSIGNED).
const maxTransportPeriod = 1<<24 - 1

// TransportEdit is what World › Transports saves: the template's entry and name, its model (a
// display) and size, its speed and acceleration (whole numbers: the template holds integers), the
// `transports` row's name, and the taxi path's ID and its points in order, on one map or several.
type TransportEdit struct {
	Entry     uint32      `json:"entry"`
	Name      string      `json:"name"`
	Object    string      `json:"object"`
	DisplayID uint32      `json:"displayId"`
	Size      float32     `json:"size"`
	Speed     uint32      `json:"speed"`
	Accel     uint32      `json:"accel"`
	PathID    uint32      `json:"pathId"`
	Points    []TaxiPoint `json:"points"`
}

// TransportIDs are the entry and path ID a new transport takes.
type TransportIDs struct {
	Entry  uint32 `json:"entry"`
	PathID uint32 `json:"pathId"`
}

// CheckTransport refuses an edit the server would not start with or the client could not sail:
// every leg of the route (TransportLegs) needs at least two points it sails through, a route over
// several maps may only cross continents (instanced says whether a map is an instance: the server
// stops on such a route), and the speed and acceleration must be above 0. It returns the client's
// period of the route.
func CheckTransport(e TransportEdit, instanced func(uint32) bool) (uint32, error) {
	if e.Entry == 0 || e.Entry > 1<<24-1 {
		return 0, fmt.Errorf("transport %d: the entry must be 1 to %d", e.Entry, 1<<24-1)
	}
	if e.PathID == 0 {
		return 0, errors.New("the transport needs a path ID")
	}
	if strings.TrimSpace(e.Name) == "" || strings.TrimSpace(e.Object) == "" {
		return 0, errors.New("the transport needs a name and its object a name")
	}
	if len(e.Object) > 100 {
		return 0, errors.New("the object's name is longer than 100 characters")
	}
	if e.DisplayID == 0 || e.DisplayID > 1<<24-1 {
		return 0, errors.New("the transport needs a model (a game object display)")
	}
	if !(e.Size > 0) || !finite(e.Size) {
		return 0, errors.New("the transport's size must be above 0")
	}
	if e.Speed == 0 || e.Accel == 0 || e.Speed > 1000 || e.Accel > 1000 {
		return 0, errors.New("the speed and the acceleration must be 1 to 1000")
	}
	maps := map[uint32]bool{}
	for _, p := range e.Points {
		if !finite(p.X, p.Y, p.Z) {
			return 0, errors.New("the route has a point that is not a number")
		}
		if p.Flags > 3 {
			return 0, fmt.Errorf("a route point has flags %d: only 1 (a jump) and 2 (a dock) are known", p.Flags)
		}
		maps[p.MapID] = true
	}
	legs := TransportLegs(e.Points)
	if len(legs) == 0 {
		return 0, errors.New("the route needs at least four points: the first and the last only shape the curve")
	}
	for _, l := range legs {
		if len(l.Points) < 2 {
			return 0, fmt.Errorf("the route's stretch on map %d sails through %d point: it needs two, besides the points either side of a map change", l.MapID, len(l.Points))
		}
	}
	if len(maps) > 1 {
		for m := range maps {
			if instanced(m) {
				return 0, fmt.Errorf("the route crosses into map %d, an instance: a route over several maps may only cross continents", m)
			}
		}
	}
	period, ok := TransportPeriod(e.Points, float32(e.Speed), float32(e.Accel))
	if !ok || period == 0 {
		return 0, errors.New("the route's round trip can't be worked out")
	}
	if period > maxTransportPeriod {
		return 0, fmt.Errorf("the round trip takes %d s, longer than the transports table holds (%d s)", period/1000, maxTransportPeriod/1000)
	}
	return period, nil
}

// SetTransportPath returns the taxi tables with path pathID's points replaced by points, the path
// added (from stop 0 to stop 0) when the tables lack it.
func SetTransportPath(tt TaxiTables, pathID uint32, points []TaxiPoint) (TaxiTables, error) {
	p, err := parseTaxi(tt)
	if err != nil {
		return TaxiTables{}, err
	}
	r := TaxiRoute{ID: pathID, Points: points}
	if row, ok := p.paths.row(pathID); ok {
		r.From, r.To, r.Cost = p.paths.u32(row, 1), p.paths.u32(row, 2), p.paths.u32(row, 3)
	}
	return SetTaxi(tt, nil, nil, []TaxiRoute{r}, nil)
}

// NextTaxiPath is the ID past the taxi tables' highest path.
func NextTaxiPath(tt TaxiTables) (uint32, error) {
	p, err := parseTaxi(tt)
	if err != nil {
		return 0, err
	}
	var top uint32
	for r := 0; r < p.paths.records; r++ {
		top = max(top, p.paths.u32(r, 0))
	}
	for r := 0; r < p.points.records; r++ {
		top = max(top, p.points.u32(r, 1))
	}
	return top + 1, nil
}

// TransportSQL writes transport e into the world database: a new entry gets a template row of type
// 15 (patch 0, the client's transports' flags), then every patch row of the entry takes the model,
// name, size, path, speed and acceleration, and the `transports` row of build 5875 (which the server
// takes over older builds' rows) the name and period. No transaction of its own: runScript wraps the
// script in one.
func TransportSQL(e TransportEdit, period uint32) (string, error) {
	name, err := templateName(e.Object)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "INSERT IGNORE INTO `gameobject_template` (`entry`, `patch`, `type`, `displayId`, `name`, `flags`, `size`, `data0`, `data1`, `data2`) VALUES (%d, 0, %d, %d, %s, %d, %s, %d, %d, %d);\n",
		e.Entry, objectTypeTransport, e.DisplayID, name, transportFlags, num32(e.Size), e.PathID, e.Speed, e.Accel)
	fmt.Fprintf(&b, "UPDATE `gameobject_template` SET `displayId` = %d, `name` = %s, `size` = %s, `data0` = %d, `data1` = %d, `data2` = %d WHERE `entry` = %d AND `type` = %d;\n",
		e.DisplayID, name, num32(e.Size), e.PathID, e.Speed, e.Accel, e.Entry, objectTypeTransport)
	fmt.Fprintf(&b, "REPLACE INTO `transports` (`entry`, `build`, `name`, `period`) VALUES (%d, %d, %s, %d);\n", e.Entry, transportBuild, sqlQuote(e.Name), period)
	return b.String(), nil
}

// NextTransportEntry is the world database's first free game object entry.
func NextTransportEntry(serverRoot string) (uint32, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return 0, err
	}
	raw, err := runSQL(db, "SELECT COALESCE(MAX(`entry`), 0) + 1 FROM `gameobject_template`")
	if err != nil {
		return 0, err
	}
	return atou(strings.TrimSpace(string(raw))), nil
}

// TransportEntryFree says whether entry may be saved as a transport: it is no game object yet, or a
// transport (type 15) already.
func TransportEntryFree(serverRoot string, entry uint32) (bool, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return false, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT COALESCE((SELECT `type` FROM `gameobject_template` WHERE `entry` = %d ORDER BY `patch` DESC LIMIT 1), %d)", entry, objectTypeTransport))
	if err != nil {
		return false, err
	}
	return atou(strings.TrimSpace(string(raw))) == objectTypeTransport, nil
}

// ForgetObjectTemplates drops the cached game object lists and displays, after SaveTransport wrote a
// template.
func ForgetObjectTemplates() {
	forgetObjectTemplates()
}
