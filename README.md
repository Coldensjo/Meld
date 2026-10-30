# Meld

A fast 3D map editor for World of Warcraft 1.12.1, for Windows and Linux. Sculpt terrain, paint
textures, place models, water and creatures, and compile the result into your own 1.12 client and
VMaNGOS server. Models and textures are read live from your client's MPQ archives; nothing from the
game is bundled.

Built with [Wails v3](https://wails.io) (Go), Svelte 5 and Three.js.

## Getting started

To build Meld you need:

- [Go](https://go.dev/dl/) 1.27.3+.
- [Bun](https://bun.sh), which runs the frontend tooling.
- The Wails v3 CLI, `wails3` (`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0`, the version in
  `go.mod`) for `make dev`, `make dev-page` and `make bindings`; `wails3 doctor` checks the rest. The builds need only Go.
- [golangci-lint](https://golangci-lint.run) v2 for `make check`
  (`go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`); without it `make check` skips the lint.
- `make` ([GNU Make](https://www.gnu.org/software/make/); the makefile also lists the plain
  commands). On Windows the recipes run through the `sh.exe` of [Git for Windows](https://gitforwindows.org).
- Linux: `gtk3` and `webkit2gtk-4.1` from your distribution. Windows: the
  [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (install it if missing).

To use the result you need your own WoW 1.12.1 client. To export a map into a running game you also
need a [VMaNGOS](https://github.com/vmangos/core) server with its [MariaDB](https://mariadb.org/download/)
database, and optionally the [Benilla](https://github.com/samwhosung/benilla) client
([Benilla guide](docs/BENILLA.md)).

First follow [source checkout and dependency setup](docs/development.md#get-the-source) in the
development guide. Run these commands from the repository root:

```bash
make dev             # run in a window with hot reload
make dev-page        # the same app as a browser page at http://localhost:34115 (the probes use it)
make build-windows   # build/bin/Meld.exe
make build-linux     # build/bin/Meld
make test            # Go and frontend unit tests
make check           # go vet + golangci-lint + ESLint + svelte-check/tsc
```

GitHub Actions runs the checks and short tests on Linux at every push (`.github/workflows/check.yml`);
its `make build-linux` job is allowed to fail for now (see [Development](docs/development.md)).

On first start, pick your WoW 1.12 client folder under Edit › Preferences… › Folders.

## Documentation

The docs are also published as a site: <https://coldensjo.github.io/Meld/>.

- [Getting started](docs/getting-started.md): client setup, your first edits and a saved working copy.
- [Manual](docs/MANUAL.md): tools, camera controls and menus (also Help › Manual in the app).
- [Saving, compiling and playing](docs/guides/saving-and-compiling.md): working files, client patches,
  server updates and recovery precautions.
- [Troubleshooting](docs/troubleshooting.md): missing assets, pending writes, crashes and bug reports.
- [Settings, local data and backups](docs/guides/settings-and-data.md): preferences, private login
  data, projects and recovery storage.
- [Benilla](docs/BENILLA.md): using the open-source Benilla client as Meld's game client.
- [Development](docs/development.md): prerequisites, building Meld and working on the documentation.
- [Testing](docs/TESTS.md): how to test and verify changes.
- [Architecture](docs/architecture/index.md): code boundaries and detailed subsystem references.
- [Engineering notebooks](docs/reference/index.md): retained investigations and the original design draft.

Documentation maintainers: read the [living roadmap](DOCUMENTATION_PLAN.md),
[audit evidence](DOCUMENTATION_AUDIT.md) and [documentation rules](DOCUMENTATION_RULES.md).

## Credits

Much of Meld's rendering of the game (particles, ribbons, clouds, WMO rooms, liquids, grass tufts and
the sun) is ported from [Benilla](https://github.com/samwhosung/benilla), the open-source 1.12.1
client by Sam; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

World of Warcraft is a trademark of Blizzard Entertainment, Inc. Meld is not affiliated with or
endorsed by Blizzard Entertainment, and it ships no Blizzard assets: every model, texture and table
it shows is read from your own 1.12.1 client.

Meld's own code is licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option.
Code ported from other projects keeps its notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
