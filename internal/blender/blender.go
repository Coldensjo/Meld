// Package blender opens a client model in Blender (#290): it finds Blender's program, keeps a work
// folder a model, and starts Blender on the model's export with a script that imports it. The way
// back: a background Blender exports the saved .blend as a GLB (ExportGLB), which the app turns into
// a client model under ClientDir.
package blender

import (
	"context"
	"crypto/sha1"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// openScript is the Python Blender runs as it starts on a fresh export (open.py).
//
//go:embed open.py
var openScript []byte

// programs are the file names Blender's program goes by in its folder, the one to start first: on
// Windows the launcher, which starts blender.exe without a console window.
func programs() []string {
	if runtime.GOOS == "windows" {
		return []string{"blender-launcher.exe", "blender.exe"}
	}
	return []string{"blender"}
}

// InFolder is Blender's program in folder dir (a portable Blender, or its install folder), or "" when
// dir holds none. A dir that is the program itself is taken as it is.
func InFolder(dir string) string {
	if dir == "" {
		return ""
	}
	if st, err := os.Stat(dir); err == nil && !st.IsDir() {
		return dir
	}
	for _, name := range programs() {
		p := filepath.Join(dir, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// ErrNotFound says no Blender was found.
var ErrNotFound = errors.New("Blender wasn't found: choose its folder in Edit › Preferences › Folders")

// Find is the Blender program to start: the one in folder dir (the user's choice) when set; else one
// in a "blender" folder beside the client's folder (wowPath, the tool chain's layout); else blender on
// the PATH.
func Find(dir, wowPath string) (string, error) {
	if dir != "" {
		if p := InFolder(dir); p != "" {
			return p, nil
		}
		return "", fmt.Errorf("%s holds no Blender program (%s)", dir, strings.Join(programs(), " or "))
	}
	if wowPath != "" {
		if p := InFolder(filepath.Join(filepath.Dir(filepath.Clean(wowPath)), "blender")); p != "" {
			return p, nil
		}
	}
	for _, name := range programs() {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	return "", ErrNotFound
}

// Root is the folder the models opened in Blender are kept in: <config dir>/Meld/blender, beside the
// scripts folder, so the .blend files edited there are not in a cache that gets cleared.
func Root() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "Meld", "blender"), nil
}

// Work is a model's files in root: its folder (the model's name and a short hash of its whole type, so
// two models of one name keep apart), the GLB export and the .blend.
type Work struct {
	Dir, GLB, Blend string
}

// WorkFor is the work folder for a model of name name, whose placed object's type is objType.
func WorkFor(root, name, objType string) Work {
	h := sha1.Sum([]byte(strings.ToLower(objType)))
	name = safeName(name)
	dir := filepath.Join(root, name+"-"+hex.EncodeToString(h[:])[:6])
	return Work{Dir: dir, GLB: filepath.Join(dir, name+".glb"), Blend: filepath.Join(dir, name+".blend")}
}

// ClientDir is the client folder the models that come back from Blender are written in, each in a
// folder named as its work folder, so Open in Blender on that model finds its .blend again
// (WorkForType). The client's own files are never written over.
const ClientDir = `World\Meld`

// WorkForType is the work folder of a placed object of type objType ("m2:<path>" or "wmo:<path>", with
// any look or doodad set after '?'): the folder a model Meld wrote from Blender came from
// (ClientDir\<folder>\<name>.m2), else the one WorkFor gives the client's model.
func WorkForType(root, objType string) Work {
	_, path, _ := strings.Cut(objType, ":")
	if q := strings.IndexByte(path, '?'); q >= 0 {
		path = path[:q]
	}
	path = strings.ReplaceAll(path, "/", `\`)
	name := path[strings.LastIndexByte(path, '\\')+1:]
	if dot := strings.LastIndexByte(name, '.'); dot > 0 {
		name = name[:dot]
	}
	if rest, ok := cutPrefixFold(path, ClientDir+`\`); ok {
		if folder, file, ok := strings.Cut(rest, `\`); ok && !strings.Contains(file, `\`) && folder == safeName(folder) && name == safeName(name) {
			dir := filepath.Join(root, folder)
			return Work{Dir: dir, GLB: filepath.Join(dir, name+".glb"), Blend: filepath.Join(dir, name+".blend")}
		}
	}
	return WorkFor(root, name, objType)
}

func cutPrefixFold(s, prefix string) (string, bool) {
	if len(s) < len(prefix) || !strings.EqualFold(s[:len(prefix)], prefix) {
		return s, false
	}
	return s[len(prefix):], true
}

// WorkForFile is the work folder of a model imported from a file the user chose (a .blend or a .glb,
// Import 3D Model), named after it and kept apart by a hash of its path.
func WorkForFile(root, file string) Work {
	if abs, err := filepath.Abs(file); err == nil {
		file = abs
	}
	name := filepath.Base(file)
	name = strings.TrimSuffix(name, filepath.Ext(name))
	return WorkFor(root, name, "file:"+file)
}

// Name is the model's name, which its client files take: the .blend's without its extension.
func (w Work) Name() string {
	return strings.TrimSuffix(filepath.Base(w.Blend), ".blend")
}

// Client is the client path the model of w is written to: ClientDir\<folder>\<name>.m2.
func (w Work) Client() string {
	return ClientDir + `\` + filepath.Base(w.Dir) + `\` + w.Name() + ".m2"
}

// sourceName is the file in a work folder that names the file the user imported the model from.
const sourceName = "source.txt"

// SetSource records file as the file w's model was imported from.
func (w Work) SetSource(file string) error {
	if err := os.MkdirAll(w.Dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(w.Dir, sourceName), []byte(file), 0o644)
}

// Source is the file w's model was imported from (WorkForFile), "" for none or one that is gone.
func (w Work) Source() string {
	b, err := os.ReadFile(filepath.Join(w.Dir, sourceName))
	if err != nil {
		return ""
	}
	p := strings.TrimSpace(string(b))
	if st, err := os.Stat(p); err != nil || st.IsDir() {
		return ""
	}
	return p
}

// Model is the file the model of w comes back from: the .blend saved in the work folder, else the file
// it was imported from, else "" (nothing saved yet).
func (w Work) Model() string {
	if _, err := os.Stat(w.Blend); err == nil {
		return w.Blend
	}
	return w.Source()
}

// isBlend says whether path is a .blend file.
func isBlend(path string) bool { return strings.EqualFold(filepath.Ext(path), ".blend") }

// safeName keeps a model's name to the characters every file system takes.
func safeName(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	s := strings.Trim(b.String(), ".")
	if s == "" {
		return "model"
	}
	return s
}

// Args are the arguments Blender starts with for w: its .blend when the user has saved one there
// (their edits are kept, never overwritten by a new export) or imported the model from one, else the
// GLB through the import script.
func Args(w Work) (args []string, fresh bool) {
	if m := w.Model(); isBlend(m) {
		return []string{m}, false
	}
	return []string{"--python", filepath.Join(w.Dir, "open.py"), "--", w.GLB, w.Blend}, true
}

// Open starts Blender's program exe on w, writing glb as w's export first unless a .blend is there
// already. It returns once Blender has started, and reports whether the model was exported fresh.
func Open(exe string, w Work, glb func() ([]byte, error)) (fresh bool, err error) {
	args, fresh := Args(w)
	if fresh {
		// The export first, so a model that can't be exported leaves no empty folder.
		b, err := glb()
		if err != nil {
			return false, err
		}
		if err := os.MkdirAll(w.Dir, 0o755); err != nil {
			return false, err
		}
		if err := os.WriteFile(w.GLB, b, 0o644); err != nil {
			return false, err
		}
		if err := os.WriteFile(filepath.Join(w.Dir, "open.py"), openScript, 0o644); err != nil {
			return false, err
		}
	}
	cmd := exec.Command(exe, args...)
	cmd.Dir = w.Dir
	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("start Blender: %w", err)
	}
	allowForeground()
	go func() { _ = cmd.Wait() }()
	return fresh, nil
}

// exportScript is the Python a background Blender runs to export a .blend as a GLB (export.py).
//
//go:embed export.py
var exportScript []byte

// Console is the program to run Blender in the background with: on Windows blender.exe beside the
// launcher, which detaches and never says how the run went.
func Console(exe string) string {
	if runtime.GOOS == "windows" && strings.EqualFold(filepath.Base(exe), "blender-launcher.exe") {
		if p := filepath.Join(filepath.Dir(exe), "blender.exe"); InFolder(p) != "" {
			return p
		}
	}
	return exe
}

// exportTimeout bounds one background export: a large scene takes Blender some seconds, a hung one
// never ends.
const exportTimeout = 3 * time.Minute

// ExportGLB runs Blender's program exe in the background on .blend file blend and returns its scene
// as a GLB (export.py: the visible meshes, modifiers applied).
func ExportGLB(ctx context.Context, exe, blend string) ([]byte, error) {
	tmp, err := os.MkdirTemp("", "meld-blender-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	script, out := filepath.Join(tmp, "export.py"), filepath.Join(tmp, "model.glb")
	if err := os.WriteFile(script, exportScript, 0o644); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, exportTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, Console(exe), "-b", "--factory-startup", blend, "--python-exit-code", "1", "--python", script, "--", out)
	cmd.Dir = tmp
	hideConsole(cmd)
	log, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("Blender took over %s to export %s", exportTimeout, filepath.Base(blend))
	}
	b, rerr := os.ReadFile(out)
	if err != nil || rerr != nil {
		return nil, fmt.Errorf("Blender didn't export %s: %v%s", filepath.Base(blend), firstErr(err, rerr), lastLines(log, 6))
	}
	return b, nil
}

func firstErr(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

// lastLines is the end of a run's output, n lines at most, after a line break; "" for none.
func lastLines(out []byte, n int) string {
	lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(string(out), "\r\n", "\n")), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return ""
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return "\n" + strings.Join(lines, "\n")
}
