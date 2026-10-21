package wow

import (
	"container/list"
	"strings"
)

// partsLimit bounds the parsed doodads a Client keeps (partCache): the furniture, lamps and crates
// most WMOs share, so a second building, another doodad set or the collision request after the
// model doesn't read and parse them again (#500).
const partsLimit = 512

// partCache is a least-recently-used map of parsed models, keyed by kind and lower-case path. Its
// values are shared read-only between requests: a caller copies what it changes. Used with
// Client.cacheMu held.
type partCache struct {
	order *list.List // of *partEntry, the most recently used first
	byKey map[string]*list.Element
}

type partEntry struct {
	key string
	val any
}

func (p *partCache) get(key string) (any, bool) {
	if p.byKey == nil {
		return nil, false
	}
	e, ok := p.byKey[key]
	if !ok {
		return nil, false
	}
	p.order.MoveToFront(e)
	return e.Value.(*partEntry).val, true
}

func (p *partCache) put(key string, val any) {
	if p.byKey == nil {
		p.order, p.byKey = list.New(), map[string]*list.Element{}
	}
	if e, ok := p.byKey[key]; ok {
		e.Value.(*partEntry).val = val
		p.order.MoveToFront(e)
		return
	}
	p.byKey[key] = p.order.PushFront(&partEntry{key, val})
	for p.order.Len() > partsLimit {
		last := p.order.Back()
		p.order.Remove(last)
		delete(p.byKey, last.Value.(*partEntry).key)
	}
}

func (p *partCache) clear() { p.order, p.byKey = nil, nil }

// part returns what build makes of a model file, kept in the part cache under kind and path. A
// build that started before the cache was emptied or forgot files isn't kept.
func (c *Client) part(kind, path string, build func() any) any {
	key := kind + ":" + strings.ToLower(path)
	c.cacheMu.Lock()
	if v, ok := c.parts.get(key); ok {
		c.cacheMu.Unlock()
		return v
	}
	gen := c.cacheGen
	c.cacheMu.Unlock()
	v := build()
	c.cacheMu.Lock()
	if gen == c.cacheGen {
		c.parts.put(key, v)
	}
	c.cacheMu.Unlock()
	return v
}

// doodadMesh is the M2 at path undressed (m2Mesh with no look), nil when it can't be read. It is
// shared: the caller copies what it transforms.
func (c *Client) doodadMesh(path string) *Mesh {
	m, _ := c.part("mesh", path, func() any {
		m, _ := c.m2Mesh(path, nil)
		return m
	}).(*Mesh)
	return m
}

// doodadHull is the collision faces of the M2 at path, nil when it has none or can't be read. It
// is shared: the caller copies what it transforms.
func (c *Client) doodadHull(path string) []float32 {
	h, _ := c.part("hull", path, func() any {
		b, err := c.readM2(path)
		if err != nil {
			return []float32(nil)
		}
		h, _ := m2HullFaces(b)
		return h
	}).([]float32)
	return h
}
