package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/config"
	"Meld/internal/game"
	"Meld/internal/mpq"
	"Meld/internal/records"
	"Meld/internal/vmangos"
)

// The record write commands (#1055, part B of #778): `<kind> set` changes a creature, game object or
// item template's columns or a spell's, `<kind> new` makes one, and `item export|import` writes and
// reads the item editor's SQL script. Each is a dry run unless given --write: it prints the SQL (and
// for a spell the client files) it would write, worked out by the same vmangos plan the editor's save
// runs, and changes nothing. With --write it saves through internal/records, as the app's Save
// bindings do: the running world server reloads what was written, the game's cache forgets the old
// rows when the game is closed, and a spell's client files go into Meld's patch, or wait for a running
// game to close (#661) and are written by Meld's watcher once it has.

// dryRunNote is what a dry run says about itself.
const dryRunNote = "Nothing was written: pass --write to apply it."

// writeFlags are the flags every write command takes.
type writeFlags struct {
	server, client *string
	write          *bool
}

func addWriteFlags(fs *flag.FlagSet) writeFlags {
	return writeFlags{
		server: fs.String("server", "", "VMaNGOS server folder"),
		client: fs.String("client", "", "client folder or its Data folder"),
		write:  fs.Bool("write", false, "write the change; without it, print what it would write"),
	}
}

// folders are the server folder and the client's Data folder: needed when clientNeeded, else "" when
// none is found (unless --client named one).
func (w writeFlags) folders(clientNeeded bool) (server, data string, err error) {
	if server, err = serverDir(*w.server); err != nil {
		return "", "", err
	}
	data, err = clientDataDir(*w.client)
	if err != nil {
		if clientNeeded || *w.client != "" {
			return "", "", err
		}
		data = ""
	}
	return server, data, nil
}

// writeReport is what a write's follow-up did: the world server's reload and the game's cache.
type writeReport struct {
	Reload string `json:"reload,omitempty"`
	Cache  string `json:"cache,omitempty"`
}

// cliHost is the records Host of a write command on server and data (data "" when no client was
// found): the game and world server are config.json's, as the app sees them, and what the follow-up
// did goes into rep, since there is no status line to say it.
func cliHost(server, data string, rep *writeReport) records.Host {
	cfg := config.Load()
	sess := game.Session{ServerRoot: server, Login: cfg.Login, Run: vmangos.OSRunner{}}
	if data != "" {
		sess.ClientRoot = filepath.Dir(data)
	}
	if cfg.GameClient == "benilla" && cfg.BenillaPath != "" {
		sess.Benilla = cfg.BenillaPath
	}
	return records.Host{
		Server:      server,
		Data:        data,
		GameRunning: func() bool { return records.GameHoldsPatch(sess) },
		Changed: func(c records.Change) {
			if cmds, restart := records.Reloads(c.Save, c.Entries...); len(cmds) > 0 || restart != "" {
				if sess.WorldRunning() {
					rep.Reload, _ = records.Reload(sess, c.Save, c.Entries...)
				} else {
					rep.Reload = "The world server isn't running: it reads the change when it starts."
				}
			}
			if c.Cached == "" {
				return
			}
			switch {
			case sess.ClientRoot == "":
				rep.Cache = "No client was found, so the game's cache may still hold the old " + c.Cached + ": pass --client to clear it."
			case sess.GameRunning():
				rep.Cache = "The game is running, so its cache keeps the old " + c.Cached + ": close it and run this again to clear it."
			default:
				var stale game.Stale
				records.MarkStale(&stale, c)
				sess.Stale = &stale
				if err := sess.ForgetStale(); err != nil {
					rep.Cache = "The game's cache of the old " + c.Cached + " wasn't cleared: " + err.Error()
				} else {
					rep.Cache = "The game's cache has forgotten the old " + c.Cached + "."
				}
			}
		},
	}
}

