package game

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Window is how the game's window opens when Meld starts it: Mode "" leaves the game's own setting,
// "windowed" opens a window of Resolution ("1280x720"), "fullscreen" fills the screen. Both clients
// keep it in the 1.12 client's video settings, gxWindow, gxResolution and gxMaximize, which Meld
// writes into the client's own settings file before starting it, so the game's Video options still
// work until the next time Meld starts it.
type Window struct {
	Mode       string
	Resolution string
}

var resolutionRe = regexp.MustCompile(`^[1-9][0-9]{2,4}x[1-9][0-9]{2,4}$`)

// Check reports a mode or resolution the client wouldn't take.
func (w Window) Check() error {
	switch w.Mode {
	case "", "windowed", "fullscreen":
	default:
		return fmt.Errorf("unknown window mode %q", w.Mode)
	}
	if w.Mode != "" && !resolutionRe.MatchString(w.Resolution) {
		return fmt.Errorf("a resolution is a width and a height, like 1280x720, not %q", w.Resolution)
	}
	return nil
}

// cvars is what the setting writes, in a fixed order; nil leaves the game's own setting.
func (w Window) cvars() [][2]string {
	switch w.Mode {
	case "windowed":
		return [][2]string{{"gxWindow", "1"}, {"gxMaximize", "0"}, {"gxResolution", w.Resolution}}
	case "fullscreen":
		return [][2]string{{"gxWindow", "0"}, {"gxResolution", w.Resolution}}
	}
	return nil
}

// setConfigWTF sets each CVar in Wow.exe's WTF\Config.wtf text ("SET name "value"" lines, CRLF),
// replacing a line that sets it (in any case) or adding one at the end.
func setConfigWTF(text string, vars [][2]string) string {
	nl := "\r\n"
	if text != "" && !strings.Contains(text, "\r\n") {
		nl = "\n"
	}
	lines := strings.Split(strings.TrimRight(text, "\r\n"), nl)
	if text == "" {
		lines = nil
	}
	for _, v := range vars {
		line := fmt.Sprintf(`SET %s "%s"`, v[0], v[1])
		found := false
		for i, l := range lines {
			f := strings.Fields(l)
			if len(f) >= 2 && strings.EqualFold(f[0], "SET") && strings.EqualFold(f[1], v[0]) {
				lines[i] = line
				found = true
			}
		}
		if !found {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, nl) + nl
}

// setBenillaConfig sets each CVar in Benilla's benilla-config\config.toml text, under its [cvars]
// table (`name = "value"` lines), replacing a line that sets it (in any case) or adding one to the
// table, which is made when the file has none. Benilla reads hand edits on its next launch and keeps
// them when it saves.
func setBenillaConfig(text string, vars [][2]string) string {
	nl := "\n"
	if strings.Contains(text, "\r\n") {
		nl = "\r\n"
	}
	var lines []string
	if text != "" {
		lines = strings.Split(strings.TrimRight(text, "\r\n"), nl)
	}
	// The [cvars] table runs from its header to the next header.
	start, end := -1, len(lines)
	for i, l := range lines {
		t := strings.TrimSpace(l)
		if strings.HasPrefix(t, "[") {
			if start >= 0 {
				end = i
				break
			}
			if t == "[cvars]" {
				start = i
			}
		}
	}
	if start < 0 {
		if len(lines) > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, "[cvars]")
		start, end = len(lines)-1, len(lines)
	}
	for _, v := range vars {
		line := fmt.Sprintf(`%s = "%s"`, v[0], v[1])
		found := false
		for i := start + 1; i < end; i++ {
			name, _, ok := strings.Cut(lines[i], "=")
			if ok && strings.EqualFold(strings.TrimSpace(name), v[0]) {
				lines[i] = line
				found = true
			}
		}
		if !found {
			// After the table's last setting, before any blank lines that end it.
			at := end
			for at > start+1 && strings.TrimSpace(lines[at-1]) == "" {
				at--
			}
			lines = append(lines[:at], append([]string{line}, lines[at:]...)...)
			end++
		}
	}
	return strings.Join(lines, nl) + nl
}

// applyWindow writes the window setting into the settings file of the game this session starts.
func (s Session) applyWindow() error {
	vars := s.Window.cvars()
	if vars == nil {
		return nil
	}
	path := filepath.Join(s.ClientRoot, "WTF", "Config.wtf")
	edit := setConfigWTF
	if s.Benilla != "" {
		path = filepath.Join(s.Benilla, "benilla-config", "config.toml")
		edit = setBenillaConfig
	}
	raw, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(edit(string(raw), vars)), 0o644)
}
