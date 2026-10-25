package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"Meld/internal/adt"
	"Meld/internal/config"
	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// archives is what the client subcommands read from: the client's whole Data folder, with its patch
// order, or one archive.
type archives interface {
	ReadFile(name string) ([]byte, error)
}

// client is an opened --client: its archives, the names they list, and how to close them.
type client struct {
	files archives
	list  func() []string
	close func()
}

// openClient opens dir (a client folder, its Data folder or one .MPQ file), or config.json's
// wowPath when dir is empty.
func openClient(dir string) (*client, error) {
	if dir == "" {
		dir = config.Load().WowPath
		if dir == "" {
			return nil, errors.New("no client: pass --client, or set the client folder in Meld")
		}
	}
	if strings.EqualFold(filepath.Ext(dir), ".mpq") {
		a, err := mpq.Open(dir)
		if err != nil {
			return nil, err
		}
		list := func() []string {
			names, _ := a.ListFile()
			return names
		}
		return &client{files: a, list: list, close: func() { _ = a.Close() }}, nil
	}
	data, err := wow.ResolveDataDir(dir)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", dir, err)
	}
	set, err := mpq.OpenDataDir(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", data, err)
	}
	return &client{files: set, list: set.List, close: set.Close}, nil
}

// tileSource reads tiles from disk, or from the client when no such file exists. The client is
// opened on the first such read.
type tileSource struct {
	dir string
	c   *client
}

// read returns the tile's bytes, and the WDT's big-alpha flag where the tile came from the client
// (big says whether it was found).
func (s *tileSource) read(name string) (data []byte, bigAlpha, big bool, err error) {
	if b, err := os.ReadFile(name); err == nil {
		return b, false, false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, false, false, err
	}
	if s.c == nil {
		c, err := openClient(s.dir)
		if err != nil {
			return nil, false, false, fmt.Errorf("%s is not a file, and %w", name, err)
		}
		s.c = c
	}
	path := strings.ReplaceAll(name, "/", `\`)
	data, err = s.c.files.ReadFile(path)
	if err != nil {
		return nil, false, false, fmt.Errorf("%s: %w", path, err)
	}
	if wdt := wdtPath(path); wdt != "" {
		if w, err := s.c.files.ReadFile(wdt); err == nil {
			return data, adt.ReadBigAlpha(w), true, nil
		}
	}
	return data, false, false, nil
}

func (s *tileSource) close() {
	if s.c != nil {
		s.c.close()
	}
}

// wdtPath is the WDT beside a tile's archive path (World\Maps\Azeroth\Azeroth_32_48.adt gives
// World\Maps\Azeroth\Azeroth.wdt), or "" for a path not in a map folder.
func wdtPath(tile string) string {
	i := strings.LastIndex(tile, `\`)
	if i <= 0 {
		return ""
	}
	dir := tile[:i]
	j := strings.LastIndex(dir, `\`)
	return dir + `\` + dir[j+1:] + ".wdt"
}

// parseFlags parses fs's flags wherever they stand among args (Go's flag package stops at the first
// positional argument) and returns the positional ones.
func parseFlags(fs *flag.FlagSet, args []string) ([]string, error) {
	fs.SetOutput(io.Discard)
	var rest []string
	for {
		if err := fs.Parse(args); err != nil {
			return nil, fmt.Errorf("%w: %v", errUsage, err)
		}
		if fs.NArg() == 0 {
			return rest, nil
		}
		rest = append(rest, fs.Arg(0))
		args = fs.Args()[1:]
	}
}
