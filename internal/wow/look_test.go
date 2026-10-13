package wow

import (
	"net/url"
	"reflect"
	"testing"
)

func TestLookQueryRoundTrip(t *testing.T) {
	l := Look{
		Textures: map[int]string{TexHair: `Character\Human\Hair00_00.blp`, TexBody: `Textures\BakedNpcTextures\a b.blp`},
		Geosets:  []int{702, 0, 5, 1302},
		Attach:   []Attachment{{Point: AttachHelm, Model: `Item\ObjectComponents\Head\Helm_HuM.mdx`, Texture: `Item\ObjectComponents\Head\Helm.blp`}},
		Anim:     69,
	}
	q := l.Query()
	v, err := url.ParseQuery(q)
	if err != nil {
		t.Fatal(err)
	}
	got := ParseLook(v)
	want := l
	want.Geosets = []int{0, 5, 702, 1302}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("round trip:\n got %+v\nwant %+v", got, want)
	}
	// The same look gives the same query, whatever order its parts came in.
	l.Geosets = []int{1302, 5, 702, 0}
	if l.Query() != q {
		t.Fatalf("query differs for the same look:\n%s\n%s", l.Query(), q)
	}
	if !(Look{}).Empty() || l.Empty() {
		t.Fatal("Empty is wrong")
	}
	if (Look{}).Query() != "" {
		t.Fatalf("an empty look's query must be empty, got %q", (Look{}).Query())
	}
}

func TestGeosetFilter(t *testing.T) {
	if geosetFilter(`Creature\Wolf\Wolf.mdx`, nil) != nil {
		t.Fatal("a creature model shows every submesh")
	}
	def := geosetFilter(`Character\Human\Male\HumanMale.mdx`, nil)
	if !def(0) || !def(1) || def(2) || def(1002) || !def(702) {
		t.Fatal("a character model without a look shows the default geosets")
	}
	f := geosetFilter(`Character\Human\Male\HumanMale.mdx`, &Look{Geosets: []int{0, 7}})
	if !f(7) || f(1) {
		t.Fatal("a look's geosets replace the default")
	}
}

func TestMeshAttach(t *testing.T) {
	m := &Mesh{
		Pos:    []float32{0, 0, 0},
		Normal: []float32{0, 1, 0},
		UV:     []float32{0, 0},
		Index:  []uint32{0, 0, 0},
		Groups: []Group{{Start: 0, Count: 3}},
		Anim:   &Anim{BoneIdx: []byte{3, 0, 0, 0}, BoneW: []byte{255, 0, 0, 0}},
		points: map[int]attachPoint{AttachHandRight: {Bone: 7, Pos: [3]float32{1, 2, 3}}},
	}
	item := &Mesh{
		Pos:     []float32{0.5, 0, 0, 0, 1, 0},
		Normal:  []float32{0, 1, 0, 0, 1, 0},
		UV:      []float32{0, 0, 1, 1},
		Index:   []uint32{0, 1, 1},
		Groups:  []Group{{Start: 0, Count: 3, Texture: "sword.blp"}},
		Effects: []Effect{{Kind: "fire", Pos: [3]float32{0, 1, 0}}},
	}
	if m.Attach(AttachHelm, item) {
		t.Fatal("a point the model lacks must not attach")
	}
	if !m.Attach(AttachHandRight, item) {
		t.Fatal("attach failed")
	}
	if want := []float32{0, 0, 0, 1.5, 2, 3, 1, 3, 3}; !reflect.DeepEqual(m.Pos, want) {
		t.Fatalf("positions %v, want %v", m.Pos, want)
	}
	if want := []uint32{0, 0, 0, 1, 2, 2}; !reflect.DeepEqual(m.Index, want) {
		t.Fatalf("indices %v, want %v", m.Index, want)
	}
	if want := []byte{3, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0}; !reflect.DeepEqual(m.Anim.BoneIdx, want) {
		t.Fatalf("bone indices %v, want the hand's bone for the item", m.Anim.BoneIdx)
	}
	if len(m.Anim.BoneW) != 12 || m.Anim.BoneW[4] != 255 {
		t.Fatalf("bone weights %v", m.Anim.BoneW)
	}
	if len(m.Effects) != 1 || m.Effects[0].Pos != [3]float32{1, 3, 3} {
		t.Fatalf("the item's flame moves with it: %+v", m.Effects)
	}
	if item.Pos[0] != 0.5 {
		t.Fatal("the item's own mesh must not change")
	}
}
