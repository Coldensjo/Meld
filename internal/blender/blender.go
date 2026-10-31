// Package blender opens a client model in Blender (#290): it finds Blender's program, keeps a work
// folder a model, and starts Blender on the model's export with a script that imports it.
package blender

import (
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
// (their edits are kept, never overwritten by a new export), else the GLB through the import script.
func Args(w Work) (args []string, fresh bool) {
	if _, err := os.Stat(w.Blend); err == nil {
		return []string{w.Blend}, false
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
