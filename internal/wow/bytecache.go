package wow

import "container/list"

// byteCache is a least-recently-used map of built replies (textures, models, collision), bounded
// by the bytes they hold. Used with Client.cacheMu held.
type byteCache struct {
	order *list.List // of *byteEntry, the most recently used first
	byKey map[string]*list.Element
	size  int
}

type byteEntry struct {
	key string
	val []byte
}

func (b *byteCache) get(key string) ([]byte, bool) {
	e, ok := b.byKey[key]
	if !ok {
		return nil, false
	}
	b.order.MoveToFront(e)
	return e.Value.(*byteEntry).val, true
}

// put stores val under key and drops the least recently used entries until the cache is within
// limit again. A value larger than limit is not kept.
func (b *byteCache) put(key string, val []byte, limit int) {
	if b.byKey == nil {
		b.order, b.byKey = list.New(), map[string]*list.Element{}
	}
	if e, ok := b.byKey[key]; ok {
		b.remove(e)
	}
	if len(val) > limit {
		return
	}
	b.byKey[key] = b.order.PushFront(&byteEntry{key, val})
	b.size += len(val)
	for b.size > limit {
		b.remove(b.order.Back())
	}
}

func (b *byteCache) remove(e *list.Element) {
	en := e.Value.(*byteEntry)
	b.order.Remove(e)
	delete(b.byKey, en.key)
	b.size -= len(en.val)
}

func (b *byteCache) clear() { *b = byteCache{} }

// forget drops every entry for which gone(key) is true.
func (b *byteCache) forget(gone func(key string) bool) {
	for key, e := range b.byKey {
		if gone(key) {
			b.remove(e)
		}
	}
}
