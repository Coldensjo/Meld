package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
)

// What Meld writes into a 2.4.3 or 3.3.5a client, which it reads (#1063, #1065). It writes tiles,
// map files, tables and models in the 1.12 client's formats first, and a later client's own files
// hold what those formats lose or break, so a patch write that holds a file Meld cannot yet write
// for the client is refused whole, before anything is written or kept waiting.
//
// The 3.3.5a client takes:
//
//   - tiles and map files (ADT, WDT): a save keeps a tile's vertex colours (MCCV), flight bounds
//     (MFBO) and MTXF, writes its liquids into MH2O and its paint in the alpha maps its map's WDT
//     asks for (#1068 to #1070);
//   - the tables of laterTables, which are written in the columns the client's own copy has, as
//     long as the table written is as wide as that copy (#1067).
//
// It does not take the other tables (items, spells, sounds and the rest, whose writers are not
// checked against that client) or models, which Meld writes as version 256 (#1071). The 2.4.3
// client takes none of these: its files are read, not yet written.

// LaterWritesEnv is the variable that lets Meld write those files into a later client anyway, for
// the work on its formats (against a throwaway copy of the client, internal/sandbox).
const LaterWritesEnv = "MELD_WRITE_LATER_CLIENTS"

// ErrLaterClient is the error of a patch write refused because the client is a later one.
var ErrLaterClient = errors.New("the client's files are not written")

// laterFormats are the kinds of client file Meld writes in the 1.12 format first, by extension.
var laterFormats = map[string]bool{".adt": true, ".wdt": true, ".dbc": true, ".m2": true}

// laterTables are the tables Meld writes in the 3.3.5a client's layout, by lower-case name: the
// ones a map, its zones, its world map and its flight paths are made of. Their writers set fields
// by the column names of the layout the table's width picks (dbcschemas.go), and the client tests
// write each into that client's own copy.
var laterTables = map[string]bool{
	"map": true, "areatable": true, "worldmaparea": true, "worldmapoverlay": true,
	"taxinodes": true, "taxipath": true, "taxipathnode": true, "areatrigger": true, "loadingscreens": true,
}

// checkWritable refuses files that hold a file Meld cannot write for the 2.4.3 or 3.3.5a client
// whose Data folder dataDir is. A 1.12 client, and a client of a build Meld does not know (read as
// 1.12), takes them all.
func checkWritable(dataDir string, files []mpq.File) error {
	if len(files) == 0 || os.Getenv(LaterWritesEnv) != "" {
		return nil
	}
	b := clientbuild.Detect(dataDir).Build
	if b != clientbuild.TBC && b != clientbuild.WotLK {
		return nil
	}
	var set *mpq.Set
	defer func() {
		if set != nil {
			set.Close()
		}
	}()
	first, why, n := "", "", 0
	for _, f := range files {
		ext := strings.ToLower(filepath.Ext(f.Name))
		if !laterFormats[ext] {
			continue
		}
		reason := ""
		switch {
		case b != clientbuild.WotLK:
			reason = "its tiles, tables and models are read but not yet written"
		case ext == ".m2":
			reason = "Meld writes models as the 1.12 client's version 256, which that client cannot draw"
		case ext == ".dbc":
			if set == nil {
				var err error
				if set, err = mpq.OpenDataDir(dataDir); err != nil {
					return err
				}
			}
			reason = tableRefusal(set, f)
		}
		if reason == "" {
			continue
		}
		if n == 0 {
			first, why = f.Name, reason
		}
		n++
	}
	if n == 0 {
		return nil
	}
	what := first
	if n > 1 {
		what = fmt.Sprintf("%s and %d more", first, n-1)
	}
	return fmt.Errorf("%w: Meld cannot write %s into a %s client: %s. Nothing was written", ErrLaterClient, what, b.Version(), why)
}

// tableRefusal is why table f is not written into the 3.3.5a client set reads, or "" when it is:
// one of laterTables, as wide as the client's own copy.
func tableRefusal(set *mpq.Set, f mpq.File) string {
	base := strings.ReplaceAll(f.Name, `\`, "/")
	name := strings.TrimSuffix(filepath.Base(base), filepath.Ext(base))
	if !laterTables[strings.ToLower(name)] {
		return "Meld writes that table in the 1.12 client's columns only"
	}
	own, err := set.ReadFile(f.Name)
	if err != nil {
		return "the client has no table of that name to tell its columns by"
	}
	if len(f.Data) < 20 || len(own) < 20 || string(f.Data[:4]) != "WDBC" ||
		binary.LittleEndian.Uint32(f.Data[8:]) != binary.LittleEndian.Uint32(own[8:]) ||
		binary.LittleEndian.Uint32(f.Data[12:]) != binary.LittleEndian.Uint32(own[12:]) {
		return "the table is not in the columns the client's own has"
	}
	return ""
}
