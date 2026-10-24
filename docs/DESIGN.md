# DESIGN.md: what Meld is for

Status: **draft**, written from README.md and CLAUDE.md. Changes to this file
need the owner's approval. The issue loop (`.claude/issue-loop.md`) must not edit it.

## Goal

A fast 3D map editor for World of Warcraft 1.12 worlds that runs on Windows and Linux. An author
sculpts terrain, paints textures, places models and water, and gets the result into a 1.12 client
and a VMaNGOS server. The editor also works on standalone `.wmap` maps.

The primary user is the repo owner, who makes maps for their own client and server.

## Hard rules (every change)

1. **Fast.** Editing and rendering stay smooth on large maps. No per-frame allocations in hot
   paths, and no per-frame writes to reactive state (CLAUDE.md).
2. **Cross-platform.** Builds on Windows and Linux. Linux uses `-tags webkit2_41`.
3. **Undoable.** Every edit that changes a map goes through `History`.
4. **No Blizzard assets** in the repo, the binary, test fixtures or map files. Maps store paths only.
5. **Client writes are checked.** Anything that writes client files is verified against the
   client's own reader or files, as earlier commits did, before it is committed.
6. **Owner's files stay theirs.** The working tree may hold uncommitted changes from the owner.
   Never revert or stage them.

## Priorities, in order

When two backlog items compete, the higher one wins.

1. **Bugs and data loss.** A saved map, or a write to the client or server, must not lose or
   corrupt data.
2. **Core authoring.** Sculpt, paint, place, select, copy/paste and undo work reliably on real maps.
3. **Client round trip.** Open a region, edit it, export it to the 1.12 client and the VMaNGOS server.
4. **Speed on large maps.** Streaming, culling and frame time.
5. **Noggit Red parity** (the issues labelled `source:gap`). Only when it serves 1 to 4.
6. **Polish.** Small UI and visual extras. These are picked last.

## Non-goals

- A Lua scripting engine. It is the largest gap, and it needs the owner's approval first.
- MySQL UID sync and other shared-server features.
- macOS support (CLAUDE.md targets Windows and Linux).
- Shipping prebuilt maps or any client-extracted content.
- Anything only later clients have (the owner, 2026-10-15, #56): vertex colours (MCCV), 8-bit alpha
  maps, MH2O water, texture height mapping, WMO low-res models and map difficulties. Meld targets the
  1.12 client only, so whatever the 1.12 client has is in scope, including its light, sky and zone
  light data (Light.dbc and its band tables), which Client Lighting and the lights editor use.

## Definition of done

An item is done only when all of these hold:

- It is implemented, and it is undoable if it edits a map.
- `make test` and `make check` pass.
- The build for the OS it was made on passes: `make build-windows` on Windows, `make build-linux` on
  Linux. The other cannot run there, so its issue's closing comment records that it was not run.
- Behaviour that shows on screen was checked in the app, or its issue's closing comment says it was not.
- It has one commit with a one-sentence imperative message (CLAUDE.md), and it is logged on its issue, which is closed.

## Known drift to review

- Resolved 2026-10-15: CLAUDE.md now describes the Go packages (files, archives and the server
  belong to Go; editing never does) and says a `.wmap` refers to client assets by path while the
  exports write into the user's own client and server folders.
