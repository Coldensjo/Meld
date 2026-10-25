package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

// mpqList prints the client's (or one archive's) listed files, one a line, keeping those whose path
// holds filter (any case; / and \ alike).
func mpqList(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("mpq ls", flag.ContinueOnError)
	clientDir := fs.String("client", "", "client folder, Data folder or .MPQ")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) > 1 {
		return fmt.Errorf("%w: mpq ls takes at most one filter", errUsage)
	}
	c, err := openClient(*clientDir)
	if err != nil {
		return err
	}
	defer c.close()
	filter := ""
	if len(pos) == 1 {
		filter = strings.ToLower(strings.ReplaceAll(pos[0], "/", `\`))
	}
	for _, n := range c.list() {
		if filter == "" || strings.Contains(strings.ToLower(strings.ReplaceAll(n, "/", `\`)), filter) {
			fmt.Fprintln(out, n)
		}
	}
	return nil
}

// mpqCat writes one file from the client (the topmost patch that has it) or one archive to stdout,
// or to -o's file.
func mpqCat(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("mpq cat", flag.ContinueOnError)
	clientDir := fs.String("client", "", "client folder, Data folder or .MPQ")
	dest := fs.String("o", "", "write to this file instead of stdout")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 {
		return fmt.Errorf("%w: mpq cat takes one archive path", errUsage)
	}
	c, err := openClient(*clientDir)
	if err != nil {
		return err
	}
	defer c.close()
	name := strings.ReplaceAll(pos[0], "/", `\`)
	data, err := c.files.ReadFile(name)
	if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	if *dest != "" {
		return os.WriteFile(*dest, data, 0o644)
	}
	_, err = out.Write(data)
	return err
}
