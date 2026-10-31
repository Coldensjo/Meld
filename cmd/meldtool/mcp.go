package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// meldtool mcp is an MCP (Model Context Protocol) server on stdin and stdout, so an AI agent can use
// meldtool's commands as tools (#777, the owner's choice A: a wrapper over the CLI of #778, stdio
// only, no port). Each tool is one command: the call's arguments become the command's flags and
// positional arguments, dispatch runs it as the command line would, and its output is the tool's
// text. So the server and the CLI share one code path, and a new command needs only its entry in
// mcpTools. It works with Meld closed, and cannot see the map open in the app.
//
// No command writes into the client or the server yet. One that does takes a `write` boolean
// (false by default) passed as --write, so a call without it is the command's dry run (#778's
// decision), and its tool is not marked read-only.

// mcpParam is one argument of a tool: its name in the call, its JSON type, and the command's flag it
// becomes (flag "" is a positional argument, given in the params' order).
type mcpParam struct {
	name     string
	kind     string // string, integer, number or boolean
	flag     string
	desc     string
	required bool
	enum     []string
}

// mcpTool is one command offered as a tool.
type mcpTool struct {
	name, desc string
	// cmd is the command's words (adt dump), and fixed the flags every call passes (bindings --json).
	cmd, fixed []string
	params     []mcpParam
	// readOnly says the command changes nothing: no file written, nothing in the client or server.
	readOnly bool
}

// mcpOutputCap is the most output a tool returns: an unfiltered mpq ls lists the whole client, which
// would flood the agent's context.
const mcpOutputCap = 200_000

// The arguments several tools share.
var (
	clientParam = mcpParam{name: "client", kind: "string", flag: "client", desc: "The WoW 1.12.1 client folder, its Data folder or one .MPQ file. Default: the client folder set in Meld (config.json's wowPath)."}
	serverParam = mcpParam{name: "server", kind: "string", flag: "server", desc: "The VMaNGOS server folder (with run\\mangosd.conf). Default: the one set in Meld (config.json's vmangosPath). Its database is started when it is down, as the app does."}
	limitParam  = mcpParam{name: "limit", kind: "integer", flag: "limit", desc: "The most results to list (default 100)."}
	bigAlpha    = mcpParam{name: "big_alpha", kind: "boolean", flag: "big-alpha", desc: "Read 8-bit alpha maps, for a tile on disk from a map whose WDT says so (a client tile reads its WDT)."}
)

// fileOrArchive describes an argument that is a file on disk or, when no such file exists, an
// archive path read from the client.
func fileOrArchive(name, what, example string) mcpParam {
	return mcpParam{name: name, kind: "string", required: true, desc: what + ": a file on disk (an absolute path is safest), or an archive path read from the client, such as " + example + "."}
}

func outParam(what string) mcpParam {
	return mcpParam{name: "out", kind: "string", flag: "o", required: true, desc: "The " + what + " to write (an absolute path is safest; an existing file is replaced)."}
}

