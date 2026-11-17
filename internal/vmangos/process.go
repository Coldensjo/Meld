package vmangos

import (
	"os"
	"os/exec"
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

// runningOffWindows reports whether a process is the image's (#730): by every process's name in
// procRoot, or, on a machine without a /proc (macOS), in the process list ps prints.
func runningOffWindows(image string) bool {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return listedProcess(image, processList())
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

// processList is the program of every process, as `ps -A -o comm=` prints it: macOS gives a
// program's path there, whole. Nil when ps fails. Tests replace it.
var processList = func() []string {
	out, err := exec.Command("ps", "-A", "-o", "comm=").Output()
	if err != nil {
		return nil
	}
	return strings.Split(string(out), "\n")
}

// listedProcess reports whether one of the programs ps listed is the image's: its file name is the
// image's stem (a native build) or its whole name (under Wine), uncut, as ps keeps it.
func listedProcess(image string, programs []string) bool {
	names := []string{image}
	if ext := filepath.Ext(image); strings.EqualFold(ext, ".exe") && len(image) > len(ext) {
		names = append(names, image[:len(image)-len(ext)])
	}
	for _, p := range programs {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		base := p[strings.LastIndexAny(p, `/\`)+1:]
		for _, n := range names {
			if base == n {
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
