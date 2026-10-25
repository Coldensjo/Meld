package vmangos

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"Meld/internal/adt"
)

// The editor names a placed model "m2:<path>" or "wmo:<path>"; a WMO showing a doodad set besides its
// global set 0 carries it as a query, "wmo:<path>?set=<n>", which is also what the model endpoint
// draws. adt.ModelType writes the name; parseModelType reads a placement's kind, path and doodad set
// back from it.

// parseModelType splits a model name into its kind, its path and, for a WMO, its doodad set; hasSet says
// the name gives one. A name without one keeps a placement's own set (a map saved before the editor
// named sets), while "?set=0" sets it to the global set alone.
func parseModelType(t string) (kind adt.Kind, name string, set uint16, hasSet bool, err error) {
	base, query, _ := strings.Cut(t, "?")
	switch {
	case strings.HasPrefix(base, "m2:"):
		kind, name = adt.M2, strings.TrimPrefix(base, "m2:")
	case strings.HasPrefix(base, "wmo:"):
		kind, name = adt.WMO, strings.TrimPrefix(base, "wmo:")
	default:
		return kind, "", 0, false, fmt.Errorf("%q is not a model", t)
	}
	if name == "" {
		return kind, "", 0, false, fmt.Errorf("%q has no path", t)
	}
	if kind == adt.WMO && query != "" {
		q, _ := url.ParseQuery(query)
		if s := q.Get("set"); s != "" {
			n, perr := strconv.Atoi(s)
			if perr != nil || n < 0 || n > 0xFFFF {
				return kind, "", 0, false, fmt.Errorf("%q has a bad doodad set", t)
			}
			set, hasSet = uint16(n), true
		}
	}
	return kind, name, set, hasSet, nil
}
