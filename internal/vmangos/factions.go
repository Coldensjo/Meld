package vmangos

import (
	"fmt"
	"sort"

	"Meld/internal/mpq"
)

// FactionInfo is a FactionTemplate.dbc row as the creature guide offers it: its ID (what
// creature_template.faction holds), the name of its Faction.dbc faction, and how it treats an
// Alliance and a Horde player: "friendly", "neutral" or "hostile".
type FactionInfo struct {
	ID       uint32 `json:"id"`
	Name     string `json:"name"`
	Alliance string `json:"alliance"`
	Horde    string `json:"horde"`
}

// factionTemplate is FactionTemplate.dbc's 1.12 row: ID, faction, flags, the groups it is in, is
// friends with and is enemies with (1 player, 2 Alliance, 4 Horde, 8 monster), then four enemy and
// four friend factions.
type factionTemplate struct {
	id, faction, ours, friendGroup, enemyGroup uint32
	enemies, friends                           [4]uint32
}

func readFactionTemplates(dbc []byte) ([]factionTemplate, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields != 14 {
		return nil, fmt.Errorf("FactionTemplate.dbc has %d fields, not 1.12's 14", t.fields)
	}
	out := make([]factionTemplate, t.records)
	for r := range out {
		f := &out[r]
		f.id, f.faction, f.ours, f.friendGroup, f.enemyGroup = t.u32(r, 0), t.u32(r, 1), t.u32(r, 3), t.u32(r, 4), t.u32(r, 5)
		for i := 0; i < 4; i++ {
			f.enemies[i], f.friends[i] = t.u32(r, 6+i), t.u32(r, 10+i)
		}
	}
	return out, nil
}

func listed(list [4]uint32, faction uint32) bool {
	for _, v := range list {
		if v != 0 && v == faction {
			return true
		}
	}
	return false
}

// reaction is how template a treats template b, as the 1.12 client and the server decide it: a named
// enemy or friend faction first, then the groups.
func reaction(a, b factionTemplate) string {
	switch {
	case listed(a.enemies, b.faction):
		return "hostile"
	case listed(a.friends, b.faction):
		return "friendly"
	case a.enemyGroup&b.ours != 0:
		return "hostile"
	case a.friendGroup&b.ours != 0 || a.ours&b.friendGroup != 0:
		return "friendly"
	}
	return "neutral"
}

// The player templates the reactions are taken against: a human (Alliance) and an orc (Horde).
const (
	allianceTemplate = 1
	hordeTemplate    = 2
)

// factionInfos names each template and works out its reactions; names come from Faction.dbc's
// field 19 (its English name).
func factionInfos(templates []factionTemplate, factionDBC []byte) ([]FactionInfo, error) {
	ft, err := parseDBC(factionDBC)
	if err != nil {
		return nil, err
	}
	var alliance, horde *factionTemplate
	for i := range templates {
		switch templates[i].id {
		case allianceTemplate:
			alliance = &templates[i]
		case hordeTemplate:
			horde = &templates[i]
		}
	}
	if alliance == nil || horde == nil {
		return nil, fmt.Errorf("FactionTemplate.dbc has no player templates 1 and 2")
	}
	out := make([]FactionInfo, 0, len(templates))
	for _, f := range templates {
		name := ""
		if r, ok := ft.row(f.faction); ok && ft.fields > 19 {
			name = ft.str(r, 19)
		}
		out = append(out, FactionInfo{ID: f.id, Name: name, Alliance: reaction(f, *alliance), Horde: reaction(f, *horde)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// Factions lists the client's faction templates with their names and reactions to each side.
func Factions(dataDir string) ([]FactionInfo, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	tdbc, err := set.ReadFile(`DBFilesClient\FactionTemplate.dbc`)
	if err != nil {
		return nil, err
	}
	fdbc, err := set.ReadFile(`DBFilesClient\Faction.dbc`)
	if err != nil {
		return nil, err
	}
	templates, err := readFactionTemplates(tdbc)
	if err != nil {
		return nil, err
	}
	return factionInfos(templates, fdbc)
}
