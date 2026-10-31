package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// LiquidTypes lists the client's LiquidType.dbc rows: every liquid it knows, for the Water tool.
func (a *App) LiquidTypes() ([]vmangos.LiquidTypeEntry, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadLiquidTypes(dataDir)
}

// GroundEffects reads the client's ground effect tables (the grass tufts each texture grows). The
// first call for a client learns the texture-to-effect pairs from its tiles, which takes a while;
// progress goes out as "effects:log" events, and the result is cached in the user's cache dir.
func (a *App) GroundEffects() (*vmangos.GroundEffectTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadGroundEffects(dataDir, cacheDir, func(line string) { a.emit("effects:log", line) })
}

// AddGroundEffect writes a new ground effect (GroundEffectTexture row) growing the given detail models
// into the client's patch, with the game closed around it on Windows, and returns its ID.
func (a *App) AddGroundEffect(doodads []string, density, terrain uint32) (uint32, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return 0, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return 0, err
	}
	doodadDBC, err := set.ReadFile(`DBFilesClient\GroundEffectDoodad.dbc`)
	if err == nil {
		var textureDBC []byte
		if textureDBC, err = set.ReadFile(`DBFilesClient\GroundEffectTexture.dbc`); err == nil {
			set.Close()
			out, id, err := vmangos.AddGroundEffect(doodadDBC, textureDBC, doodads, density, terrain)
			if err != nil {
				return 0, err
			}
			_, err = a.installClientFiles(dataDir, []mpq.File{{Name: `DBFilesClient\GroundEffectTexture.dbc`, Data: out}})
			return id, err
		}
	}
	set.Close()
	return 0, err
}

// MapEntries lists the maps the client knows (continents, dungeons, raids, battlegrounds, arenas), so
// the New Map dialog can offer their IDs.
func (a *App) MapEntries() ([]vmangos.MapEntry, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadMapEntries(dataDir)
}

// MapZones lists the client's named zones as tile rectangles, so a part of a continent can be picked by
// name.
func (a *App) MapZones() ([]vmangos.Zone, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadZones(dataDir)
}

// ZoneTextures lists the ground textures a zone's own tiles use, by share of its ground, for the New
// world page's texture packs (#733). mapDir is the zone's map folder (Map.dbc's directory).
func (a *App) ZoneTextures(mapDir string, zone vmangos.Zone) ([]vmangos.TextureUse, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadZoneTextures(dataDir, mapDir, zone)
}

// ZoneDoodads lists the models a zone's own tiles place on its dry ground, by count, and that
// ground's area, for the trees, bushes and rocks the New world page scatters (#758).
func (a *App) ZoneDoodads(mapDir string, zone vmangos.Zone) (vmangos.ZoneDoodadList, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ZoneDoodadList{}, err
	}
	return vmangos.ReadZoneDoodads(dataDir, mapDir, zone)
}

// WMODoodadSets names a WMO's doodad sets, by index (set 0 is the global set), for the Inspector's
// doodad set choice.
func (a *App) WMODoodadSets(path string) ([]string, error) {
	return a.wow.WMODoodadSets(path)
}

// Areas lists the client's zones and subzones (AreaTable.dbc), which the Map data tool paints into
// chunks by ID.
func (a *App) Areas() ([]vmangos.Area, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadAreas(dataDir)
}

// ReadWorldMap reads the client's world map of a zone (WorldMapArea.dbc's row of the map and area, and
// its art), for World › World Map (#181); a view without a row when the zone has none.
func (a *App) ReadWorldMap(mapID, areaID uint32) (*vmangos.WorldMapView, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadWorldMap(dataDir, mapID, areaID)
}

// WorldMapResult is what Write World Map wrote: the row (with its ID), the overlays (with theirs,
// without pictures) and the patch.
type WorldMapResult struct {
	Row      vmangos.WorldMapRow       `json:"row"`
	Overlays []vmangos.WorldMapOverlay `json:"overlays"`
	Patch    string                    `json:"patch"`
}

// WriteWorldMap writes a zone's world map into the client's patch: its twelve art tiles, its
// WorldMapArea.dbc row and its exploration overlays (WorldMapOverlay.dbc rows and their art, #219),
// with the game closed around it.
func (a *App) WriteWorldMap(spec vmangos.WorldMapSpec) (WorldMapResult, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return WorldMapResult{}, err
	}
	files, row, overlays, err := vmangos.WorldMapFiles(dataDir, spec)
	if err != nil {
		return WorldMapResult{}, err
	}
	patch, err := a.installClientFiles(dataDir, files)
	return WorldMapResult{Row: row, Overlays: overlays, Patch: patch}, err
}

