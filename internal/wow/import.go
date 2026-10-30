package wow

import (
	"bytes"
	"errors"
	"fmt"
	"sort"
	"strings"

	"Meld/internal/mpq"
)

// Importing models and textures from another client (#858): Meld opens a second client read-only,
// and the chosen assets go into the current client's patch with every file they need, under the same
// paths, so a map that names them finds them in the game too.

// maxImportBytes bounds one import: the files are held in memory until the patch is written.
const maxImportBytes = 512 << 20

// ReadFile reads a client file as Meld's reader sees it (the overlay first).
func (c *Client) ReadFile(path string) ([]byte, error) {
	return c.read(path)
}

// assetDeps names the files an asset's own file refers to: an M2's textures (the hardcoded ones; a
// replaceable slot is filled from the server's tables) and its particles' models; a WMO root's
// groups, materials' textures, doodads (every set) and skybox. A tileset texture brings its `_s`
// sheen twin, which the terrain reads beside it. Paths come back with backslashes.
func assetDeps(path string, b []byte) []string {
	low := strings.ToLower(path)
	var out []string
	add := func(p string) {
		if p = strings.TrimSpace(strings.ReplaceAll(p, "/", `\`)); p != "" {
			out = append(out, p)
		}
	}
	switch {
	case strings.HasSuffix(low, ".m2") || strings.HasSuffix(low, ".mdx"):
		textures, models := m2Refs(b)
		for _, t := range textures {
			add(t)
		}
		for _, m := range models {
			add(m)
		}
	case strings.HasSuffix(low, ".wmo") && !wmoGroupRe.MatchString(low):
		root, err := ParseWMORoot(b)
		if err != nil {
			return nil
		}
		for i := 0; i < root.NumGroups; i++ {
			add(GroupPath(path, i))
		}
		for _, m := range root.Materials {
			add(m.Texture)
		}
		for _, d := range root.AllDoodads {
			add(d.Model)
		}
		for _, c := range chunks(b) {
			if c.id == "MOSB" {
				add(m2Name(cstrAt(c.data, 0)))
			}
		}
	case strings.HasPrefix(low, `tileset\`) && strings.HasSuffix(low, ".blp") && !strings.HasSuffix(low, "_s.blp"):
		add(path[:len(path)-len(".blp")] + "_s.blp")
	}
	return out
}

// m2Name is a model name as the client stores it: ".mdx" and ".mdl" are read as ".m2".
func m2Name(p string) string {
	if l := strings.ToLower(p); strings.HasSuffix(l, ".mdx") || strings.HasSuffix(l, ".mdl") {
		return p[:len(p)-4] + ".m2"
	}
	return p
}

// m2Refs reads a vanilla M2's hardcoded texture names and the models its particle emitters are
// drawn as or recurse into. A file it can't read names nothing.
func m2Refs(b []byte) (textures, models []string) {
	if len(b) < m2HeaderSize || string(b[:4]) != "MD20" {
		return nil, nil
	}
	r := reader{b}
	if n, ofs, err := r.arr(0x5C, 16); err == nil {
		for i := 0; i < n; i++ {
			o := ofs + i*16
			if r.u32(o) != 0 {
				continue
			}
			if name := r.cstr(r.u32(o+12), r.u32(o+8)); name != "" {
				textures = append(textures, name)
			}
		}
	}
	n, ofs := r.u32(0x13C), r.u32(0x140)
	if n > 0 && n <= 256 && ofs > 0 && ofs+n*emitterStride <= len(b) {
		for i := 0; i < n; i++ {
			e := ofs + i*emitterStride
			for _, p := range []string{m2PathAt(r, e+0x18), m2PathAt(r, e+0x20)} {
				if p != "" {
					models = append(models, p)
				}
			}
		}
	}
	return textures, models
}

// ImportOptions are the opt-ins to replace what the current client has a different copy of (#878).
// Without them nothing it already shows changes.
type ImportOptions struct {
	// ReplaceAssets writes a chosen asset whose own file the current client has a different copy of,
	// instead of refusing it (Differs).
	ReplaceAssets bool `json:"replaceAssets"`
	// ReplaceNeeded writes a file an imported asset needs that the current client has a different
	// copy of, instead of keeping the current client's (Kept).
	ReplaceNeeded bool `json:"replaceNeeded"`
}

// ImportPlan is what importing assets from one client into another writes and finds.
type ImportPlan struct {
	// Files are the files to write into the current client's patch.
	Files []mpq.File
	// Bytes is their size together.
	Bytes int64
	// Imported are the chosen assets the files bring in.
	Imported []string
	// Present are the chosen assets the current client has already, the same file with all it needs.
	Present []string
	// Refused are the chosen assets left out, each with the reason.
	Refused []string
	// Differs are the refused assets whose own file the current client has a different copy of: the
	// ones ReplaceAssets would import.
	Differs []string
	// Kept are the files an imported asset needs that the current client has a different copy of:
	// the current client's stays, so what already uses it doesn't change.
	Kept []string
	// Missing are the files an imported asset names that neither client has.
	Missing []string
	// Replaced are the files written over a different copy the current client has (ImportOptions).
	Replaced []string
}

// PlanImport works out what copying the assets at paths (models, buildings or textures) from src
// into dst takes: each asset's own file and every file it needs, read from src, less the ones dst
// has already. A file dst has a different copy of is replaced only as opts allow: otherwise an asset
// whose own file differs is refused (Differs), and a needed file that differs is kept as dst has it
// (Kept), so nothing the current client shows changes.
func PlanImport(src, dst *Client, paths []string, opts ImportOptions) (ImportPlan, error) {
	var plan ImportPlan
	if src == dst {
		return plan, errors.New("the other client is the current one")
	}
	// seen are the files an earlier asset took care of, written are those of them it writes, and
	// chosen the assets already answered for.
	seen, written, chosen := map[string]bool{}, map[string]bool{}, map[string]bool{}
	kept, missing, replaced := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, root := range paths {
		root = strings.ReplaceAll(strings.TrimSpace(root), "/", `\`)
		rk := strings.ToLower(root)
		if root == "" || chosen[rk] {
			continue
		}
		chosen[rk] = true
		if seen[rk] {
			// It came with an earlier asset (a building's doodad).
			if written[rk] {
				plan.Imported = append(plan.Imported, root)
			} else {
				plan.Present = append(plan.Present, root)
			}
			continue
		}
		b, err := src.read(root)
		if err != nil {
			plan.Refused = append(plan.Refused, fmt.Sprintf("%s: not in the other client (%v)", root, err))
			continue
		}
		if have, err := dst.read(root); err == nil && !bytes.Equal(have, b) && !opts.ReplaceAssets {
			plan.Differs = append(plan.Differs, root)
			plan.Refused = append(plan.Refused, root+": the current client has a different file there, which Meld doesn't replace")
			continue
		}
		// Walk the asset's files breadth first; the files to write are kept apart until the asset is
		// known to fit, so one that doesn't leaves none of its files behind.
		var files []mpq.File
		var size int64
		var over []string
		local := map[string]bool{strings.ToLower(root): true}
		queue := []string{root}
		for len(queue) > 0 {
			p := queue[0]
			queue = queue[1:]
			body := b
			if p != root {
				if body, err = src.read(p); err != nil {
					if _, err := dst.read(p); err != nil {
						missing[p] = true
					}
					continue
				}
			}
			for _, d := range assetDeps(p, body) {
				if k := strings.ToLower(d); !local[k] && !seen[k] {
					local[k] = true
					queue = append(queue, d)
				}
			}
			have, err := dst.read(p)
			switch {
			case err != nil:
				files = append(files, mpq.File{Name: p, Data: body})
				size += int64(len(body))
			case bytes.Equal(have, body):
			case p == root && opts.ReplaceAssets, p != root && opts.ReplaceNeeded:
				files = append(files, mpq.File{Name: p, Data: body})
				size += int64(len(body))
				over = append(over, p)
			default:
				kept[p] = true
			}
		}
		if len(files) == 0 {
			plan.Present = append(plan.Present, root)
		} else if plan.Bytes+size > maxImportBytes {
			plan.Refused = append(plan.Refused, fmt.Sprintf("%s: its files would take the import past %d MB; import it on its own", root, maxImportBytes>>20))
			continue
		} else {
			plan.Imported = append(plan.Imported, root)
			plan.Files = append(plan.Files, files...)
			plan.Bytes += size
			for _, f := range files {
				written[strings.ToLower(f.Name)] = true
			}
			for _, p := range over {
				replaced[p] = true
			}
		}
		for k := range local {
			seen[k] = true
		}
	}
	plan.Kept, plan.Missing, plan.Replaced = sortedKeys(kept), sortedKeys(missing), sortedKeys(replaced)
	return plan, nil
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
