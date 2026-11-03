package wow

import (
	"strings"
	"testing"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// Integration test against a local client: WOW_DIR=/path/to/WoW go test ./internal/wow/
func TestClientAssets(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	st := c.Status()
	t.Logf("status: %+v", st)

	check := func(kind string, limit int, fn func(string) error) {
		list := c.List(kind)
		step := max(1, len(list)/limit)
		fails, n := 0, 0
		for i := 0; i < len(list); i += step {
			n++
			if err := fn(list[i]); err != nil {
				fails++
				if fails <= 5 {
					t.Logf("  %s FAIL %s: %v", kind, list[i], err)
				}
			}
		}
		t.Logf("%s: %d listed, %d/%d failed", kind, len(list), fails, n)
		if n > 0 && fails*10 > n {
			t.Errorf("%s failure rate too high", kind)
		}
	}
	check("tileset", 300, func(p string) error { _, err := c.Texture(p); return err })
	check("m2", 600, func(p string) error {
		b, err := c.Model(p, Look{})
		if err == nil && len(b) < 16 {
			t.Errorf("tiny mesh for %s", p)
		}
		return err
	})
	check("wmo", 120, func(p string) error { _, err := c.Model(p, Look{}); return err })

	// Textures referenced by models should resolve.
	missing, total := 0, 0
	for _, p := range []string{`World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnFirTree01.m2`} {
		raw, _ := c.read(p)
		m, err := ParseM2(raw, p)
		if err != nil {
			t.Fatal(err)
		}
		for _, g := range m.Groups {
			total++
			if _, err := c.Texture(g.Texture); err != nil {
				missing++
				t.Logf("missing texture %q: %v", g.Texture, err)
			}
		}
		t.Logf("%s: %d verts, %d groups", p, len(m.Pos)/3, len(m.Groups))
	}
	if missing > 0 {
		t.Errorf("%d/%d textures missing", missing, total)
	}
	_ = strings.ToLower
}

// TestClientBuild checks that the configured 1.12 client reads as build 5875 from its Wow.exe
// (#1063). A 2.4.3 or 3.3.5a client is checked by clientbuild's synthetic Wow.exe only.
func TestClientBuild(t *testing.T) {
	dir := testclient.DataDir(t)
	data, err := ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(data)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	info := set.BuildInfo()
	if set.Build() != clientbuild.Vanilla || info.Warning != "" {
		t.Errorf("the client's build = %v (%+v), want %v", set.Build(), info, clientbuild.Vanilla)
	}
	if info.From == "Wow.exe" && info.Exe != "1.12.1.5875" {
		t.Errorf("Wow.exe's FileVersion = %q, want 1.12.1.5875", info.Exe)
	}
	t.Logf("build %+v", info)
}