// MapLights reads a map's lights from the client's Light tables, for the preview's client lighting.
func (a *App) MapLights(mapID uint32) (*vmangos.MapLights, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadMapLights(dataDir, mapID)
}

// LightIDs are the IDs a new light and its params row take (see vmangos.NewLightIDs).
type LightIDs struct {
	Light  uint32 `json:"light"`
	Params uint32 `json:"params"`
}

// NewLightIDs gives the light editor the IDs for a new light; nothing is written until SaveLights.
func (a *App) NewLightIDs() (LightIDs, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return LightIDs{}, err
	}
	tables, err := vmangos.LoadLightTables(dataDir)
	if err != nil {
		return LightIDs{}, err
	}
	l, p, err := vmangos.NewLightIDs(tables[0], tables[1])
	return LightIDs{Light: l, Params: p}, err
}

// SaveLights writes the light editor's lights and params into the client's light tables in Meld's
// patch (only the tables that changed; the game closed around it on Windows). Returns the
// patch's path, or "" when nothing changed. The server doesn't read the lights.
func (a *App) SaveLights(edit vmangos.LightsEdit) (string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return "", err
	}
	tables, err := vmangos.LoadLightTables(dataDir)
	if err != nil {
		return "", err
	}
	out, err := vmangos.WriteLights(tables, edit)
	if err != nil {
		return "", err
	}
	files := vmangos.LightFiles(tables, out)
	if len(files) == 0 {
		return "", nil
	}
	return a.installClientFiles(dataDir, files)
}

var lightsFilters = []fileFilter{{DisplayName: "Meld lights (*.json)", Pattern: "*.json"}}

// ExportLights asks where to save a lights file of the light editor's lights and their params (#945) and
// writes it there. Returns the path, or "" if cancelled.
func (a *App) ExportLights(edit vmangos.LightsEdit, suggested string) (string, error) {
	b, err := vmangos.MarshalLightsFile(edit)
	if err != nil {
		return "", err
	}
	if suggested == "" {
		suggested = "lights"
	}
	path, err := a.saveFile(dialogOptions{Title: "Export Lights", DefaultFilename: suggested + ".json", Filters: lightsFilters})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, b, 0o644)
}

// ImportLights asks for a lights file and reads it, for the light editor to load as unsaved changes;
// nothing is written to the client. Returns nil if cancelled.
func (a *App) ImportLights() (*vmangos.LightsEdit, error) {
	path, err := a.openFile(dialogOptions{Title: "Import Lights", Filters: lightsFilters})
	if err != nil || path == "" {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	e, err := vmangos.ParseLightsFile(b)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// LoadingScreens lists the client's loading screens, which a map made for the client may show.
func (a *App) LoadingScreens() ([]vmangos.LoadingScreen, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadLoadingScreens(dataDir)
}

// LoadingScreenResult is what Write Loading Screen wrote: the LoadingScreens.dbc row and the patch.
type LoadingScreenResult struct {
	Row   vmangos.LoadingScreen `json:"row"`
	Patch string                `json:"patch"`
}

// WriteLoadingScreen writes a map's own loading screen into the client's patch (#218): the picture as
// a BLP, its LoadingScreens.dbc row and, when the client has the map already, its Map.dbc row pointing
// at it, with the game closed around it.
func (a *App) WriteLoadingScreen(spec vmangos.LoadingScreenSpec) (LoadingScreenResult, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return LoadingScreenResult{}, err
	}
	files, row, err := vmangos.LoadingScreenFiles(dataDir, spec)
	if err != nil {
		return LoadingScreenResult{}, err
	}
	patch, err := a.installClientFiles(dataDir, files)
	return LoadingScreenResult{Row: row, Patch: patch}, err
}

// AreaRows lists a map's zones and subzones from the client's AreaTable.dbc, for the zone editor.
func (a *App) AreaRows(mapID uint32) ([]vmangos.AreaRow, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return nil, err
	}
	return vmangos.ReadAreaRows(dbc, mapID)
}

