package vmangos

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
)

// A lights file is what the Lights dialog exports and imports (#945): a map's lights and the params rows
// they name, as JSON, so a lighting look can go to another map or client. The server doesn't read the
// lights, so there is no SQL form.

// lightsFileKind marks a Meld lights file, and LightsFileVersion is the version this build writes.
const (
	lightsFileKind    = "meld-lights"
	LightsFileVersion = 1
)

type lightsFile struct {
	Kind    string `json:"kind"`
	Version int    `json:"version"`
	LightsEdit
}

// MarshalLightsFile writes an edit as a lights file. Params rows go in ID order, so a file exported twice
// from the same lights is the same.
func MarshalLightsFile(e LightsEdit) ([]byte, error) {
	if err := checkLightsFile(e); err != nil {
		return nil, err
	}
	e.Params = slices.Clone(e.Params)
	slices.SortFunc(e.Params, func(a, b LightParamSet) int { return int(a.ID) - int(b.ID) })
	return json.MarshalIndent(lightsFile{Kind: lightsFileKind, Version: LightsFileVersion, LightsEdit: e}, "", "\t")
}

// ParseLightsFile reads a lights file. It refuses a file that isn't one, one from a newer Meld, and lights
// or params the client's tables could not hold.
func ParseLightsFile(b []byte) (LightsEdit, error) {
	var f lightsFile
	if err := json.Unmarshal(b, &f); err != nil {
		return LightsEdit{}, fmt.Errorf("not a lights file: %w", err)
	}
	if f.Kind != lightsFileKind {
		return LightsEdit{}, errors.New("not a Meld lights file")
	}
	if f.Version < 1 || f.Version > LightsFileVersion {
		return LightsEdit{}, fmt.Errorf("lights file version %d; this Meld reads up to %d", f.Version, LightsFileVersion)
	}
	return f.LightsEdit, checkLightsFile(f.LightsEdit)
}

// checkLightsFile is what a lights file must hold: lights with IDs and sane radii, params with IDs and
// all their bands of at most 16 keys.
func checkLightsFile(e LightsEdit) error {
	if len(e.Lights) == 0 {
		return errors.New("the lights file holds no lights")
	}
	for _, l := range e.Lights {
		if l.ID == 0 {
			return errors.New("a light needs an ID")
		}
		if !l.Global && (l.Outer <= 0 || l.Inner < 0 || l.Inner > l.Outer) {
			return fmt.Errorf("light %d: the inner radius must be within the outer one", l.ID)
		}
	}
	for _, p := range e.Params {
		if p.ID == 0 {
			return errors.New("a light's params need an ID")
		}
		if len(p.Colors) != LightBands || len(p.Floats) != LightFloats {
			return fmt.Errorf("params %d has %d colour and %d float bands, want %d and %d", p.ID, len(p.Colors), len(p.Floats), LightBands, LightFloats)
		}
		for _, keys := range slices.Concat(p.Colors, p.Floats) {
			if len(keys) > 16 {
				return fmt.Errorf("params %d: a band has %d keys, the client takes 16", p.ID, len(keys))
			}
		}
	}
	return nil
}
