package wow

import (
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Look is how a creature display dresses a model: the textures of its replaceable slots, the
// geosets a character model shows, the item models attached to it, and the animation it plays.
// It travels to the model endpoint as a URL query (Query, ParseLook), so every look is its own
// cached mesh.
type Look struct {
	// Textures are the textures for the model's replaceable slots, by M2 texture type (1 body,
	// 2 cape or item skin, 6 hair, 8 fur, 11-13 creature skins).
	Textures map[int]string
	// Geosets are the submesh IDs a character model shows (0 the body, 1-99 a hair style,
	// group*100+n the rest). Nil shows the default for a character model, every submesh otherwise.
	Geosets []int
	// Attach are item models held at the model's attachment points: helmet, shoulders, weapons.
	Attach []Attachment
	// Anim is the AnimationData ID of the loop to play; the model's Stand when it has no such loop.
	Anim int
}

// Attachment is an item model at one of a model's attachment points, with the texture for its
// item skin (texture type 2).
type Attachment struct {
	Point   int
	Model   string
	Texture string
}

// Attachment points (M2Attachment IDs) a dressed creature uses.
const (
	AttachShield        = 0
	AttachHandRight     = 1
	AttachHandLeft      = 2
	AttachShoulderRight = 5
	AttachShoulderLeft  = 6
	AttachHelm          = 11
)

// Replaceable M2 texture types.
const (
	TexBody     = 1
	TexItem     = 2
	TexHair     = 6
	TexFur      = 8
	TexMonster1 = 11
	TexMonster3 = 13
)

// defaultGeosets is what a character model shows with nothing chosen: the body, the first hair
// style, no facial hair, bare hands and feet, ears, plain legs and the back without a cloak (1501).
var defaultGeosets = []int{0, 1, 101, 201, 301, 401, 501, 702, 1301, 1501}

// Empty says the look changes nothing about the model.
func (l Look) Empty() bool {
	return len(l.Textures) == 0 && l.Geosets == nil && len(l.Attach) == 0 && l.Anim == 0
}

// Query encodes the look for the model endpoint, the same way for the same look:
// tex=<type>:<path> per texture, geo=<id>,<id>..., att=<point>:<model>:<texture> per item, and
// anim=<id>.
func (l Look) Query() string {
	v := url.Values{}
	types := make([]int, 0, len(l.Textures))
	for t, p := range l.Textures {
		if p != "" {
			types = append(types, t)
		}
	}
	sort.Ints(types)
	for _, t := range types {
		v.Add("tex", strconv.Itoa(t)+":"+l.Textures[t])
	}
	if l.Geosets != nil {
		ids := append([]int(nil), l.Geosets...)
		sort.Ints(ids)
		parts := make([]string, len(ids))
		for i, id := range ids {
			parts[i] = strconv.Itoa(id)
		}
		v.Set("geo", strings.Join(parts, ","))
	}
	for _, a := range l.Attach {
		v.Add("att", strconv.Itoa(a.Point)+":"+a.Model+":"+a.Texture)
	}
	if l.Anim != 0 {
		v.Set("anim", strconv.Itoa(l.Anim))
	}
	return v.Encode()
}

// ParseLook reads a look from the model endpoint's query, skipping what it can't read.
func ParseLook(q url.Values) Look {
	var l Look
	for _, s := range q["tex"] {
		t, p, ok := strings.Cut(s, ":")
		n, err := strconv.Atoi(t)
		if !ok || err != nil || p == "" {
			continue
		}
		if l.Textures == nil {
			l.Textures = map[int]string{}
		}
		l.Textures[n] = p
	}
	if g, ok := q["geo"]; ok && len(g) > 0 {
		l.Geosets = []int{}
		for _, s := range strings.Split(g[0], ",") {
			if n, err := strconv.Atoi(s); err == nil {
				l.Geosets = append(l.Geosets, n)
			}
		}
	}
	for _, s := range q["att"] {
		parts := strings.SplitN(s, ":", 3)
		if len(parts) != 3 || parts[1] == "" {
			continue
		}
		n, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}
		l.Attach = append(l.Attach, Attachment{Point: n, Model: parts[1], Texture: parts[2]})
	}
	l.Anim, _ = strconv.Atoi(q.Get("anim"))
	return l
}

// geosetFilter says which submeshes of a model to draw: every one for a creature, and for a
// character model (Character\...) the look's geosets or the default ones.
func geosetFilter(path string, look *Look) func(id int) bool {
	var ids []int
	switch {
	case look != nil && look.Geosets != nil:
		ids = look.Geosets
	case strings.HasPrefix(strings.ToLower(path), `character\`):
		ids = defaultGeosets
	default:
		return nil
	}
	show := make(map[int]bool, len(ids))
	for _, id := range ids {
		show[id] = true
	}
	return func(id int) bool { return show[id] }
}
