package vmangos

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// iconPNG is a size by size PNG of one colour, made here (no client assets in the tests).
func iconPNG(t *testing.T, size int, c color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for i := 0; i < size*size; i++ {
		img.SetNRGBA(i%size, i/size, c)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// iconClient is a client Data folder with an icon of its own (in base.MPQ) and one Meld added (in
// its patch), each a real icon BLP.
func iconClient(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	own, err := wow.IconFromPNG(iconPNG(t, 64, color.NRGBA{255, 0, 0, 255}))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "base.MPQ"), mpq.Write([]mpq.File{{Name: IconPath("INV_Misc_Bag_07"), Data: own}}), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallPatch(dir, []mpq.File{{Name: IconPath("Meld_Added"), Data: own}}); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestCheckIconName(t *testing.T) {
	for _, name := range []string{"INV_Misc_MyThing", "my_icon_2", "Spell-Fire"} {
		if err := CheckIconName(name); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	for _, name := range []string{"bad.name", "über", "", "a b", `..\up`, strings.Repeat("a", 101)} {
		if CheckIconName(name) == nil {
			t.Errorf("%q was taken", name)
		}
	}
}

func TestPlanIconImport(t *testing.T) {
	dir := iconClient(t)
	red := iconPNG(t, 64, color.NRGBA{255, 0, 0, 255})
	files, names, refused, err := PlanIconImport(dir, []IconSource{
		{Name: "Probe_New", PNG: iconPNG(t, 128, color.NRGBA{0, 0, 255, 255})},
		{Name: "inv_misc_bag_07", PNG: red},      // the client's own, any case: kept
		{Name: "Meld_Added", PNG: red},           // added earlier: replaced
		{Name: "probe_new", PNG: red},            // the same name twice in one import
		{Name: "Wide", PNG: []byte("no image")},  // not a PNG
		{Name: "bad name", PNG: red},             // not a name
		{Name: "Short", Pixels: []byte{1, 2, 3}}, // not a whole picture
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names, ",") != "Probe_New,Meld_Added" || len(files) != 2 {
		t.Fatalf("names %v, %d files", names, len(files))
	}
	if len(refused) != 5 || !strings.Contains(refused[0], "client has an icon") || !strings.Contains(refused[1], "two pictures") || !strings.Contains(refused[2], "PNG") || !strings.Contains(refused[3], "letters") || !strings.Contains(refused[4], "bytes") {
		t.Fatalf("refused %q", refused)
	}
	if files[0].Name != `Interface\Icons\Probe_New.blp` {
		t.Fatalf("file %s", files[0].Name)
	}
	img, err := wow.DecodeBLP(files[0].Data)
	if err != nil || img.W != 64 || img.Pix[2] < 200 {
		t.Fatalf("the 128 px blue icon reads %v %v", img, err)
	}

	// Written into the patch, the icon is listed with the client's and exports as a PNG.
	if _, err := InstallPatch(dir, files); err != nil {
		t.Fatal(err)
	}
	ForgetIcons()
	list, err := ListItemIcons(dir)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(list, ",") != "INV_Misc_Bag_07,Meld_Added,Probe_New" {
		t.Fatalf("listed %v", list)
	}
	out := t.TempDir()
	n, failed, err := ExportIcons(dir, []string{"Probe_New", "INV_Misc_Bag_07", "Missing", `..\up`}, out)
	if err != nil || n != 2 || strings.Join(failed, ",") != `Missing,..\up` {
		t.Fatalf("exported %d, failed %v, %v", n, failed, err)
	}
	b, err := os.ReadFile(filepath.Join(out, "INV_Misc_Bag_07.png"))
	if err != nil {
		t.Fatal(err)
	}
	back, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if r, _, bl, a := back.At(10, 10).RGBA(); r>>8 < 240 || bl>>8 > 10 || a>>8 != 255 {
		t.Fatalf("the exported red icon reads %v %v %v", r>>8, bl>>8, a>>8)
	}
}

func TestPendingIcons(t *testing.T) {
	root := t.TempDir()
	old := pendingRoot
	pendingRoot = func() string { return root }
	defer func() { pendingRoot = old }()
	dir := iconClient(t)
	files, _, _, err := PlanIconImport(dir, []IconSource{{Name: "Waiting_One", PNG: iconPNG(t, 64, color.NRGBA{0, 255, 0, 255})}}, false)
	if err != nil || len(files) != 1 {
		t.Fatal(files, err)
	}
	// The game is running: the icon waits, and is listed, previewed and exported meanwhile.
	if err := AddPending(dir, files); err != nil {
		t.Fatal(err)
	}
	ForgetIcons()
	list, err := ListItemIcons(dir)
	if err != nil || !strings.Contains(strings.Join(list, ","), "Waiting_One") {
		t.Fatalf("listed %v %v", list, err)
	}
	if _, ok := PendingIcon(dir, `interface/icons/waiting_one.blp`); !ok {
		t.Error("the waiting icon isn't read for the preview")
	}
	if _, ok := PendingIcon(dir, SpellPath); ok {
		t.Error("a waiting table is read as an icon")
	}
	if n, _, err := ExportIcons(dir, []string{"Waiting_One"}, t.TempDir()); err != nil || n != 1 {
		t.Fatalf("exported %d, %v", n, err)
	}
	ForgetIcons()
}

// iconPixels is an IconSize square RGBA picture of one colour, as the page sends it.
func iconPixels(c color.NRGBA) []byte {
	pix := make([]byte, wow.IconSize*wow.IconSize*4)
	for i := 0; i < len(pix); i += 4 {
		pix[i], pix[i+1], pix[i+2], pix[i+3] = c.R, c.G, c.B, c.A
	}
	return pix
}

// readIconRed is the red of the icon's top left pixel as the client reads it (Meld's patch first).
func readIconRed(t *testing.T, dir, name string) byte {
	t.Helper()
	set, err := mpq.OpenDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	b, err := set.ReadFile(IconPath(name))
	if err != nil {
		t.Fatal(err)
	}
	img, err := wow.DecodeBLP(b)
	if err != nil {
		t.Fatal(err)
	}
	return img.Pix[0]
}

// Replace and Delete (#717): a client's icon is overridden in Meld's patch only with replace, and
// deleting the override brings the client's back; an added icon deleted is gone, and one waiting is
// dropped unwritten.
func TestReplaceAndDeleteIcons(t *testing.T) {
	root := t.TempDir()
	old := pendingRoot
	pendingRoot = func() string { return root }
	defer func() { pendingRoot = old }()
	dir := iconClient(t)
	blue := iconPixels(color.NRGBA{0, 0, 255, 255})
	files, names, refused, err := PlanIconImport(dir, []IconSource{{Name: "INV_Misc_Bag_07", Pixels: blue}, {Name: "Probe_Pixels", Pixels: blue}}, true)
	if err != nil || len(refused) != 0 || strings.Join(names, ",") != "INV_Misc_Bag_07,Probe_Pixels" {
		t.Fatalf("names %v, refused %v, %v", names, refused, err)
	}
	if _, err := InstallPatch(dir, files); err != nil {
		t.Fatal(err)
	}
	if r := readIconRed(t, dir, "INV_Misc_Bag_07"); r > 20 {
		t.Fatalf("the replaced icon reads red %d", r)
	}
	for name, want := range map[string]IconState{
		"INV_Misc_Bag_07": {InPatch: true, InClient: true},
		"Probe_Pixels":    {InPatch: true},
		"Meld_Added":      {InPatch: true},
		"Missing":         {},
	} {
		if st, err := ReadIconState(dir, name); err != nil || st != want {
			t.Errorf("%s: %+v %v, want %+v", name, st, err, want)
		}
	}
	if _, err := ReadIconState(dir, `..\up`); err == nil {
		t.Error("a path was taken as a name")
	}

	// Waiting: an added icon the game hasn't got yet.
	waiting, _, _, err := PlanIconImport(dir, []IconSource{{Name: "Waiting_Two", Pixels: blue}}, false)
	if err != nil || len(waiting) != 1 {
		t.Fatal(waiting, err)
	}
	if err := AddPending(dir, waiting); err != nil {
		t.Fatal(err)
	}
	if st, _ := ReadIconState(dir, "Waiting_Two"); st != (IconState{Waiting: true}) {
		t.Fatalf("waiting state %+v", st)
	}

	// Deleting the override and the added one leaves the client's icon and the waiting one alone,
	// and takes the waiting one into the patch.
	if _, err := RemovePatchFiles(dir, []string{IconPath("INV_Misc_Bag_07"), IconPath("Probe_Pixels")}); err != nil {
		t.Fatal(err)
	}
	if r := readIconRed(t, dir, "INV_Misc_Bag_07"); r < 240 {
		t.Fatalf("the client's icon reads red %d after the delete", r)
	}
	ForgetIcons()
	list, err := ListItemIcons(dir)
	if err != nil || strings.Join(list, ",") != "INV_Misc_Bag_07,Meld_Added,Waiting_Two" {
		t.Fatalf("listed %v %v", list, err)
	}
	if st, _ := ReadIconState(dir, "Waiting_Two"); st != (IconState{InPatch: true}) {
		t.Fatalf("the waiting icon wasn't written: %+v", st)
	}

	// A waiting icon deleted is dropped without a write.
	if err := AddPending(dir, []mpq.File{{Name: IconPath("Waiting_Three"), Data: waiting[0].Data}}); err != nil {
		t.Fatal(err)
	}
	if dropped, err := DropPendingFiles(dir, []string{IconPath("Waiting_Three")}); err != nil || !dropped {
		t.Fatalf("dropped %v %v", dropped, err)
	}
	if dropped, err := DropPendingFiles(dir, []string{IconPath("Waiting_Three")}); err != nil || dropped {
		t.Fatalf("dropped twice %v %v", dropped, err)
	}
	if st, _ := ReadIconState(dir, "Waiting_Three"); st != (IconState{}) {
		t.Fatalf("the dropped icon is %+v", st)
	}
	ForgetIcons()
}
