package otbm

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Item groups and flags of items.otb (the Open Tibia servers' itemloader.h).
const (
	groupGround = 1

	flagBlockSolid      = 1 << 0
	flagBlockProjectile = 1 << 1
	flagAlwaysOnTop     = 1 << 13

	attrServerID     = 0x10
	attrMinimapColor = 0x21
	attrTopOrder     = 0x2B
)

// Item is what the import needs of an item of items.otb: its group, its flags, its minimap colour (an
// index into Tibia's 216 colours, -1 when it has none), the order it is drawn in over the ground (1 a
// border, 2 a wall, 3 a door, 0 for an item without one) and its name from items.xml ("" when unknown).
type Item struct {
	Group    byte
	Flags    uint32
	Colour   int
	TopOrder byte
	Name     string
}

// Ground says whether the item is a tile's ground.
func (it *Item) Ground() bool { return it.Group == groupGround }

// Blocks says whether nothing walks through the item.
func (it *Item) Blocks() bool { return it.Flags&flagBlockSolid != 0 }

// Border says whether the item is a border: drawn on the ground first of all that lies on it, a grass
// edge fraying over dirt or a shore over water, which blocks nothing (3dgame #226).
func (it *Item) Border() bool {
	return !it.Ground() && it.Flags&flagAlwaysOnTop != 0 && it.TopOrder == 1 && !it.Blocks()
}

// Opaque says whether the item blocks sight and missiles as well as walking: rock, earth, a wall.
func (it *Item) Opaque() bool {
	return it.Flags&flagBlockSolid != 0 && it.Flags&flagBlockProjectile != 0
}

// Items is an item table by server id, the ids a map's tiles hold.
type Items map[uint16]*Item

// LoadItems reads items.otb at path and, when there is one beside it, items.xml for the names.
func LoadItems(path string) (Items, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	items := Items{}
	err = walk(data, func(depth int, typ byte, b []byte) error {
		if depth != 1 {
			return nil
		}
		p := &props{b: b}
		it := &Item{Group: typ, Flags: p.u32(), Colour: -1}
		id, has := uint16(0), false
		for p.left() >= 3 && !p.short {
			attr := p.u8()
			body := &props{b: p.take(int(p.u16()))}
			switch attr {
			case attrServerID:
				id, has = body.u16(), true
			case attrMinimapColor:
				it.Colour = int(body.u16())
			case attrTopOrder:
				it.TopOrder = body.u8()
			}
		}
		if has {
			items[id] = it
		}
		return nil
	}, func(int, byte) error { return nil })
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("%s holds no items: is it an items.otb?", path)
	}
	xmlPath := filepath.Join(filepath.Dir(path), "items.xml")
	if f, err := os.Open(xmlPath); err == nil {
		defer f.Close()
		if err := readNames(f, items); err != nil {
			return nil, fmt.Errorf("%s: %w", xmlPath, err)
		}
	}
	return items, nil
}

// readNames sets the names of items from an items.xml: its <item> elements' name, for the one id or the
// range fromid to toid each gives.
func readNames(r io.Reader, items Items) error {
	d := xml.NewDecoder(r)
	// Older servers' files say ISO-8859-1: each byte is its own rune.
	d.CharsetReader = func(charset string, in io.Reader) (io.Reader, error) {
		if c := strings.ToLower(charset); c != "iso-8859-1" && c != "latin1" && c != "windows-1252" {
			return nil, fmt.Errorf("unknown charset %q", charset)
		}
		raw, err := io.ReadAll(in)
		if err != nil {
			return nil, err
		}
		var b bytes.Buffer
		for _, c := range raw {
			b.WriteRune(rune(c))
		}
		return &b, nil
	}
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		el, ok := tok.(xml.StartElement)
		if !ok || el.Name.Local != "item" {
			continue
		}
		var name string
		from, to := -1, -1
		for _, a := range el.Attr {
			switch a.Name.Local {
			case "name":
				name = a.Value
			case "id":
				from, _ = strconv.Atoi(a.Value)
				to = from
			case "fromid":
				from, _ = strconv.Atoi(a.Value)
			case "toid":
				to, _ = strconv.Atoi(a.Value)
			}
		}
		if name == "" || from < 0 || to < from || to > 0xffff {
			continue
		}
		for id := from; id <= to; id++ {
			if it := items[uint16(id)]; it != nil && it.Name == "" {
				it.Name = name
			}
		}
	}
}
