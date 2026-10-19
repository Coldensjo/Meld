package vmangos

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// The spell editor's visual composer (#361): a new spell visual put together from the client's
// existing pieces. A 1.12 visual is layered, and the layouts here are checked against the client's
// rows (TestSpellVisualsLive):
//   - SpellVisual.dbc (16 fields): ID; a SpellVisualKit for each stage (1 precast, 2 cast, 3 impact,
//     4 state, the aura left on the target, 5 channel); the missile (6 has one, 7 its model, 8 path
//     type, 9 the attachment it flies to, 10 its sound); the area effect (11 has one, 12 its model,
//     13 its sound); 14 and 15 left as they are.
//   - SpellVisualKit.dbc (35 fields): ID, 1 kind, 2 animation, the effect model on each attachment
//     point (3 head, 4 chest, 5 base, 6 left hand, 7 right hand, 8 breath, 9 left weapon, 10 right
//     weapon, 11 and 12 special; -1 for none), 13 sound, then shake, the character's glow and its
//     parameters.
//   - SpellVisualEffectName.dbc (5 fields): ID, name, model path (.mdx or .mdl: the client loads the
//     .m2), area size, scale.
// The composer never changes a row other spells use: a changed stage is a new kit, a changed visual
// a new visual, both added at the end of their table in Meld's patch.

// The client tables of spell visuals.
const (
	SpellVisualPath       = `DBFilesClient\SpellVisual.dbc`
	SpellVisualKitPath    = `DBFilesClient\SpellVisualKit.dbc`
	SpellVisualEffectPath = `DBFilesClient\SpellVisualEffectName.dbc`
)

const (
	visualFields   = 16
	visualKitBase  = 1 // the stages' kits, 5 fields
	visualStages   = 5
	visualMissile  = 6 // has a missile, then model, path type, attachment, sound
	visualArea     = 11
	kitFields      = 35
	kitEffectsBase = 3 // the attachment points' effects, 10 fields
	kitSlots       = 10
)

// none is a kit's "no effect on this attachment point".
const none = 0xFFFFFFFF

// VisualEffect is an effect model the composer can put on a stage: its name and its model as the
// previews load it (an .m2 path).
type VisualEffect struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Model string `json:"model"`
}

// VisualKit is a stage of a visual: the kit it was read from (0 for none) and the effect on each of
// its ten attachment points (0 for none).
type VisualKit struct {
	ID      int   `json:"id"`
	Effects []int `json:"effects"`
}

// VisualDesign is a visual as the composer edits it: the visual it was read from (0 for none), its
// five stages, its missile and its area effect (an effect ID each, 0 for none), and the visuals the
// missile and the area came from, whose path, attachment and sounds go with them.
type VisualDesign struct {
	ID          int         `json:"id"`
	Stages      []VisualKit `json:"stages"`
	Missile     int         `json:"missile"`
	MissileFrom int         `json:"missileFrom"`
	Area        int         `json:"area"`
	AreaFrom    int         `json:"areaFrom"`
}

var visualEffects struct {
	sync.Mutex
	byDir map[string][]VisualEffect
}

// effectModel is an effect's model path as the client loads it: its .mdx or .mdl named .m2.
func effectModel(path string) string {
	if path == "" {
		return ""
	}
	return trimModelExt(path) + ".m2"
}

