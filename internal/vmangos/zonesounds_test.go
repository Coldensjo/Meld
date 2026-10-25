package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestClientZoneSounds names the client's zone sound rows: Elwynn's music set, the Orgrimmar intro
// and an ambience with a playable file. It needs WOW_DIR.
func TestClientZoneSounds(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	z, err := ZoneSounds(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	has := func(list []SoundOption, part string) *SoundOption {
		for i := range list {
			if strings.Contains(list[i].Name, part) {
				return &list[i]
			}
		}
		return nil
	}
	if m := has(z.Music, "Forest"); m == nil || !strings.HasPrefix(strings.ToLower(m.File), `sound\`) {
		t.Errorf("no forest music with a file: %+v", m)
	}
	if has(z.Intro, "Orgrimmar") == nil {
		t.Error("no Orgrimmar intro")
	}
	if len(z.Ambience) == 0 || z.Ambience[0].Name == "" {
		t.Errorf("ambience unnamed: %+v", z.Ambience[:1])
	}
	if len(z.Prefs) == 0 || z.Prefs[0].Name == "" {
		t.Error("sound preferences unnamed")
	}
	t.Logf("%d music, %d intro, %d ambience, %d prefs; music %+v", len(z.Music), len(z.Intro), len(z.Ambience), len(z.Prefs), *has(z.Music, "Forest"))
}
