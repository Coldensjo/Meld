# Meld (3dgame's world editor)

The world editor of 3dgame, for Windows and Linux: it builds the game's cube worlds (`.world` files)
with the Select and Cubes tools, and starts the game on the open world. It began as a fork of Meld, a
WoW 1.12 map editor; the WoW parts have been removed.

Built with [Wails v2](https://wails.io) (Go), Svelte 5 and Three.js.

## Getting started

To build it you need:

- [Go](https://go.dev/dl/) 1.25+.
- [Bun](https://bun.sh), which runs the frontend tooling.
- The [Wails v2 CLI](https://wails.io/docs/gettingstarted/installation)
  (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`); `wails doctor` checks the rest.
- Rust (cargo), for `make check`'s shape table check and for the game client that Play World starts.
- `make` ([GNU Make](https://www.gnu.org/software/make/); the makefile also lists the plain
  commands). On Windows the recipes run through the `sh.exe` of [Git for Windows](https://gitforwindows.org).
- Linux: `gtk3` and `webkit2gtk-4.1` from your distribution. Windows: the
  [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already on Windows 10/11).

```bash
make dev             # run with hot reload (also served at http://localhost:34125)
make build-windows   # build/bin/Meld.exe
make build-linux     # build/bin/Meld
make test            # Go and frontend unit tests
make check           # shape table, gofmt, go vet, svelte-check/tsc
```

## Documentation

- [Manual](docs/MANUAL.md): every tool, menu and shortcut (also Help › Manual in the app).
- [Testing](docs/TESTS.md): how to test and verify changes.
- [Architecture](docs/architecture/): how the code is laid out, one file an area (indexed in CLAUDE.md).
- [Design](../docs/DESIGN.md): the game's goals, hard rules and priorities (its Editor section is this editor's); the editor's own rules are in CLAUDE.md.

## License

The editor's own code is licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option.
Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
