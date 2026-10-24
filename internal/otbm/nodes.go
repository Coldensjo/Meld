// Package otbm imports an Open Tibia map (.otbm, as Remere's Map Editor saves it) into a cube world
// (3dgame #218): every tile becomes a cube of the layer its floor maps to, painted with its items' ids
// as textures the game does not have yet, which the owner matches with textures later (Edit > Textures
// in This World). What a cube world has no place for (houses, towns but the first temple, waypoints,
// item attributes, borders and loose items) is dropped. items.otb, the item table the map was made
// with, says which item is a ground, a wall or an obstacle; items.xml beside it names them.
//
// Both files are OTB node streams: a 4-byte magic, then nested nodes, each 0xFE, a type byte, its
// properties and its children, then 0xFF; 0xFD escapes a property byte equal to one of the three.
package otbm

import (
	"errors"
	"fmt"
)

const (
	nodeStart = 0xFE
	nodeEnd   = 0xFF
	escape    = 0xFD
)

// walk reads the node stream in data and calls visit for each node once its properties are read
// (before its children), with its depth (the root's is 0), its type and its unescaped properties,
// which are only valid during the call; and leave after its children. A file cut short ends the walk
// as if its open nodes were closed.
func walk(data []byte, visit func(depth int, typ byte, props []byte) error, leave func(depth int, typ byte) error) error {
	if len(data) < 5 {
		return errors.New("not a node file: too short")
	}
	pos := 4
	if data[pos] != nodeStart {
		return errors.New("not a node file: no root node")
	}
	var types []byte
	props := make([]byte, 0, 256)
	// Whether the innermost node's properties are still being read, not yet given to visit.
	pending := false
	deliver := func() error {
		if !pending {
			return nil
		}
		pending = false
		return visit(len(types)-1, types[len(types)-1], props)
	}
	for pos < len(data) {
		switch b := data[pos]; b {
		case nodeStart:
			if err := deliver(); err != nil {
				return err
			}
			if pos+1 >= len(data) {
				return fmt.Errorf("a node starts at the end of the file")
			}
			types = append(types, data[pos+1])
			props = props[:0]
			pending = true
			pos += 2
		case nodeEnd:
			if len(types) == 0 {
				return fmt.Errorf("a node ends at byte %d that never started", pos)
			}
			if err := deliver(); err != nil {
				return err
			}
			if err := leave(len(types)-1, types[len(types)-1]); err != nil {
				return err
			}
			types = types[:len(types)-1]
			pos++
		case escape:
			if pos+1 < len(data) && pending {
				props = append(props, data[pos+1])
			}
			pos += 2
		default:
			if pending {
				props = append(props, b)
			}
			pos++
		}
	}
	if err := deliver(); err != nil {
		return err
	}
	for len(types) > 0 {
		if err := leave(len(types)-1, types[len(types)-1]); err != nil {
			return err
		}
		types = types[:len(types)-1]
	}
	return nil
}

// props reads little-endian numbers and strings from a node's properties; past the end it gives 0
// and sets short.
type props struct {
	b     []byte
	short bool
}

func (p *props) left() int { return len(p.b) }

func (p *props) take(n int) []byte {
	if n > len(p.b) {
		p.short = true
		p.b = nil
		return nil
	}
	out := p.b[:n]
	p.b = p.b[n:]
	return out
}

func (p *props) u8() byte {
	if b := p.take(1); b != nil {
		return b[0]
	}
	return 0
}

func (p *props) u16() uint16 {
	if b := p.take(2); b != nil {
		return uint16(b[0]) | uint16(b[1])<<8
	}
	return 0
}

func (p *props) u32() uint32 {
	if b := p.take(4); b != nil {
		return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 | uint32(b[3])<<24
	}
	return 0
}

func (p *props) str() string { return string(p.take(int(p.u16()))) }
