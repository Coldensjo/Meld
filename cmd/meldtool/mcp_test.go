package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"Meld/internal/mapfile"
	"Meld/internal/mpq"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcpSession connects a client to the server in memory, as an agent would over stdio.
func mcpSession(t *testing.T) *mcp.ClientSession {
	t.Helper()
	ctx := context.Background()
	st, ct := mcp.NewInMemoryTransports()
	ss, err := newMCPServer().Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cs.Close()
		_ = ss.Wait()
	})
	return cs
}

// callText calls a tool and gives its text and whether it is an error result.
func callText(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) (string, bool) {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String(), res.IsError
}

// TestMCPTools lists the tools as a client sees them: every command, each with an object schema
// whose required arguments are named, and the reading ones marked read-only.
func TestMCPTools(t *testing.T) {
	cs := mcpSession(t)
	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Tools) != len(mcpTools) {
		t.Fatalf("%d tools listed, want %d", len(res.Tools), len(mcpTools))
	}
	byName := map[string]*mcp.Tool{}
	for _, tool := range res.Tools {
		byName[tool.Name] = tool
	}
	info := byName["wmap_info"]
	if info == nil || info.Annotations == nil || !info.Annotations.ReadOnlyHint {
		t.Fatalf("wmap_info: %+v", info)
	}
	schema, _ := info.InputSchema.(map[string]any)
	if req, _ := schema["required"].([]any); len(req) != 1 || req[0] != "file" {
		t.Fatalf("wmap_info schema: %v", schema)
	}
	if enc := byName["blp_encode"]; enc == nil || (enc.Annotations != nil && enc.Annotations.ReadOnlyHint) {
		t.Fatalf("blp_encode writes a file, so it is not read-only: %+v", enc)
	}
	for _, want := range []string{"adt_dump", "adt_diff", "mpq_ls", "mpq_cat", "bindings", "m2_info", "wmo_info", "heightmap_import", "creature_get", "spell_search"} {
		if byName[want] == nil {
			t.Errorf("no %s tool", want)
		}
	}
}

// TestMCPToolsDispatch keeps the tool table and the command line together: every tool's command is
// one dispatch knows.
func TestMCPToolsDispatch(t *testing.T) {
	for _, tool := range mcpTools {
		err := dispatch(tool.cmd, &strings.Builder{})
		if err != nil && strings.Contains(err.Error(), "unknown command") {
			t.Errorf("%s: %v", tool.name, err)
		}
	}
}

func toolNamed(t *testing.T, name string) mcpTool {
	t.Helper()
	for _, tool := range mcpTools {
		if tool.name == name {
			return tool
		}
	}
	t.Fatalf("no tool %s", name)
	return mcpTool{}
}

// TestMCPArgv turns arguments into the command line, and refuses the ones the command can't take.
func TestMCPArgv(t *testing.T) {
	enc := toolNamed(t, "blp_encode")
	got, err := enc.argv(json.RawMessage(`{"png":"in.png","out":"o.blp","format":"dxt1","mips":false}`))
	if want := []string{"blp", "encode", "--o=o.blp", "--format=dxt1", "--mips=false", "in.png"}; err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("argv = %q, %v; want %q", got, err, want)
	}
	get := toolNamed(t, "creature_get")
	if got, err := get.argv(json.RawMessage(`{"entry":448,"server":"S"}`)); err != nil || !reflect.DeepEqual(got, []string{"creature", "get", "--server=S", "448"}) {
		t.Fatalf("creature_get argv = %q, %v", got, err)
	}
	if got, err := toolNamed(t, "bindings").argv(nil); err != nil || !reflect.DeepEqual(got, []string{"bindings", "--json"}) {
		t.Fatalf("bindings argv = %q, %v", got, err)
	}
	for _, c := range []struct{ args, want string }{
		{`{"entry":1.5}`, "must be an integer"},
		{`{"entry":"448"}`, "must be an integer"},
		{`{}`, `needs the argument "entry"`},
		{`{"entry":1,"nope":2}`, `unknown argument "nope"`},
		{`[1]`, "not a JSON object"},
	} {
		if _, err := get.argv(json.RawMessage(c.args)); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v, want %q", c.args, err, c.want)
		}
	}
	if _, err := enc.argv(json.RawMessage(`{"png":"in.png","out":"o.blp","format":"png"}`)); err == nil {
		t.Error("a format outside the enum passes")
	}
	if _, err := toolNamed(t, "wmap_info").argv(json.RawMessage(`{"file":"-h"}`)); err == nil {
		t.Error("a positional argument starting with - passes")
	}
}

