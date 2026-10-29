# Building and development

Meld is a Wails v2 desktop application with a Go backend and a Svelte 5, TypeScript and Three.js
frontend. Windows and Linux are the supported platforms. Game assets are read from a local
WoW 1.12.1 installation; they are not part of the source or build.

The integrated VMaNGOS process-management and map-extraction workflow is Windows-only.
Cross-platform editor builds do not imply that every server operation is available on Linux.

## Install the prerequisites

| Dependency | Used for |
| --- | --- |
| Git | Clone the source repository; Git for Windows also supplies the shell for Make |
| Go 1.27.3 or newer | Backend, tests and command-line tools |
| Bun 1.4 or newer | Frontend dependencies, development server and documentation |
| Wails v2 CLI | Desktop development and builds |
| GNU Make | Repository convenience commands |
| golangci-lint v2 | Go lint checks; `make check` reports a skip if it is absent |

Install the Go-based tools:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@latest
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
# Rebuild it after a Go toolchain bump: it refuses a go.mod newer than the Go it was built with.
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

## Get the source

In a terminal, choose a parent folder for the checkout, then run these commands (PowerShell or a
Linux shell):

```sh
git clone https://github.com/Coldensjo/Meld.git
cd Meld
```

This `Meld` folder is the **repository root** used by the commands below. If you already have a
checkout, use that folder instead; preserve local changes rather than cloning over it.

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

### Debug a focused failure

