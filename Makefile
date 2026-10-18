# Convenience targets (Linux/macOS/Git-Bash). On Windows without make, run the
# commands directly — see README.md and docs/MANUAL.md.

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
	cd frontend && bun run test

check:
	@test -z "$$(gofmt -l internal *.go)" || { echo 'gofmt: unformatted files (run gofmt -w):'; gofmt -l internal *.go; exit 1; }
	go vet ./internal/...
	cd frontend && bun run check

# Every probe in frontend/probes against the running `make dev` (docs/TESTS.md, "Probes").
probe:
	cd frontend && bun run probe --all

clean:
	rm -rf build/bin frontend/dist
