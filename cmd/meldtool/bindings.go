package main

import (
	"bytes"
	"flag"
	"fmt"
	"go/ast"
	"go/build"
	"go/parser"
	"go/printer"
	"go/token"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// binding is one method the app binds for the frontend: an exported method of *App in the root
// package, which Wails turns into frontend/wailsjs/go/main/App.d.ts.
type binding struct {
	Name      string `json:"name"`
	Signature string `json:"signature"`
	File      string `json:"file"`
	Line      int    `json:"line"`
	// Doc is the first line of the method's comment.
	Doc string `json:"doc,omitempty"`
}

// bindings lists the bound methods, read from the root package's sources (no build, no wails).
func bindings(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("bindings", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "print JSON")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) > 1 {
		return fmt.Errorf("%w: bindings takes at most the repository folder", errUsage)
	}
	dir := "."
	if len(pos) == 1 {
		dir = pos[0]
	}
	list, err := boundMethods(dir)
	if err != nil {
		return err
	}
	if *asJSON {
		return writeJSON(out, list)
	}
	for _, b := range list {
		fmt.Fprintf(out, "%s%s\t%s:%d\n", b.Name, b.Signature, b.File, b.Line)
	}
	return nil
}

func boundMethods(dir string) ([]binding, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}
	fset := token.NewFileSet()
	var out []binding
	for _, f := range files {
		// Only the files this OS builds: a method may have one file a platform (mouselook_*.go).
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		if ok, err := build.Default.MatchFile(filepath.Dir(f), filepath.Base(f)); err != nil || !ok {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		file, err := parser.ParseFile(fset, f, src, parser.ParseComments)
		if err != nil {
			return nil, err
		}
		if file.Name.Name != "main" {
			continue
		}
		for _, d := range file.Decls {
			fn, ok := d.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || len(fn.Recv.List) != 1 || !fn.Name.IsExported() || !isApp(fn.Recv.List[0].Type) {
				continue
			}
			var sig bytes.Buffer
			if err := printer.Fprint(&sig, fset, fn.Type); err != nil {
				return nil, err
			}
			b := binding{
				Name:      fn.Name.Name,
				Signature: strings.TrimPrefix(sig.String(), "func"),
				File:      filepath.Base(f),
				Line:      fset.Position(fn.Pos()).Line,
			}
			if fn.Doc != nil {
				b.Doc, _, _ = strings.Cut(strings.TrimSpace(fn.Doc.Text()), "\n")
			}
			out = append(out, b)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s: no methods of *App (run it from the repository root, or pass the folder)", dir)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// isApp says whether a receiver's type is *App.
func isApp(t ast.Expr) bool {
	star, ok := t.(*ast.StarExpr)
	if !ok {
		return false
	}
	id, ok := star.X.(*ast.Ident)
	return ok && id.Name == "App"
}
