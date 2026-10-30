# Convenience targets (Linux/macOS/Git-Bash). On Windows without make, run the
# commands directly — see README.md and docs/MANUAL.md.

# On Windows, run the recipes through Git for Windows' sh, so they also work
# when make is started from PowerShell or cmd (which have no sh on the PATH).
ifeq ($(OS),Windows_NT)
GIT_SH ?= C:/Program Files/Git/usr/bin/sh.exe
SHELL := $(GIT_SH)
endif

WAILS3 ?= $(shell command -v wails3 2>/dev/null || echo $(HOME)/go/bin/wails3)
# Wails v3 builds Linux on GTK4 and WebKitGTK 6.0 unless told gtk3, which is the GTK3 and WebKitGTK 4.1
# stack the owner's Linux machine has (#854). v3.1 drops gtk3: install webkitgtk-6.0 and set this empty.
LINUX_TAGS ?= gtk3
ifeq ($(OS),Windows_NT)
EXE := .exe
endif

.PHONY: dev dev-page dev-build dev-page-build build build-linux build-windows frontend-build frontend-dist test test-full fuzz check lint notices notices-check bindings bindings-check format format-check verify probe probe-smoke probe-perf docs clean

# The desktop window, with Vite's hot reload; a Go change rebuilds and restarts it (build/dev.yml).
dev:
	$(WAILS3) dev -config build/dev.yml

# The browser page at http://localhost:34115 that the probes drive: the app built in Wails' server
# mode (no window, no native dialogs), with Vite's hot reload and a rebuild on a Go change (build/dev-page.yml).
dev-page:
	$(WAILS3) dev -config build/dev-page.yml -port 9246

# The builds the two dev targets run (a dev build: no production tag, so the probes' sandbox works).
dev-build: frontend-dist
	go build -tags "$(LINUX_TAGS)" -o build/bin/Meld-dev$(EXE) .

dev-page-build: frontend-dist
	go build -tags server -o build/bin/Meld-page$(EXE) .

build: build-linux

frontend-build:
	cd frontend && bun install && bun run build

build-linux: frontend-build
	go build -tags "production $(LINUX_TAGS)" -trimpath -ldflags "-w -s" -o build/bin/Meld .

# Cross-compiles from Linux too (Wails' Windows backend needs no cgo). The .syso holds the icon, the
# manifest and the version info; go build links it in from the root folder.
build-windows: frontend-build
	$(WAILS3) generate syso -arch amd64 -icon build/windows/icon.ico -manifest build/windows/wails.exe.manifest -info build/windows/info.json -out meld_windows_amd64.syso
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags production -trimpath -ldflags "-w -s -H windowsgui" -o build/bin/Meld.exe . ; status=$$?; rm -f meld_windows_amd64.syso; exit $$status

# Builds the frontend when frontend/dist is missing, since the root package embeds it and its tests
# guard the bindings that write the world database (#410). Skipped when it is already built.
frontend-dist:
	@if [ ! -f frontend/dist/index.html ]; then echo 'frontend/dist is missing: building the frontend'; cd frontend && bun run build; fi

test: frontend-dist
	go test -short ./internal/... ./cmd/...
	go test -short -tags "$(LINUX_TAGS)" .
	cd frontend && bun run test

# Mutates each client parser's fuzzer for 10 s (internal/*/fuzz_test.go, docs/TESTS.md); `make test` runs only their seeds.
fuzz:
	for f in FuzzParseM2 FuzzParseWMORoot FuzzParseWMOGroup FuzzParseMLIQ FuzzDecodeBLP FuzzDXTOf; do go test ./internal/wow -run '^$$' -fuzz "^$$f\$$" -fuzztime=10s || exit 1; done
	for f in FuzzParseTerrain FuzzParsePlacements; do go test ./internal/adt -run '^$$' -fuzz "^$$f\$$" -fuzztime=10s || exit 1; done

# Everything, with the heavy client scans that -short skips (about 10 s more).
test-full: frontend-dist
	go test ./internal/... ./cmd/...
	go test -tags "$(LINUX_TAGS)" .
	cd frontend && bun run test

# Regenerates frontend/bindings from the bound Go methods (wails3 generate bindings), then the page's
# modules over them, frontend/src/lib/wails/App.ts and models.ts (frontend/scripts/bindings.mjs). Never edit them by hand.
bindings:
	$(WAILS3) generate bindings -ts -i -silent -d frontend/bindings
	cd frontend && bun scripts/bindings.mjs

# Fails when a bound method (func (a *App) X in the root *.go files, but Wails' ServiceStartup and ServiceShutdown) has no
# function in frontend/bindings/Meld/app.ts, or the reverse, or lib/wails is out of step with them: run `make bindings`. Needs no wails3.
bindings-check:
	@grep -hoE '^func \(a \*App\) [A-Z][A-Za-z0-9]*' *.go | sed 's/.* //' | grep -vxE 'Service(Startup|Shutdown)' | sort -u > .bindings-go.tmp; 	grep -oE '^export function [A-Za-z0-9]+' frontend/bindings/Meld/app.ts | sed 's/.* //' | sort -u > .bindings-ts.tmp; 	diff=$$(comm -3 .bindings-go.tmp .bindings-ts.tmp); rm -f .bindings-go.tmp .bindings-ts.tmp; 	test -z "$$diff" || { echo 'frontend/bindings/Meld/app.ts is out of step with the bound methods (go on the left, ts indented); run make bindings:'; echo "$$diff"; exit 1; }
	@cd frontend && bun scripts/bindings.mjs --check

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
lint: frontend-dist
	@if ! command -v golangci-lint >/dev/null 2>&1; then echo 'skipping golangci-lint (not installed: go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest)'; \
	else golangci-lint run --build-tags "$(LINUX_TAGS)" ./internal/... ./cmd/... .; fi

check: bindings-check notices-check format-check frontend-dist lint
	@test -z "$$(gofmt -l internal cmd *.go)" || { echo 'gofmt: unformatted files (run gofmt -w):'; gofmt -l internal cmd *.go; exit 1; }
	go vet -tags "$(LINUX_TAGS)" ./internal/... ./cmd/... .
	cd frontend && bun run lint && bun run check

# Every probe in frontend/probes but the benchmarks (bench, perf-*; `make probe-perf` runs those) and the `// tier: manual` ones against the running `make dev-page` (docs/TESTS.md, "Probes").
# The whole set outgrew the agent harness's 30-minute task limit (#669): `make probe SHARD=1/2`, then `SHARD=2/2`, runs it in halves.
probe:
	cd frontend && bun run probe --all $(if $(SHARD),--shard $(SHARD))

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
	rm -rf build/bin frontend/dist meld_windows_amd64.syso
