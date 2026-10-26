package vmangos

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
)

// The asset browser's Creatures, NPCs and Objects tabs list every creature template and game object
// template of the world database, dressed for a thumbnail. Both lists are made once per server and
// client.

// ObjectTemplate is a game object the world database can spawn (gameobject_template): a chest, a
// herb, an ore vein, a door…, with the client model of its display for a thumbnail ("" for none).
type ObjectTemplate struct {
	Entry   int     `json:"entry"`
	Name    string  `json:"name"`
	Type    int     `json:"type"`
	Display int     `json:"display"`
	Size    float32 `json:"size"`
	Model   string  `json:"model"`
}

var (
	templatesMu    sync.Mutex
	creaturesCache = map[string][]CreatureTemplate{}
	objectsCache   = map[string][]ObjectTemplate{}
)

// creatureTemplateSQL selects the columns parseCreatureTemplates reads, for the templates matching `where`.
func creatureTemplateSQL(where, tail string) string {
	return fmt.Sprintf(`SELECT t.entry, t.name, COALESCE(t.subname, ''), t.level_min, t.level_max, t.faction, t.npc_flags,
		t.rank, t.type, COALESCE(NULLIF(t.display_id1, 0), NULLIF(t.display_id2, 0), NULLIF(t.display_id3, 0), NULLIF(t.display_id4, 0), 0),
		CASE WHEN t.display_id1 <> 0 THEN t.display_scale1 WHEN t.display_id2 <> 0 THEN t.display_scale2
		WHEN t.display_id3 <> 0 THEN t.display_scale3 ELSE t.display_scale4 END, t.equipment_id
		FROM creature_template t WHERE %s AND t.patch = (SELECT MAX(patch) FROM creature_template WHERE entry = t.entry) %s`, where, tail)
}

// parseCreatureTemplates reads creatureTemplateSQL's rows.
func parseCreatureTemplates(raw []byte) []CreatureTemplate {
	var out []CreatureTemplate
	for _, f := range batchRows(raw, 12) {
		var c CreatureTemplate
		c.Name, c.Subname = f[1], f[2]
		ok := true
		for i, p := range []*int{&c.Entry, nil, nil, &c.LevelMin, &c.LevelMax, &c.Faction, &c.NPCFlags, &c.Rank, &c.Type, &c.Display, nil, &c.Equipment} {
			if p == nil {
				continue
			}
			n, err := strconv.Atoi(f[i])
			ok = ok && err == nil
			*p = n
		}
		scale, err := strconv.ParseFloat(f[10], 32)
		if !ok || err != nil {
			continue
		}
		c.Scale = float32(scale)
		if c.Scale <= 0 {
			c.Scale = 1
		}
		out = append(out, c)
	}
	return out
}

// ListCreatureTemplates lists every creature template, dressed in its first display (no
// equipment, standing, weapons out) for a thumbnail, by name.
func ListCreatureTemplates(serverRoot, dataDir string) ([]CreatureTemplate, error) {
	key := dataDir + "|" + serverRoot
	templatesMu.Lock()
	defer templatesMu.Unlock()
	if c, ok := creaturesCache[key]; ok {
		return c, nil
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, creatureTemplateSQL("1", "ORDER BY t.name, t.entry"))
	if err != nil {
		return nil, err
	}
	out := parseCreatureTemplates(raw)
	for i := range out {
		c := &out[i]
		look := tables.creatureLook(uint32(c.Display), gear{sheath: sheathMelee})
		c.Model, c.Look, c.DisplayScale = look.model, look.look.Query(), look.scale
	}
	creaturesCache[key] = out
	return out, nil
}

// ListObjectTemplates lists every game object template with its display's model, by name.
func ListObjectTemplates(serverRoot, dataDir string) ([]ObjectTemplate, error) {
	key := dataDir + "|" + serverRoot
	templatesMu.Lock()
	defer templatesMu.Unlock()
	if o, ok := objectsCache[key]; ok {
		return o, nil
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, `SELECT t.entry, t.name, t.type, t.displayId, t.size FROM gameobject_template t
		WHERE t.patch = (SELECT MAX(patch) FROM gameobject_template WHERE entry = t.entry) ORDER BY t.name, t.entry`)
	if err != nil {
		return nil, err
	}
	var out []ObjectTemplate
	for _, f := range batchRows(raw, 5) {
		entry, err1 := strconv.Atoi(f[0])
		typ, err2 := strconv.Atoi(f[2])
		display, err3 := strconv.Atoi(f[3])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		size, _ := strconv.ParseFloat(f[4], 32)
		if size <= 0 {
			size = 1
		}
		o := ObjectTemplate{Entry: entry, Name: f[1], Type: typ, Display: display, Size: float32(size), Model: tables.objectModel(uint32(display))}
		out = append(out, o)
	}
	objectsCache[key] = out
	return out, nil
}

// forgetObjectTemplates drops the cached game object lists, after a template was saved or made.
func forgetObjectTemplates() {
	templatesMu.Lock()
	defer templatesMu.Unlock()
	clear(objectsCache)
	forgetObjectDisplays()
}

// ObjectModel is the client model of game object display display ("" for none or an unknown one).
func ObjectModel(dataDir string, display int) (string, error) {
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return "", err
	}
	return tables.objectModel(uint32(max(display, 0))), nil
}

// NextObjectGUID is the first game object guid above every one the world database has.
func NextObjectGUID(serverRoot string) (int, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return 0, err
	}
	raw, err := runSQL(db, "SELECT COALESCE(MAX(guid), 0) + 1 FROM gameobject")
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(raw)))
}