// ListVisualEffects lists the client's effect models whose file the client has, by name, once per
// client data folder.
func ListVisualEffects(dataDir string) ([]VisualEffect, error) {
	visualEffects.Lock()
	defer visualEffects.Unlock()
	if l, ok := visualEffects.byDir[dataDir]; ok {
		return l, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(SpellVisualEffectPath)
	if err != nil {
		return nil, err
	}
	t, err := parseDBC(b)
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, f := range set.List() {
		have[strings.ToLower(f)] = true
	}
	out := listVisualEffects(t, have)
	if visualEffects.byDir == nil {
		visualEffects.byDir = map[string][]VisualEffect{}
	}
	visualEffects.byDir[dataDir] = out
	return out, nil
}

// listVisualEffects is the effect list from the table and the client's files (lower case).
func listVisualEffects(t *dbcTable, have map[string]bool) []VisualEffect {
	out := make([]VisualEffect, 0, t.records)
	for r := 0; r < t.records; r++ {
		m := effectModel(t.str(r, 2))
		if m == "" || !have[strings.ToLower(m)] {
			continue
		}
		out = append(out, VisualEffect{ID: int(t.u32(r, 0)), Name: t.str(r, 1), Model: m})
	}
	sort.Slice(out, func(i, j int) bool {
		if a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name); a != b {
			return a < b
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// readVisualTables reads SpellVisual.dbc and SpellVisualKit.dbc as the client has them.
func readVisualTables(set *mpq.Set) ([]byte, []byte, error) {
	vb, err := set.ReadFile(SpellVisualPath)
	if err != nil {
		return nil, nil, err
	}
	kb, err := set.ReadFile(SpellVisualKitPath)
	if err != nil {
		return nil, nil, err
	}
	return vb, kb, nil
}

// checkVisualTables refuses tables whose layout isn't 1.12's.
func checkVisualTables(v, k *dbcTable) error {
	if v.fields != visualFields || v.recSize != v.fields*4 {
		return fmt.Errorf("SpellVisual.dbc has %d fields, not 1.12's %d", v.fields, visualFields)
	}
	if k.fields != kitFields || k.recSize != k.fields*4 {
		return fmt.Errorf("SpellVisualKit.dbc has %d fields, not 1.12's %d", k.fields, kitFields)
	}
	return nil
}

// kitEffects are the effects on a kit's attachment points, 0 for none.
func kitEffects(k *dbcTable, id uint32) []int {
	out := make([]int, kitSlots)
	if r, ok := k.row(id); ok && id != 0 {
		for i := range out {
			if e := k.u32(r, kitEffectsBase+i); e != none {
				out[i] = int(e)
			}
		}
	}
	return out
}

// readVisualDesign reads visual id from the tables (an ID the client lacks reads as an empty visual).
func readVisualDesign(v, k *dbcTable, id int) VisualDesign {
	d := VisualDesign{Stages: make([]VisualKit, visualStages)}
	r, ok := v.row(uint32(id))
	if !ok || id <= 0 {
		for i := range d.Stages {
			d.Stages[i] = VisualKit{Effects: make([]int, kitSlots)}
		}
		return d
	}
	d.ID = id
	for i := range d.Stages {
		kid := v.u32(r, visualKitBase+i)
		if _, ok := k.row(kid); !ok {
			kid = 0
		}
		d.Stages[i] = VisualKit{ID: int(kid), Effects: kitEffects(k, kid)}
	}
	if v.u32(r, visualMissile) != 0 {
		d.Missile, d.MissileFrom = int(v.u32(r, visualMissile+1)), id
	}
	if v.u32(r, visualArea) != 0 {
		d.Area, d.AreaFrom = int(v.u32(r, visualArea+1)), id
	}
	return d
}

// ReadSpellVisual reads visual id of the client as the composer edits it.
func ReadSpellVisual(dataDir string, id int) (VisualDesign, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return VisualDesign{}, err
	}
	defer set.Close()
	vb, kb, err := readVisualTables(set)
	if err != nil {
		return VisualDesign{}, err
	}
	v, err := parseDBC(vb)
	if err != nil {
		return VisualDesign{}, err
	}
	k, err := parseDBC(kb)
	if err != nil {
		return VisualDesign{}, err
	}
	if err := checkVisualTables(v, k); err != nil {
		return VisualDesign{}, err
	}
	return readVisualDesign(v, k, id), nil
}

// The kind and animation of a kit made for a stage that had none: the values the client's own kits
// of that stage have most (precast and cast 0 with the omni cast animations, impact 1, state and
// channel 2).
var (
	newKitKind = [visualStages]uint32{0, 0, 1, 2, 2}
	newKitAnim = [visualStages]uint32{52, 54, none, none, 125}
)

// planVisual works out the visual design d comes to in the client's tables vdbc and kdbc: the ID to
// give the spell, and the tables with the rows it adds (nil for a table it leaves alone). A stage
// whose effects are its kit's keeps the kit; a changed one is a new kit, a copy of its own with the
// new effects. The visual is d.ID when nothing changed, else any visual with the same fields, else
// a new one, a copy of d.ID's with the stages, missile and area set.
func planVisual(vdbc, kdbc []byte, d VisualDesign) (int, []byte, []byte, error) {
	v, err := parseDBC(vdbc)
	if err != nil {
		return 0, nil, nil, err
	}
	k, err := parseDBC(kdbc)
	if err != nil {
		return 0, nil, nil, err
	}
	if err := checkVisualTables(v, k); err != nil {
		return 0, nil, nil, err
	}
	if len(d.Stages) != visualStages {
		return 0, nil, nil, fmt.Errorf("a visual has %d stages, not %d", len(d.Stages), visualStages)
	}
	maxKit := uint32(0)
	for r := 0; r < k.records; r++ {
		maxKit = max(maxKit, k.u32(r, 0))
	}
	var kitsOut []byte
	var kits [visualStages]uint32
	for i, s := range d.Stages {
		if len(s.Effects) != kitSlots {
			return 0, nil, nil, fmt.Errorf("stage %d has %d attachment points, not %d", i+1, len(s.Effects), kitSlots)
		}
		empty := true
		for _, e := range s.Effects {
			empty = empty && e == 0
		}
		base, hasBase := k.row(uint32(max(s.ID, 0)))
		hasBase = hasBase && s.ID > 0
		same := hasBase
		if hasBase {
			now := kitEffects(k, uint32(s.ID))
			for j := range now {
				same = same && now[j] == s.Effects[j]
			}
		}
		switch {
		case same:
			kits[i] = uint32(s.ID)
			continue
		case empty && !hasBase:
			continue
		}
		var rec []uint32
		if hasBase {
			rec = k.record(base)
		} else {
			rec = make([]uint32, kitFields)
			rec[1], rec[2] = newKitKind[i], newKitAnim[i]
			for f := 15; f <= 18; f++ {
				rec[f] = none // no character glow
			}
		}
		for j, e := range s.Effects {
			rec[kitEffectsBase+j] = none
			if e > 0 {
				rec[kitEffectsBase+j] = uint32(e)
			}
		}
		maxKit++
		rec[0] = maxKit
		if kitsOut == nil {
			kitsOut = kdbc
		}
		if kitsOut, err = putRecord(kitsOut, rec, nil); err != nil {
			return 0, nil, nil, err
		}
		kits[i] = maxKit
	}

	rec := make([]uint32, visualFields)
	baseRow, hasBase := v.row(uint32(max(d.ID, 0)))
	hasBase = hasBase && d.ID > 0
	if hasBase {
		rec = v.record(baseRow)
	}
	copy(rec[visualKitBase:], kits[:])
	// The missile: the path, attachment and sound of the visual it came from, else a plain one.
	// The attachment (field 9) is set on most visuals, with a missile or without, so only a missile
	// taken from another visual changes it.
	for _, f := range []int{visualMissile, visualMissile + 1, visualMissile + 2, visualMissile + 4} {
		rec[f] = 0
	}
	if d.Missile > 0 {
		if r, ok := v.row(uint32(d.MissileFrom)); ok && d.MissileFrom > 0 && v.u32(r, visualMissile) != 0 {
			for f := visualMissile; f < visualMissile+5; f++ {
				rec[f] = v.u32(r, f)
			}
		} else if rec[visualMissile+3] == 0 {
			rec[visualMissile+3] = 1 // to the target's chest
		}
		rec[visualMissile], rec[visualMissile+1] = 1, uint32(d.Missile)
	}
	for f := visualArea; f < visualArea+3; f++ {
		rec[f] = 0
	}
	if d.Area > 0 {
		if r, ok := v.row(uint32(d.AreaFrom)); ok && d.AreaFrom > 0 && v.u32(r, visualArea) != 0 {
			for f := visualArea; f < visualArea+3; f++ {
				rec[f] = v.u32(r, f)
			}
		}
		rec[visualArea], rec[visualArea+1] = 1, uint32(d.Area)
	}
	sameRow := func(r int) bool {
		for f := 1; f < visualFields; f++ {
			if v.u32(r, f) != rec[f] {
				return false
			}
		}
		return true
	}
	if hasBase && kitsOut == nil && sameRow(baseRow) {
		return d.ID, nil, nil, nil
	}
	if !hasBase && kitsOut == nil && d.Missile <= 0 && d.Area <= 0 && kits == [visualStages]uint32{} {
		return 0, nil, nil, nil // nothing at all: no visual
	}
	maxVis := uint32(0)
	for r := 0; r < v.records; r++ {
		if kitsOut == nil && sameRow(r) {
			return int(v.u32(r, 0)), nil, nil, nil
		}
		maxVis = max(maxVis, v.u32(r, 0))
	}
	rec[0] = maxVis + 1
	visOut, err := putRecord(vdbc, rec, nil)
	if err != nil {
		return 0, nil, nil, err
	}
	return int(rec[0]), visOut, kitsOut, nil
}

// planSpellVisualFiles plans design d in the client's tables and returns the visual's ID and the
// files to write into the patch.
func planSpellVisualFiles(set *mpq.Set, d VisualDesign) (int, []mpq.File, error) {
	vb, kb, err := readVisualTables(set)
	if err != nil {
		return 0, nil, err
	}
	id, vis, kits, err := planVisual(vb, kb, d)
	if err != nil {
		return 0, nil, err
	}
	var files []mpq.File
	if kits != nil {
		files = append(files, mpq.File{Name: SpellVisualKitPath, Data: kits})
	}
	if vis != nil {
		files = append(files, mpq.File{Name: SpellVisualPath, Data: vis})
	}
	return id, files, nil
}
