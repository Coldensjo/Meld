# Using Benilla as the game client

[Benilla](https://github.com/samwhosung/benilla) is an optional open-source 1.12.1 client.
Meld can launch it instead of Wow.exe, using
the same client installation and VMaNGOS server. It does not replace the game data or change the
format Meld exports.

Use Wow.exe if you do not need Benilla. Setting up Benilla is not required to edit or compile maps.

## Build and select Benilla

1. Keep a separate Benilla checkout. Meld's optional launcher currently expects it beside the Meld
   checkout, for example `work/Meld` and `work/benilla`.
2. Follow Benilla's own build prerequisites and its pinned Rust toolchain. In that checkout, run:

   ```sh
   cargo build --release -p benilla
   ```

3. Keep the default development features: that build reads the client through `WOW_DATA`. A
   player build made with `--no-default-features` expects its own adjacent `Data` folder instead.
4. In Meld, open **Edit › Preferences… › Folders** and set the Benilla folder to the checkout
   containing the release build under `target/release`.
5. On the **Game** page of Preferences, set **Game client** to **Benilla**. **Game › Game Settings…**
   also opens that page.

On Windows, the normal executable is `target/release/benilla.exe`. Meld checks for a usable build
before selecting it. After updating the Benilla source, rebuild it before launching from Meld.

## Optional: build Meld's launcher

The launcher keeps Benilla's window hidden during automatic login and shows it when the character
enters the world. If login stalls, it reveals the window after a timeout so you can respond.

From Meld's `benilla-launcher/` directory:

```sh
cargo build --release
```

This is a local source integration, not a portable standalone dependency. Its manifest references
the sibling `benilla` checkout and its Cargo configuration shares Benilla's target directory.
The resulting `meld-benilla.exe` sits beside `benilla.exe` on Windows; Meld prefers it when present.
If you use another directory layout, the existing path dependencies will not resolve unchanged.

After a Benilla update, rebuild both the client and launcher. When Benilla's dependency lockfile
changes, align the launcher's root lockfile with it before rebuilding; Cargo reads the root
project's lockfile, not the dependency checkout's.

## Configure login and the game window

Set the account and character through **Game › Game Login** rather than putting credentials in
scripts or documentation. Meld supplies the configured client data path and login environment
when it launches Benilla:

| Setting | Purpose |
| --- | --- |
| `WOW_DATA` | The selected WoW installation's `Data` directory |
| `BENILLA_HOME` | Benilla's `benilla-config` directory |
| `WOW_USER`, `WOW_PASS` | The saved account credentials, when configured |
| `WOW_REALM`, `WOW_CHAR` | The selected realm and character, when available |

You do not need to set these manually for a launch from Meld. Keep credentials out of shell
history, screenshots and bug reports.

The **Game** page of Preferences controls the window mode and resolution Meld writes when starting the
client. Benilla keeps its settings, addons and caches under `benilla-config`. Meld's launcher log
is `benilla-config/meld-benilla.log`.

## Compile and play

The workflow is the same as with Wow.exe:

1. Save the working map and compile or publish its client/server data.
2. Close the game and stop the world server when the operation requests it.
3. Wait for completion, then start the server and use Launch or Play Here as appropriate.

**Compile and publish do not automatically restart Benilla or the server.** Explicit Launch is
different: it can close the client to place your configured character at the editor camera.
See [Saving, compiling and playing](guides/saving-and-compiling.md) for prerequisites and details.

Benilla reads the same `patch-3.MPQ`, terrain tiles and client tables that Meld writes for Wow.exe.
If a result is wrong only in Benilla, compare with Wow.exe before changing the export. The
[integration notebook](reference/benilla-notes.md) preserves earlier format checks, rendering-port
notes and investigations; its dated setup and backlog entries are not current installation steps.
