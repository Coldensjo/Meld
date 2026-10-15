package wow

import (
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// Client serves assets read directly from a local WoW 1.x installation.
// Nothing is copied out of the MPQs; data is decoded on request and kept in a
// bounded in-memory cache.
type Client struct {
	mu    sync.RWMutex
	dir   string
	set   *mpq.Set
	files []string
	err   error

	cacheMu   sync.Mutex
	cache     map[string][]byte
	cacheSize int

	// The minimap table (see minimap.go), parsed on first use.
	minimapMu sync.Mutex
	minimap   map[string][]MapTile
}

const cacheLimit = 512 << 20

func NewClient() *Client { return &Client{cache: map[string][]byte{}} }

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

// Open (re)loads the client at dir. An empty dir unloads it.
func (c *Client) Open(dir string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.set != nil {
		c.set.Close()
		c.set = nil
	}
	c.files, c.dir, c.err = nil, dir, nil
	c.cacheMu.Lock()
	c.cache, c.cacheSize = map[string][]byte{}, 0
	c.cacheMu.Unlock()
	if dir == "" {
		return nil
	}
	data, err := ResolveDataDir(dir)
	if err != nil {
		c.err = err
		return err
	}
	set, err := mpq.OpenDataDir(data)
	if err != nil {
		c.err = err
		return err
	}
	c.set = set
	c.minimapMu.Lock()
	c.minimap = nil
	c.minimapMu.Unlock()
	// Listfiles reference some files that were never shipped; drop those.
	for _, f := range set.List() {
		if set.Has(f) {
			c.files = append(c.files, f)
		}
	}
	return nil
}

type Status struct {
	Path     string `json:"path"`
	Loaded   bool   `json:"loaded"`
	Error    string `json:"error"`
	Files    int    `json:"files"`
	Archives int    `json:"archives"`
}

func (c *Client) Status() Status {
	c.mu.RLock()
	defer c.mu.RUnlock()
	s := Status{Path: c.dir, Loaded: c.set != nil, Files: len(c.files)}
	if c.set != nil {
		s.Archives = len(c.set.Archives())
	}
	if c.err != nil {
		s.Error = c.err.Error()
	}
	return s
}

func (c *Client) read(path string) ([]byte, error) {
	c.mu.RLock()
	set := c.set
	c.mu.RUnlock()
	if set == nil {
		return nil, errors.New("no WoW client loaded")
	}
	return set.ReadFile(path)
}

var wmoGroupRe = regexp.MustCompile(`(?i)_\d{3}\.wmo$`)

// List returns asset paths of a kind: "m2", "wmo" or "tileset".
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
		}
	}
	return out
}

func (c *Client) cached(key string, build func() ([]byte, error)) ([]byte, error) {
	c.cacheMu.Lock()
	if b, ok := c.cache[key]; ok {
		c.cacheMu.Unlock()
		return b, nil
	}
	c.cacheMu.Unlock()
	b, err := build()
	if err != nil {
		return nil, err
	}
	c.cacheMu.Lock()
	if c.cacheSize+len(b) > cacheLimit {
		c.cache, c.cacheSize = map[string][]byte{}, 0
	}
	c.cache[key] = b
	c.cacheSize += len(b)
	c.cacheMu.Unlock()
	return b, nil
}

// Texture returns "RGBA" + u32 w + u32 h + pixels.
func (c *Client) Texture(path string) ([]byte, error) {
	return c.cached("tex:"+strings.ToLower(path), func() ([]byte, error) {
		raw, err := c.read(path)
		if err != nil {
			return nil, err
		}
		img, err := DecodeBLP(raw)
		if err != nil {
			return nil, err
		}
		out := make([]byte, 12+len(img.Pix))
		copy(out, "RGBA")
		binary.LittleEndian.PutUint32(out[4:], uint32(img.W))
		binary.LittleEndian.PutUint32(out[8:], uint32(img.H))
		copy(out[12:], img.Pix)
		return out, nil
	})
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
	models := map[string]*Mesh{}
	for _, di := range root.DoodadIndicesOf(set) {
		d := root.AllDoodads[di]
		key := strings.ToLower(d.Model)
		src, ok := models[key]
		if !ok {
			src, _ = c.m2Mesh(d.Model, nil)
			models[key] = src
		}
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
	// The map overview for picking a region: a PNG stitched from the client's minimap.
	mux.HandleFunc("/wow/overview", func(w http.ResponseWriter, r *http.Request) {
		b, err := c.MapOverview(r.URL.Query().Get("map"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(b)
	})
	mux.HandleFunc("/wow/tiles", func(w http.ResponseWriter, r *http.Request) {
		tiles, err := c.MinimapTiles(r.URL.Query().Get("map"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, tiles)
	})
	mux.HandleFunc("/wow/model", func(w http.ResponseWriter, r *http.Request) {
		// The rest of the query is the look a spawn's display dresses the model in (see Look.Query).
		b, err := c.Model(r.URL.Query().Get("path"), ParseLook(r.URL.Query()))
		blob(w, b, err)
	})
	// A WMO's room data (groups, portals, collision faces, fogs) for the camera's room probe.
	mux.HandleFunc("/wow/wmonav", func(w http.ResponseWriter, r *http.Request) {
		b, err := c.WMONav(r.URL.Query().Get("path"))
		blob(w, b, err)
	})
	return mux
}

// Suspend closes the client's archives, so another program can write the game's files (the patch
// archive, say, which the archives keep open while they're loaded). Resume loads them again.
func (c *Client) Suspend() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.set != nil {
		c.set.Close()
		c.set = nil
	}
}

// Resume loads the archives again after Suspend.
func (c *Client) Resume() error {
	c.mu.RLock()
	dir := c.dir
	c.mu.RUnlock()
	return c.Open(dir)
}
