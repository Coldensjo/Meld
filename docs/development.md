# Building and development

Meld is a Wails v2 desktop application with a Go backend and a Svelte 5, TypeScript and Three.js
frontend. Windows and Linux are the supported platforms. Game assets are read from a local
WoW 1.12.1 installation; they are not part of the source or build.

The integrated VMaNGOS process-management and map-extraction workflow is Windows-only.
Cross-platform editor builds do not imply that every server operation is available on Linux.

## Install the prerequisites

| Dependency | Used for |
| --- | --- |
| Go 1.26 or newer | Backend, tests and command-line tools |
| Bun 1.4 or newer | Frontend dependencies, development server and documentation |
| Wails v2 CLI | Desktop development and builds |
| GNU Make | Repository convenience commands |
| golangci-lint v2 | Go lint checks; `make check` reports a skip if it is absent |

Install the Go-based tools:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@latest
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
wails doctor
```

Ensure the Go tools directory is on your `PATH`. `wails doctor` checks platform dependencies.

### Windows

The desktop application uses WebView2. Install its runtime if it is missing. Meld's Go backend
does not need a C compiler on Windows.

Make recipes use Git for Windows' `sh.exe`, including when Make runs from PowerShell. If you do
not have Make, use the direct commands below. The optional Benilla launcher has separate Rust
and native-toolchain requirements; see [Benilla](BENILLA.md).

### Linux

Install GTK 3 and WebKitGTK 4.1 development packages. For example:

```sh
# Debian / Ubuntu
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev

# Arch Linux
sudo pacman -S gtk3 webkit2gtk-4.1
```

Linux Wails commands need `-tags webkit2_41`; the Make targets add it for you.

## Install frontend dependencies

From the repository root:

```sh
cd frontend
bun install --frozen-lockfile
cd ..
```

## Run the application

```sh
make dev
```

Without Make, run `wails dev` on Windows or `wails dev -tags webkit2_41` on Linux.
The development app is also available at `http://localhost:34115`, with the Go bindings connected.
Use a configured development client if you want to inspect real assets.

## Build a desktop executable

| Platform | Make command | Direct Wails command | Output |
| --- | --- | --- | --- |
| Windows | `make build-windows` | `wails build -platform windows/amd64` | `build/bin/Meld.exe` |
| Linux | `make build-linux` | `wails build -tags webkit2_41` | `build/bin/Meld` |

The Windows target can also cross-compile from Linux. On Windows, `wails build -nsis` builds an
installer when the NSIS tooling is installed. Building a different platform does not verify that
the application runs correctly on it.

## Validate a change

```sh
make test          # Go tests in short mode and frontend unit tests
make check         # formatting checks, vet, lint, bindings, notices and TypeScript/Svelte checks
make verify        # check, test and the build for the current OS
```

`make check` checks formatting; `make format` rewrites source files. Do not run the latter over
someone else's in-progress work. The root Go package's tests and some checks are skipped if
`frontend/dist/index.html` has not been built, because the desktop package embeds it.

GitHub Actions runs the same checks and the short tests on Linux at every push and pull request
(`.github/workflows/check.yml`, job `check`): gofmt, the bindings, notices and Prettier checks,
`go vet`, golangci-lint, `go test -short`, `bun run test` and `bun run check`, then the frontend build
and the root package. Its second job, `build-linux`, runs `make build-linux` with WebKitGTK 4.1 and
is allowed to fail (`continue-on-error`) while it is new, so read its result rather than the run's
overall status. Read a run with `gh run list --workflow check.yml` and `gh run view <id> --log-failed`.

Read [Testing](TESTS.md) before running integration tests or live-app probes: a local configuration
can make tests discover the real client and server, and some database-writing tests require explicit opt-in.

## Work on the documentation

The site is built from `docs/` with VitePress. Its dependency and scripts live in `frontend/`:

```sh
cd frontend
bun run docs:dev       # edit with hot reload
bun run docs:build     # validate links and build the static site
bun run docs:preview   # inspect the built site
```

The build output is `docs/.vitepress/dist`. The preview normally serves it at
`http://localhost:4173/Meld/`. The GitHub Pages workflow publishes documentation changes on `main`;
a local build does not deploy anything.

For a new page, add it to `docs/.vitepress/config.mts` and link it from the relevant guide.
Links to source files outside `docs/` must use GitHub URLs. Raw HTML in Markdown is disabled;
use Markdown and VitePress containers rather than embedded HTML.

Check the built site in a browser as well as building it: search, theme switching and collapsible
navigation must work after hydration. Prerendered text alone does not prove the JavaScript works.

## Find the relevant code

Start with the [architecture overview](architecture/index.md). The detailed subsystem references
and [engineering notebooks](reference/index.md) retain format constraints, regression cases and
implementation details from previous investigations.

Keep user-facing instructions in the guides. Put a repeatable feature check in `docs/tests/`, and
put historical experiments or machine-specific observations in the notebooks rather than adding
them to the getting-started path. Do not commit extracted game assets, account credentials or
private connection details.
