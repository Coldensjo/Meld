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

Do not delete customized manifests, icons or installer scripts to reset a build. Review the diff
and preserve local changes before deliberately restoring a tracked asset from version control.
Cleaning generated output and changing packaging inputs are separate operations.

## Windows packaging assets

- `windows/icon.ico`: Windows application icon.
- `windows/info.json`: executable version/product metadata, which `make build-windows` links in
  with the icon and the manifest (`wails3 generate syso`).
- `windows/wails.exe.manifest`: application manifest.
- `windows/installer/project.nsi` and `wails_tools.nsh`: NSIS installer inputs.

These NSIS inputs are Wails v2 templates (`wails build -nsis`); since the move to Wails v3 no target
builds them. A normal desktop
build is not proof that the installer works, nor does a cross-build verify the other OS at runtime.

> **Warning: uninstall removes the entire chosen install directory.** The NSIS uninstall section
> recursively removes the installation folder, not only a list of packaged files. Keep client/server
> data, projects, working maps and backups outside that directory. Move any author data out before
> uninstalling. The script also removes its WebView2 data path, shortcuts and generated associations.
> This is source-inspected behavior; the installer/uninstaller were not run for documentation checks.

Default scope is administrator/all-machine under Program Files, with a user-scope override in the
script. Review the generated NSIS inputs for the exact artifact. The WebView2 bootstrap and
file/protocol association behavior require disposable-host validation. The optional sibling-built
Benilla launcher and Rust dependency/asset attribution are separate distribution-review inputs,
not proven included by the binary-file macro or the npm/Go notices check.
