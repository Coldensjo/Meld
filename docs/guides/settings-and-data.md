# Settings, local data and backups

Use this guide to find Meld's settings, understand what a project contains and decide what to
back up or share. Prefer the settings dialogs over hand-editing JSON. For client/server writes and
previous-patch recovery, use [Saving, compiling and playing](saving-and-compiling.md).

## Choose the right settings page

Open **Edit › Preferences…** (`Ctrl+,` by default). Search there to locate a setting.

| Page | What to look for |
| --- | --- |
| General | Appearance and what the editor keeps, including autosave |
| Folders | WoW client, VMaNGOS server and optional Benilla folders (projects select their own client), and the other clients you import models and textures from (Tools › Import from Another Client…) |
| Camera and input | Camera behavior, tablet input and keyboard shortcuts |
| Graphics | Quality-related preferences; current rendering controls also live in Graphics and Lighting menus |
| Compile and export | Map checking and additional compile/export behavior |
| Game | Selected game client, window mode and resolution |

Use **Game › Game Login** for the account and character used by launch/play workflows. Configuring
login does not replace server setup or give the account server permissions. See
[Troubleshooting](../troubleshooting.md#play-here-does-not-work) for Play Here requirements.

::: warning Saved passwords are plaintext
Meld saves the Game Login password **without encryption** in `config.json`. Use only a local
development account, not a password reused for another service. Treat the configuration and any
backup containing it as private. Do not attach the original file to an issue or commit it to a repo.
:::

## Find the configuration and cache folders

Meld uses the operating system's per-user configuration and cache directories, each with a
`Meld` subfolder. Typical locations are:

| Data | Windows | Linux |
| --- | --- | --- |
| Configuration | `%APPDATA%/Meld` | `$XDG_CONFIG_HOME/Meld`, or `~/.config/Meld` when unset |
| Cache and recovery | `%LOCALAPPDATA%/Meld` | `$XDG_CACHE_HOME/Meld`, or `~/.cache/Meld` when unset |

The Windows paths use environment variables, not a literal folder named `%APPDATA%`.
In PowerShell, the configuration folder is `Join-Path $env:APPDATA 'Meld'`; the cache folder is
`Join-Path $env:LOCALAPPDATA 'Meld'`. Linux paths follow the environment of the process running Meld.

| File or subfolder | Contents | How to treat it |
| --- | --- | --- |
| Configuration: `config.json` | Client/server paths, login, preferences, window, recent projects and saved session references | Private settings, not a map backup |
| Configuration: `scripts/` | User-authored Lua scripts | Back up scripts you want to keep |
| Cache: `recovery/` | Autosaved dirty-map copies and session metadata | May be the only copy of unsaved edits |
| Cache: `pending-client/` | Client files waiting to be flushed into the patch | May contain changes not yet in the client |
| Cache: `logs/` | Session logs retained outside the application window | Useful for diagnosis; review before sharing |
| Cache: `thumbs/` | Client-specific asset thumbnails | Reproducible from the configured client |

This is a safety-oriented list, not an exhaustive cache schema. If locating the user cache fails,
pending client files can fall back to the system temporary directory's `Meld/pending-client`.
Other storage failures can prevent recovery/log initialization; do not rely on autosave as your only copy.

**Do not delete the entire Meld cache to fix thumbnails.** It also holds recovery copies and pending
client writes. Resolve pending writes and save recovered maps first; preserve copies before any cleanup.

## Understand projects and portability

A project folder contains `meld-project.json`, recording its name and client path. Open/save dialogs
start in the active project folder, but maps remain separate `.wmap` working files. A project is
required for opening part of an existing client world; a standalone new world does not require one.

Opening a project selects its client. Closing the project leaves that client loaded. Forgetting a
project removes its recent-list entry, not its folder or maps.

Copying a project does **not** copy the WoW installation, server database or assets. If you move it
to another computer, select a valid local client when opening the project; the stored path may not
exist there. Keep the working maps and referenced images available separately. Do not distribute
client-extracted game assets with a project.

## Session restore is not crash recovery

Session restore remembers file, region and world tabs with their views. It reopens references to
those sources; it does not save untitled map contents or replace a working-file save.

Autosave separately copies maps with unsaved changes to recovery storage at the configured interval.
It can be disabled and is not an immediate snapshot of every edit. After a crash, use the offered
recovery, then save a separate `.wmap`. See [crash recovery](../troubleshooting.md#meld-crashed-with-unsaved-work).

## Back up and share safely

1. Save editable maps with **Save As**. For a new client world, ordinary **Save** can publish;
   follow the [save/compile guide](saving-and-compiling.md) rather than assuming it only saves a file.
2. Keep independent copies of working maps, project descriptors, your Lua scripts and referenced
   source images. Back up client patches and server data/database separately before write operations.
3. Recover unsaved work and resolve pending writes before cache cleanup or migration. Copying
   `config.json` alone does not preserve these changes; copying a live cache is not a guaranteed backup.
4. Close Meld before manually backing up or editing settings. Protect backups containing login data.
   Recheck machine-specific client/server paths before using settings on another machine.
5. For reports, prefer a minimal reproduction, relevant log excerpts and **Help › Copy Scene**.
   Redact passwords, account names, connection details and private paths from copies before sharing.
   Never share the original configuration or a whole client installation.

### Implementation references

Maintainers can verify this contract in the
[configuration and project code](https://github.com/Coldensjo/Meld/tree/main/internal/config),
[recovery/log setup](https://github.com/Coldensjo/Meld/blob/main/app_mapfile.go),
[pending-write storage](https://github.com/Coldensjo/Meld/blob/main/internal/vmangos/pending.go) and
[session persistence](https://github.com/Coldensjo/Meld/blob/main/frontend/src/lib/io/session.ts).
