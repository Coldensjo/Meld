package wow

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"WorldEditor/internal/mpq"
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

func (c *Client) m2Mesh(path string) (*Mesh, error) {
	raw, err := c.read(path)
	if err != nil {
		return nil, err
	}
	return ParseM2(raw)
}

func (c *Client) wmoMesh(path string) (*Mesh, error) {
	raw, err := c.read(path)
	if err != nil {
		return nil, err
	}
	root, err := ParseWMORoot(raw)
	if err != nil {
		return nil, err
	}
	m := &Mesh{}
	for i := 0; i < root.NumGroups; i++ {
		gb, err := c.read(GroupPath(path, i))
		if err != nil {
			continue
		}
		g, err := ParseWMOGroup(gb, root.Materials)
		if err != nil {
			continue
		}
		m.Append(g)
	}
	// Bake the default doodad set (furniture, lamps, crates...) into the mesh.
	models := map[string]*Mesh{}
	for _, d := range root.Doodads {
		key := strings.ToLower(d.Model)
		src, ok := models[key]
		if !ok {
			src, _ = c.m2Mesh(d.Model)
			models[key] = src
		}
		if src == nil {
			continue
		}
		cp := &Mesh{
			Pos:    append([]float32(nil), src.Pos...),
			Normal: append([]float32(nil), src.Normal...),
			UV:     src.UV,
			Index:  src.Index,
			Groups: src.Groups,
		}
		cp.TransformWoW(d.Pos, d.Rot, d.Scale)
		m.Append(cp)
	}
	if len(m.Index) == 0 {
		return nil, errors.New("wmo: no geometry")
	}
	m.Consolidate()
	return m, nil
}

// Model returns an encoded mesh for an .m2 or .wmo path.
func (c *Client) Model(path string) ([]byte, error) {
	return c.cached("mdl:"+strings.ToLower(path), func() ([]byte, error) {
		var m *Mesh
		var err error
		if strings.HasSuffix(strings.ToLower(path), ".wmo") {
			m, err = c.wmoMesh(path)
		} else {
			m, err = c.m2Mesh(path)
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
	mux.HandleFunc("/wow/model", func(w http.ResponseWriter, r *http.Request) {
		b, err := c.Model(r.URL.Query().Get("path"))
		blob(w, b, err)
	})
	return mux
}
