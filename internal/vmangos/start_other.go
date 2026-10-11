//go:build !windows

package vmangos

import (
	"os"
	"os/exec"
	"sync"
)

// startProgram starts a program that stays up after this returns. A server reads its console and shuts
// down when that input ends, so it gets a pipe whose write end stays open with this process.
func startProgram(dir, name string, args []string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	in, out, err := os.Pipe()
	if err != nil {
		return err
	}
	cmd.Stdin = in
	if err := cmd.Start(); err != nil {
		in.Close()
		out.Close()
		return err
	}
	in.Close()
	heldMu.Lock()
	held = append(held, out)
	heldMu.Unlock()
	go cmd.Wait()
	return nil
}

// held keeps the write ends of the servers' console pipes open. A file that's garbage collected is
// closed, which would end a server's console input.
var (
	heldMu sync.Mutex
	held   []*os.File
)
