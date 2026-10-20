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

.PHONY: dev build build-linux build-windows test check probe clean

dev:
	$(WAILS) dev -tags $(LINUX_TAGS)

build: build-linux

build-linux:
	$(WAILS) build -tags $(LINUX_TAGS)

# Cross-compiles from Linux (Wails' Windows backend needs no cgo).
build-windows:
	$(WAILS) build -platform windows/amd64

test:
	go test ./internal/...
	@if [ -f frontend/dist/index.html ]; then go test .; else echo 'skipping go test . (frontend/dist is missing; build the frontend first)'; fi
	cd frontend && bun run test

check:
	@test -z "$$(gofmt -l internal *.go)" || { echo 'gofmt: unformatted files (run gofmt -w):'; gofmt -l internal *.go; exit 1; }
	go vet ./internal/...
	@if [ -f frontend/dist/index.html ]; then go vet .; else echo 'skipping go vet . (frontend/dist is missing; build the frontend first)'; fi
	cd frontend && bun run check

# Every probe in frontend/probes against the running `make dev` (docs/TESTS.md, "Probes").
probe:
	cd frontend && bun run probe --all

clean:
	rm -rf build/bin frontend/dist
