package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/mapfile"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// writePNG writes a w by h image whose alpha is alpha everywhere, a gradient in colour.
func writePNG(t *testing.T, dir string, w, h int, alpha byte) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := y*img.Stride + x*4
			img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = byte(x*4), byte(y*4), 90, alpha
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return writeFile(t, dir, "in.png", buf.Bytes())
}

func decodeInfo[T any](t *testing.T, out string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(out), &v); err != nil {
		t.Fatalf("%v in %s", err, out)
	}
	return v
}

// TestBlpEncodeDecode encodes a PNG as the client's textures are (DXT3 with alpha, DXT1 without,
// mips down to 1x1), reads it back, and refuses a size the client can't load.
func TestBlpEncodeDecode(t *testing.T) {
	dir := t.TempDir()
	for _, c := range []struct {
		alpha  byte
		format string
	}{{128, "dxt3"}, {255, "dxt1"}} {
		in := writePNG(t, dir, 64, 32, c.alpha)
		blp := filepath.Join(dir, "out.blp")
		code, out, errOut := call(t, "blp", "encode", "-o", blp, in)
		if code != 0 {
			t.Fatalf("encode: exit %d: %s", code, errOut)
		}
		if info := decodeInfo[blpInfo](t, out); info.Format != c.format || info.Mips != 7 || info.W != 64 || info.H != 32 {
			t.Fatalf("encode alpha %d: %+v", c.alpha, info)
		}
		back := filepath.Join(dir, "back.png")
		code, out, errOut = call(t, "blp", "decode", "-o", back, blp)
		if code != 0 {
			t.Fatalf("decode: exit %d: %s", code, errOut)
		}
		if info := decodeInfo[blpInfo](t, out); info.Format != c.format || info.Out != back {
			t.Fatalf("decode: %+v", info)
		}
		f, err := os.Open(back)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(f)
		_ = f.Close()
		if err != nil {
			t.Fatal(err)
		}
		if b := img.Bounds(); b.Dx() != 64 || b.Dy() != 32 {
			t.Fatalf("decoded %v", b)
		}
		if _, _, _, a := img.At(10, 10).RGBA(); int(a>>8)-int(c.alpha) > 9 || int(c.alpha)-int(a>>8) > 9 {
			t.Fatalf("alpha %d read back as %d", c.alpha, a>>8)
		}
	}
	code, _, _ := call(t, "blp", "encode", "-o", filepath.Join(dir, "x.blp"), "--mips=false", writePNG(t, dir, 48, 32, 255))
	if code != 2 {
		t.Fatalf("a 48x32 image encoded (exit %d)", code)
	}
	if code, _, _ := call(t, "blp", "decode", writePNG(t, dir, 4, 4, 255)); code != 2 {
		t.Fatalf("decode without -o: exit %d", code)
	}
}

// testM2Header is a vanilla M2 header named name, with a bounding box and one hardcoded and one
// replaceable texture, and nothing to draw.
func testM2Header(name string) []byte {
	b := make([]byte, 0x144)
	copy(b, "MD20")
	put := func(o int, v uint32) { binary.LittleEndian.PutUint32(b[o:], v) }
	put(4, 256)
	for i, v := range []float32{-1, -2, 0, 1, 2, 3} {
		put(0xB4+i*4, math.Float32bits(v))
	}
	put(0xCC, math.Float32bits(4))
	tex := `World\Test\Bark.blp`
	put(0x5C, 2)
	put(0x60, uint32(len(b)))
	names := len(b) + 32
	recs := make([]byte, 32)
	binary.LittleEndian.PutUint32(recs[8:], uint32(len(tex)+1))
	binary.LittleEndian.PutUint32(recs[12:], uint32(names))
	binary.LittleEndian.PutUint32(recs[16:], 11)
	b = append(b, recs...)
	b = append(append(b, tex...), 0)
	put(0x08, uint32(len(name)+1))
	put(0x0C, uint32(len(b)))
	return append(append(b, name...), 0)
}

