package wow

import (
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"Meld/internal/mpq"
)

// Client serves assets read directly from a local WoW 1.x installation.
// Nothing is copied out of the MPQs; data is decoded on request and kept in a
// bounded in-memory cache.
type Client struct {
	mu    sync.RWMutex
	dir   string
	data  string // dir's Data folder, where the archives are
	set   *mpq.Set
	files []string
	err   error
	// stamps are the archives' names, sizes and times when files was listed, so Resume lists them
	// again only when one changed.
	stamps string
	// held counts the Suspends that wait for their Resume: the archives open again with the last.
	held int
	// resumed is closed when the last Resume (or an Open) ends a Suspend, so the reads that came
	// while the archives were closed wait for it instead of failing (#472). Nil when not suspended.
	resumed chan struct{}

	cacheMu sync.Mutex
	cache   byteCache
	// cacheGen counts the times the cache was emptied or forgot files, so a build that read a file
	// before then isn't stored after.
	cacheGen int
	// parts holds parsed doodads (m2cache.go), under cacheMu and cacheGen too.
	parts partCache

	// The minimap table (see minimap.go), parsed on first use.
	minimapMu sync.Mutex
	minimap   map[string][]MapTile
	// minimapGen counts forgetMinimap's calls, so a table read before one isn't kept.
	minimapGen int

	// overlay, when set, reads a file the archives don't have yet ahead of them (SetOverlay).
	overlay func(path string) ([]byte, bool)
}

// SetOverlay has the client read a file through over first, when over has it: the client files
// waiting for the game to close (an icon added while it ran, #364), which the patch has only later.
func (c *Client) SetOverlay(over func(path string) ([]byte, bool)) {
	c.mu.Lock()
	c.overlay = over
	c.mu.Unlock()
}

// cacheLimit is the bytes the reply cache keeps; past it the least recently used go first.
var cacheLimit = 512 << 20

func NewClient() *Client { return &Client{} }

// ResolveDataDir accepts either the client root or its Data folder.
func ResolveDataDir(dir string) (string, error) {
	for _, d := range []string{filepath.Join(dir, "Data"), dir} {
		entries, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if strings.EqualFold(filepath.Ext(e.Name()), ".mpq") {
				return d, nil
			}
		}
	}
	return "", errors.New("no MPQ archives found (select the WoW folder or its Data folder)")
}

// Open (re)loads the client at dir, dropping everything decoded from the one before. An empty dir
// unloads it.
func (c *Client) Open(dir string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.set != nil {
		c.set.Close()
		c.set = nil
	}
	c.files, c.dir, c.data, c.err, c.stamps, c.held = nil, dir, "", nil, "", 0
	c.wakeReaders()
	c.cacheMu.Lock()
	c.cache.clear()
	c.parts.clear()
	c.cacheGen++
	c.cacheMu.Unlock()
	c.forgetMinimap()
	if dir == "" {
		return nil
	}
	data, err := ResolveDataDir(dir)
	if err != nil {
		c.err = err
		return err
	}
	c.data = data
	return c.load()
}

// load opens the archives of c.data and lists their files, unless they're the ones listed last
// (stamps): a reopen after Meld's own patch write that changed nothing, or a write into the waiting
// files, keeps the list. Called with c.mu held.
func (c *Client) load() error {
	stamps := archiveStamps(c.data)
	set, err := mpq.OpenDataDir(c.data)
	if err != nil {
		c.err = err
		return err
	}
	c.set, c.err = set, nil
	if stamps != "" && stamps == c.stamps {
		return nil
	}
	c.files, c.stamps = nil, stamps
	// The minimap index may be new too.
	c.forgetMinimap()
	// Listfiles reference some files that were never shipped; drop those.
	for _, f := range set.List() {
		if set.Has(f) {
			c.files = append(c.files, f)
		}
	}
	return nil
}

