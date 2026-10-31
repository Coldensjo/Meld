# Build assets

This directory contains tracked packaging inputs and generated application output. For prerequisites,
platform commands and validation, use [Building and development](../docs/development.md).
Meld targets Windows and Linux; retained macOS templates are not a promise of macOS support.

## Outputs versus tracked inputs

- `bin/` is ignored build output: `Meld.exe` on Windows and `Meld` on Linux.
- `appicon.png` is a tracked application icon source.
- `windows/` contains tracked Windows packaging assets.
- `darwin/Info.plist` and `darwin/Info.dev.plist` are retained Wails v2 templates.
- `dev.yml` and `dev-page.yml` are the `wails3 dev` configurations of `make dev` and `make dev-page`.

Do not delete customized manifests or icons to reset a build. Review the diff
and preserve local changes before deliberately restoring a tracked asset from version control.
Cleaning generated output and changing packaging inputs are separate operations.

## Windows packaging assets

- `windows/icon.ico`: Windows application icon.
- `windows/info.json`: executable version/product metadata, which `make build-windows` links in
  with the icon and the manifest (`wails3 generate syso`).
- `windows/wails.exe.manifest`: application manifest.

Meld ships no installer (the Wails v2 NSIS inputs were removed in #859). A normal desktop build
does not verify the other OS at runtime. The optional sibling-built Benilla launcher and Rust
dependency/asset attribution are separate distribution-review inputs, not covered by the npm/Go
notices check.
