package vmangos

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
)

// A 2.4.3 or 3.3.5a client is read (#1063, #1065) but not written yet. Meld writes tiles, map
// files, tables and models in the 1.12 client's formats only, and in a later client those lose or
// break what its own files hold: a stock 3.3.5a tile keeps its water in MH2O, its vertex colours in
// MCCV and its flight bounds in MFBO, none of which adt.Rewrite carries over, and a map whose WDT
// asks for 8-bit alpha maps gets 4-bit ones (#1068 to #1070); a table is written in the 1.12 column
// layout, which that client refuses to load (#1067); a model is written as version 256, which it
// cannot draw (#1071). So a patch write that holds one of those is refused whole, before anything is
// written or kept waiting. A format leaves laterFormats when Meld can write it for the later clients.

// LaterWritesEnv is the variable that lets Meld write those files into a later client anyway, for
// the work on its formats (against a throwaway copy of the client, internal/sandbox).
const LaterWritesEnv = "MELD_WRITE_LATER_CLIENTS"

// ErrLaterClient is the error of a patch write refused because the client is a later one.
var ErrLaterClient = errors.New("the client's files are not written")

// laterFormats are the kinds of client file Meld writes in the 1.12 format only, by extension.
var laterFormats = map[string]bool{".adt": true, ".wdt": true, ".dbc": true, ".m2": true}

// checkWritable refuses files that hold a file of laterFormats for a 2.4.3 or 3.3.5a client's Data
// folder. A 1.12 client, and a client of a build Meld does not know (read as 1.12), takes them all.
func checkWritable(dataDir string, files []mpq.File) error {
	if len(files) == 0 || os.Getenv(LaterWritesEnv) != "" {
		return nil
	}
	b := clientbuild.Detect(dataDir).Build
	if b != clientbuild.TBC && b != clientbuild.WotLK {
		return nil
	}
	first, n := "", 0
	for _, f := range files {
		if laterFormats[strings.ToLower(filepath.Ext(f.Name))] {
			if n == 0 {
				first = f.Name
			}
			n++
		}
	}
	if n == 0 {
		return nil
	}
	what := first
	if n > 1 {
		what = fmt.Sprintf("%s and %d more", first, n-1)
	}
	return fmt.Errorf("%w: Meld reads a %s client but cannot write its tiles, tables and models yet, and writing them in the 1.12 format would lose the water, vertex colours and flight bounds of its tiles (%s). Nothing was written", ErrLaterClient, b.Version(), what)
}
