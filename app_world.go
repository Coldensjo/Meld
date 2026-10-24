package main

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"Meld/internal/play"
	"Meld/internal/recovery"
	"Meld/internal/worldfile"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Cube worlds (*.world, the game's world format, internal/worldfile).

// WorldData is a cube world over the Wails bridge: its bounds in chunks, its stored chunks, its
// spawn point, its monsters' spawn points, NPCs, props and mood regions (the format's MONSTERS, NPCS, PROPS and MOODS records) and its groups of joined
// cubes and attached objects (the format's JOINS, OBJECTS and OBJECT_STATE records), which the
// editor keeps as they are until it edits them (#32), and the records it does not know (Kept).
type WorldData struct {
	ChunksX int              `json:"chunksX"`
	ChunksZ int              `json:"chunksZ"`
	Chunks  []WorldChunkData `json:"chunks"`
	// Spawn is the cube a player starts in; nil when the world has none.
	Spawn    *WorldSpawnData    `json:"spawn"`
	Monsters []WorldMonsterData `json:"monsters"`
	Npcs     []WorldNpcData     `json:"npcs"`
	Props    []WorldPropData    `json:"props"`
	Moods    []WorldMoodData    `json:"moods"`
	Hints    []WorldHintData    `json:"hints"`
	Images   []WorldImageData   `json:"images"`
	Joins    []WorldJoinData    `json:"joins"`
	Objects  []WorldObjectData  `json:"objects"`
	// Kept is the optional records the editor does not know (worldfile.World.Kept, #147), carried
	// through as they are so a saved world keeps them.
	Kept []WorldRecordData `json:"kept"`
}

// WorldRecordData is a record the editor keeps without reading it: its tag, its flags and its body
// as base64.
type WorldRecordData struct {
	Tag   int    `json:"tag"`
	Flags int    `json:"flags"`
	Body  string `json:"body"`
}

// WorldMonsterData is where a monster spawns: its kind's name (the game's monster kinds) and the
// cube it stands in.
type WorldMonsterData struct {
	Kind string         `json:"kind"`
	Pos  WorldSpawnData `json:"pos"`
}

// WorldNpcData is where an NPC stands and walks: its name (the game's NPCs), the cube it starts in
// and the cubes of its route, empty when it stands.
type WorldNpcData struct {
	Name  string           `json:"name"`
	Pos   WorldSpawnData   `json:"pos"`
	Route []WorldSpawnData `json:"route"`
}

// WorldPropData is a model standing in the world (the format's PROPS, #133): its model's name (its
// path under assets/models without .glb), where its origin stands in metres, its turn in radians
// and its scale. The numbers are float32s in the file; one that comes back unchanged is written
// back as it was read.
type WorldPropData struct {
	Model string  `json:"model"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Z     float64 `json:"z"`
	Turn  float64 `json:"turn"`
	Scale float64 `json:"scale"`
}

// WorldHintData is a name and a colour (0xRRGGBB) for a texture id the game does not have yet (the
// format's TEXTURE_HINTS, worldfile.TextureHint, 3dgame #218).
type WorldHintData struct {
	ID     int    `json:"id"`
	Colour int    `json:"colour"`
	Name   string `json:"name"`
}

// WorldImageData is a picture for a texture id the game does not have yet (the format's
// TEXTURE_IMAGES, worldfile.TextureImage, 3dgame #224): its PNG as base64.
type WorldImageData struct {
	ID  int    `json:"id"`
	PNG string `json:"png"`
}

// WorldMoodData is a place with a mood of its own (the format's MOODS, #143): its mood's name (the
// game's moods) and the cubes at its two corners, min (least x, z and layer) and max.
type WorldMoodData struct {
	Mood string         `json:"mood"`
	Min  WorldSpawnData `json:"min"`
	Max  WorldSpawnData `json:"max"`
}

// WorldJoinData is a group of joined cubes: its id and its cubes.
type WorldJoinData struct {
	ID    uint32           `json:"id"`
	Cubes []WorldSpawnData `json:"cubes"`
}

// WorldObjectData is an object attached to a cube: its id, kind (0 door, 1 window, 2 lever, 3
// button, 4 teleporter, 5 torch), the face of its cube it is on (0 north, 1 east, 2 south, 3 west, 4 up, 5 down), its cube,
// the ids of the objects it acts on, its state (0 off or closed, 1 on or open), and the colour a
// torch's fire burns (0 orange, 1 green, 2 blue, 3 purple; 0 for the other kinds).
type WorldObjectData struct {
	ID      uint32         `json:"id"`
	Kind    int            `json:"kind"`
	Face    int            `json:"face"`
	Pos     WorldSpawnData `json:"pos"`
	Targets []uint32       `json:"targets"`
	State   int            `json:"state"`
	Colour  int            `json:"colour"`
}

// WorldSpawnData is the world's spawn point, or any cube's position: x and z from the world's
// corner, and its layer.
type WorldSpawnData struct {
	X     int `json:"x"`
	Z     int `json:"z"`
	Layer int `json:"layer"`
}

// WorldChunkData is one chunk: its position and its cubes, the 768 bytes of planes (256 kinds, 256
// shapes, 256 rotations, in index order z*16 + x) as base64, which keeps the bridge to one string;
// the textures painted on its cubes' faces, the 1536 ids of worldfile.Chunk.Paint as 3072 bytes
// (two an id, little-endian, 3dgame #217) in base64,
// "" when none is painted; and the edges of its cubes' faces that blend into the texture beside
// them, the 1536 bytes of worldfile.Chunk.Blend as base64, "" when none does.
type WorldChunkData struct {
	CX    int    `json:"cx"`
	CZ    int    `json:"cz"`
	Layer int    `json:"layer"`
	Cubes string `json:"cubes"`
	Paint string `json:"paint"`
	Blend string `json:"blend"`
	// Overlay is the texture over each cube's top face (worldfile.Chunk.Overlay, 3dgame #226), 256 ids
	// as 512 bytes, little-endian, in base64; "" when none has one.
	Overlay string `json:"overlay"`
}

const worldExt = ".world"

// SaveWorldDialog asks where to save a cube world. Returns "" if cancelled.
func (a *App) SaveWorldDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "untitled"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save World",
		DefaultDirectory: a.projectDir(),
		DefaultFilename:  suggested + worldExt,
		Filters:          []runtime.FileFilter{{DisplayName: "Cube World (*.world)", Pattern: "*.world"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), worldExt) {
		path += worldExt
	}
	return path, nil
}

// LoadWorld reads the cube world at path.
func (a *App) LoadWorld(path string) (*WorldData, error) {
	w, err := worldfile.Load(path)
	if err != nil {
		return nil, err
	}
	runtime.WindowSetTitle(a.ctx, "Meld — "+filepath.Base(path))
	return worldToData(w), nil
}

// SaveWorld writes the cube world to path.
func (a *App) SaveWorld(path string, data WorldData) error {
	w, err := worldFromData(data)
	if err != nil {
		return err
	}
	if err := worldfile.Save(path, w); err != nil {
		return err
	}
	runtime.WindowSetTitle(a.ctx, "Meld — "+filepath.Base(path))
	return nil
}

// SaveRecoveryWorld writes the autosaved copy of open cube world doc (a tab's id), as SaveRecovery
// does a map's, and returns its info.
func (a *App) SaveRecoveryWorld(doc int, info recovery.Info, data WorldData) (recovery.Info, error) {
	if a.rec == nil {
		return info, errNoRecovery
	}
	w, err := worldFromData(data)
	if err != nil {
		return info, err
	}
	return a.rec.SaveWorld(doc, info, w)
}

// LoadRecoveryWorld reads a cube world's autosaved copy. Unlike LoadWorld it leaves the window
// title alone.
func (a *App) LoadRecoveryWorld(id string) (*WorldData, error) {
	if a.rec == nil {
		return nil, errNoRecovery
	}
	w, err := a.rec.LoadWorld(id)
	if err != nil {
		return nil, err
	}
	return worldToData(w), nil
}

// SaveSceneWorld writes a copy of the open cube world for a copied scene (Help > Copy Scene) into
// the scenes folder of the user's cache dir and returns its path. Unlike SaveWorld it leaves the
// window title alone.
func (a *App) SaveSceneWorld(data WorldData) (string, error) {
	w, err := worldFromData(data)
	if err != nil {
		return "", err
	}
	return saveSceneCopy(worldExt, func(path string) error { return worldfile.Save(path, w) })
}

func worldToData(w *worldfile.World) *WorldData {
	d := &WorldData{ChunksX: int(w.ChunksX), ChunksZ: int(w.ChunksZ), Chunks: make([]WorldChunkData, len(w.Chunks))}
	for i, c := range w.Chunks {
		d.Chunks[i] = WorldChunkData{CX: int(c.CX), CZ: int(c.CZ), Layer: int(c.Layer), Cubes: base64.StdEncoding.EncodeToString(c.Cubes)}
		if c.Paint != nil {
			raw := make([]byte, 2*len(c.Paint))
			for j, t := range c.Paint {
				binary.LittleEndian.PutUint16(raw[2*j:], t)
			}
			d.Chunks[i].Paint = base64.StdEncoding.EncodeToString(raw)
		}
		if c.Blend != nil {
			d.Chunks[i].Blend = base64.StdEncoding.EncodeToString(c.Blend)
		}
		if c.Overlay != nil {
			raw := make([]byte, 2*len(c.Overlay))
			for j, t := range c.Overlay {
				binary.LittleEndian.PutUint16(raw[2*j:], t)
			}
			d.Chunks[i].Overlay = base64.StdEncoding.EncodeToString(raw)
		}
	}
	if sp := w.Spawn; sp != nil {
		d.Spawn = &WorldSpawnData{X: int(sp.X), Z: int(sp.Z), Layer: int(sp.Layer)}
	}
	posData := func(p worldfile.CubePos) WorldSpawnData {
		return WorldSpawnData{X: int(p.X), Z: int(p.Z), Layer: int(p.Layer)}
	}
	d.Monsters = make([]WorldMonsterData, len(w.Monsters))
	for i, m := range w.Monsters {
		d.Monsters[i] = WorldMonsterData{Kind: m.Kind, Pos: posData(m.Pos)}
	}
	d.Npcs = make([]WorldNpcData, len(w.Npcs))
	for i, n := range w.Npcs {
		d.Npcs[i] = WorldNpcData{Name: n.Name, Pos: posData(n.Pos), Route: make([]WorldSpawnData, len(n.Route))}
		for k, p := range n.Route {
			d.Npcs[i].Route[k] = posData(p)
		}
	}
	d.Props = make([]WorldPropData, len(w.Props))
	for i, p := range w.Props {
		d.Props[i] = WorldPropData{Model: p.Model, X: float64(p.X), Y: float64(p.Y), Z: float64(p.Z), Turn: float64(p.Turn), Scale: float64(p.Scale)}
	}
	d.Hints = make([]WorldHintData, len(w.Hints))
	for i, h := range w.Hints {
		d.Hints[i] = WorldHintData{ID: int(h.ID), Colour: int(h.Colour), Name: h.Name}
	}
	d.Images = make([]WorldImageData, len(w.Images))
	for i, im := range w.Images {
		d.Images[i] = WorldImageData{ID: int(im.ID), PNG: base64.StdEncoding.EncodeToString(im.PNG)}
	}
	d.Moods = make([]WorldMoodData, len(w.Moods))
	for i, r := range w.Moods {
		d.Moods[i] = WorldMoodData{Mood: r.Mood, Min: posData(r.Min), Max: posData(r.Max)}
	}
	d.Joins = make([]WorldJoinData, len(w.Joins))
	for i, j := range w.Joins {
		d.Joins[i] = WorldJoinData{ID: j.ID, Cubes: make([]WorldSpawnData, len(j.Cubes))}
		for k, p := range j.Cubes {
			d.Joins[i].Cubes[k] = posData(p)
		}
	}
	d.Objects = make([]WorldObjectData, len(w.Objects))
	for i, o := range w.Objects {
		d.Objects[i] = WorldObjectData{ID: o.ID, Kind: int(o.Kind), Face: int(o.Face), Pos: posData(o.Pos), Targets: append([]uint32{}, o.Targets...), State: int(o.State), Colour: int(o.Colour)}
	}
	d.Kept = make([]WorldRecordData, len(w.Kept))
	for i, k := range w.Kept {
		d.Kept[i] = WorldRecordData{Tag: int(k.Tag), Flags: int(k.Flags), Body: base64.StdEncoding.EncodeToString(k.Body)}
	}
	return d
}

func worldFromData(d WorldData) (*worldfile.World, error) {
	if d.ChunksX < 0 || d.ChunksZ < 0 || d.ChunksX > 1<<20 || d.ChunksZ > 1<<20 {
		return nil, fmt.Errorf("world bounds %d x %d chunks are out of range", d.ChunksX, d.ChunksZ)
	}
	w := &worldfile.World{ChunksX: uint32(d.ChunksX), ChunksZ: uint32(d.ChunksZ), Chunks: make([]worldfile.Chunk, len(d.Chunks))}
	for i, c := range d.Chunks {
		cubes, err := base64.StdEncoding.DecodeString(c.Cubes)
		if err != nil {
			return nil, fmt.Errorf("chunk (%d, %d, layer %d): %w", c.CX, c.CZ, c.Layer, err)
		}
		if c.Layer < 0 || c.Layer > worldfile.BottomLayer || c.CX < 0 || c.CZ < 0 || c.CX >= d.ChunksX || c.CZ >= d.ChunksZ {
			return nil, fmt.Errorf("chunk (%d, %d, layer %d) is outside the world", c.CX, c.CZ, c.Layer)
		}
		w.Chunks[i] = worldfile.Chunk{CX: int32(c.CX), CZ: int32(c.CZ), Layer: uint8(c.Layer), Cubes: cubes}
		if c.Paint != "" {
			raw, err := base64.StdEncoding.DecodeString(c.Paint)
			if err != nil {
				return nil, fmt.Errorf("chunk (%d, %d, layer %d) paint: %w", c.CX, c.CZ, c.Layer, err)
			}
			if len(raw) != 2*worldfile.PaintLen {
				return nil, fmt.Errorf("chunk (%d, %d, layer %d) has %d bytes of paint, not %d", c.CX, c.CZ, c.Layer, len(raw), 2*worldfile.PaintLen)
			}
			paint := make([]uint16, worldfile.PaintLen)
			for j := range paint {
				paint[j] = binary.LittleEndian.Uint16(raw[2*j:])
			}
			w.Chunks[i].Paint = paint
		}
		if c.Blend != "" {
			blend, err := base64.StdEncoding.DecodeString(c.Blend)
			if err != nil {
				return nil, fmt.Errorf("chunk (%d, %d, layer %d) blend: %w", c.CX, c.CZ, c.Layer, err)
			}
			w.Chunks[i].Blend = blend
		}
		if c.Overlay != "" {
			raw, err := base64.StdEncoding.DecodeString(c.Overlay)
			if err != nil || len(raw) != 2*worldfile.OverlayLen {
				return nil, fmt.Errorf("chunk (%d, %d, layer %d): the overlay is not %d bytes of base64", c.CX, c.CZ, c.Layer, 2*worldfile.OverlayLen)
			}
			overlay := make([]uint16, worldfile.OverlayLen)
			for j := range overlay {
				overlay[j] = binary.LittleEndian.Uint16(raw[2*j:])
			}
			w.Chunks[i].Overlay = overlay
		}
	}
	if sp := d.Spawn; sp != nil {
		if sp.X < 0 || sp.Z < 0 || sp.X >= d.ChunksX*worldfile.ChunkSize || sp.Z >= d.ChunksZ*worldfile.ChunkSize || sp.Layer < 0 || sp.Layer > worldfile.BottomLayer {
			return nil, fmt.Errorf("the spawn point (%d, %d, layer %d) is outside the world", sp.X, sp.Z, sp.Layer)
		}
		w.Spawn = &worldfile.CubePos{X: int32(sp.X), Z: int32(sp.Z), Layer: uint8(sp.Layer)}
	}
	// Positions and ids are range-checked here so they fit their fields; worldfile.Write checks the
	// rest (inside the world, known kinds, targets that exist) before saving.
	pos := func(p WorldSpawnData) (worldfile.CubePos, error) {
		if p.X < 0 || p.Z < 0 || p.X >= d.ChunksX*worldfile.ChunkSize || p.Z >= d.ChunksZ*worldfile.ChunkSize || p.Layer < 0 || p.Layer > worldfile.BottomLayer {
			return worldfile.CubePos{}, fmt.Errorf("the cube (%d, %d, layer %d) is outside the world", p.X, p.Z, p.Layer)
		}
		return worldfile.CubePos{X: int32(p.X), Z: int32(p.Z), Layer: uint8(p.Layer)}, nil
	}
	for _, m := range d.Monsters {
		p, err := pos(m.Pos)
		if err != nil {
			return nil, fmt.Errorf("monster %q: %w", m.Kind, err)
		}
		w.Monsters = append(w.Monsters, worldfile.MonsterSpawn{Kind: m.Kind, Pos: p})
	}
	for _, n := range d.Npcs {
		p, err := pos(n.Pos)
		if err != nil {
			return nil, fmt.Errorf("NPC %q: %w", n.Name, err)
		}
		npc := worldfile.Npc{Name: n.Name, Pos: p}
		for _, r := range n.Route {
			c, err := pos(r)
			if err != nil {
				return nil, fmt.Errorf("the route of NPC %q: %w", n.Name, err)
			}
			npc.Route = append(npc.Route, c)
		}
		w.Npcs = append(w.Npcs, npc)
	}
	for _, p := range d.Props {
		w.Props = append(w.Props, worldfile.Prop{Model: p.Model, X: float32(p.X), Y: float32(p.Y), Z: float32(p.Z), Turn: float32(p.Turn), Scale: float32(p.Scale)})
	}
	for _, r := range d.Moods {
		lo, err := pos(r.Min)
		if err != nil {
			return nil, fmt.Errorf("mood region %q: %w", r.Mood, err)
		}
		hi, err := pos(r.Max)
		if err != nil {
			return nil, fmt.Errorf("mood region %q: %w", r.Mood, err)
		}
		w.Moods = append(w.Moods, worldfile.MoodRegion{Mood: r.Mood, Min: lo, Max: hi})
	}
	for _, h := range d.Hints {
		if h.ID < 0 || h.ID > 0xffff || h.Colour < 0 || h.Colour > 0xffffff {
			return nil, fmt.Errorf("texture hint %d: id or colour out of range", h.ID)
		}
		w.Hints = append(w.Hints, worldfile.TextureHint{ID: uint16(h.ID), Colour: uint32(h.Colour), Name: h.Name})
	}
	for _, im := range d.Images {
		raw, err := base64.StdEncoding.DecodeString(im.PNG)
		if err != nil || im.ID < 0 || im.ID > 0xffff {
			return nil, fmt.Errorf("texture image %d: not a picture", im.ID)
		}
		w.Images = append(w.Images, worldfile.TextureImage{ID: uint16(im.ID), PNG: raw})
	}
	for _, j := range d.Joins {
		join := worldfile.Join{ID: j.ID, Cubes: make([]worldfile.CubePos, len(j.Cubes))}
		for k, p := range j.Cubes {
			c, err := pos(p)
			if err != nil {
				return nil, fmt.Errorf("group %d: %w", j.ID, err)
			}
			join.Cubes[k] = c
		}
		w.Joins = append(w.Joins, join)
	}
	for _, o := range d.Objects {
		p, err := pos(o.Pos)
		if err != nil {
			return nil, fmt.Errorf("object %d: %w", o.ID, err)
		}
		if o.Kind < 0 || o.Kind >= worldfile.ObjectKindCount || o.Face < 0 || o.Face >= worldfile.FaceCount || o.State < 0 || o.State >= worldfile.StateCount || o.Colour < 0 || o.Colour >= worldfile.FireColourCount {
			return nil, fmt.Errorf("object %d: kind %d, face %d, state %d or fire colour %d is unknown", o.ID, o.Kind, o.Face, o.State, o.Colour)
		}
		w.Objects = append(w.Objects, worldfile.Object{ID: o.ID, Kind: uint8(o.Kind), Face: uint8(o.Face), Pos: p, Targets: append([]uint32(nil), o.Targets...), State: uint8(o.State), Colour: uint8(o.Colour)})
	}
	for _, k := range d.Kept {
		if k.Tag < 0 || k.Tag > 0xffff || k.Flags < 0 || k.Flags > 0xffff {
			return nil, fmt.Errorf("kept record %d (flags %d) is out of range", k.Tag, k.Flags)
		}
		body, err := base64.StdEncoding.DecodeString(k.Body)
		if err != nil {
			return nil, fmt.Errorf("kept record %d: %w", k.Tag, err)
		}
		w.Kept = append(w.Kept, worldfile.Record{Tag: uint16(k.Tag), Flags: uint16(k.Flags), Body: body})
	}
	return w, nil
}

// PlayWorld starts the 3dgame client on the saved cube world at path (it plays alone, on a server it
// starts itself), with the player at spot: the camera's eyes in the game's metres and its view in
// radians (#33). The client is config.WorldClientPath, else the repository's own build.
func (a *App) PlayWorld(path string, spot play.Spot) error {
	a.cfgMu.Lock()
	configured := a.cfg.WorldClientPath
	a.cfgMu.Unlock()
	exe, _ := os.Executable()
	client, err := play.FindClient(configured, exe)
	if err != nil {
		return err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	return play.Launch(play.OSStarter{}, client, path, filepath.Join(cache, "Meld"), spot)
}