// NewAreaRow is a new zone (parent 0) or subzone on a map, with a free ID and exploration bit. It is
// not written until SaveAreas.
func (a *App) NewAreaRow(mapID, parent uint32) (vmangos.AreaRow, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.AreaRow{}, err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return vmangos.AreaRow{}, err
	}
	return vmangos.NewAreaRow(dbc, mapID, parent)
}

// AreaSaveResult says where the zone editor's rows went: the client's patch, and whether the
// server's world database (area_template) took them too. Waiting says the patch's files wait for the
// game to close, and Restart that the world server runs and reads them only at its start, so the
// author restarts it: Meld restarts nothing (#661).
type AreaSaveResult struct {
	Patch   string `json:"patch"`
	Server  bool   `json:"server"`
	Waiting bool   `json:"waiting"`
	Restart bool   `json:"restart"`
}

// ZoneWeatherList is every zone's weather from the world database's game_weather, and whether a
// server folder is set to read it from (without one, Zones is empty and the weather can't be edited).
type ZoneWeatherList struct {
	Server bool                  `json:"server"`
	Zones  []vmangos.ZoneWeather `json:"zones"`
}

// ZoneWeather reads every zone's weather chances for the zone editor (#185).
func (a *App) ZoneWeather() (ZoneWeatherList, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if !hasDB(server) {
		return ZoneWeatherList{}, nil
	}
	zones, err := vmangos.ReadWeather(server)
	return ZoneWeatherList{Server: true, Zones: zones}, err
}

// applySQL runs script in the server's world database.
func (a *App) applySQL(server, script string) error {
	if a.runSQL != nil {
		return a.runSQL(server, script)
	}
	return vmangos.ApplySQL(server, script)
}

// afterDatabase is the error of a client write that failed once the world database already held the
// save (what names it), so the user knows the server and the client disagree until a Save again (#477).
func afterDatabase(what string, err error) error {
	return fmt.Errorf("%s saved in the world database, but writing them into the client's patch failed (Save again to retry): %w", what, err)
}

// SaveAreas writes the zone editor's rows into the client's AreaTable.dbc (in Meld's patch) and,
// with a server folder set, into the world database's area_template, which the server reads areas
// from, with the zones' weather into game_weather. Nothing is closed or restarted (#661): the server
// reads area_template only at its start, so the result says when to restart it.
func (a *App) SaveAreas(rows []vmangos.AreaRow, weather []vmangos.ZoneWeather) (AreaSaveResult, error) {
	var res AreaSaveResult
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return res, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetAreaRows(dbc, rows)
	if err != nil {
		return res, err
	}
	weatherSQL, err := vmangos.WeatherSQL(weather)
	if err != nil {
		return res, err
	}
	if !hasDB(server) && len(weather) > 0 {
		return res, errors.New("the weather is the server's: set the VMaNGOS server folder first")
	}
	if hasDB(server) {
		if err := a.applySQL(server, vmangos.AreaSQL(rows)+weatherSQL); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		res.Server = true
		res.Restart = len(rows) > 0 && a.worldRunning()
		if len(weather) > 0 {
			a.reloadWorld("SaveWeather")
		}
	}
	if len(rows) > 0 && !bytes.Equal(out, dbc) {
		if res.Patch, res.Waiting, err = a.installClient(dataDir, []mpq.File{{Name: vmangos.AreaTablePath, Data: out}}, nil); err != nil {
			if res.Server {
				err = afterDatabase("the zones are", err)
			}
			return res, err
		}
	}
	return res, nil
}

// ExportAreas asks where to save an SQL script of a map's zones and writes it there (#942): the areas
// of ids (all of the map's when empty) as the client has them, and with a server folder set their
// zones' weather. Returns the path, or "" if cancelled.
func (a *App) ExportAreas(mapID uint32, ids []uint32, suggested string) (string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return "", err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return "", err
	}
	all, err := vmangos.ReadAreaRows(dbc, mapID)
	if err != nil {
		return "", err
	}
	rows := all
	if len(ids) > 0 {
		want := map[uint32]bool{}
		for _, id := range ids {
			want[id] = true
		}
		rows = nil
		for _, r := range all {
			if want[r.ID] {
				rows = append(rows, r)
			}
		}
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	var weather []vmangos.ZoneWeather
	if hasDB(server) {
		if weather, err = vmangos.ReadWeather(server); err != nil {
			return "", fmt.Errorf("the server's weather: %w", err)
		}
	}
	mapName := ""
	if maps, err := vmangos.LoadMapEntries(dataDir); err == nil {
		for _, m := range maps {
			if m.ID == mapID {
				mapName = m.Name
			}
		}
	}
	script, err := vmangos.AreaScript(rows, weather, hasDB(server), mapName, time.Now())
	if err != nil {
		return "", err
	}
	if suggested == "" {
		suggested = "zones"
	}
	path, err := a.saveFile(dialogOptions{Title: "Export Zones", DefaultFilename: suggested + ".sql", Filters: sqlFilters})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, []byte(script), 0o644)
}