func TestM2Info(t *testing.T) {
	p := writeFile(t, t.TempDir(), "Tree.m2", testM2Header("Tree"))
	code, out, errOut := call(t, "m2", "info", p)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	info := decodeInfo[m2Info](t, out)
	if info.Name != "Tree" || info.Version != 256 || info.BoundsMax != [3]float32{1, 2, 3} || info.Radius != 4 || info.Counts["textures"] != 2 {
		t.Fatalf("info %+v", info)
	}
	if len(info.Textures) != 2 || info.Textures[0].File != `World\Test\Bark.blp` || info.Textures[1].Type != 11 || info.Textures[1].File != "" {
		t.Fatalf("textures %+v", info.Textures)
	}
	if info.Draw != nil || info.DrawError == "" {
		t.Fatalf("a model without views draws %+v (%q)", info.Draw, info.DrawError)
	}
	if code, _, _ := call(t, "m2", "info", writeFile(t, t.TempDir(), "bad.m2", []byte("nope"))); code != 2 {
		t.Fatalf("a file that isn't an M2: exit %d", code)
	}
}

func chunk(id string, data []byte) []byte {
	b := []byte{id[3], id[2], id[1], id[0], 0, 0, 0, 0}
	binary.LittleEndian.PutUint32(b[4:], uint32(len(data)))
	return append(b, data...)
}

// TestWmoInfo reads a root with two groups, one of them on disk beside it.
func TestWmoInfo(t *testing.T) {
	dir := t.TempDir()
	mohd := make([]byte, 64)
	binary.LittleEndian.PutUint32(mohd[0:], 1)
	binary.LittleEndian.PutUint32(mohd[4:], 2)
	binary.LittleEndian.PutUint32(mohd[20:], 1)
	binary.LittleEndian.PutUint32(mohd[48:], math.Float32bits(5))
	momt := make([]byte, 64)
	mods := make([]byte, 32)
	copy(mods, "Set_$DefaultGlobal")
	binary.LittleEndian.PutUint32(mods[24:], 1)
	mogi := make([]byte, 64)
	binary.LittleEndian.PutUint32(mogi[28:], 0)
	binary.LittleEndian.PutUint32(mogi[32+28:], 5)
	root := chunk("MVER", []byte{17, 0, 0, 0})
	for _, c := range []struct {
		id   string
		data []byte
	}{
		{"MOHD", mohd}, {"MOTX", []byte("Wall.blp\x00")}, {"MOMT", momt}, {"MOGN", []byte("hall\x00room\x00")}, {"MOGI", mogi},
		{"MODN", []byte("Chair.mdx\x00")}, {"MODS", mods}, {"MODD", make([]byte, 40)},
	} {
		root = append(root, chunk(c.id, c.data)...)
	}
	p := writeFile(t, dir, "Hut.wmo", root)
	mogp := make([]byte, 68)
	binary.LittleEndian.PutUint32(mogp[8:], 0x2000)
	mogp = append(mogp, chunk("MOPY", []byte{0, 0, 0, 0xFF})...)
	mogp = append(mogp, chunk("MOVI", make([]byte, 12))...)
	mogp = append(mogp, chunk("MOVT", make([]byte, 36))...)
	mogp = append(mogp, chunk("MODR", []byte{0, 0})...)
	writeFile(t, dir, "Hut_000.wmo", append(chunk("MVER", []byte{17, 0, 0, 0}), chunk("MOGP", mogp)...))

	// The second group's file is neither on disk nor in a client.
	code, out, errOut := call(t, "wmo", "info", "--client", filepath.Join(dir, "none.MPQ"), p)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	info := decodeInfo[wmoInfo](t, out)
	if info.Version != 17 || info.Counts.Groups != 2 || info.BoundsMax[0] != 5 || len(info.Materials) != 1 || info.Materials[0].Texture != "Wall.blp" {
		t.Fatalf("info %+v", info)
	}
	if len(info.DoodadModel) != 1 || info.DoodadModel[0] != "Chair.m2" || len(info.DoodadSets) != 1 || info.DoodadSets[0].Doodads != 1 {
		t.Fatalf("doodads %v, sets %+v", info.DoodadModel, info.DoodadSets)
	}
	g := info.Groups
	if len(g) != 2 || g[0].Name != "hall" || !g[0].Interior || g[0].Vertices != 3 || g[0].Triangles != 1 || g[0].Doodads != 1 || g[0].Missing != "" {
		t.Fatalf("group 0 %+v", g)
	}
	if g[1].Name != "room" || g[1].Missing == "" || info.Triangles != 1 {
		t.Fatalf("group 1 %+v, %d triangles", g[1], info.Triangles)
	}
}