// mcpTools are the tools, in the order tools/list gives them.
var mcpTools = func() []mcpTool {
	tools := []mcpTool{
		{
			name: "wmap_info", cmd: []string{"wmap", "info"}, readOnly: true,
			desc:   "Summarize a Meld map file (.wmap): version, size, texture palette, objects by kind, holes, liquids, zones, flags, shadows and region, as JSON.",
			params: []mcpParam{{name: "file", kind: "string", required: true, desc: "The .wmap file (an absolute path is safest)."}},
		},
		{
			name: "adt_dump", cmd: []string{"adt", "dump"}, readOnly: true,
			desc: "Dump a WoW 1.12 terrain tile (.adt) chunk by chunk as JSON: flags, area, holes, height range, texture layers, liquids, shadows; one chunk with its heights, or the model placements.",
			params: []mcpParam{
				fileOrArchive("tile", "The tile", `World\Maps\Azeroth\Azeroth_32_48.adt`),
				clientParam, bigAlpha,
				{name: "chunk", kind: "string", flag: "chunk", desc: "Dump only this chunk, as x,y (0 to 15), with its 145 heights."},
				{name: "placements", kind: "boolean", flag: "placements", desc: "Also list the tile's model placements (M2 and WMO)."},
			},
		},
		{
			name: "adt_diff", cmd: []string{"adt", "diff"}, readOnly: true,
			desc: "Compare two 1.12 terrain tiles chunk by chunk (flags, area, holes, heights, layers, alpha maps, liquids, shadows) and then their placements by UID: a line per difference, or \"same\".",
			params: []mcpParam{
				fileOrArchive("a", "The first tile", `World\Maps\Azeroth\Azeroth_32_48.adt`),
				fileOrArchive("b", "The second tile", `World\Maps\Azeroth\Azeroth_32_48.adt`),
				clientParam,
				{name: "client_b", kind: "string", flag: "client-b", desc: "Where b comes from, when not client: such as patch-3.MPQ against terrain.MPQ, to see what a patch changed."},
				bigAlpha,
				{name: "eps", kind: "number", flag: "eps", desc: "The height difference that counts (default 0.001)."},
				{name: "place_eps", kind: "number", flag: "place-eps", desc: "The placement position, rotation and scale difference that counts (default 0.01)."},
			},
		},
		{
			name: "mpq_ls", cmd: []string{"mpq", "ls"}, readOnly: true,
			desc: "List the client's files (all its MPQ archives, or one), one a line: the way to find a file's archive path.",
			params: []mcpParam{
				{name: "filter", kind: "string", desc: "Keep the paths holding this text (any case, / or \\). Give one: the whole list is cut off."},
				clientParam,
			},
		},
		{
			name: "mpq_cat", cmd: []string{"mpq", "cat"},
			desc: "Read one file from the client (the topmost patch that has it): its text, such as the Interface\\FrameXML XML or Lua, or with out its bytes written to a file (a binary file needs out).",
			params: []mcpParam{
				{name: "path", kind: "string", required: true, desc: "The archive path, such as Interface\\FrameXML\\UIParent.lua."},
				clientParam,
				{name: "out", kind: "string", flag: "o", desc: "Write the file here instead of returning it (an absolute path is safest)."},
			},
		},
		{
			name: "bindings", cmd: []string{"bindings"}, fixed: []string{"--json"}, readOnly: true,
			desc:   "List the Go methods Meld's app binds for its frontend, with their signatures, file and line, read from the repository's sources, as JSON.",
			params: []mcpParam{{name: "repo", kind: "string", desc: "The Meld repository folder (default: the server's working folder)."}},
		},
		{
			name: "blp_decode", cmd: []string{"blp", "decode"},
			desc: "Write a BLP texture's first mip level as a PNG with its alpha, and give the texture's header (size, format, alpha depth, mips) as JSON.",
			params: []mcpParam{
				fileOrArchive("texture", "The texture", `Interface\WorldMap\Elwynn\Goldshire1.blp`),
				outParam("PNG"), clientParam,
			},
		},
		{
			name: "blp_encode", cmd: []string{"blp", "encode"},
			desc: "Write a PNG as a BLP texture in the client's own form (DXT1, or DXT3 when the image has alpha, with mips), and give its header as JSON. The sides must be powers of two from 4 to 4096.",
			params: []mcpParam{
				{name: "png", kind: "string", required: true, desc: "The PNG to encode (an absolute path is safest)."},
				outParam("BLP"),
				{name: "format", kind: "string", flag: "format", enum: []string{"auto", "dxt1", "dxt3"}, desc: "auto (the default: dxt3 when the image has alpha, else dxt1), dxt1 or dxt3."},
				{name: "mips", kind: "boolean", flag: "mips", desc: "Write every mip level down to 1x1 (the default); false writes the first only."},
			},
		},
		{
			name: "m2_info", cmd: []string{"m2", "info"}, readOnly: true,
			desc:   "Read an M2 model's facts as JSON: header, bounds, texture table, animation IDs, and what the editor draws of it (vertices, triangles, batches, lights, emitters).",
			params: []mcpParam{fileOrArchive("model", "The .m2 model", `World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnTree01\ElwynnPine01.m2`), clientParam},
		},
		{
			name: "dbc_dump", cmd: []string{"dbc", "dump"}, readOnly: true,
			desc: "Print the rows of a client DBC table as JSON: each record's 32-bit fields, and the text of a field that is a valid string offset. Filter with where (field=value, e.g. 1=9), cut with limit.",
			params: []mcpParam{
				{name: "table", kind: "string", required: true, desc: `The table: a name such as CharHairGeosets.dbc (read from DBFilesClient in the client, as the game will have it), or a .dbc file on disk.`},
				clientParam,
				{name: "where", kind: "string", flag: "where", desc: "Keep rows whose field (index from 0) equals the number, as field=value."},
				limitParam,
			},
		},
		{
			name: "wmo_info", cmd: []string{"wmo", "info"}, readOnly: true,
			desc:   "Read a WMO's facts as JSON: the root's counts, bounds, materials, doodad sets and their models, and each group's name, flags, vertices, triangles, doodads and liquid.",
			params: []mcpParam{fileOrArchive("model", "The root .wmo", `World\wmo\Azeroth\Buildings\Stormwind\Stormwind.wmo`), clientParam},
		},
		{
			name: "heightmap_export", cmd: []string{"heightmap", "export"},
			desc: "Write a .wmap's heights as a 16-bit grey PNG, as the app's Export Heightmap does (black -1024 yards, white 1024), and give the height range as JSON.",
			params: []mcpParam{
				{name: "wmap", kind: "string", required: true, desc: "The .wmap file (an absolute path is safest)."},
				outParam("PNG"),
			},
		},
		{
			name: "heightmap_import", cmd: []string{"heightmap", "import"},
			desc: "Set every height of a .wmap from a grey image (the app's Import Heightmap in Set mode, stretched when the sizes differ) and write the result as a new .wmap; the input file is left as it is.",
			params: []mcpParam{
				{name: "wmap", kind: "string", required: true, desc: "The .wmap whose heights to set (an absolute path is safest)."},
				{name: "image", kind: "string", required: true, desc: "The grey image (PNG)."},
				outParam(".wmap"),
				{name: "min", kind: "number", flag: "min", desc: "The height black stands for, in yards (default -1024)."},
				{name: "max", kind: "number", flag: "max", desc: "The height white stands for, in yards (default 1024)."},
			},
		},
	}
	records := []struct{ kind, what string }{{"creature", "creature template"}, {"object", "game object template"}, {"item", "item template"}, {"spell", "spell"}}
	for _, r := range records {
		get := []mcpParam{{name: "entry", kind: "integer", required: true, desc: "The " + r.what + "'s entry (ID)."}, serverParam}
		search := []mcpParam{{name: "text", kind: "string", required: true, desc: "A name (any part, any case) or an entry."}, serverParam, limitParam}
		getDesc := "Read a " + r.what + " from the world database: its newest patch row with every column, as the editor reads it, as JSON."
		searchDesc := "Search the world database's " + r.what + "s by name or entry, as the editor does; JSON."
		switch r.kind {
		case "object":
			search = []mcpParam{search[0], serverParam, clientParam, limitParam}
		case "spell":
			get = append(get, clientParam)
			getDesc = "Read a spell: its spell_template row for the server's build, with every column, as the spell editor reads it, as JSON."
			search = []mcpParam{search[0], clientParam, limitParam}
			searchDesc = "Search the client's spells (Spell.dbc) by name or ID; JSON."
		}
		tools = append(tools,
			mcpTool{name: r.kind + "_get", cmd: []string{r.kind, "get"}, readOnly: true, desc: getDesc, params: get},
			mcpTool{name: r.kind + "_search", cmd: []string{r.kind, "search"}, readOnly: true, desc: searchDesc, params: search})
	}
	return tools
}()

