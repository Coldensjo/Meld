// Command otbm2world imports an Open Tibia map (.otbm) into a cube world (.world), as the editor's
// File > Import Tibia Map does (internal/otbm, 3dgame #218):
//
//	go run ./cmd/otbm2world -items <items.otb> [-out <world>] <map.otbm>
//
// The world is written beside the map, with the map's name, unless -out says where; an items.csv
// beside the world lists what became of every item id.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"Meld/internal/otbm"
)

func main() {
	items := flag.String("items", "", "the items.otb the map was made with (items.xml beside it names the items)")
	out := flag.String("out", "", "where to write the world (default: beside the map, .world)")
	flag.Parse()
	if flag.NArg() != 1 || *items == "" {
		fmt.Fprintln(os.Stderr, "usage: otbm2world -items <items.otb> [-out <world>] <map.otbm>")
		os.Exit(2)
	}
	mapPath := flag.Arg(0)
	if *out == "" {
		*out = strings.TrimSuffix(mapPath, filepath.Ext(mapPath)) + ".world"
	}
	start := time.Now()
	rep, err := otbm.Import(mapPath, *items, *out)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Print(rep.Summary())
	fmt.Printf("Wrote %s in %.1f s.\n", *out, time.Since(start).Seconds())
}
