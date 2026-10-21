package vmangos

import (
	"fmt"
	"runtime"
	"sync"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// Unique IDs of model placements. The 1.12 client keeps the placements it has loaded by their
// unique ID across every loaded tile, and draws only the first one of an ID (that is how a model two
// tiles list draws once); the server's vmap assembler likewise keeps one spawn an ID for a whole map.
// So a model Meld adds needs an ID no other placement of the map has: an export seeds one counter
// (adt.Changes.NextUID) above every ID of the map's tiles it doesn't rewrite and shares it across the
// tiles it writes (#491).

// mapUIDMax is the highest placement ID of the map's tiles as the client reads them now (Meld's patch
// included), leaving out the tiles skip names. It reads the tiles in parallel, since a continent has
// hundreds (Azeroth's 687 take about 5 s one at a time).
func mapUIDMax(set *mpq.Set, mapName string, skip func(x, y int) bool) (uint32, error) {
	var names []string
	for y := 0; y < MapTiles; y++ {
		for x := 0; x < MapTiles; x++ {
			if skip != nil && skip(x, y) {
				continue
			}
			if name := adt.TilePath(mapName, x, y, ""); set.Has(name) {
				names = append(names, name)
			}
		}
	}
	var (
		mu    sync.Mutex
		top   uint32
		first error
		wg    sync.WaitGroup
	)
	work := make(chan string)
	for range min(runtime.GOMAXPROCS(0), max(1, len(names))) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for name := range work {
				uid, err := tileUIDMax(set, name)
				mu.Lock()
				if err != nil && first == nil {
					first = err
				}
				top = max(top, uid)
				mu.Unlock()
			}
		}()
	}
	for _, name := range names {
		work <- name
	}
	close(work)
	wg.Wait()
	return top, first
}

// tileHeadBytes is how much of a tile tileUIDMax reads first: enough for the name and placement
// tables before the map chunks of nearly every tile, a tenth or less of the file.
const tileHeadBytes = 64 << 10

// tileUIDMax is the highest placement ID of a tile, read from the start of its file where it can be.
func tileUIDMax(set *mpq.Set, name string) (uint32, error) {
	head, err := set.ReadPrefix(name, tileHeadBytes)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", name, err)
	}
	if uid, found := adt.MaxPlacementUID(head); found || len(head) < tileHeadBytes {
		return uid, nil
	}
	root, err := set.ReadFile(name)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", name, err)
	}
	uid, _ := adt.MaxPlacementUID(root)
	return uid, nil
}
