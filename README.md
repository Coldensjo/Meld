# Meld

A fast 3D map editor for World of Warcraft 1.12.1, for Windows and Linux. Sculpt terrain, paint
textures, place models, water and creatures, and compile the result into your own 1.12 client and
VMaNGOS server. Models and textures are read live from your client's MPQ archives; nothing from the
game is bundled.

Built with [Wails v2](https://wails.io) (Go), Svelte 5 and Three.js.

## Getting started

You need Go 1.25+, Node.js 22.18+ with pnpm, and the Wails CLI
(`go install github.com/wailsapp/wails/v2/cmd/wails@latest`; check with `wails doctor`). Linux also
needs `gtk3` and `webkit2gtk-4.1`; Windows needs the WebView2 runtime (already on Windows 10/11).

```bash
make dev             # run with hot reload (also served at http://localhost:34115)
make build-windows   # build/bin/Meld.exe
make build-linux     # build/bin/Meld
make test            # Go and frontend unit tests
make check           # go vet + svelte-check/tsc
```

On first start, pick your WoW 1.12 client folder in Preferences.

## Documentation

- [Manual](docs/MANUAL.md): every tool, menu, shortcut and format (also Help › Manual in the app).
- [Benilla](docs/BENILLA.md): using the open-source Benilla client as Meld's game client.
- [Testing](docs/TESTS.md): how to test and verify changes.
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