// archiveStamps names the archives in data with their sizes and modification times, or "" when the
// folder can't be read.
func archiveStamps(data string) string {
	entries, err := os.ReadDir(data)
	if err != nil {
		return ""
	}
	var b strings.Builder
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".mpq") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			return ""
		}
		fmt.Fprintf(&b, "%s|%d|%d\n", e.Name(), info.Size(), info.ModTime().UnixNano())
	}
	return b.String()
}

func (c *Client) forgetMinimap() {
	c.minimapMu.Lock()
	c.minimap = nil
	c.minimapGen++
	c.minimapMu.Unlock()
}

type Status struct {
	Path     string `json:"path"`
	Loaded   bool   `json:"loaded"`
	Error    string `json:"error"`
	Files    int    `json:"files"`
	Archives int    `json:"archives"`
	// Started is when this process started (Unix ms), so the probe runner can tell that wails dev rebuilt and
	// restarted the app during a probe (#656).
	Started int64 `json:"started"`
}

// processStart is when this process started, for Status.Started.
var processStart = time.Now().UnixMilli()

func (c *Client) Status() Status {
	c.mu.RLock()
	defer c.mu.RUnlock()
	s := Status{Path: c.dir, Loaded: c.set != nil, Files: len(c.files), Started: processStart}
	if c.set != nil {
		s.Archives = len(c.set.Archives())
	}
	if c.err != nil {
		s.Error = c.err.Error()
	}
	return s
}

// suspendWait is how long a read waits for the archives a Suspend closed to open again.
var suspendWait = 60 * time.Second

// read returns a client file. While a Suspend holds the archives closed (a patch write's rename,
// the sandbox's refresh), it waits for the Resume, up to suspendWait, rather than failing: a model
// that failed is drawn as a placeholder for 30 s (#472). The read itself holds the read lock, so a
// Suspend waits for the reads in flight instead of closing the archives under them.
func (c *Client) read(path string) ([]byte, error) {
	var deadline time.Time
	overlaid := false
	for {
		c.mu.RLock()
		set, over, resumed := c.set, c.overlay, c.resumed
		if set != nil && (overlaid || over == nil) {
			b, err := set.ReadFile(path)
			c.mu.RUnlock()
			return b, err
		}
		c.mu.RUnlock()
		if set != nil {
			// The overlay runs outside the lock: it reads the waiting files under their own.
			if b, ok := over(path); ok {
				return b, nil
			}
			overlaid = true
			continue
		}
		if resumed == nil {
			return nil, errors.New("no WoW client loaded")
		}
		if deadline.IsZero() {
			deadline = time.Now().Add(suspendWait)
		}
		wait := time.Until(deadline)
		if wait <= 0 {
			return nil, errors.New("the WoW client's archives stayed closed")
		}
		t := time.NewTimer(wait)
		select {
		case <-resumed:
			t.Stop()
		case <-t.C:
		}
	}
}

// wakeReaders ends a Suspend for the reads waiting on it. Called with c.mu held.
func (c *Client) wakeReaders() {
	if c.resumed != nil {
		close(c.resumed)
		c.resumed = nil
	}
}

var wmoGroupRe = regexp.MustCompile(`(?i)_\d{3}\.wmo$`)

