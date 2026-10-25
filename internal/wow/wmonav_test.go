package wow

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// iffChunk is a chunk as the client stores it: the FourCC reversed, the size, the data.
func iffChunk(id string, data []byte) []byte {
	out := []byte{id[3], id[2], id[1], id[0], 0, 0, 0, 0}
	binary.LittleEndian.PutUint32(out[4:], uint32(len(data)))
	return append(out, data...)
}

// le packs numbers little-endian: float32s as floats, ints as u32 unless wrapped in u16.
type u16 uint16

func le(vals ...any) []byte {
	var out []byte
	for _, v := range vals {
		switch x := v.(type) {
		case float32:
			out = binary.LittleEndian.AppendUint32(out, math.Float32bits(x))
		case int:
			out = binary.LittleEndian.AppendUint32(out, uint32(x))
		case u16:
			out = binary.LittleEndian.AppendUint16(out, uint16(x))
		}
	}
	return out
}

func TestParseWMONav(t *testing.T) {
	root := iffChunk("MVER", le(17))
	root = append(root, iffChunk("MOHD", le(0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))...)
	root = append(root, iffChunk("MOGN", []byte("\x00stairs\x00"))...)
	root = append(root, iffChunk("MOGI", le(
		0x2000, float32(-5), float32(-5), float32(0), float32(5), float32(5), float32(11), 1,
		0x2000, float32(-20), float32(-20), float32(10), float32(20), float32(20), float32(20), -1,
	))...)
	root = append(root, iffChunk("MOPV", le(float32(-5), float32(-5), float32(10), float32(5), float32(-5), float32(10),
		float32(5), float32(5), float32(10), float32(-5), float32(5), float32(10)))...)
	root = append(root, iffChunk("MOPT", le(u16(0), u16(4), float32(0), float32(0), float32(1), float32(-10)))...)
	root = append(root, iffChunk("MOPR", le(u16(0), u16(1), u16(0xffff), u16(0), u16(0), u16(0), u16(1), u16(0)))...)
	root = append(root, iffChunk("MFOG", append(
		le(0, float32(0), float32(0), float32(0), float32(0), float32(0), float32(444), float32(0.25), 0xff112233, float32(0), float32(0), 0),
		le(1, float32(1), float32(2), float32(3), float32(4), float32(9), float32(80), float32(0.5), 0xff445566, float32(0), float32(0), 0)...))...)

	// Group 0: two triangles, a plain floor and a DETAIL one.
	hdr := make([]byte, 68)
	binary.LittleEndian.PutUint32(hdr[8:], 0x2000)
	binary.LittleEndian.PutUint16(hdr[0x24:], 0)
	binary.LittleEndian.PutUint16(hdr[0x26:], 1)
	copy(hdr[0x30:], []byte{1, 0, 0, 0})
	sub := iffChunk("MOPY", []byte{0x20, 0, mopyDetail, 0})
	sub = append(sub, iffChunk("MOVI", le(u16(0), u16(1), u16(2), u16(0), u16(2), u16(3)))...)
	sub = append(sub, iffChunk("MOVT", le(float32(-5), float32(-5), float32(0), float32(5), float32(-5), float32(0),
		float32(5), float32(5), float32(0), float32(-5), float32(5), float32(0)))...)
	group0 := append(iffChunk("MVER", le(17)), iffChunk("MOGP", append(hdr, sub...))...)

	nav, err := ParseWMONav(root, [][]byte{group0, nil})
	if err != nil {
		t.Fatal(err)
	}
	if len(nav.Groups) != 2 || len(nav.Portals) != 1 || len(nav.Refs) != 2 || len(nav.Fogs) != 2 || len(nav.PortalVerts) != 12 {
		t.Fatalf("counts: %+v", nav)
	}
	g := nav.Groups[0]
	if g.Flags != 0x2000 || g.RefCount != 1 || g.Fogs != [4]uint8{1, 0, 0, 0} || g.Max != [3]float32{5, 5, 11} {
		t.Fatalf("group 0: %+v", g)
	}
	if g.Walk != 1 || g.Camera != 1 || nav.Groups[1].Walk != 0 {
		t.Fatalf("faces: walk %d camera %d, group 1 walk %d", g.Walk, g.Camera, nav.Groups[1].Walk)
	}
	if g.Name != "stairs" || nav.Groups[1].Name != "" {
		t.Fatalf("names %q %q", g.Name, nav.Groups[1].Name)
	}
	if nav.Refs[0] != (WMOPortalRef{Portal: 0, Group: 1, Side: -1}) || nav.Portals[0].Plane[3] != -10 {
		t.Fatalf("portal: %+v %+v", nav.Refs[0], nav.Portals[0])
	}
	if f := nav.Fogs[1]; f.Flags != 1 || f.RadiusOuter != 9 || f.End != 80 || f.StartScalar != 0.5 || f.Color != 0xff445566 {
		t.Fatalf("fog: %+v", f)
	}

	// The body: the header, then group 0's walking face, then its camera-only face.
	b := nav.Encode()
	n := binary.LittleEndian.Uint32(b)
	if n%4 != 0 || len(b) != 4+int(n)+2*9*4 {
		t.Fatalf("encoded %d bytes, header %d", len(b), n)
	}
	var back WMONav
	if err := json.Unmarshal(b[4:4+n], &back); err != nil || len(back.Groups) != 2 {
		t.Fatalf("header: %v", err)
	}
	at := func(i int) float32 { return math.Float32frombits(binary.LittleEndian.Uint32(b[4+int(n)+i*4:])) }
	if at(3) != 5 || at(9+3) != 5 || at(9+4) != 5 || at(9+7) != 5 {
		t.Fatalf("faces: %v %v %v %v", at(3), at(12), at(13), at(16))
	}
}