// OpenAreasDialog asks for an SQL script of zones to import. Returns "" if cancelled.
func (a *App) OpenAreasDialog() (string, error) {
	return a.openFile(dialogOptions{Title: "Import Zones", Filters: sqlFilters})
}

// planAreaImport reads the zones script at path and plans its import into the client and, when
// server has a database, the server.
func (a *App) planAreaImport(server, path string) (vmangos.AreaImport, []vmangos.AreaRow, []vmangos.ZoneWeather, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.AreaImport{}, nil, nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return vmangos.AreaImport{}, nil, nil, err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return vmangos.AreaImport{}, nil, nil, err
	}
	return vmangos.PlanAreaImport(dbc, string(b), vmangos.LoadAreaRefs(dataDir), hasDB(server))
}

// PlanAreaImport says what importing the zones of the SQL script at path would write: which areas
// are new and which replace one of this client's, the exploration bits that move, the weather, and
// the maps, zones, sounds and lights this client lacks.
func (a *App) PlanAreaImport(path string) (vmangos.AreaImport, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	plan, _, _, err := a.planAreaImport(server, path)
	return plan, err
}

// AreaImportResult is what ImportAreas wrote: Save's result (AreaSaveResult's fields), and how many
// areas on which maps.
type AreaImportResult struct {
	Patch   string   `json:"patch"`
	Server  bool     `json:"server"`
	Waiting bool     `json:"waiting"`
	Restart bool     `json:"restart"`
	Areas   int      `json:"areas"`
	Maps    []uint32 `json:"maps"`
	Weather int      `json:"weather"`
}

// ImportAreas writes the zones of the SQL script at path as Save writes the dialog's (SaveAreas): the
// areas into the client's AreaTable.dbc and the server's area_template, and their zones' weather into
// game_weather. Nothing is written while the plan refuses the script.
func (a *App) ImportAreas(path string) (AreaImportResult, error) {
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return AreaImportResult{}, err
	}
	plan, rows, weather, err := a.planAreaImport(server, path)
	if err != nil {
		return AreaImportResult{}, err
	}
	if len(plan.Refused) > 0 {
		return AreaImportResult{}, fmt.Errorf("the zones are not imported: %s", strings.Join(plan.Refused, "; "))
	}
	res, err := a.SaveAreas(rows, weather)
	return AreaImportResult{Patch: res.Patch, Server: res.Server, Waiting: res.Waiting, Restart: res.Restart, Areas: len(rows), Maps: plan.Maps, Weather: len(weather)}, err
}

// AreaTriggerList is a map's area triggers with the server's names and teleports, and the ID a new
// trigger takes.
type AreaTriggerList struct {
	Triggers []vmangos.AreaTrigger `json:"triggers"`
	NextID   uint32                `json:"nextId"`
}

