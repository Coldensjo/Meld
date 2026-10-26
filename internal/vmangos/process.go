package vmangos

import (
	"os"
	"path/filepath"
	"strings"
)

// procRoot is Linux's process table; tests point it at a folder of their own.
var procRoot = "/proc"

// commLen is how much of a program's name Linux keeps in /proc/<pid>/comm (TASK_COMM_LEN less the NUL).
const commLen = 15

// procNames are the names an image (a Windows name, say "benilla.exe") runs under off Windows: its
// stem, which a native build such as Benilla's has, and the whole name, which a Windows program under
// Wine keeps. Each is cut to commLen, as comm holds it.
func procNames(image string) []string {
	names := []string{image}
	if stem := image[:len(image)-len(filepath.Ext(image))]; strings.EqualFold(filepath.Ext(image), ".exe") && stem != "" {
		names = append(names, stem)
	}
	for i, n := range names {
		if len(n) > commLen {
			names[i] = n[:commLen]
		}
	}
	return names
}

// runningOffWindows reads every process's name from procRoot and reports whether one is the image's
// (#730). A machine without a /proc (macOS) reports nothing running.
func runningOffWindows(image string) bool {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return false
	}
	names := procNames(image)
	for _, e := range entries {
		if !e.IsDir() || !isPID(e.Name()) {
			continue
		}
		b, err := os.ReadFile(filepath.Join(procRoot, e.Name(), "comm"))
		if err != nil {
			continue
		}
		comm := strings.TrimRight(string(b), "\n")
		for _, n := range names {
			if comm == n {
				return true
			}
		}
	}
	return false
}

func isPID(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// StopCommand is the command that asks the program with this image name to exit (force: kills it).
// Windows' taskkill is used everywhere but on this machine's runner off Windows, where pkill matches
// the name Running found it under (#730); a test's fake runner always gets taskkill.
func StopCommand(r Runner, image string, force bool) (string, []string) {
	if _, isOS := r.(OSRunner); !isOS || hostOS == "windows" {
		if force {
			return "taskkill", []string{"/F", "/IM", image}
		}
		return "taskkill", []string{"/IM", image}
	}
	pattern := "^(" + strings.Join(quoteNames(procNames(image)), "|") + ")$"
	if force {
		return "pkill", []string{"-KILL", pattern}
	}
	return "pkill", []string{pattern}
}

func quoteNames(names []string) []string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = strings.ReplaceAll(n, ".", `\.`)
	}
	return out
}