// recordValues are a set command's values: --values (a JSON object of column to value, or @file
// holding one), then the col=value arguments over them.
func recordValues(valuesFlag string, pairs []string) (map[string]string, error) {
	values := map[string]string{}
	if valuesFlag != "" {
		raw := []byte(valuesFlag)
		if strings.HasPrefix(valuesFlag, "@") {
			b, err := os.ReadFile(valuesFlag[1:])
			if err != nil {
				return nil, err
			}
			raw = b
		}
		dec := json.NewDecoder(strings.NewReader(string(raw)))
		dec.UseNumber()
		var obj map[string]any
		if err := dec.Decode(&obj); err != nil {
			return nil, fmt.Errorf("%w: --values is not a JSON object of column to value: %v", errUsage, err)
		}
		for k, v := range obj {
			switch x := v.(type) {
			case string:
				values[k] = x
			case json.Number:
				values[k] = x.String()
			case bool:
				values[k] = map[bool]string{true: "1", false: "0"}[x]
			case nil:
				values[k] = ""
			default:
				return nil, fmt.Errorf("%w: --values: %s is not a single value", errUsage, k)
			}
		}
	}
	for _, p := range pairs {
		k, v, ok := strings.Cut(p, "=")
		if !ok || strings.TrimSpace(k) == "" {
			return nil, fmt.Errorf("%w: %q is not column=value", errUsage, p)
		}
		values[strings.TrimSpace(k)] = v
	}
	if len(values) == 0 {
		return nil, fmt.Errorf("%w: set takes the values to change, as column=value or --values", errUsage)
	}
	return values, nil
}

// fileInfo is a client file a spell write puts into Meld's patch: its archive path and size.
type fileInfo struct {
	Name string `json:"name"`
	Size int    `json:"size"`
}

func fileInfos(files []mpq.File) []fileInfo {
	out := make([]fileInfo, len(files))
	for i, f := range files {
		out[i] = fileInfo{Name: f.Name, Size: len(f.Data)}
	}
	return out
}

// writeResult is what a write command prints.
type writeResult struct {
	DryRun  bool       `json:"dryRun"`
	Entry   int        `json:"entry,omitempty"`
	Patch   *int       `json:"patch,omitempty"`
	Build   *int       `json:"build,omitempty"`
	SQL     string     `json:"sql,omitempty"`
	Files   []fileInfo `json:"files,omitempty"`
	Icon    string     `json:"iconAdded,omitempty"`
	Waiting bool       `json:"waitingForGame,omitempty"`
	Note    string     `json:"note,omitempty"`
	writeReport
}

// templateWriters are the template kinds' plans and saves.
var templateWriters = map[string]struct {
	read    func(server string, entry int) (vmangos.TemplateRecord, error)
	plan    func(server string, entry, patch int, values map[string]string) (string, error)
	save    func(h records.Host, entry, patch int, values map[string]string) (string, error)
	planNew func(server string, base int, name string) (vmangos.TemplateCreate, error)
	create  func(h records.Host, base int, name string) (int, error)
}{
	"creature": {vmangos.ReadCreature, vmangos.PlanCreatureSave, records.SaveCreature, vmangos.PlanCreateCreature, records.CreateCreature},
	"object":   {vmangos.ReadObject, vmangos.PlanObjectSave, records.SaveObject, vmangos.PlanCreateObject, records.CreateObject},
	"item":     {vmangos.ReadItemTemplate, vmangos.PlanItemSave, records.SaveItem, vmangos.PlanCreateItem, records.CreateItem},
}

// recordSet runs `<kind> set <entry> [col=value ...]`.
func recordSet(kind string, args []string, out io.Writer) error {
	fs := flag.NewFlagSet(kind+" set", flag.ContinueOnError)
	wf := addWriteFlags(fs)
	valuesFlag := fs.String("values", "", "the values as a JSON object of column to value, or @file holding one")
	contentPatch := fs.Int("content-patch", -1, "the row's content patch (the patch column, not patch-3.MPQ); default the newest row's")
	build := fs.Int("build", -1, "spell: the spell_template row's build; default the one the server uses")
	icon := fs.String("icon", "", "spell: the icon, a name under Interface\\Icons (added to SpellIcon.dbc when new)")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) == 0 {
		return fmt.Errorf("%w: %s set takes an entry, then the values", errUsage, kind)
	}
	entry, err := strconv.Atoi(pos[0])
	if err != nil {
		return fmt.Errorf("%w: %q is not an entry", errUsage, pos[0])
	}
	values, err := recordValues(*valuesFlag, pos[1:])
	if err != nil {
		return err
	}
	if kind == "spell" {
		return spellSet(wf, entry, *build, values, *icon, out)
	}
	if *build >= 0 || *icon != "" {
		return fmt.Errorf("%w: --build and --icon are for spells", errUsage)
	}
	w := templateWriters[kind]
	server, data, err := wf.folders(false)
	if err != nil {
		return err
	}
	patch := *contentPatch
	if patch < 0 {
		rec, err := w.read(server, entry)
		if err != nil {
			return err
		}
		patch = rec.Patch
	}
	res := writeResult{DryRun: !*wf.write, Entry: entry, Patch: &patch}
	if !*wf.write {
		if res.SQL, err = w.plan(server, entry, patch, values); err != nil {
			return refusedError(err)
		}
		res.Note = dryRunNote
		return writeJSON(out, res)
	}
	if res.SQL, err = w.save(cliHost(server, data, &res.writeReport), entry, patch, values); err != nil {
		return refusedError(err)
	}
	return writeJSON(out, res)
}