// schema is the tool's input schema: an object of its params.
func (t mcpTool) schema() map[string]any {
	props := map[string]any{}
	required := []string{}
	for _, p := range t.params {
		prop := map[string]any{"type": p.kind, "description": p.desc}
		if p.enum != nil {
			prop["enum"] = p.enum
		}
		props[p.name] = prop
		if p.required {
			required = append(required, p.name)
		}
	}
	return map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}
}

// argv turns a call's arguments into the command line: the command, its fixed flags, a --flag=value
// for each flag given, then the positional arguments in order.
func (t mcpTool) argv(raw json.RawMessage) ([]string, error) {
	args := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(raw)) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, fmt.Errorf("the arguments are not a JSON object: %v", err)
		}
	}
	known := map[string]bool{}
	for _, p := range t.params {
		known[p.name] = true
	}
	for name := range args {
		if !known[name] {
			names := make([]string, 0, len(t.params))
			for _, p := range t.params {
				names = append(names, p.name)
			}
			sort.Strings(names)
			return nil, fmt.Errorf("unknown argument %q (%s takes %s)", name, t.name, strings.Join(names, ", "))
		}
	}
	argv := append(append([]string{}, t.cmd...), t.fixed...)
	var pos []string
	for _, p := range t.params {
		v, ok := args[p.name]
		if !ok || string(v) == "null" {
			if p.required {
				return nil, fmt.Errorf("%s needs the argument %q", t.name, p.name)
			}
			continue
		}
		s, err := p.text(v)
		if err != nil {
			return nil, err
		}
		if p.flag != "" {
			argv = append(argv, "--"+p.flag+"="+s)
			continue
		}
		// The command line would read a positional argument starting with - as a flag.
		if strings.HasPrefix(s, "-") {
			return nil, fmt.Errorf("%q may not start with -", p.name)
		}
		pos = append(pos, s)
	}
	return append(argv, pos...), nil
}

