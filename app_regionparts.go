package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"Meld/internal/mapfile"
	"Meld/internal/vmangos"
)

// regionPartStore holds region edits and maps sent in parts (SendRegionEditPart) until
// SaveRegionParts, RegionPendingParts, SaveMapParts or SaveSceneMapParts takes them. Wails refuses a
// binding call whose body passes 64 MB ("assembled body too large"), and a big region's edit passes
// it: every painted chunk's weights, its water and its chunk headers come to about 1.5 MB a tile, so
// a block of more than about 6x6 tiles could not be compiled or listed in the Changes window in one
// call. A big map passes it the same way when it is saved to a file.
type regionPartStore struct {
	mu    sync.Mutex
	edits map[string]*strings.Builder
	next  map[string]int
}

func (s *regionPartStore) add(id string, index int, part string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.edits == nil {
		s.edits = map[string]*strings.Builder{}
		s.next = map[string]int{}
	}
	// Part 0 starts the edit afresh, dropping what an edit given up under the same id left.
	if index == 0 {
		s.edits[id] = &strings.Builder{}
		s.next[id] = 0
	}
	b := s.edits[id]
	if b == nil || index != s.next[id] {
		delete(s.edits, id)
		delete(s.next, id)
		return fmt.Errorf("part %d of region edit %s came out of order", index, id)
	}
	b.WriteString(part)
	s.next[id] = index + 1
	return nil
}

func (s *regionPartStore) take(id string) (vmangos.RegionEdit, error) {
	var edit vmangos.RegionEdit
	return edit, s.takeJSON(id, "region edit", &edit)
}

// takeJSON joins the parts sent under id and decodes them into into; what names the value in errors.
func (s *regionPartStore) takeJSON(id, what string, into any) error {
	s.mu.Lock()
	b := s.edits[id]
	delete(s.edits, id)
	delete(s.next, id)
	s.mu.Unlock()
	if b == nil {
		return fmt.Errorf("no parts of %s %s were sent", what, id)
	}
	if err := json.Unmarshal([]byte(b.String()), into); err != nil {
		return fmt.Errorf("%s %s: %w", what, id, err)
	}
	return nil
}

func (s *regionPartStore) drop(id string) {
	s.mu.Lock()
	delete(s.edits, id)
	delete(s.next, id)
	s.mu.Unlock()
}

// SendRegionEditPart sends the next slice of a region edit's JSON (vmangos.RegionEdit, as SaveRegion
// takes it) or a map's (mapfile.MapData, as SaveMap takes it), index 0 first, for one too large for one
// binding call; SaveRegionParts, RegionPendingParts, SaveMapParts or SaveSceneMapParts with the same id
// then takes the whole of it.
func (a *App) SendRegionEditPart(id string, index int, part string) error {
	return a.regionParts.add(id, index, part)
}

// DropRegionEditParts forgets the parts sent under id, for an edit or map the page gave up sending.
func (a *App) DropRegionEditParts(id string) {
	a.regionParts.drop(id)
}

// SaveRegionParts is SaveRegion for the edit sent in parts under id.
func (a *App) SaveRegionParts(id string) (vmangos.RegionResult, error) {
	edit, err := a.regionParts.take(id)
	if err != nil {
		return vmangos.RegionResult{}, err
	}
	return a.SaveRegion(edit)
}

// RegionPendingParts is RegionPending for the edit sent in parts under id.
func (a *App) RegionPendingParts(id string) (vmangos.RegionResult, error) {
	edit, err := a.regionParts.take(id)
	if err != nil {
		return vmangos.RegionResult{}, err
	}
	return a.RegionPending(edit)
}

// SaveMapParts is SaveMap for the map sent in parts under id.
func (a *App) SaveMapParts(path, id string) error {
	var data mapfile.MapData
	if err := a.regionParts.takeJSON(id, "map", &data); err != nil {
		return err
	}
	return a.SaveMap(path, data)
}

// SaveSceneMapParts is SaveSceneMap for the map sent in parts under id.
func (a *App) SaveSceneMapParts(id string) (string, error) {
	var data mapfile.MapData
	if err := a.regionParts.takeJSON(id, "map", &data); err != nil {
		return "", err
	}
	return a.SaveSceneMap(data)
}
