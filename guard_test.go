package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// writerDirArg maps each function that writes into a client's Data folder to the position of the
// argument holding that folder. WriteLights takes DBC bytes, not a folder, so it needs no entry.
var writerDirArg = map[string]int{
	"InstallPatch":       0,
	"InstallWithPending": 0,
	"AddPending":         0,
	"ExportMap":          1, // ExportMap(readDir, patchDir, serverDir, spec)
}

// guardAllowConfig lists the test files (slash paths below internal/) that may read config.json.
// The tests find the client and the server through internal/testclient (#400), which reads
// config.json itself; it is not a test file, so it needs no entry.
var guardAllowConfig = map[string]bool{
	"config/config_test.go": true,
}

// guardDBWriters are the tests that write the world database. They name the server through the
// explicit VMANGOS_DIR, never testclient's config.json fallback (#400). A new test that writes the
// database goes on this list.
var guardDBWriters = map[string]bool{
	"TestCreatedGUIDLive":   true,
	"TestSpellStartersLive": true,
	"TestSpellScriptsLive":  true,
}

// TestNoTestWritesRealClient fails when a Go test hands a folder that is the owner's real client to
// a function that writes there (#402). The real client is the folder named by WOW_DIR, or the one
// testclient.DataDir returns (WOW_DIR, else config.json's wowPath, #400); a test that writes uses
// t.TempDir() or a hard-linked copy of the client (clientfolder_test.go) instead.
//
// How it works: in each function, an identifier is "real" when it is assigned from
// os.Getenv("WOW_DIR") or testclient.DataDir(t), or from an expression that uses another real identifier (ResolveDataDir,
// filepath.Join, ...), unless the expression calls t.TempDir() or a function whose name contains
// "TempDir", "Copy", "Link" or "Sandbox". A call of a writer in writerDirArg whose folder argument
// uses a real identifier fails. Limit: a real folder passed to a helper that writes is not followed;
// helpers that write take the folder as a parameter and are fine only when their callers pass a copy.
//
// The world database is guarded too: a test that writes it (guardDBWriters; TestCreatedGUIDLive
// inserts a row that has to fail on its key, and the database is MyISAM, so a rollback undoes
// nothing) reaches the server only through the explicit VMANGOS_DIR variable, never testclient's
// config.json fallback. Read-only tests use testclient.ServerDir. No test below internal/ other than
// guardAllowConfig reads config.json (config.Load) itself.
func TestNoTestWritesRealClient(t *testing.T) {
	var problems []string
	fset := token.NewFileSet()
	err := filepath.WalkDir("internal", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, perr := parser.ParseFile(fset, path, nil, 0)
		if perr != nil {
			return perr
		}
		rel := strings.TrimPrefix(filepath.ToSlash(path), "internal/")
		problems = append(problems, guardFile(fset, file, rel)...)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range problems {
		t.Error(p)
	}
}

// TestGuardCatchesRealClientWrite is the guard's own check: scratch sources with a write into the
// real client must be reported, and the safe patterns must pass.
func TestGuardCatchesRealClientWrite(t *testing.T) {
	bad := `package x
import ("os"; "testing")
func TestA(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	dataDir, _ := wow.ResolveDataDir(dir)
	InstallPatch(dataDir, nil)
}
func TestB(t *testing.T) {
	read := os.Getenv("WOW_DIR")
	ExportMap(read, read, "", spec)
}
func TestC(t *testing.T) {
	cfg, _ := config.Load()
	_ = cfg
}
func TestD(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, _ := wow.ResolveDataDir(dir)
	InstallWithPending(dataDir, nil)
}
func TestCreatedGUIDLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	_ = dir
}`
	good := `package x
import ("os"; "testing")
func TestA(t *testing.T) {
	read := os.Getenv("WOW_DIR")
	out := t.TempDir()
	ExportMap(read, out, "", spec)
	InstallPatch(out, nil)
	dir := t.TempDir()
	AddPending(filepath.Join(dir, "x"), nil)
	client := testclient.DataDir(t)
	ExportMap(client, out, testclient.ServerDir(t), spec)
}
func TestCreatedGUIDLive(t *testing.T) {
	dir := os.Getenv("VMANGOS_DIR")
	_ = dir
}`
	count := func(src string) int {
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, "x_test.go", src, 0)
		if err != nil {
			t.Fatal(err)
		}
		return len(guardFile(fset, f, "x/x_test.go"))
	}
	if n := count(bad); n != 5 {
		t.Errorf("bad source: %d problems reported, want 5", n)
	}
	if n := count(good); n != 0 {
		t.Errorf("good source: %d problems reported, want 0", n)
	}
}