// TestMCPCalls runs commands through the server: a map's summary, a tile diff (a difference is not
// an error), a file from an archive, a binary file without out, and the errors an agent can read.
func TestMCPCalls(t *testing.T) {
	cs := mcpSession(t)
	dir := t.TempDir()

	const size = 16
	enc := base64.StdEncoding.EncodeToString
	heights := make([]byte, (size+1)*(size+1)*4)
	binary.LittleEndian.PutUint32(heights[4:], math.Float32bits(12.5))
	m := &mapfile.MapData{
		Header:     mapfile.Header{Name: "Test", Size: size, CellSize: 1, SplatRes: 16},
		Heights:    enc(heights),
		Weights:    enc(make([]byte, 16*16*4)),
		ChunkSlots: enc(make([]byte, 4*mapfile.SlotsPerChunk)),
		Holes:      enc(make([]byte, size*size)),
	}
	wm := filepath.Join(dir, "test.wmap")
	if err := mapfile.Save(wm, m); err != nil {
		t.Fatal(err)
	}
	out, isErr := callText(t, cs, "wmap_info", map[string]any{"file": wm})
	var s wmapSummary
	if isErr || json.Unmarshal([]byte(out), &s) != nil || s.Size != size || s.HeightMax != 12.5 {
		t.Fatalf("wmap_info: %v %s", isErr, out)
	}

	a := writeFile(t, dir, "a.adt", buildTile(t, 0, 7))
	b := writeFile(t, dir, "b.adt", buildTile(t, 5, 8))
	if out, isErr := callText(t, cs, "adt_diff", map[string]any{"a": a, "b": b}); isErr || !strings.Contains(out, "differences") {
		t.Fatalf("adt_diff: %v %s", isErr, out)
	}

	archive := writeFile(t, dir, "patch-3.MPQ", mpq.Write([]mpq.File{{Name: `Interface\Test.txt`, Data: []byte("hello")}, {Name: `Interface\Test.bin`, Data: []byte{0xff, 0xfe, 0}}}))
	if out, isErr := callText(t, cs, "mpq_cat", map[string]any{"path": `Interface\Test.txt`, "client": archive}); isErr || out != "hello" {
		t.Fatalf("mpq_cat: %v %q", isErr, out)
	}
	if out, isErr := callText(t, cs, "mpq_cat", map[string]any{"path": `Interface\Test.bin`, "client": archive}); !isErr || !strings.Contains(out, "pass out") {
		t.Fatalf("mpq_cat of a binary file: %v %q", isErr, out)
	}
	if out, isErr := callText(t, cs, "mpq_cat", map[string]any{"path": `Interface\Missing.txt`, "client": archive}); !isErr || !strings.Contains(out, "Missing.txt") {
		t.Fatalf("mpq_cat of a missing file: %v %q", isErr, out)
	}
	if out, isErr := callText(t, cs, "wmap_info", map[string]any{"file": filepath.Join(dir, "none.wmap")}); !isErr || out == "" {
		t.Fatalf("wmap_info of a missing file: %v %q", isErr, out)
	}
	if out, isErr := callText(t, cs, "wmap_info", map[string]any{}); !isErr || !strings.Contains(out, `"file"`) {
		t.Fatalf("wmap_info without its file: %v %q", isErr, out)
	}
	if out, isErr := callText(t, cs, "bindings", map[string]any{"repo": "../.."}); isErr || !strings.Contains(out, `"SaveMap"`) {
		t.Fatalf("bindings: %v %.200s", isErr, out)
	}
}

// TestMCPServeArgs refuses arguments to the subcommand rather than starting a server.
func TestMCPServeArgs(t *testing.T) {
	if err := mcpServe([]string{"x"}, nil); !errors.Is(err, errUsage) {
		t.Fatalf("mcp x: %v", err)
	}
}