Start with a synthetic test for the affected subsystem before opening real client/server data.
The [testing guide](TESTS.md#reproduce-and-inspect-a-failure) explains log/scene capture and
`meldtool` inspection; its [regression index](TESTS.md#index-of-feature-checks) routes to feature checks.
For a native failure, record **Help › Log…**, exact steps and the build revision. For a viewport
failure, capture **Help › Copy Scene** and, when relevant, **Help › Copy Performance Report**.
Review logs and scene text for private paths or credentials before sharing them.

The development browser endpoint shares the Go backend. It is not a disposable database or client:
do not use it for an integration write merely because its page can be closed. Follow the
[probe isolation rules](TESTS.md#probes-repeatable-checks-in-the-live-app) and distinguish pure-test failures, backend
failures and real GPU/native behavior. See [architecture](architecture/index.md) to locate the
responsible layer rather than duplicating a backend workaround in the UI.

## Build a desktop executable

| Platform | Make command | Direct Wails command | Output |
| --- | --- | --- | --- |
| Windows | `make build-windows` | `wails build -platform windows/amd64` | `build/bin/Meld.exe` |
| Linux | `make build-linux` | `wails build -tags webkit2_41` | `build/bin/Meld` |

The Windows target can also cross-compile from Linux. On Windows, `wails build -nsis` builds an
installer when the NSIS tooling is installed. Building a different platform does not verify that
the application runs correctly on it.

### Installer and distribution precautions

::: warning Keep author data outside the installation folder
The checked-in NSIS uninstall script recursively removes the selected installation directory.
Do not install into a client, server, project or source-asset folder, and do not keep working maps
or backups beneath it. Copy any author data out before uninstalling. It also removes the configured
WebView2 data path, shortcuts and generated file/protocol associations. These are source-verified
script effects, not results of an executed installer/uninstaller test.
:::

The NSIS inputs default to an administrator/all-machine installation under Program Files; a
user-scope override has a LocalAppData Programs path. The generated scope/association settings
need review for the actual package. The script checks/installs WebView2 as needed; confirm its
network/runtime behavior on a disposable Windows host rather than assuming a desktop build
proved it. See [build assets](https://github.com/Coldensjo/Meld/blob/main/build/README.md).

The Pages workflow builds/deploys this documentation site, not desktop release artifacts.
The optional [Benilla launcher](BENILLA.md) has separate sibling-source/Rust/assets requirements;
the NSIS binary-file macro is not evidence it packages that launcher or its assets. The current
notices generator checks frontend npm and Go dependencies, not the complete Rust/sibling artifact
closure. A distributor must identify the exact artifact, revisions/assets and attribution needed
before redistribution; this is an open review boundary, not a verified licence defect.

Native Windows installer/WebView2/association/uninstall checks and Linux WebKitGTK startup have
not been executed for this documentation pass. No release packaging or macOS support is certified.

#### Disposable-host verification still required

Do not run installer/uninstaller tests on a development machine or point them at real author data.
Use a disposable VM snapshot and synthetic files only. Record the built installer hash, Meld/Wails
revisions, OS/architecture, generated scope/association inputs and each observed result.

- **Windows scope and payload:** verify elevation/default all-machine path and an intentionally
  generated user-scope package separately; custom install path, binary payload, shortcuts and first
  launch must match the actual generated artifact, not just the checked-in template.
- **WebView2:** check launch with an existing runtime and installation without one, including the
  bootstrap's network/error path. Record resulting runtime/data locations; do not infer success
  from compilation or assume offline installation works.
- **Associations and uninstall:** on the disposable host, test only associations/protocols actually
  generated for that package, opening a synthetic working file and cleanup on uninstall. Use a
  synthetic sentinel to observe recursive installation-directory deletion and WebView2 data cleanup;
  record treatment of preexisting handlers rather than promising restoration.
- **Linux:** on a native disposable target, install the documented GTK/WebKitGTK 4.1 dependencies,
  build/start the editor and exercise a basic WebView window. Keep distribution/version evidence
  separate from Windows and from the Windows-only server automation. This is not an NSIS test.

Before distributing, the distributor must decide the supported artifact/architecture and install
scope, release/signing/update policy, whether the optional launcher is included, and its exact
sibling Benilla revision/assets. Review the Rust/sibling dependency and asset attribution boundary
alongside npm/Go notices. Neither a notices check nor a documentation deployment makes those
decisions. Store results with the artifact before closing the packaging verification task.

## Validate a change

```sh
make test          # Go tests in short mode and frontend unit tests
make check         # formatting checks, vet, lint, bindings, notices and TypeScript/Svelte checks
make verify        # check, test and the build for the current OS
```

`make check` checks formatting; `make format` rewrites source files. Do not run the latter over
someone else's in-progress work. The desktop package embeds `frontend/dist`, so `make test` and
`make check` build the frontend first when `frontend/dist/index.html` is missing, and always run the
root package's tests and checks.

GitHub Actions runs the same checks and the short tests on Linux at every push and pull request
(`.github/workflows/check.yml`, job `check`): gofmt, the bindings, notices and Prettier checks,
`go vet`, golangci-lint, `go test -short`, `bun run test` and `bun run check`, then the frontend build
and the root package. Its second job, `build-linux`, runs `make build-linux` with WebKitGTK 4.1 and
is allowed to fail (`continue-on-error`) while it is new, so read its result rather than the run's
overall status. Read a run with `gh run list --workflow check.yml` and `gh run view <id> --log-failed`.

Read [Testing](TESTS.md) before running integration tests or live-app probes: a local configuration
can make tests discover the real client and server, and some database-writing tests require explicit opt-in.

## Work on the documentation

Before editing, read the repository's
[documentation roadmap](https://github.com/Coldensjo/Meld/blob/main/DOCUMENTATION_PLAN.md),
[audit](https://github.com/Coldensjo/Meld/blob/main/DOCUMENTATION_AUDIT.md) and
[rules](https://github.com/Coldensjo/Meld/blob/main/DOCUMENTATION_RULES.md). Preserve stable task IDs,
record the source areas you actually checked and update coverage when functionality changes.

The site is built from `docs/` with VitePress. Its dependency and scripts live in `frontend/`:

```sh
cd frontend
bun run docs:dev       # edit with hot reload
bun run docs:check     # build, validate Markdown/rendered links and anchors, test the checker
bun run docs:preview   # inspect the built site
```

The build output is `docs/.vitepress/dist`. The preview normally serves it at
`http://localhost:4173/Meld/`. The GitHub Pages workflow publishes documentation changes on `main`;
a local build does not deploy anything.

`docs:check` validates relative Markdown links/images, case-sensitive paths, rendered links and
anchors, navigation entries and local assets. It checks one H1 per prose page (the home layout
generates its title), closed code fences and NUL characters, then runs synthetic checker tests,
including a deliberately broken VitePress build. It does not enforce every stylistic convention,
check external websites or replace browser/accessibility testing. No new dependencies are required.

The existing `Docs` workflow runs these checks on relevant pull requests and pushes to `main`,
with a frozen lockfile and cached Bun dependencies. Pull requests never upload or deploy Pages;
only `main` can publish. The uploaded output includes `revision.txt` containing the deployed Git
commit, so maintainers can compare the actual website with the successful workflow's head SHA.

For a new page, add it to `docs/.vitepress/config.mts` and link it from the relevant guide.
Links to source files outside `docs/` must use GitHub URLs. Raw HTML in Markdown is disabled;
use Markdown and VitePress containers rather than embedded HTML.

Check the built site in a browser as well as building it: search, theme switching and collapsible
navigation must work after hydration. Prerendered text alone does not prove the JavaScript works.

### Check documentation accessibility

For theme changes, run `bun run docs:check`, start `bun run docs:preview` in a separate terminal,
then run `node scripts/docs-browser-check.mjs` from `frontend/`. Restart the preview after rebuilding:
its cached asset directory can otherwise return 404 for newly generated filenames.

The optional browser check needs Playwright Core, axe-core and a Chromium browser. Keep these QA
tools outside the project dependencies. For example, in PowerShell:

```powershell
$tools = Join-Path $env:TEMP 'meld-doc013-tools'
npm install --prefix $tools --no-audit --no-fund playwright-core@1.56.1 axe-core@4.10.3
node "$tools/node_modules/playwright-core/cli.js" install chromium
$env:DOCS_BROWSER_TOOLS = $tools
node scripts/docs-browser-check.mjs
```

Alternatively set `DOCS_BROWSER_EXECUTABLE` to an installed Chrome/Chromium executable and skip the
browser download. On other shells, set the same environment variables to absolute paths. The script
defaults to the local preview; `DOCS_BASE_URL` changes the target. JSON evidence and QA screenshots go
to the system temporary directory's `meld-doc013-browser` folder, or `DOCS_BROWSER_OUTPUT` if set.
No game, database, application probe or deployment is involved.

The check audits the sidebar-linked pages in both themes, narrow/desktop layouts and search states;
it exercises keyboard focus, sidebar/mobile menus, mouse and keyboard result navigation, Escape,
empty results and reduced motion. axe's incomplete results are retained for review, not counted as
passes. Independent computed-color checks supplement clipped search-result/footer contrast checks.
An optional browser-requested `/favicon.ico` 404 is recorded separately from application failures.
Real screen-reader announcements, touch/virtual-keyboard behavior and full WCAG 2.2 AA conformance
still require manual assessment.

DOC-013's small compatibility plugin in `docs/.vitepress/theme-patches.mjs` corrects the pinned
VitePress default theme at build time, before Vue compilation, without editing `node_modules` or
copying the entire upstream components. It preserves their search handlers, routing and styling.
Exact-match guards and `scripts/docs-check-theme.test.mjs` fail when an upstream component changes;
review or retire each patch on a VitePress upgrade. The local theme CSS and code-token transformer
only adjust verified contrast failures and focus indicators.

## Find the relevant code

Start with the [architecture overview](architecture/index.md). The detailed subsystem references
and [engineering notebooks](reference/index.md) retain format constraints, regression cases and
implementation details from previous investigations.

Keep user-facing instructions in the guides. Put a repeatable feature check in `docs/tests/`, and
put historical experiments or machine-specific observations in the notebooks rather than adding
them to the getting-started path. Do not commit extracted game assets, account credentials or
private connection details.