func guardFile(fset *token.FileSet, file *ast.File, rel string) []string {
	var out []string
	if !guardAllowConfig[rel] {
		ast.Inspect(file, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok && calleeName(call) == "config.Load" {
				out = append(out, fmt.Sprintf("%s: reads config.json; a test reaches the client and the server only through WOW_DIR and VMANGOS_DIR (#402)", fset.Position(call.Pos())))
			}
			return true
		})
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		if guardDBWriters[fn.Name.Name] {
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				if call, ok := n.(*ast.CallExpr); ok && strings.HasPrefix(calleeName(call), "testclient.Server") {
					out = append(out, fmt.Sprintf("%s: %s writes the world database; name the server through os.Getenv(\"VMANGOS_DIR\"), not testclient's config.json fallback (#400)", fset.Position(call.Pos()), fn.Name.Name))
				}
				return true
			})
		}
		real := realIdents(fn.Body)
		redirected := assignsPendingRoot(fn.Body)
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			name := calleeName(call)
			if i := strings.LastIndex(name, "."); i >= 0 {
				name = name[i+1:]
			}
			pos, isWriter := writerDirArg[name]
			if !isWriter || pos >= len(call.Args) {
				return true
			}
			if name == "AddPending" && redirected {
				return true // the queue is in a temp folder, the client's folder is only read
			}
			if usesReal(call.Args[pos], real) || isRealSource(call.Args[pos]) {
				out = append(out, fmt.Sprintf("%s: %s writes into the real client's folder; use t.TempDir() or a hard-linked copy (#402)", fset.Position(call.Pos()), name))
			}
			return true
		})
	}
	return out
}

// realIdents finds the identifiers in body that hold the real client's folder, by taint: assigned
// from os.Getenv("WOW_DIR") or testclient.DataDir, or from an expression using one already found.
func realIdents(body *ast.BlockStmt) map[string]bool {
	real := map[string]bool{}
	for changed := true; changed; {
		changed = false
		mark := func(lhs []ast.Expr, rhs []ast.Expr) {
			for i, l := range lhs {
				id, ok := l.(*ast.Ident)
				if !ok || id.Name == "_" || real[id.Name] {
					continue
				}
				var r ast.Expr
				if len(rhs) == len(lhs) {
					r = rhs[i]
				} else if len(rhs) == 1 {
					r = rhs[0] // a, err := f(x)
				} else {
					continue
				}
				if isRealSource(r) || (usesReal(r, real) && !makesCopy(r)) {
					real[id.Name] = true
					changed = true
				}
			}
		}
		ast.Inspect(body, func(n ast.Node) bool {
			switch s := n.(type) {
			case *ast.AssignStmt:
				mark(s.Lhs, s.Rhs)
			case *ast.ValueSpec:
				lhs := make([]ast.Expr, len(s.Names))
				for i, nm := range s.Names {
					lhs[i] = nm
				}
				mark(lhs, s.Values)
			}
			return true
		})
	}
	return real
}

func usesReal(e ast.Expr, real map[string]bool) bool {
	found := false
	ast.Inspect(e, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok && real[id.Name] {
			found = true
		}
		return !found
	})
	return found
}

// makesCopy reports an expression that builds a safe folder: it calls t.TempDir() or a helper
// named for a copy, link or sandbox.
func makesCopy(e ast.Expr) bool {
	found := false
	ast.Inspect(e, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok {
			name := calleeName(call)
			for _, w := range []string{"TempDir", "Copy", "Link", "Sandbox"} {
				if strings.Contains(name, w) {
					found = true
				}
			}
		}
		return !found
	})
	return found
}

// isRealSource reports an expression that yields the real client's folder: os.Getenv("WOW_DIR")
// or testclient.DataDir.
func isRealSource(e ast.Expr) bool {
	call, ok := e.(*ast.CallExpr)
	if ok && calleeName(call) == "testclient.DataDir" {
		return true
	}
	if !ok || calleeName(call) != "os.Getenv" || len(call.Args) != 1 {
		return false
	}
	lit, ok := call.Args[0].(*ast.BasicLit)
	if !ok {
		return false
	}
	s, _ := strconv.Unquote(lit.Value)
	return s == "WOW_DIR"
}

// calleeName is "pkg.Func", "recv.Method" or "Func" for the called expression.
func calleeName(call *ast.CallExpr) string {
	switch f := call.Fun.(type) {
	case *ast.Ident:
		return f.Name
	case *ast.SelectorExpr:
		if x, ok := f.X.(*ast.Ident); ok {
			return x.Name + "." + f.Sel.Name
		}
		return f.Sel.Name
	}
	return ""
}

// assignsPendingRoot reports a function that points pendingRoot elsewhere, so AddPending queues in
// that folder and leaves the client's Data folder alone.
func assignsPendingRoot(body *ast.BlockStmt) bool {
	found := false
	ast.Inspect(body, func(n ast.Node) bool {
		if as, ok := n.(*ast.AssignStmt); ok {
			for _, l := range as.Lhs {
				if id, ok := l.(*ast.Ident); ok && id.Name == "pendingRoot" {
					found = true
				}
			}
		}
		return !found
	})
	return found
}
