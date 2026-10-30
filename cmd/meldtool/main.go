// Command meldtool is Meld's command line tools. It inspects the files Meld reads and writes, for the
// checks that would otherwise need a scratch Go test or the live app: a .wmap's header and blobs, a
// 1.12 tile's chunks (dumped or compared chunk by chunk), the client's MPQ archives, and the methods
// the app binds for the frontend. It converts local files: BLP textures to and from PNG, a .wmap's
// heights to and from a heightmap image. And it reads an M2's or WMO's facts and the world database's
// creatures, objects, items and spells (#778, #893). No subcommand writes into the client or the
// server; one that does will print what it would do and act only with --write (#778's decision).
// And `meldtool mcp` offers the commands to an AI agent as an MCP server on stdin and stdout (#777).
//
//	go run ./cmd/meldtool wmap info <file.wmap>
//	go run ./cmd/meldtool adt dump [--client DIR] [--chunk x,y] [--placements] <tile>
//	go run ./cmd/meldtool adt diff [--client DIR] [--client-b DIR] [--eps 0.001] [--place-eps 0.01] <a> <b>
//	go run ./cmd/meldtool mpq ls [--client DIR] [filter]
//	go run ./cmd/meldtool mpq cat [--client DIR] [-o file] <path>
//	go run ./cmd/meldtool bindings [--json] [repo dir]
//	go run ./cmd/meldtool blp decode|encode ...
//	go run ./cmd/meldtool m2 info|wmo info [--client DIR] <model>
//	go run ./cmd/meldtool heightmap export|import ...
//	go run ./cmd/meldtool creature|object|item|spell get|search ...
//	go run ./cmd/meldtool mcp
//
// A tile, texture or model is a file on disk or, when no such file exists, an archive path
// (World\Maps\...) read from the client. The client is --client (the client folder, its Data folder,
// or one .MPQ file), else the wowPath in Meld's config.json; the server is --server, else vmangosPath.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

const usage = `meldtool: Meld's command line tools (docs/TESTS.md, "meldtool"). None writes into the
client or the server. The output is JSON, or a table with --table where a command takes it.

  meldtool wmap info <file.wmap>
  meldtool adt dump [--client DIR] [--big-alpha] [--chunk x,y] [--placements] <tile>
  meldtool adt diff [--client DIR] [--client-b DIR] [--big-alpha] [--eps 0.001] [--place-eps 0.01] <a> <b>
  meldtool mpq ls [--client DIR] [filter]
  meldtool mpq cat [--client DIR] [-o file] <path>
  meldtool bindings [--json] [repo dir]

  meldtool blp decode [--client DIR] -o out.png <texture>
  meldtool blp encode [--format auto|dxt1|dxt3] [--mips=false] -o out.blp <in.png>
  meldtool m2 info [--client DIR] <model.m2>
  meldtool wmo info [--client DIR] <model.wmo>
  meldtool heightmap export -o out.png <file.wmap>
  meldtool heightmap import [--min -1024] [--max 1024] -o out.wmap <file.wmap> <image.png>
  meldtool creature|object|item get [--server DIR] [--table] <entry>
  meldtool creature|item search [--server DIR] [--limit 100] [--table] <name or entry>
  meldtool object search [--server DIR] [--client DIR] [--limit 100] [--table] <name or entry>
  meldtool spell get [--server DIR] [--client DIR] [--table] <entry>
  meldtool spell search [--client DIR] [--limit 100] [--table] <name or id>

  meldtool mcp   an MCP server on stdin and stdout, giving an AI agent these commands as tools

A tile, texture or model is a file on disk, or an archive path (World\Maps\<map>\<map>_<x>_<y>.adt)
read from the client: --client (the client folder, its Data folder or one .MPQ), else config.json's
wowPath. adt diff exits 1 when the tiles differ, as diff does; --client-b reads b from another
client or archive (patch-3.MPQ against terrain.MPQ: what a patch changed). mpq ls searches the
client's file list (mpq ls moneyframe finds a UI texture's path), and mpq cat prints a file, such
as the Interface\FrameXML XML or Lua that uses it.

blp encode needs sides that are powers of two, and picks DXT3 for an image with alpha. heightmap
export and import use the app's scale (black -1024 yards, white 1024); import sets every height
(the app's Set mode), stretching an image of another size over the map, and writes -o as a new
file. The server is --server (a VMaNGOS folder), else config.json's vmangosPath; the record
commands start its database when it is down, as the app does.
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
	case args[0] == "blp" && sub == "decode":
		return blpDecode(args[2:], out)
	case args[0] == "blp" && sub == "encode":
		return blpEncode(args[2:], out)
	case args[0] == "m2" && sub == "info":
		return m2InfoCmd(args[2:], out)
	case args[0] == "wmo" && sub == "info":
		return wmoInfoCmd(args[2:], out)
	case args[0] == "heightmap" && sub == "export":
		return heightmapExport(args[2:], out)
	case args[0] == "heightmap" && sub == "import":
		return heightmapImport(args[2:], out)
	case recordKinds[args[0]].get != nil && (sub == "get" || sub == "search"):
		return record(args[0], sub, args[2:], out)
	case args[0] == "mcp":
		return mcpServe(args[1:], out)
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
