package adt

import (
	"math"
	"strconv"
)

// The editor's view of a placement: the name it gives the model and the turn it holds it at. Shared by
// the region reader (vmangos) and the world view's tile models (wow), which reach the editor apart.

// ModelType is the editor's name for a placement: "m2:<path>" or "wmo:<path>", with a WMO's doodad set
// as "?set=<n>" when it isn't 0 (vmangos.parseModelType reads it back).
func ModelType(kind Kind, name string, set uint16) string {
	if kind == WMO {
		if set != 0 {
			return "wmo:" + name + "?set=" + strconv.Itoa(int(set))
		}
		return "wmo:" + name
	}
	return "m2:" + name
}

// EditorTurn is the placement's rotation as the editor holds it, in radians: its yaw (the file's middle
// rotation less 90 degrees) and its tilt forward and back, and side to side (the file's first and last).
func (p Placement) EditorTurn() (rotY, tiltX, tiltZ float32) {
	rad := func(d float64) float32 { return float32(d * math.Pi / 180) }
	return rad(float64(p.Rotation[1]) - 90), rad(float64(p.Rotation[0])), rad(float64(p.Rotation[2]))
}
