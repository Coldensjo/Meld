// Command meldtool inspects the files Meld reads and writes, for the checks that would otherwise
// need a scratch Go test or the live app: a .wmap's header and blobs, a 1.12 tile's chunks (dumped
// or compared chunk by chunk), the client's MPQ archives, and the methods the app binds for the
// frontend. It only reads: no subcommand writes into the client or the server.
//
//	go run ./cmd/meldtool wmap info <file.wmap>
//	go run ./cmd/meldtool adt dump [--client DIR] [--chunk x,y] [--placements] <tile>
//	go run ./cmd/meldtool adt diff [--client DIR] [--client-b DIR] [--eps 0.001] [--place-eps 0.01] <a> <b>
//	go run ./cmd/meldtool mpq ls [--client DIR] [filter]
//	go run ./cmd/meldtool mpq cat [--client DIR] [-o file] <path>
//	go run ./cmd/meldtool bindings [--json] [repo dir]
//
// A tile is a file on disk or, when no such file exists, an archive path (World\Maps\...) read from
// the client. The client is --client (the client folder, its Data folder, or one .MPQ file), else
// the wowPath in Meld's config.json.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

const usage = `meldtool: read-only checks of Meld's files (docs/TESTS.md, "meldtool")

  meldtool wmap info <file.wmap>
  meldtool adt dump [--client DIR] [--big-alpha] [--chunk x,y] [--placements] <tile>
  meldtool adt diff [--client DIR] [--client-b DIR] [--big-alpha] [--eps 0.001] [--place-eps 0.01] <a> <b>
  meldtool mpq ls [--client DIR] [filter]
  meldtool mpq cat [--client DIR] [-o file] <path>
  meldtool bindings [--json] [repo dir]

A tile is a file on disk, or an archive path (World\Maps\<map>\<map>_<x>_<y>.adt) read from the
client: --client (the client folder, its Data folder or one .MPQ), else config.json's wowPath.
adt diff exits 1 when the tiles differ, as diff does; --client-b reads b from another client or
archive (patch-3.MPQ against terrain.MPQ: what a patch changed).
`

// errUsage is a call with the wrong arguments; main prints the usage for it.
var errUsage = errors.New("bad arguments")

// errDiffer is adt diff's answer when the tiles differ: exit status 1, without an error message.
var errDiffer = errors.New("tiles differ")

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run is the command without the process around it, so the tests can call it.
func run(args []string, stdout, stderr io.Writer) int {
	err := dispatch(args, stdout)
	switch {
	case err == nil:
		return 0
	case errors.Is(err, errDiffer):
		return 1
	case errors.Is(err, errUsage):
		fmt.Fprintf(stderr, "%v\n\n%s", err, usage)
		return 2
	default:
		fmt.Fprintln(stderr, "meldtool:", err)
		return 2
	}
}

func dispatch(args []string, out io.Writer) error {
	if len(args) == 0 {
		return errUsage
	}
	sub := ""
	if len(args) > 1 {
		sub = args[1]
	}
	switch {
	case args[0] == "wmap" && sub == "info":
		return wmapInfo(args[2:], out)
	case args[0] == "adt" && sub == "dump":
		return adtDump(args[2:], out)
	case args[0] == "adt" && sub == "diff":
		return adtDiff(args[2:], out)
	case args[0] == "mpq" && sub == "ls":
		return mpqList(args[2:], out)
	case args[0] == "mpq" && sub == "cat":
		return mpqCat(args[2:], out)
	case args[0] == "bindings":
		return bindings(args[1:], out)
	case args[0] == "help" || args[0] == "-h" || args[0] == "--help":
		fmt.Fprint(out, usage)
		return nil
	}
	return fmt.Errorf("%w: unknown command %q", errUsage, args)
}

// writeJSON prints v indented, as every JSON-giving subcommand does.
func writeJSON(out io.Writer, v any) error {
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
