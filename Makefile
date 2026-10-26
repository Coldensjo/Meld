# Convenience targets (Linux/macOS/Git-Bash). On Windows without make, run the
# commands directly — see README.md and docs/MANUAL.md.

# On Windows, run the recipes through Git for Windows' sh, so they also work
# when make is started from PowerShell or cmd (which have no sh on the PATH).
ifeq ($(OS),Windows_NT)
GIT_SH ?= C:/Program Files/Git/usr/bin/sh.exe
SHELL := $(GIT_SH)
endif

WAILS ?= $(shell command -v wails 2>/dev/null || echo $(HOME)/go/bin/wails)
LINUX_TAGS ?= webkit2_41

.PHONY: dev build build-linux build-windows test test-full fuzz check lint notices notices-check bindings bindings-check format format-check verify probe probe-smoke probe-perf docs clean

dev:
	$(WAILS) dev -tags $(LINUX_TAGS)

build: build-linux

build-linux:
	$(WAILS) build -tags $(LINUX_TAGS)

# Cross-compiles from Linux (Wails' Windows backend needs no cgo).
build-windows:
	$(WAILS) build -platform windows/amd64

test:
	go test -short ./internal/... ./cmd/...
	@if [ -f frontend/dist/index.html ]; then go test -short .; else echo 'skipping go test . (frontend/dist is missing; build the frontend first)'; fi
	cd frontend && bun run test

# Mutates each client parser's fuzzer for 10 s (internal/*/fuzz_test.go, docs/TESTS.md); `make test` runs only their seeds.
fuzz:
	for f in FuzzParseM2 FuzzParseWMORoot FuzzParseWMOGroup FuzzParseMLIQ FuzzDecodeBLP FuzzDXTOf; do go test ./internal/wow -run '^$$' -fuzz "^$$f\$$" -fuzztime=10s || exit 1; done
	for f in FuzzParseTerrain FuzzParsePlacements; do go test ./internal/adt -run '^$$' -fuzz "^$$f\$$" -fuzztime=10s || exit 1; done

# Everything, with the heavy client scans that -short skips (about 10 s more).
test-full:
	go test ./internal/... ./cmd/...
	@if [ -f frontend/dist/index.html ]; then go test .; else echo 'skipping go test . (frontend/dist is missing; build the frontend first)'; fi
	cd frontend && bun run test

# Regenerates frontend/wailsjs from the bound Go methods (never edit it by hand); stage only the files that changed.
bindings:
	$(WAILS) generate module -tags $(LINUX_TAGS)
	@rm -f Meld.exe Meld

# Fails when a bound method (func (a *App) X in the root *.go files) has no export in wailsjs/go/main/App.d.ts, or the reverse: run `make bindings`. Needs no wails.
bindings-check:
	@grep -hoE '^func \(a \*App\) [A-Z][A-Za-z0-9]*' *.go | sed 's/.* //' | sort -u > .bindings-go.tmp; 	grep -oE '^export function [A-Za-z0-9]+' frontend/wailsjs/go/main/App.d.ts | sed 's/.* //' | sort -u > .bindings-ts.tmp; 	diff=$$(comm -3 .bindings-go.tmp .bindings-ts.tmp); rm -f .bindings-go.tmp .bindings-ts.tmp; 	test -z "$$diff" || { echo 'wailsjs/go/main/App.d.ts is out of step with the bound methods (go on the left, d.ts indented); run make bindings:'; echo "$$diff"; exit 1; }

# Formats the Go sources (gofmt) and the frontend (Prettier with the Svelte plugin, frontend/.prettierrc.json).
format:
	gofmt -w internal cmd *.go
	cd frontend && bun run format

# Fails when a frontend file is not as Prettier writes it: run make format.
format-check:
	cd frontend && bun run format:check

# The gate before a commit (CLAUDE.md, "Git workflow"): check, test, then the build for this OS.
verify: check test
	@if [ "$(OS)" = Windows_NT ]; then $(MAKE) build-windows; else $(MAKE) build-linux; fi

# Rewrites the generated part of THIRD_PARTY_NOTICES.md: the licence and text of every library the app bundles (frontend/scripts/notices.mjs).
notices:
	cd frontend && bun scripts/notices.mjs

# Fails on a shipped library outside the permissive licence allow list, or when THIRD_PARTY_NOTICES.md is out of date: run make notices.
notices-check:
	cd frontend && bun scripts/notices.mjs --check

# golangci-lint with the committed .golangci.yml (errcheck, govet, ineffassign, staticcheck, unused). Skipped with a note when the tool is missing; install it as README says.
lint:
	@if ! command -v golangci-lint >/dev/null 2>&1; then echo 'skipping golangci-lint (not installed: go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest)'; \
	elif [ -f frontend/dist/index.html ]; then golangci-lint run ./internal/... ./cmd/... .; \
	else echo 'linting ./internal/... only (frontend/dist is missing; build the frontend first)'; golangci-lint run ./internal/... ./cmd/...; fi

check: bindings-check notices-check format-check lint
	@test -z "$$(gofmt -l internal cmd *.go)" || { echo 'gofmt: unformatted files (run gofmt -w):'; gofmt -l internal cmd *.go; exit 1; }
	go vet ./internal/... ./cmd/...
	@if [ -f frontend/dist/index.html ]; then go vet .; else echo 'skipping go vet . (frontend/dist is missing; build the frontend first)'; fi
	cd frontend && bun run check

# Every probe in frontend/probes but the benchmarks (bench, perf-*; `make probe-perf` runs those) against the running `make dev` (docs/TESTS.md, "Probes").
probe:
	cd frontend && bun run probe --all

# The probes marked `// tier: smoke`: fast and deterministic, guarding the shared code most commits touch (docs/TESTS.md, "Probes").
probe-smoke:
	cd frontend && bun run probe --smoke

# The benchmark probes, which print numbers for a before/after (docs/TESTS.md, "Measuring performance").
probe-perf:
	cd frontend && bun run probe bench 'perf-*'

# The documentation site (VitePress) -> docs/.vitepress/dist; .github/workflows/docs.yml publishes it to GitHub Pages.
docs:
	cd frontend && bun run docs:build

clean:
	rm -rf build/bin frontend/dist
