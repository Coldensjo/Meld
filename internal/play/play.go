// Package play starts the 3dgame client on a cube world, with the player where the editor's camera
// is (#33). The client plays alone: it starts a server of its own inside itself on the world file
// (`3dgame-client world.world --at x,y,z --look yaw,pitch`), so there is nothing else to run.
package play

import (
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
)

// Spot is where the player starts and which way it looks: the eyes in metres of the game's
// coordinates (the world's x and z, y up from the ground layer's bottom), and the view's yaw and
// pitch in radians as the client's --look takes them (yaw 0 looks north, -z; positive pitch looks up).
type Spot struct {
	X, Y, Z    float64
	Yaw, Pitch float64
}

// Args is the client's command line for the world file at world, starting at spot.
func Args(world string, s Spot) ([]string, error) {
	for _, v := range []float64{s.X, s.Y, s.Z, s.Yaw, s.Pitch} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, errors.New("the camera's position is not a number")
		}
	}
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }
	return []string{world, "--at", f(s.X) + "," + f(s.Y) + "," + f(s.Z), "--look", f(s.Yaw) + "," + f(s.Pitch)}, nil
}

// exeName is the client's file name on this OS.
func exeName() string {
	if runtime.GOOS == "windows" {
		return "3dgame-client.exe"
	}
	return "3dgame-client"
}

// FindClient returns the client program: configured (a file, or a folder holding it) when set,
// else the release or debug build in the repository's target folder above the running editor,
// else one on the PATH.
func FindClient(configured, editorExe string) (string, error) {
	if configured != "" {
		if info, err := os.Stat(configured); err == nil && info.IsDir() {
			configured = filepath.Join(configured, exeName())
		}
		if _, err := os.Stat(configured); err != nil {
			return "", fmt.Errorf("the game client %s isn't there", configured)
		}
		return configured, nil
	}
	if editorExe != "" {
		for dir := filepath.Dir(editorExe); ; dir = filepath.Dir(dir) {
			for _, profile := range []string{"release", "debug"} {
				p := filepath.Join(dir, "target", profile, exeName())
				if _, err := os.Stat(p); err == nil {
					return p, nil
				}
			}
			if filepath.Dir(dir) == dir {
				break
			}
		}
	}
	if p, err := exec.LookPath(exeName()); err == nil {
		return p, nil
	}
	return "", errors.New("the game client isn't built: run cargo build --release -p client in the repository, or set its path")
}

// Starter starts a program that stays up after this returns (OSStarter, or a fake in tests).
type Starter interface {
	StartLogged(dir, name, logPath string, env []string, args ...string) error
}

// OSStarter starts programs for real.
type OSStarter struct{}

// StartLogged starts name in dir with env (KEY=value) added to the environment and its output in a
// new file at logPath, and returns once it runs: it runs on after the editor exits.
func (OSStarter) StartLogged(dir, name, logPath string, env []string, args ...string) error {
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}
	log, err := os.Create(logPath)
	if err != nil {
		return err
	}
	// The program gets its own copy of the handle, so this one closes once it's started.
	defer log.Close()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}
	allowForeground(cmd.Process.Pid)
	return cmd.Process.Release()
}

// Launch starts the client at client on the saved world file at world, with the player at spot. Its
// output goes to a file (client.log) beside the editor's other logs in logDir.
func Launch(run Starter, client, world, logDir string, s Spot) error {
	args, err := Args(world, s)
	if err != nil {
		return err
	}
	if _, err := os.Stat(world); err != nil {
		return fmt.Errorf("the world file %s isn't there", world)
	}
	return run.StartLogged(filepath.Dir(client), client, filepath.Join(logDir, "client.log"), nil, args...)
}