// List returns asset paths of a kind: "m2", "wmo", "tileset" or "sheen" (the tilesets' `_s` twins,
// so the terrain asks only for the sheen masks that exist, #336).
func (c *Client) List(kind string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := []string{}
	for _, f := range c.files {
		l := strings.ToLower(f)
		switch kind {
		case "m2":
			if strings.HasPrefix(l, `world\`) && strings.HasSuffix(l, ".m2") {
				out = append(out, f)
			}
		case "wmo":
			if strings.HasPrefix(l, `world\`) && strings.HasSuffix(l, ".wmo") && !wmoGroupRe.MatchString(l) {
				out = append(out, f)
			}
		case "tileset":
			if strings.HasPrefix(l, `tileset\`) && strings.HasSuffix(l, ".blp") && !strings.HasSuffix(l, "_s.blp") {
				out = append(out, f)
			}
		case "sheen":
			if strings.HasPrefix(l, `tileset\`) && strings.HasSuffix(l, "_s.blp") {
				out = append(out, f)
			}
		}
	}
	return out
}

func (c *Client) cached(key string, build func() ([]byte, error)) ([]byte, error) {
	c.cacheMu.Lock()
	if b, ok := c.cache.get(key); ok {
		c.cacheMu.Unlock()
		return b, nil
	}
	gen := c.cacheGen
	c.cacheMu.Unlock()
	b, err := build()
	if err != nil {
		return nil, err
	}
	c.cacheMu.Lock()
	if gen != c.cacheGen {
		// Built from files a write has changed since: served, not kept.
		c.cacheMu.Unlock()
		return b, nil
	}
	c.cache.put(key, b, cacheLimit)
	c.cacheMu.Unlock()
	return b, nil
}

// Texture returns "RGBA" + u32 w + u32 h + pixels, for a client file or a composed body texture
// (ComposedTexture).
func (c *Client) Texture(path string) ([]byte, error) {
	return c.cached("tex:"+strings.ToLower(path), func() ([]byte, error) {
		if layers, ok := parseComposed(path); ok {
			img, err := c.composeTexture(layers)
			if err != nil {
				return nil, err
			}
			return encodeImage(img), nil
		}
		raw, err := c.read(path)
		if err != nil {
			return nil, err
		}
		img, err := DecodeBLP(raw)
		if err != nil {
			return nil, err
		}
		return encodeImage(img), nil
	})
}

// TextureDXT is a BLP as "DXT1", "DXT3" or "DXT5", width, height and the mip count, then each mip
// level as its byte count and blocks, the full size first; or Texture's RGBA reply for a BLP that
// DXTOf can't give whole, or a composed one.
func (c *Client) TextureDXT(path string) ([]byte, error) {
	if _, ok := parseComposed(path); ok {
		return c.Texture(path)
	}
	b, err := c.cached("dxt:"+strings.ToLower(path), func() ([]byte, error) {
		raw, err := c.read(path)
		if err != nil {
			return nil, err
		}
		d, ok := DXTOf(raw)
		if !ok {
			// A marker: the RGBA reply is kept once, under "tex:", not again here.
			return []byte{}, nil
		}
		n := 16
		for _, m := range d.Mips {
			n += 4 + len(m)
		}
		out := make([]byte, 16, n)
		copy(out, []byte{'D', 'X', 'T', byte('0' + d.Kind)})
		binary.LittleEndian.PutUint32(out[4:], uint32(d.W))
		binary.LittleEndian.PutUint32(out[8:], uint32(d.H))
		binary.LittleEndian.PutUint32(out[12:], uint32(len(d.Mips)))
		for _, m := range d.Mips {
			out = binary.LittleEndian.AppendUint32(out, uint32(len(m)))
			out = append(out, m...)
		}
		return out, nil
	})
	if err == nil && len(b) == 0 {
		return c.Texture(path)
	}
	return b, err
}

// m2Mesh decodes an M2 dressed in look (nil for none), with the look's items attached. An item
// that can't be read is left off.
func (c *Client) m2Mesh(path string, look *Look) (*Mesh, error) {
	raw, err := c.readM2(path)
	if err != nil {
		return nil, err
	}
	m, err := ParseM2Look(raw, path, look)
	if err != nil {
		return m, err
	}
	c.recursionChildren(m)
	if look == nil {
		return m, nil
	}
	for _, a := range look.Attach {
		b, err := c.readM2(a.Model)
		if err != nil {
			continue
		}
		item, err := ParseM2Look(b, a.Model, &Look{Textures: map[int]string{TexItem: a.Texture}})
		if err != nil {
			continue
		}
		m.Attach(a.Point, item)
	}
	return m, nil
}

// recursionChildren gives each of m's emitters that names a recursion model the first four
// emitters of that model as its children (one level: a child's own recursion is dropped).
func (c *Client) recursionChildren(m *Mesh) {
	for i := range m.Emitters {
		e := &m.Emitters[i]
		if e.Recursion == "" {
			continue
		}
		raw, err := c.readM2(e.Recursion)
		if err != nil {
			continue
		}
		child, err := ParseM2Look(raw, e.Recursion, nil)
		if err != nil {
			continue
		}
		for k := 0; k < len(child.Emitters) && len(e.Children) < 4; k++ {
			ce := child.Emitters[k]
			ce.Recursion, ce.Children = "", nil
			e.Children = append(e.Children, ce)
		}
	}
}

// readM2 reads a model file. Map files and the client's tables name models ".mdx", but the
// client stores them as ".m2".
func (c *Client) readM2(path string) ([]byte, error) {
	raw, err := c.read(path)
	if err != nil && strings.HasSuffix(strings.ToLower(path), ".mdx") {
		raw, err = c.read(path[:len(path)-len(".mdx")] + ".m2")
	}
	return raw, err
}

func (c *Client) wmoMesh(path string, set int) (*Mesh, error) {
	raw, err := c.read(path)
	if err != nil {
		return nil, err
	}
	root, err := ParseWMORoot(raw)
	if err != nil {
		return nil, err
	}
	m := &Mesh{}
	var interiors [][6]float32
	// The group each doodad belongs to, plus one: the first whose MODR names it.
	doodadRoom := map[int][]uint16{}
	for i := 0; i < root.NumGroups; i++ {
		gb, err := c.read(GroupPath(path, i))
		if err != nil {
			continue
		}
		if box, ok := InteriorBox(gb); ok {
			interiors = append(interiors, box)
		}
		for _, d := range GroupDoodadRefs(gb) {
			doodadRoom[d] = append(doodadRoom[d], uint16(i+1))
		}
		// The group's lava or water, which no group geometry stands for.
		if l, gl, flags := GroupLiquid(gb); l != nil {
			if lm := LiquidSurface(l, gl, flags, i+1, root.Materials); lm != nil {
				if m.Liquid == nil {
					m.Liquid = &LiquidMesh{}
				}
				m.Liquid.Append(lm)
			}
		}
		g, err := ParseWMOGroup(gb, root.Materials)
		if err != nil {
			continue
		}
		g.Room = make([]uint16, 2*g.vertCount())
		for k := 0; k < len(g.Room); k += 2 {
			g.Room[k] = uint16(i + 1)
		}
		m.Append(g)
	}
	// Bake the doodads (furniture, lamps, crates...) into the mesh: the global set, and the placement's.
	for _, di := range root.DoodadIndicesOf(set) {
		d := root.AllDoodads[di]
		src := c.doodadMesh(d.Model)
		if src == nil {
			continue
		}
		cp := &Mesh{
			Pos:      append([]float32(nil), src.Pos...),
			Normal:   append([]float32(nil), src.Normal...),
			UV:       src.UV,
			Index:    src.Index,
			Groups:   src.Groups,
			Effects:  append([]Effect(nil), src.Effects...),
			Emitters: append([]Emitter(nil), src.Emitters...),
			Ribbons:  append([]Ribbon(nil), src.Ribbons...),
		}
		cp.TransformWoW(d.Pos, d.Rot, d.Scale)
		if rooms := doodadRoom[di]; len(rooms) > 0 && len(rooms) <= 2 {
			cp.Room = make([]uint16, 2*cp.vertCount())
			for k := 0; k < len(cp.Room); k += 2 {
				copy(cp.Room[k:k+2], rooms)
			}
		}
		m.Append(cp)
	}
	if len(m.Index) == 0 {
		return nil, errors.New("wmo: no geometry")
	}
	m.Effects = append(m.Effects, root.Lights...)
	markInterior(m.Effects, interiors)
	m.Consolidate()
	return m, nil
}

// WMODoodadSets names a WMO's doodad sets, by index: set 0 is the global set every placement shows.
func (c *Client) WMODoodadSets(path string) ([]string, error) {
	raw, err := c.read(path)
	if err != nil {
		return nil, err
	}
	root, err := ParseWMORoot(raw)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(root.Sets))
	for i, s := range root.Sets {
		names[i] = s.Name
	}
	return names, nil
}

// nothingToDraw is the mesh Model sends for an M2 the client draws nothing of (ErrNothingToDraw):
// no groups, effects, emitters or ribbons, and the model's collision hull as its vertices and
// triangles (none for a model without one), so the editor can show where it stands and pick it.
func (c *Client) nothingToDraw(path string) (*Mesh, error) {
	raw, err := c.readM2(path)
	if err != nil {
		return nil, err
	}
	hull, _ := m2HullFaces(raw)
	n := len(hull) / 3
	m := &Mesh{Pos: hull, Normal: make([]float32, n*3), UV: make([]float32, n*2), Index: make([]uint32, n)}
	for i := range m.Index {
		m.Index[i] = uint32(i)
	}
	return m, nil
}

// Model returns an encoded mesh for an .m2 or .wmo path, an M2 dressed in look (a WMO with its doodad set).
func (c *Client) Model(path string, look Look) ([]byte, error) {
	key := "mdl:" + strings.ToLower(path)
	var lp *Look
	if !look.Empty() {
		key += "|" + strings.ToLower(look.Query())
		lp = &look
	}
	return c.cached(key, func() ([]byte, error) {
		var m *Mesh
		var err error
		if strings.HasSuffix(strings.ToLower(path), ".wmo") {
			m, err = c.wmoMesh(path, look.Set)
		} else {
			m, err = c.m2Mesh(path, lp)
			if err == nil {
				m.Consolidate()
			} else if errors.Is(err, ErrNothingToDraw) {
				m, err = c.nothingToDraw(path)
			}
		}
		if err != nil {
			return nil, err
		}
		return m.Encode(), nil
	})
}

// SaveThumb stores a PNG thumbnail for key in the cache dir.
func (c *Client) SaveThumb(key string, png []byte) error {
	if len(png) < 8 || string(png[1:4]) != "PNG" || len(png) > 4<<20 {
		return errors.New("invalid thumbnail")
	}
	p, err := c.thumbPath(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, png, 0o644)
}

// ClearThumbs deletes all cached thumbnails for the current client.
func (c *Client) ClearThumbs() error {
	p, err := c.thumbPath("x")
	if err != nil {
		return err
	}
	return os.RemoveAll(filepath.Dir(p))
}

func hashHex(s string) string {
	h := sha1.Sum([]byte(strings.ToLower(s)))
	return hex.EncodeToString(h[:])
}

// thumbPath maps a thumbnail key to a file in the per-client cache folder.
func (c *Client) thumbPath(key string) (string, error) {
	c.mu.RLock()
	dir, loaded := c.dir, c.set != nil
	c.mu.RUnlock()
	if !loaded || key == "" {
		return "", errors.New("no client or key")
	}
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "Meld", "thumbs", hashHex(dir)[:12], hashHex(key)+".png"), nil
}

// Handler serves /wow/* endpoints for the frontend.
func (c *Client) Handler() http.Handler {
	mux := http.NewServeMux()
	writeJSON := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
	blob := func(w http.ResponseWriter, b []byte, err error) {
		if err != nil {
			code := http.StatusInternalServerError
			if errors.Is(err, mpq.ErrNotFound) {
				code = http.StatusNotFound
			}
			http.Error(w, err.Error(), code)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(b)
	}
	mux.HandleFunc("/wow/status", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, c.Status()) })
	mux.HandleFunc("/wow/list", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, c.List(r.URL.Query().Get("kind"))) })
	mux.HandleFunc("/wow/texture", func(w http.ResponseWriter, r *http.Request) {
		// fmt=dxt (#178): a DXT BLP's own blocks for a GPU with S3TC, else the RGBA reply.
		if r.URL.Query().Get("fmt") == "dxt" {
			b, err := c.TextureDXT(r.URL.Query().Get("path"))
			blob(w, b, err)
			return
		}
		b, err := c.Texture(r.URL.Query().Get("path"))
		blob(w, b, err)
	})
	// Thumbnail cache: rendered previews stored in the user's cache dir
	// (never in the project). 404 when not cached; stored via SaveThumb
	// (request bodies crash WebKitGTK's custom scheme handler, so no POST).
	mux.HandleFunc("/wow/thumb", func(w http.ResponseWriter, r *http.Request) {
		p, err := c.thumbPath(r.URL.Query().Get("key"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		b, err := os.ReadFile(p)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(b)
	})
	// The map overview for picking a region: a PNG stitched from the client's minimap, with tiles that
	// have no minimap image (an instance's) drawn from their heights. /wow/tiles lists the tiles that exist.
	mux.HandleFunc("/wow/overview", func(w http.ResponseWriter, r *http.Request) {
		b, err := c.MapOverview(r.URL.Query().Get("map"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(b)
	})
	mux.HandleFunc("/wow/tiles", func(w http.ResponseWriter, r *http.Request) {
		tiles, err := c.MapTiles(r.URL.Query().Get("map"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, tiles)
	})
	// One tile's ground for the world view (#15): its heights, holes, zones and chunk flags (EncodeGround); 404 for no tile.
	mux.HandleFunc("/wow/ground", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		x, errX := strconv.Atoi(q.Get("x"))
		y, errY := strconv.Atoi(q.Get("y"))
		if errX != nil || errY != nil {
			http.Error(w, "x and y must be tile numbers", http.StatusBadRequest)
			return
		}
		b, err := c.Ground(q.Get("map"), x, y)
		blob(w, b, err)
	})
	// The same tile's texture layers for the world view's near ground (EncodePaint); 404 for no tile.
	mux.HandleFunc("/wow/groundpaint", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		x, errX := strconv.Atoi(q.Get("x"))
		y, errY := strconv.Atoi(q.Get("y"))
		if errX != nil || errY != nil {
			http.Error(w, "x and y must be tile numbers", http.StatusBadRequest)
			return
		}
		b, err := c.GroundPaint(q.Get("map"), x, y)
		blob(w, b, err)
	})
	// The same tile's liquids for the world view (EncodeLiquids); 404 for no tile.
	mux.HandleFunc("/wow/groundliquids", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		x, errX := strconv.Atoi(q.Get("x"))
		y, errY := strconv.Atoi(q.Get("y"))
		if errX != nil || errY != nil {
			http.Error(w, "x and y must be tile numbers", http.StatusBadRequest)
			return
		}
		b, err := c.GroundLiquids(q.Get("map"), x, y)
		blob(w, b, err)
	})
	// The same tile's models for the world view: a JSON list of TileModel; 404 for no tile.
	mux.HandleFunc("/wow/groundmodels", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		x, errX := strconv.Atoi(q.Get("x"))
		y, errY := strconv.Atoi(q.Get("y"))
		if errX != nil || errY != nil {
			http.Error(w, "x and y must be tile numbers", http.StatusBadRequest)
			return
		}
		b, err := c.GroundModels(q.Get("map"), x, y)
		blob(w, b, err)
	})
	mux.HandleFunc("/wow/model", func(w http.ResponseWriter, r *http.Request) {
		// The rest of the query is the look a spawn's display dresses the model in (see Look.Query).
		b, err := c.Model(r.URL.Query().Get("path"), ParseLook(r.URL.Query()))
		blob(w, b, err)
	})
	// A sound file of the client, as it is, for the zone editor's play buttons (#31). Only WAV and MP3
	// under Sound\, which the WebView plays itself.
	mux.HandleFunc("/wow/sound", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Query().Get("path")
		low := strings.ToLower(p)
		kind := map[bool]string{true: "audio/mpeg", false: "audio/wav"}[strings.HasSuffix(low, ".mp3")]
		if !strings.HasPrefix(low, `sound\`) || !(strings.HasSuffix(low, ".mp3") || strings.HasSuffix(low, ".wav")) {
			http.Error(w, "not a sound file", http.StatusBadRequest)
			return
		}
		b, err := c.read(p)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", kind)
		w.Write(b)
	})
	// A WMO's room data (groups, portals, collision faces, fogs) for the camera's room probe.
	mux.HandleFunc("/wow/wmonav", func(w http.ResponseWriter, r *http.Request) {
		b, err := c.WMONav(r.URL.Query().Get("path"))
		blob(w, b, err)
	})
	// A model's collision faces for the walkable-ground preview (#175); a WMO's with its doodad set.
	mux.HandleFunc("/wow/collision", func(w http.ResponseWriter, r *http.Request) {
		b, err := c.Collision(r.URL.Query().Get("path"), ParseLook(r.URL.Query()).Set)
		blob(w, b, err)
	})
	return RecoverPanics(mux)
}

// RecoverPanics answers a request whose handler panics with a 500 that names the panic, and logs
// it with the path and stack, so a corrupt client file (a truncated model in a patch) costs that
// one reply rather than the app: Wails' desktop asset server runs each request in a goroutine of
// its own with no recover, where a panic ends the process (#487); only wails dev's net/http
// server survives one.
func RecoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("panic serving %s: %v\n%s", r.URL.RequestURI(), v, debug.Stack())
				http.Error(w, fmt.Sprintf("internal error: %v", v), http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Suspend closes the client's archives, so Meld's patch can be replaced (Windows doesn't rename over
// a file a program holds open). Resume loads them again; while they're closed every read waits for
// it (up to suspendWait), so hold them only around the write itself (vmangos.InstallPatch does,
// through SetClientReader). It waits for the reads in flight.
// Suspends nest: the archives open again with the last Resume.
func (c *Client) Suspend() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.held++
	if c.resumed == nil {
		c.resumed = make(chan struct{})
	}
	if c.set != nil {
		c.set.Close()
		c.set = nil
	}
}

// Resume loads the archives again after Suspend. What was decoded from them stays: a write that
// changed files the cache holds says so with Forget. The list of files is read again only when an
// archive changed (#471).
func (c *Client) Resume() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.held > 0 {
		c.held--
	}
	if c.held > 0 {
		return nil
	}
	// The waiting reads go on once the lock is let go: with the archives, or failing as unloaded.
	defer c.wakeReaders()
	if c.set != nil || c.data == "" {
		return nil
	}
	return c.load()
}

// Forget drops what was decoded from the client files at paths (any case, either slash), as their
// textures, models and collision, after a write changed them: the next request reads them again.
func (c *Client) Forget(paths ...string) {
	if len(paths) == 0 {
		return
	}
	gone := make(map[string]bool, len(paths))
	model := false
	for _, p := range paths {
		p = strings.ToLower(strings.ReplaceAll(p, "/", `\`))
		gone[p] = true
		if strings.EqualFold(p, MinimapIndexPath) {
			c.forgetMinimap()
		}
		model = model || strings.HasSuffix(p, ".m2") || strings.HasSuffix(p, ".mdx")
	}
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()
	c.cacheGen++
	// A parsed doodad also holds the models its particles recurse into, so any model write drops them all.
	if model {
		c.parts.clear()
	}
	c.cache.forget(func(key string) bool {
		// Keys are "<kind>:<path>", then "|<look or set>" for a model or its collision.
		_, p, _ := strings.Cut(key, ":")
		if i := strings.IndexByte(p, '|'); i >= 0 {
			p = p[:i]
		}
		return gone[p]
	})
}