// TestHeightmapExportImport writes a map's heights as an image and back, onto the same map and onto
// a range, and stretches a smaller image over it.
func TestHeightmapExportImport(t *testing.T) {
	const size = 16
	dir := t.TempDir()
	heights := make([]byte, (size+1)*(size+1)*4)
	for i := 0; i < (size+1)*(size+1); i++ {
		binary.LittleEndian.PutUint32(heights[i*4:], math.Float32bits(float32(i%17)*8-40))
	}
	enc := base64.StdEncoding.EncodeToString
	m := &mapfile.MapData{
		Header:     mapfile.Header{Name: "Test", Size: size, CellSize: 1, SplatRes: 16},
		Heights:    enc(heights),
		Weights:    enc(make([]byte, 16*16*4)),
		ChunkSlots: enc(make([]byte, 4*mapfile.SlotsPerChunk)),
	}
	src := filepath.Join(dir, "test.wmap")
	if err := mapfile.Save(src, m); err != nil {
		t.Fatal(err)
	}
	img := filepath.Join(dir, "h.png")
	code, out, errOut := call(t, "heightmap", "export", "-o", img, src)
	if code != 0 {
		t.Fatalf("export: exit %d: %s", code, errOut)
	}
	if info := decodeInfo[heightmapInfo](t, out); info.Side != size+1 || info.HeightMin != -40 || info.HeightMax != 88 {
		t.Fatalf("export %+v", info)
	}
	back := filepath.Join(dir, "back.wmap")
	if code, _, errOut := call(t, "heightmap", "import", "-o", back, src, img); code != 0 {
		t.Fatalf("import: exit %d: %s", code, errOut)
	}
	m2, err := mapfile.Load(back)
	if err != nil {
		t.Fatal(err)
	}
	h, _, err := mapHeights(m2)
	if err != nil {
		t.Fatal(err)
	}
	for i, v := range h {
		if want := float32(i%17)*8 - 40; math.Abs(float64(v-want)) > 0.02 {
			t.Fatalf("height %d came back %v, want %v", i, v, want)
		}
	}
	// A 2x2 image, black on the left and white on the right, stretched over 0 to 100.
	grey := image.NewGray16(image.Rect(0, 0, 2, 2))
	grey.Pix = []byte{0, 0, 255, 255, 0, 0, 255, 255}
	var buf bytes.Buffer
	if err := png.Encode(&buf, grey); err != nil {
		t.Fatal(err)
	}
	small := writeFile(t, dir, "small.png", buf.Bytes())
	code, out, errOut = call(t, "heightmap", "import", "--min", "0", "--max", "100", "-o", back, src, small)
	if code != 0 {
		t.Fatalf("import small: exit %d: %s", code, errOut)
	}
	if info := decodeInfo[heightmapInfo](t, out); info.ImageSide != 2 || info.HeightMin != 0 || info.HeightMax != 100 {
		t.Fatalf("import small %+v", info)
	}
	m2, _ = mapfile.Load(back)
	h, side, _ := mapHeights(m2)
	if mid := h[8*side+8]; math.Abs(float64(mid-50)) > 0.01 {
		t.Fatalf("the middle of the ramp is %v, want 50", mid)
	}
	if code, _, _ := call(t, "heightmap", "import", src, small); code != 2 {
		t.Fatalf("import without -o: exit %d", code)
	}
}

// TestRecordArguments checks the record commands' arguments, which fail before any database call.
func TestRecordArguments(t *testing.T) {
	for _, args := range [][]string{
		{"creature", "get"},
		{"item", "get", "1", "2"},
		{"spell", "search"},
		{"creature", "get", "--server", t.TempDir(), "abc"},
	} {
		if code, _, _ := call(t, args...); code != 2 {
			t.Fatalf("%v: exit %d", args, code)
		}
	}
	if code, _, errOut := call(t, "item", "get", "--server", t.TempDir(), "25"); code != 2 || !strings.Contains(errOut, "not a VMaNGOS server folder") {
		t.Fatalf("a folder without mangosd.conf: exit %d, %q", code, errOut)
	}
	if code, _, _ := call(t, "quest", "get", "1"); code != 2 {
		t.Fatalf("an unknown kind: exit %d", code)
	}
}