// TestClientWMONav reads the Goldshire inn's room data: the client check for the down-ray's input.
// WOW_DIR=/path/to/client go test ./internal/wow/ -run ClientWMONav -v
func TestClientWMONav(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	var path string
	for _, p := range c.List("wmo") {
		if strings.HasSuffix(strings.ToLower(p), `\goldshireinn.wmo`) {
			path = p
		}
	}
	if path == "" {
		t.Fatal("no Goldshire inn in the client")
	}
	raw, err := c.read(path)
	if err != nil {
		t.Fatal(err)
	}
	root, _ := ParseWMORoot(raw)
	groups := make([][]byte, root.NumGroups)
	for i := range groups {
		groups[i], _ = c.read(GroupPath(path, i))
	}
	nav, err := ParseWMONav(raw, groups)
	if err != nil {
		t.Fatal(err)
	}
	walk := 0
	for i, g := range nav.Groups {
		walk += g.Walk
		t.Logf("group %d %q: flags %#x, refs %d+%d, fogs %v, %d walk, %d camera", i, g.Name, g.Flags, g.RefStart, g.RefCount, g.Fogs, g.Walk, g.Camera)
		if g.RefStart+g.RefCount > len(nav.Refs) {
			t.Errorf("group %d's portal refs run past MOPR", i)
		}
	}
	t.Logf("%s: %d groups, %d portals, %d refs, %d fogs", path, len(nav.Groups), len(nav.Portals), len(nav.Refs), len(nav.Fogs))
	if len(nav.Groups) != root.NumGroups || len(nav.Portals) == 0 || len(nav.Refs) != 2*len(nav.Portals) || walk == 0 || len(nav.Fogs) == 0 {
		t.Fatal("the inn's room data is incomplete")
	}
	for _, r := range nav.Refs {
		if r.Portal >= len(nav.Portals) || r.Group >= len(nav.Groups) || (r.Side != 1 && r.Side != -1) {
			t.Fatalf("bad ref %+v", r)
		}
	}
	for _, p := range nav.Portals {
		if (p.Start+p.Count)*3 > len(nav.PortalVerts) || p.Count < 3 {
			t.Fatalf("bad portal %+v", p)
		}
	}
}

// TestServerCollision checks the vmap extractor's rules for which faces and groups collide (#283).
func TestServerCollision(t *testing.T) {
	for _, c := range []struct {
		f    byte
		want bool
	}{
		{0, false}, {mopyRender, true}, {mopyRender | mopyDetail, false}, {mopyCollision, true},
		{mopyCollision | mopyDetail, true}, {mopyNoCamCollide, false},
	} {
		if serverCollides(c.f) != c.want {
			t.Errorf("MOPY %#x: collides %v, want %v", c.f, !c.want, c.want)
		}
	}
	for _, c := range []struct {
		g    WMONavGroup
		want bool
	}{
		{WMONavGroup{Flags: 0x2000}, false}, {WMONavGroup{Flags: mogpUnreachable}, true},
		{WMONavGroup{Flags: mogpAntiportal}, true}, {WMONavGroup{Name: "antiportal"}, true},
	} {
		if c.g.serverSkips() != c.want {
			t.Errorf("group %+v: skipped %v, want %v", c.g, !c.want, c.want)
		}
	}
}