// AreaTriggers lists the area triggers of map mapID from the client's AreaTrigger.dbc, with their
// names and teleports from the world database when a server folder is set (the Portals dialog).
func (a *App) AreaTriggers(mapID uint32) (AreaTriggerList, error) {
	var res AreaTriggerList
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadAreaTriggerTable(dataDir)
	if err != nil {
		return res, err
	}
	if res.Triggers, err = vmangos.ReadAreaTriggers(dbc, mapID); err != nil {
		return res, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	var top uint32
	if hasDB(server) {
		if top, err = vmangos.TriggerExtras(server, res.Triggers); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
	}
	res.NextID, err = vmangos.NewAreaTriggerID(dbc, top)
	return res, err
}

// SaveAreaTriggers writes the Portals dialog's changed triggers (rows) and removed ones (remove, by
// ID) into the client's AreaTrigger.dbc in Meld's patch and into the world database's
// areatrigger_template and areatrigger_teleport, which the server reads. Nothing is closed or
// restarted (#661): the server reads areatrigger_template only at its start, so the result says when
// to restart it.
func (a *App) SaveAreaTriggers(rows []vmangos.AreaTrigger, remove []uint32) (AreaSaveResult, error) {
	var res AreaSaveResult
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return res, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadAreaTriggerTable(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetAreaTriggers(dbc, rows, remove)
	if err != nil {
		return res, err
	}
	if hasDB(server) {
		if err := a.applySQL(server, vmangos.AreaTriggerSQL(rows, remove)); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		res.Server = true
		res.Restart = a.worldRunning()
	}
	if !bytes.Equal(out, dbc) {
		if res.Patch, res.Waiting, err = a.installClient(dataDir, []mpq.File{{Name: vmangos.AreaTriggerPath, Data: out}}, nil); err != nil {
			if res.Server {
				err = afterDatabase("the portals are", err)
			}
			return res, err
		}
	}
	return res, nil
}

// TaxiNetwork lists map mapID's flight stops and the routes from or to them from the client's taxi
// tables, with the IDs a new stop (above the world database's taxi_nodes too, when a server folder
// is set) and route take, for the Flight Paths window (#180).
func (a *App) TaxiNetwork(mapID uint32) (vmangos.TaxiNetwork, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.TaxiNetwork{}, err
	}
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return vmangos.TaxiNetwork{}, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	var top uint32
	if hasDB(server) {
		if top, err = vmangos.ServerTaxiMax(server); err != nil {
			return vmangos.TaxiNetwork{}, fmt.Errorf("world database: %w", err)
		}
	}
	return vmangos.ReadTaxiNetwork(tt, mapID, top)
}

// Transports lists the boats and zeppelins whose route has a leg on map mapID (#954): the world
// database's type 15 game objects and `transports` rows, with the legs of their taxi paths from the
// client's tables and their models, for World › Transports and Show › Transports. Read only.
func (a *App) Transports(mapID uint32) ([]vmangos.Transport, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return nil, err
	}
	return vmangos.ReadTransports(server, dataDir, tt, mapID)
}

// SaveTaxi writes the Flight Paths window's changed and removed stops and routes into the client's
// three taxi tables (Meld's patch) and, with a server folder set, the stops into the world database's
// taxi_nodes and the route tables into the server's data, which it reads at start. Nothing is closed
// or restarted (#661): the result says when the world server needs a restart for the new routes.
func (a *App) SaveTaxi(edit vmangos.TaxiEdit) (AreaSaveResult, error) {
	var res AreaSaveResult
	if externalOn() && (len(edit.Routes) > 0 || len(edit.RemoveRoutes) > 0) {
		// The routes are the server's data files (InstallServerTaxi), which an external server's
		// folder doesn't take (#856): refused before anything is read or written.
		return res, errExternalRoutes
	}
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return res, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetTaxi(tt, edit.Nodes, edit.RemoveNodes, edit.Routes, edit.RemoveRoutes)
	if err != nil {
		return res, err
	}
	if hasDB(server) {
		if err := a.applySQL(server, vmangos.TaxiSQL(edit.Nodes, edit.RemoveNodes, edit.RemoveRoutes)); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
	}
	var files []mpq.File
	for _, f := range []struct {
		name     string
		old, new []byte
	}{{vmangos.TaxiNodesPath, tt.Nodes, out.Nodes}, {vmangos.TaxiPathPath, tt.Paths, out.Paths}, {vmangos.TaxiPathNodePath, tt.Points, out.Points}} {
		if !bytes.Equal(f.old, f.new) {
			files = append(files, mpq.File{Name: f.name, Data: f.new})
		}
	}
	// The client's tables are written (or wait for the game) by the time the server's run, so their
	// failure says the stops are in the world database and the client but the routes are not.
	tablesTried := false
	serverTables := func() error {
		tablesTried = true
		if server == "" || externalOn() {
			res.Server = hasDB(server)
			return nil
		}
		if _, err := vmangos.InstallServerTaxi(server, out); err != nil {
			where := "the world database and the client's patch"
			if len(files) == 0 {
				where = "the world database"
			}
			return fmt.Errorf("the flight stops are saved in %s, but writing the routes into the server's data failed (Save again to retry): %w", where, err)
		}
		res.Server = true
		res.Restart = a.worldRunning()
		return nil
	}
	if len(files) == 0 {
		return res, serverTables()
	}
	res.Patch, res.Waiting, err = a.installClient(dataDir, files, serverTables)
	if err != nil && hasDB(server) && !tablesTried {
		err = afterDatabase("the flight stops are", err)
	}
	return res, err
}