// spellSet runs `spell set`: the spell_template row and the client's Spell.dbc (with SpellIcon.dbc
// for a new icon) in Meld's patch.
func spellSet(wf writeFlags, entry, build int, values map[string]string, icon string, out io.Writer) error {
	server, data, err := wf.folders(true)
	if err != nil {
		return err
	}
	if build < 0 {
		rec, err := vmangos.ReadSpell(server, data, entry)
		if err != nil {
			return err
		}
		build = rec.Build
	}
	plan, err := vmangos.PlanSpellSave(server, data, entry, build, values, icon, nil)
	if err != nil {
		return refusedError(err)
	}
	res := writeResult{DryRun: !*wf.write, Entry: entry, Build: &build, SQL: plan.SQL, Files: fileInfos(plan.Files), Icon: plan.IconAdded}
	if !*wf.write {
		res.Note = dryRunNote
		return writeJSON(out, res)
	}
	if res.Waiting, err = records.SaveSpell(cliHost(server, data, &res.writeReport), plan); err != nil {
		return err
	}
	res.Note = waitingNote(res.Waiting)
	return writeJSON(out, res)
}

// waitingNote says where a spell's client files went.
func waitingNote(waiting bool) string {
	if waiting {
		return "The game is running, so the client files wait for it to close: Meld writes them into its patch once it has (or when Meld next starts, or at the next patch write)."
	}
	return "The client files are in Meld's patch: the game has them from its next start."
}

// refusedError is err, with a value the save refused said as its message alone.
func refusedError(err error) error {
	if r := vmangos.Refused(err); r != nil {
		return errors.New(r.Message)
	}
	return err
}

// recordNew runs `<kind> new <name>`.
func recordNew(kind string, args []string, out io.Writer) error {
	fs := flag.NewFlagSet(kind+" new", flag.ContinueOnError)
	wf := addWriteFlags(fs)
	from := fs.Int("from", 0, "copy this entry (default: start from the editor's defaults)")
	itemKind := fs.String("kind", "", "item: start from the usual item of this kind, as class,subclass,inventory_type")
	starter := fs.String("starter", "", "spell: the starter to make it from ("+starterIDs()+")")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	name := strings.TrimSpace(strings.Join(pos, " "))
	if name == "" {
		return fmt.Errorf("%w: %s new takes a name", errUsage, kind)
	}
	if kind == "spell" {
		return spellNew(wf, *from, *starter, name, out)
	}
	if *starter != "" || (*itemKind != "" && kind != "item") {
		return fmt.Errorf("%w: --starter is for spells and --kind for items", errUsage)
	}
	var k vmangos.ItemKind
	if *itemKind != "" {
		if *from != 0 {
			return fmt.Errorf("%w: give --from or --kind, not both", errUsage)
		}
		if k, err = parseItemKind(*itemKind); err != nil {
			return err
		}
	}
	server, data, err := wf.folders(false)
	if err != nil {
		return err
	}
	res := writeResult{DryRun: !*wf.write}
	if *itemKind != "" {
		if !*wf.write {
			plan, err := vmangos.PlanCreateItemOfKind(server, k, name)
			if err != nil {
				return err
			}
			res.Entry, res.SQL, res.Note = plan.Entry, plan.SQL, dryRunNote
			return writeJSON(out, res)
		}
		if res.Entry, err = records.CreateItemOfKind(cliHost(server, data, &res.writeReport), k, name); err != nil {
			return err
		}
		return writeJSON(out, res)
	}
	w := templateWriters[kind]
	if !*wf.write {
		plan, err := w.planNew(server, *from, name)
		if err != nil {
			return err
		}
		res.Entry, res.SQL, res.Note = plan.Entry, plan.SQL, dryRunNote
		return writeJSON(out, res)
	}
	if res.Entry, err = w.create(cliHost(server, data, &res.writeReport), *from, name); err != nil {
		return err
	}
	return writeJSON(out, res)
}

