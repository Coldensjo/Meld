package otbm

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/worldfile"
)

// Import reads the map at mapPath with the item table at itemsPath (items.otb, items.xml beside it for
// the names), saves the cube world to outPath, and beside it outPath without .world plus ".items.csv":
// every item id the map holds, the texture it is painted as, its name, how often it stands on a tile
// and how often it became each outcome. Returns the report.
func Import(mapPath, itemsPath, outPath string) (*Report, error) {
	items, err := LoadItems(itemsPath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(mapPath)
	if err != nil {
		return nil, err
	}
	w, rep, err := Convert(data, items)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", mapPath, err)
	}
	if err := worldfile.Save(outPath, w); err != nil {
		return nil, err
	}
	if err := writeItemList(strings.TrimSuffix(outPath, filepath.Ext(outPath))+".items.csv", rep, items); err != nil {
		return nil, err
	}
	return rep, nil
}

// writeItemList writes the report's items to path as CSV, most used first.
func writeItemList(path string, rep *Report, items Items) error {
	ids := make([]uint16, 0, len(rep.Items))
	for id := range rep.Items {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := rep.Items[ids[i]].Count, rep.Items[ids[j]].Count
		return a > b || a == b && ids[i] < ids[j]
	})
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	cw := csv.NewWriter(f)
	_ = cw.Write(append([]string{"item", "texture", "name", "uses"}, Outcomes...))
	for _, id := range ids {
		u := rep.Items[id]
		name := ""
		if it := items[id]; it != nil {
			name = it.Name
		}
		texture := ""
		if u.Painted() {
			texture = strconv.Itoa(TextureBase + int(id))
		}
		row := []string{strconv.Itoa(int(id)), texture, name, strconv.Itoa(u.Count)}
		for _, as := range Outcomes {
			row = append(row, strconv.Itoa(u.As[as]))
		}
		_ = cw.Write(row)
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// Summary is the report in a few lines, for a status message or a command's output.
func (r *Report) Summary() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d tiles read, %d cubes made, %d item ids.\n", r.Tiles, r.Cubes, len(r.Items))
	fmt.Fprintf(&b, "Tibia (%d, %d) is cube (0, 0); floor z is layer z + %d.\n", r.MinX, r.MinY, FloorLayer)
	if r.Spawn != "" {
		fmt.Fprintf(&b, "Spawn: %s.\n", r.Spawn)
	}
	for _, w := range r.Warnings {
		fmt.Fprintf(&b, "Warning: %s.\n", w)
	}
	return b.String()
}
