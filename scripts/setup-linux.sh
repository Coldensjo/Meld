#!/usr/bin/env bash
# Sets up a fresh Debian or Ubuntu container (a cloud Claude Code session, a CI runner) to build,
# test, run `make dev-page` and run the probes (#617). A fresh container has no wails3, no Chrome and
# no GTK/WebKitGTK headers, so without this only `go test`, `bun test` and `bun run check` can run.
#
# It installs what is missing and skips what is there, so it is safe to run at every session start:
#   - Go (the version in go.mod, into ~/.local/go) and Bun, when not on the PATH;
#   - the GTK3 and WebKitGTK 4.1 headers (`make build-linux` and the vet/lint of the root package
#     use the gtk3 tag, LINUX_TAGS in the Makefile) and a C compiler for cgo;
#   - Google Chrome (amd64) or the distribution's Chromium, which frontend/probes/run.mjs finds in
#     /usr/bin (or set CHROME);
#   - wails3 at go.mod's Wails version (`make dev`, `make dev-page`, `make bindings`) and
#     golangci-lint v2 (`make check` skips the lint without it);
#   - the frontend's packages (`bun install --frozen-lockfile`).
#
# Still impossible without the owner's WoW 1.12.1 client: the client-dependent Go tests (they skip
# without WOW_DIR) and the probes that load client assets or the benchmark scene; only the probes on
# flat maps can pass. The desktop window (`make dev`) also needs a display.
#
# Usage: scripts/setup-linux.sh [--no-chrome] [--no-lint]
# As a Claude Code SessionStart hook (.claude/settings.json), cloud sessions only:
#   { "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
#     "command": "[ \"$CLAUDE_CODE_REMOTE\" = true ] && \"$CLAUDE_PROJECT_DIR\"/scripts/setup-linux.sh || true" } ] } ] } }
# The PATH additions go to $CLAUDE_ENV_FILE under a hook (and $GITHUB_PATH in Actions), so later commands see them.
set -euo pipefail

chrome=1
lint=1
for arg in "$@"; do
	case "$arg" in
		--no-chrome) chrome=0 ;;
		--no-lint) lint=0 ;;
		-h | --help)
			sed -n '2,24p' "$0"
			exit 0
			;;
		*)
			echo "setup-linux: unknown option $arg" >&2
			exit 2
			;;
	esac
done

if [ "$(uname -s)" != Linux ]; then
	echo "setup-linux: not Linux, nothing to do"
	exit 0
fi

root=$(cd "$(dirname "$0")/.." && pwd)
log() { echo "setup-linux: $*"; }

# Adds a folder to this script's PATH and, under a SessionStart hook, to the session's.
add_path() {
	case ":$PATH:" in *":$1:"*) ;; *) export PATH="$1:$PATH" ;; esac
	if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qsF "$1" "$CLAUDE_ENV_FILE"; then
		echo "export PATH=\"$1:\$PATH\"" >>"$CLAUDE_ENV_FILE"
	fi
	if [ -n "${GITHUB_PATH:-}" ]; then
		echo "$1" >>"$GITHUB_PATH"
	fi
}

sudo=
if [ "$(id -u)" -ne 0 ]; then
	if command -v sudo >/dev/null; then
		sudo=sudo
	else
		log "not root and no sudo: the apt packages are skipped"
		sudo=none
	fi
fi

arch=$(uname -m)
case "$arch" in
	x86_64) goarch=amd64 ;;
	aarch64 | arm64) goarch=arm64 ;;
	*) goarch=$arch ;;
esac

# System packages.
apt_install() { $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"; }
if [ "$sudo" != none ] && command -v apt-get >/dev/null; then
	pkgs="build-essential pkg-config curl ca-certificates unzip libgtk-3-dev libwebkit2gtk-4.1-dev"
	missing=
	for p in $pkgs; do
		dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"
	done
	have_chrome=0
	for c in "${CHROME:-}" /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
		[ -n "$c" ] && [ -x "$c" ] && have_chrome=1
	done
	if [ -n "$missing" ] || { [ $chrome = 1 ] && [ $have_chrome = 0 ]; }; then
		log "apt-get update"
		$sudo apt-get update -qq
	fi
	if [ -n "$missing" ]; then
		log "installing$missing"
		apt_install $missing
	fi
	if [ $chrome = 1 ] && [ $have_chrome = 0 ]; then
		if [ "$goarch" = amd64 ]; then
			# Ubuntu's chromium package is a snap stub that does not run in a container: take Google's .deb.
			log "installing Google Chrome"
			deb=$(mktemp -d)/google-chrome.deb
			curl -fsSL -o "$deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
			apt_install "$deb"
			rm -f "$deb"
		else
			log "installing chromium (Google ships no Linux Chrome for $arch)"
			apt_install chromium || apt_install chromium-browser
		fi
	fi
elif [ "$sudo" != none ]; then
	log "no apt-get: install gtk3, webkit2gtk-4.1, a C compiler and Chrome with your package manager"
fi

# Go, at go.mod's version when missing.
if ! command -v go >/dev/null; then
	if [ -x "$HOME/.local/go/bin/go" ]; then
		add_path "$HOME/.local/go/bin"
	else
		gover=$(sed -n 's/^go \([0-9.]*\).*/\1/p' "$root/go.mod")
		log "installing Go $gover into ~/.local/go"
		mkdir -p "$HOME/.local"
		curl -fsSL "https://go.dev/dl/go$gover.linux-$goarch.tar.gz" | tar -xz -C "$HOME/.local"
		add_path "$HOME/.local/go/bin"
	fi
fi
add_path "$(go env GOPATH)/bin"

# Bun.
if ! command -v bun >/dev/null; then
	if [ ! -x "$HOME/.bun/bin/bun" ]; then
		log "installing Bun"
		curl -fsSL https://bun.sh/install | bash >/dev/null
	fi
	add_path "$HOME/.bun/bin"
fi

# wails3, at the Wails version go.mod pins.
wailsver=$(sed -n 's#^[[:space:]]*github.com/wailsapp/wails/v3 \(v[^ ]*\).*#\1#p' "$root/go.mod")
if ! command -v wails3 >/dev/null || ! wails3 version 2>/dev/null | grep -qF "${wailsver#v}"; then
	log "installing wails3 $wailsver"
	go install "github.com/wailsapp/wails/v3/cmd/wails3@$wailsver"
fi

if [ $lint = 1 ] && ! command -v golangci-lint >/dev/null; then
	log "installing golangci-lint v2"
	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
fi

log "bun install"
(cd "$root/frontend" && bun install --frozen-lockfile)

log "done: go $(go env GOVERSION), bun $(bun --version), $(wails3 version 2>/dev/null | head -n 1)"