// TestRecordsLive reads Hogger, an item, an object and a spell from the machine's server and client
// (testclient: skipped without them).
func TestRecordsLive(t *testing.T) {
	server := testclient.ServerDir(t)
	data, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	code, out, errOut := call(t, "creature", "get", "--server", server, "448")
	if code != 0 || !strings.Contains(out, `"name": "Hogger"`) {
		t.Fatalf("creature get: exit %d: %s%s", code, errOut, out[:min(len(out), 300)])
	}
	code, out, errOut = call(t, "creature", "search", "--server", server, "--table", "hogger")
	if code != 0 || !strings.HasPrefix(out, "entry") || !strings.Contains(out, "448") {
		t.Fatalf("creature search: exit %d: %s%s", code, errOut, out)
	}
	code, out, errOut = call(t, "item", "search", "--server", server, "Linen Cloth")
	if code != 0 || !strings.Contains(out, `"entry": 2589`) {
		t.Fatalf("item search: exit %d: %s%s", code, errOut, out)
	}
	code, out, errOut = call(t, "object", "search", "--server", server, "--client", data, "--limit", "2", "mailbox")
	if code != 0 || !strings.Contains(out, `"name": "Mailbox"`) {
		t.Fatalf("object search: exit %d: %s%s", code, errOut, out)
	}
	code, out, errOut = call(t, "spell", "get", "--server", server, "--client", data, "--table", "133")
	if code != 0 || !strings.HasPrefix(out, "entry") || !strings.Contains(out, "Fireball") {
		t.Fatalf("spell get: exit %d: %s%s", code, errOut, out[:min(len(out), 300)])
	}
	code, out, errOut = call(t, "spell", "search", "--client", data, "133")
	if code != 0 || !strings.Contains(out, `"id": 133`) {
		t.Fatalf("spell search: exit %d: %s%s", code, errOut, out)
	}
	if code, _, _ := call(t, "creature", "get", "--server", server, "99999999"); code != 2 {
		t.Fatalf("a missing creature: exit %d", code)
	}
}

// TestModelInfoClient reads a model of each kind from the machine's client (skipped without one).
func TestModelInfoClient(t *testing.T) {
	client := testclient.DataDir(t)
	code, out, errOut := call(t, "m2", "info", "--client", client, `World\Dungeon\GoldshireInn\InnChandelier\InnChandelier.m2`)
	if code != 0 {
		t.Fatalf("m2 info: exit %d: %s", code, errOut)
	}
	if info := decodeInfo[m2Info](t, out); info.Draw == nil || info.Draw.Triangles == 0 || len(info.Textures) == 0 {
		t.Fatalf("m2 info %+v", info)
	}
	code, out, errOut = call(t, "wmo", "info", "--client", client, `World\wmo\Azeroth\Buildings\GoldshireInn\GoldshireInn.wmo`)
	if code != 0 {
		t.Fatalf("wmo info: exit %d: %s", code, errOut)
	}
	info := decodeInfo[wmoInfo](t, out)
	if len(info.Groups) == 0 || info.Triangles == 0 || len(info.DoodadSets) < 2 {
		t.Fatalf("wmo info %+v", info)
	}
	for _, g := range info.Groups {
		if g.Missing != "" {
			t.Fatalf("group %d: %s", g.Index, g.Missing)
		}
	}
	png := filepath.Join(t.TempDir(), "goldshire.png")
	code, out, errOut = call(t, "blp", "decode", "--client", client, "-o", png, `Interface\WorldMap\Elwynn\Goldshire1.blp`)
	if code != 0 {
		t.Fatalf("blp decode: exit %d: %s", code, errOut)
	}
	if info := decodeInfo[blpInfo](t, out); info.Format != "dxt3" || info.W != 256 {
		t.Fatalf("blp decode %+v", info)
	}
}
