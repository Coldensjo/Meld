package wow

import "testing"

func TestByteCacheEvictsOldestFirst(t *testing.T) {
	var c byteCache
	for _, k := range []string{"a", "b", "c"} {
		c.put(k, make([]byte, 10), 30)
	}
	c.get("a") // a is now the most recent; b the oldest
	c.put("d", make([]byte, 10), 30)
	if _, ok := c.get("b"); ok {
		t.Fatal("b should have been evicted")
	}
	for _, k := range []string{"a", "c", "d"} {
		if _, ok := c.get(k); !ok {
			t.Fatalf("%s was dropped", k)
		}
	}
	if c.size != 30 {
		t.Fatalf("size %d, want 30", c.size)
	}
	c.put("big", make([]byte, 31), 30)
	if _, ok := c.get("big"); ok || c.size != 30 {
		t.Fatal("a value over the limit must not be kept or evict others")
	}
	c.put("a", make([]byte, 5), 30)
	if c.size != 25 {
		t.Fatalf("replacing a: size %d, want 25", c.size)
	}
	c.forget(func(k string) bool { return k == "a" })
	if c.size != 20 {
		t.Fatalf("after forget size %d, want 20", c.size)
	}
}

func TestTextureDXTFallbackCountedOnce(t *testing.T) {
	c := NewClient()
	c.cacheMu.Lock()
	c.cache.put("tex:x", make([]byte, 100), cacheLimit)
	c.cache.put("dxt:x", nil, cacheLimit)
	n := c.cache.size
	c.cacheMu.Unlock()
	if n != 100 {
		t.Fatalf("size %d, want 100", n)
	}
}
