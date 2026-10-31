package vmangos

import (
	"fmt"
	"sort"
)

// Boats and zeppelins (#954). VMaNGOS makes every gameobject_template of type 15 (MO_TRANSPORT) a
// transport (TransportMgr::LoadTransportTemplates): its data0 is the taxi path it sails
// (TaxiPathNode.dbc's points, read through the same tables as the flight paths), data1 its speed in
// yards a second and data2 its acceleration. The `transports` table only overrides the period (the
// milliseconds of a full round trip) the server works out, with the row of the highest build up to
// 5875. A route can cross maps: the boat from Menethil to Theramore sails on map 0, then on map 1.

// objectTypeTransport is gameobject_template's type of a boat or zeppelin (GAMEOBJECT_TYPE_MO_TRANSPORT).
const objectTypeTransport = 15

// transportBuild is the client build whose `transports` rows the server reads (SUPPORTED_CLIENT_BUILD).
const transportBuild = 5875

// TransportLeg is a stretch of a transport's route on one map, the points it sails through in order
// as the server keys them (GenerateWaypoints): a point with flags 2 is a dock, waited at for its delay
// in seconds. After a leg's last point the transport jumps to the next leg's first, on another map
// (or, after the last leg, back to the first).
type TransportLeg struct {
	MapID  uint32      `json:"mapId"`
	Points []TaxiPoint `json:"points"`
}

// Transport is a boat or zeppelin: its game object, the taxi path it sails, its speed and the legs of
// its route.
type Transport struct {
	Entry uint32 `json:"entry"`
	// Name is the `transports` row's ("Menethil Harbor and Theramore Isle"), Object the template's
	// ("Proudmore's Treasure").
	Name   string `json:"name"`
	Object string `json:"object"`
	// Period is the `transports` row's round trip in milliseconds, 0 when it has none (the server then
	// keeps the one it works out).
	Period    uint32  `json:"period"`
	PathID    uint32  `json:"pathId"`
	Speed     float32 `json:"speed"`
	Accel     float32 `json:"accel"`
	DisplayID uint32  `json:"displayId"`
	// Model is the display's model path (GameObjectDisplayInfo.dbc), "" when the client has none.
	Model string         `json:"model"`
	Size  float32        `json:"size"`
	Legs  []TransportLeg `json:"legs"`
}

// TransportLegs splits a taxi path's points into the legs the server sails, as GenerateWaypoints keys
// them: the first and last points only shape the curve's ends and are left out; a point whose action
// flag has bit 1 or whose next point is on another map ends a leg, and the point after it (the first
// on the new map) is left out too. Nil when the path has too few points for the server to use it.
func TransportLegs(points []TaxiPoint) []TransportLeg {
	if len(points) < 3 {
		return nil
	}
	var legs []TransportLeg
	var cur []TaxiPoint
	end := func() {
		if len(cur) > 0 {
			legs = append(legs, TransportLeg{MapID: cur[0].MapID, Points: cur})
			cur = nil
		}
	}
	skip := false
	for i := 1; i < len(points)-1; i++ {
		if skip {
			skip = false
			continue
		}
		p := points[i]
		if p.Flags&1 != 0 || p.MapID != points[i+1].MapID {
			end()
			skip = true
			continue
		}
		if len(cur) > 0 && cur[0].MapID != p.MapID {
			end()
		}
		cur = append(cur, p)
	}
	end()
	return legs
}

// transportsSQL selects every type 15 template (its newest patch) with its `transports` row of the
// highest build up to 5875, if any: entry, the row's name, period, the template's name, path, speed,
// acceleration, display and size.
var transportsSQL = fmt.Sprintf("SELECT t.entry, %s, COALESCE(r.period, 0), %s, t.data0, t.data1, t.data2, t.displayId, t.size FROM %s "+
	"LEFT JOIN (SELECT x.entry, x.name, x.period FROM transports x JOIN (SELECT entry, MAX(build) AS build FROM transports WHERE build <= %d GROUP BY entry) b "+
	"ON b.entry = x.entry AND b.build = x.build) r ON r.entry = t.entry WHERE t.type = %d ORDER BY t.entry",
	labelCol("COALESCE(r.name, '')"), labelCol("t.name"), newestObjects, transportBuild, objectTypeTransport)

// readTransports lists the transports of the world database's rows (transportsSQL's) whose route has a
// leg on map mapID, with their legs from the taxi tables and their models from model (a display's
// path, "" for none). A transport whose path the tables lack is left out, as the server leaves it.
func readTransports(raw []byte, tt TaxiTables, mapID uint32, model func(uint32) string) ([]Transport, error) {
	p, err := parseTaxi(tt)
	if err != nil {
		return nil, err
	}
	points := p.routePoints()
	out := []Transport{}
	for _, f := range batchRows(raw, 9) {
		t := Transport{Entry: f.u32(0), Name: f[1], Period: f.u32(2), Object: f[3], PathID: f.u32(4), Speed: f.f32(5), Accel: f.f32(6), DisplayID: f.u32(7), Size: f.f32(8)}
		t.Legs = TransportLegs(points[t.PathID])
		here := false
		for _, l := range t.Legs {
			here = here || l.MapID == mapID
		}
		if !here {
			continue
		}
		if t.Name == "" {
			t.Name = t.Object
		}
		t.Model = model(t.DisplayID)
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// ReadTransports lists the boats and zeppelins whose route has a leg on map mapID: the world
// database's type 15 game objects and `transports` rows, their routes from the taxi tables tt (the
// client's as the game sees them) and their models from dataDir's display table.
func ReadTransports(serverRoot, dataDir string, tt TaxiTables, mapID uint32) ([]Transport, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, transportsSQL)
	if err != nil {
		return nil, err
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	return readTransports(raw, tt, mapID, tables.objectModel)
}