// text is a JSON argument as the command line gives it, checked against the param's type.
func (p mcpParam) text(v json.RawMessage) (string, error) {
	bad := func() (string, error) { return "", fmt.Errorf("%q must be %s, not %s", p.name, kindNames[p.kind], v) }
	switch p.kind {
	case "string":
		var s string
		if json.Unmarshal(v, &s) != nil {
			return bad()
		}
		if p.enum != nil && !contains(p.enum, s) {
			return "", fmt.Errorf("%q must be one of %s", p.name, strings.Join(p.enum, ", "))
		}
		return s, nil
	case "boolean":
		var b bool
		if json.Unmarshal(v, &b) != nil {
			return bad()
		}
		return strconv.FormatBool(b), nil
	case "integer", "number":
		// json.Number would take a quoted number too; the schema says a number.
		var n json.Number
		if bytes.HasPrefix(v, []byte(`"`)) || json.Unmarshal(v, &n) != nil {
			return bad()
		}
		if p.kind == "integer" {
			if _, err := strconv.ParseInt(n.String(), 10, 64); err != nil {
				return bad()
			}
		} else if _, err := strconv.ParseFloat(n.String(), 64); err != nil {
			return bad()
		}
		return n.String(), nil
	}
	return "", fmt.Errorf("%q has an unknown type %s", p.name, p.kind)
}

// kindNames are the JSON types as an error names them.
var kindNames = map[string]string{"string": "a string", "integer": "an integer", "number": "a number", "boolean": "true or false"}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// mcpMu runs one command at a time: the record commands may start the server's database, and two
// calls must not both start it.
var mcpMu sync.Mutex

// callTool runs the tool's command and gives its output, or its error as an error result the agent
// can read and correct.
func (t mcpTool) callTool(_ context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	argv, err := t.argv(req.Params.Arguments)
	if err != nil {
		return toolError(err.Error()), nil
	}
	out, err := runLocked(argv)
	if err != nil && !errors.Is(err, errDiffer) {
		msg := err.Error()
		if errors.Is(err, errUsage) {
			msg = strings.TrimPrefix(msg, errUsage.Error()+": ")
		}
		if s := strings.TrimSpace(string(out)); s != "" {
			msg += "\n" + s
		}
		return toolError(msg), nil
	}
	if !utf8.Valid(out) {
		return toolError(fmt.Sprintf("the output is binary (%d bytes): pass out to write it to a file", len(out))), nil
	}
	text := string(out)
	if len(text) > mcpOutputCap {
		cut := strings.LastIndexByte(text[:mcpOutputCap], '\n') + 1
		if cut == 0 {
			cut = mcpOutputCap
		}
		for !utf8.ValidString(text[:cut]) {
			cut--
		}
		text = text[:cut] + fmt.Sprintf("\n[cut at %d of %d bytes: narrow the call]\n", cut, len(out))
	}
	if strings.TrimSpace(text) == "" {
		text = "(no output)"
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil
}

// runLocked runs one command line, turning a panic into an error so the server outlives it.
func runLocked(argv []string) (out []byte, err error) {
	mcpMu.Lock()
	defer mcpMu.Unlock()
	var buf bytes.Buffer
	defer func() {
		if r := recover(); r != nil {
			out, err = buf.Bytes(), fmt.Errorf("%s failed: %v", strings.Join(argv, " "), r)
		}
	}()
	err = dispatch(argv, &buf)
	return buf.Bytes(), err
}

func toolError(msg string) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: msg}}}
}

// newMCPServer is the server with every tool added.
func newMCPServer() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "meld", Title: "Meld", Version: "1"}, &mcp.ServerOptions{
		Instructions: "Meld's command line tools (meldtool) for a WoW 1.12.1 client and a VMaNGOS server: inspect .wmap maps, terrain tiles, MPQ archives, BLP textures, M2 and WMO models; convert textures and heightmaps; read creatures, objects, items and spells. " +
			"A tile, texture or model argument is a file on disk or an archive path in the client. No tool writes into the client or the server; the ones with an out argument write that file only. " +
			"The tools work on files, not on the map open in the Meld app.",
	})
	for _, t := range mcpTools {
		tool := &mcp.Tool{Name: t.name, Description: t.desc, InputSchema: t.schema()}
		if t.readOnly {
			tool.Annotations = &mcp.ToolAnnotations{ReadOnlyHint: true}
		}
		s.AddTool(tool, t.callTool)
	}
	return s
}

// mcpServe runs `meldtool mcp`: the server on stdin and stdout until the client closes stdin.
func mcpServe(args []string, _ io.Writer) error {
	if len(args) != 0 {
		return fmt.Errorf("%w: mcp takes no arguments", errUsage)
	}
	err := newMCPServer().Run(context.Background(), &mcp.StdioTransport{})
	if err != nil && (errors.Is(err, io.EOF) || errors.Is(err, os.ErrClosed) || strings.Contains(err.Error(), "closed")) {
		return nil
	}
	return err
}
