# Meld

A fast 3D map editor for World of Warcraft 1.12.1, for Windows and Linux. Sculpt terrain, paint
textures, place models, water and creatures, and compile the result into your own 1.12 client and
VMaNGOS server. Models and textures are read live from your client's MPQ archives; nothing from the
game is bundled.

Built with [Wails v2](https://wails.io) (Go), Svelte 5 and Three.js.

## Getting started

To build Meld you need:

- [Go](https://go.dev/dl/) 1.26+.
- [Bun](https://bun.sh), which runs the frontend tooling.
- The [Wails v2 CLI](https://wails.io/docs/gettingstarted/installation)
  (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`); `wails doctor` checks the rest.
- [golangci-lint](https://golangci-lint.run) v2 for `make check`
  (`go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`); without it `make check` skips the lint.
- `make` ([GNU Make](https://www.gnu.org/software/make/); the makefile also lists the plain
  commands). On Windows the recipes run through the `sh.exe` of [Git for Windows](https://gitforwindows.org).
- Linux: `gtk3` and `webkit2gtk-4.1` from your distribution. Windows: the
  [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already on Windows 10/11).

To use the result you need your own WoW 1.12.1 client. To export a map into a running game you also
need a [VMaNGOS](https://github.com/vmangos/core) server with its [MariaDB](https://mariadb.org/download/)
database, and optionally the [Benilla](https://github.com/samwhosung/benilla) client
([Benilla guide](docs/BENILLA.md)).

```bash
make dev             # run with hot reload (also served at http://localhost:34115)
make build-windows   # build/bin/Meld.exe
make build-linux     # build/bin/Meld
make test            # Go and frontend unit tests
make check           # go vet + golangci-lint + svelte-check/tsc
```

On first start, pick your WoW 1.12 client folder in Preferences.

## Documentation

The docs are also published as a site: <https://coldensjo.github.io/Meld/>.

- [Manual](docs/MANUAL.md): every tool, menu, shortcut and format (also Help › Manual in the app).
- [Benilla](docs/BENILLA.md): using the open-source Benilla client as Meld's game client.
- [Testing](docs/TESTS.md): how to test and verify changes.
- [Architecture](docs/architecture/): how the code is laid out, one file an area (indexed in CLAUDE.md).
- [Design](docs/DESIGN.md): goals, rules and priorities.

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
