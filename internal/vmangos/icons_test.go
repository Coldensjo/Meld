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

func TestIconName(t *testing.T) {
	for file, want := range map[string]string{
		filepath.Join(string(filepath.Separator)+"art", "INV_Misc_MyThing.png"): "INV_Misc_MyThing",
		"/home/me/my icon 2.PNG": "my_icon_2",
		"Spell-Fire.png":         "Spell-Fire",
	} {
		if got, err := IconName(file); err != nil || got != want {
			t.Errorf("%s: %q %v, want %q", file, got, err, want)
		}
	}
	for _, file := range []string{"bad.name.png", "über.png", ".png"} {
		if got, err := IconName(file); err == nil {
			t.Errorf("%s: took %q", file, got)
		}
	}
}

func TestPlanIconImport(t *testing.T) {
	dir := iconClient(t)
	red := iconPNG(t, 64, color.NRGBA{255, 0, 0, 255})
	files, names, refused, err := PlanIconImport(dir, []IconSource{
		{Name: "Probe_New", PNG: iconPNG(t, 128, color.NRGBA{0, 0, 255, 255})},
		{Name: "inv_misc_bag_07", PNG: red},     // the client's own, any case: kept
		{Name: "Meld_Added", PNG: red},          // added earlier: replaced
		{Name: "probe_new", PNG: red},           // the same name twice in one import
		{Name: "Wide", PNG: []byte("no image")}, // not a PNG
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names, ",") != "Probe_New,Meld_Added" || len(files) != 2 {
		t.Fatalf("names %v, %d files", names, len(files))
	}
	if len(refused) != 3 || !strings.Contains(refused[0], "client has an icon") || !strings.Contains(refused[1], "two files") || !strings.Contains(refused[2], "PNG") {
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
	files, _, _, err := PlanIconImport(dir, []IconSource{{Name: "Waiting_One", PNG: iconPNG(t, 64, color.NRGBA{0, 255, 0, 255})}})
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