// spellNew runs `spell new`: a copy of --from, or a spell made from --starter.
func spellNew(wf writeFlags, from int, starter, name string, out io.Writer) error {
	if (from > 0) == (starter != "") {
		return fmt.Errorf("%w: spell new takes --from <spell> or --starter <%s>", errUsage, starterIDs())
	}
	if starter != "" && !strings.Contains(","+starterIDs()+",", ","+starter+",") {
		return fmt.Errorf("%w: no starter %q (%s)", errUsage, starter, starterIDs())
	}
	server, data, err := wf.folders(true)
	if err != nil {
		return err
	}
	plan, err := vmangos.PlanCreateSpell(server, data, from, starter, name)
	if err != nil {
		return err
	}
	res := writeResult{DryRun: !*wf.write, Entry: plan.Entry, SQL: plan.SQL, Files: fileInfos([]mpq.File{plan.File})}
	if !*wf.write {
		res.Note = dryRunNote
		return writeJSON(out, res)
	}
	if res.Entry, res.Waiting, err = records.CreateSpell(cliHost(server, data, &res.writeReport), plan); err != nil {
		return err
	}
	res.Note = waitingNote(res.Waiting)
	return writeJSON(out, res)
}

// starterIDs are the spell starters' IDs, comma separated.
func starterIDs() string {
	var ids []string
	for _, s := range vmangos.SpellStarters() {
		ids = append(ids, s.ID)
	}
	return strings.Join(ids, ",")
}

// parseItemKind reads class,subclass,inventory_type.
func parseItemKind(s string) (vmangos.ItemKind, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 3 {
		return vmangos.ItemKind{}, fmt.Errorf("%w: --kind is class,subclass,inventory_type, not %q", errUsage, s)
	}
	var n [3]int
	for i, p := range parts {
		v, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return vmangos.ItemKind{}, fmt.Errorf("%w: --kind is class,subclass,inventory_type, not %q", errUsage, s)
		}
		n[i] = v
	}
	return vmangos.ItemKind{Class: n[0], Subclass: n[1], InvType: n[2]}, nil
}

// parseEntries reads entries given as separate arguments, comma separated, or both.
func parseEntries(args []string) ([]int, error) {
	var out []int
	for _, a := range args {
		for _, f := range strings.FieldsFunc(a, func(r rune) bool { return r == ',' || r == ' ' }) {
			e, err := strconv.Atoi(f)
			if err != nil {
				return nil, fmt.Errorf("%w: %q is not an entry", errUsage, f)
			}
			out = append(out, e)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: give the entries", errUsage)
	}
	return out, nil
}

// itemExport runs `item export <entries...>`: the item editor's SQL script of the items (every patch
// row, as REPLACE statements), printed or written to -o.
func itemExport(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("item export", flag.ContinueOnError)
	serverFlag := fs.String("server", "", "VMaNGOS server folder")
	outFile := fs.String("o", "", "write the script to this file instead of printing it")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	entries, err := parseEntries(pos)
	if err != nil {
		return err
	}
	server, err := serverDir(*serverFlag)
	if err != nil {
		return err
	}
	script, err := vmangos.ExportItems(server, entries)
	if err != nil {
		return err
	}
	if *outFile != "" {
		if err := os.WriteFile(*outFile, []byte(script), 0o644); err != nil {
			return err
		}
		return writeJSON(out, map[string]any{"file": *outFile, "entries": entries, "bytes": len(script)})
	}
	_, err = io.WriteString(out, script)
	return err
}

// itemImport runs `item import <file.sql>`: what importing the script's items would write, or with
// --write their rows written (replacing those of the same entry and patch).
func itemImport(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("item import", flag.ContinueOnError)
	wf := addWriteFlags(fs)
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 {
		return fmt.Errorf("%w: item import takes one SQL script", errUsage)
	}
	b, err := os.ReadFile(pos[0])
	if err != nil {
		return err
	}
	server, data, err := wf.folders(false)
	if err != nil {
		return err
	}
	plan, err := vmangos.PlanItemImport(server, string(b))
	if err != nil {
		return err
	}
	type importResult struct {
		DryRun bool `json:"dryRun"`
		vmangos.ItemImport
		Written []int  `json:"written,omitempty"`
		Note    string `json:"note,omitempty"`
		writeReport
	}
	res := importResult{DryRun: !*wf.write, ItemImport: plan}
	if res.Items == nil {
		res.Items = []vmangos.ItemImportRow{}
	}
	if res.Unknown == nil {
		res.Unknown = []string{}
	}
	if !*wf.write {
		res.Note = dryRunNote
		return writeJSON(out, res)
	}
	if res.Written, err = records.ImportItems(cliHost(server, data, &res.writeReport), string(b)); err != nil {
		return refusedError(err)
	}
	sort.Ints(res.Written)
	return writeJSON(out, res)
}
