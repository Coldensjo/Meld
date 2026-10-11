# Convenience targets (Linux/macOS/Git-Bash). On Windows without make, run the
# commands directly — see README.md.

WAILS ?= $(shell command -v wails 2>/dev/null || echo $(HOME)/go/bin/wails)
LINUX_TAGS ?= webkit2_41

.PHONY: dev build build-linux build-windows test check clean

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

check:
	go vet ./internal/...
	cd frontend && pnpm check

clean:
	rm -rf build/bin frontend/dist
