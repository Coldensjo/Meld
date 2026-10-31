# Shared sessions

A shared session lets two or more people edit one map at the same time, each in their own Meld
(#728). The owner chose its shape on 2026-10-30: one Meld hosts and the others join it directly (no
separate relay), terrain heights and texture paint sync first, every edit goes through one
host-ordered log, each user undoes only their own edits, and only the host exports to the client and
server. #728 is the umbrella; its parts are separate issues:

| Part | Issue | State |
| --- | --- | --- |
| The transport: host, join, the host's order | #998 | Done (`internal/session`, `app_session.go`) |
| A scripted guest for the probes (`meldtool session join`) | #999 | Done (`cmd/meldtool/session.go`, `probes/session-bot.mjs`) |
| File > Host and Join Session, the members, the map a guest starts from | #1000 | Done (`lib/session/`) |
| Terrain heights sync | #1001 | Done (`lib/session/heights.ts`) |
| Texture paint sync, with the palette | #1002 | Open |
| Placed objects sync | #1003 | Open |
| Presence: the others' cameras and brushes | #1004 | Open |
| Compile, publish and launch by the host only | #1005 | Done (`isGuestMap`, `refuseGuestExport`) |

## The transport (`internal/session`)

- The host listens on a port (`session.DefaultPort`, 34180) for WebSocket connections at
  `/meld-session`, through `github.com/coder/websocket` (ISC). A guest dials `ws://host:port` with the
  protocol version, the session code (six characters from `NewCode`, compared in constant time) and its
  name. A wrong code is refused with 403 before the upgrade (`ErrCode`), another protocol version with
  426 (`ErrProtocol`), a full session (15 guests) with 503.
- Members have ids: the host is 1 (`HostID`), guests 2, 3, ... in the order they joined, never reused
  within a session.
- **The order.** Every message gets the host's next sequence number (`Message.Seq`) under one lock and
  goes to every member, the sender too: the sender's own copy is its acknowledgement. So every member
  sees the same messages in the same order, and an edit's place in that order is its `seq`. A message
  with `To` set goes to that member alone and still takes a `seq` (the map a joining guest starts
  from is one: its `seq` tells the guest which edits it already holds).
- The transport's own kinds start `session.`: `session.welcome` (to a guest first: its id and the
  members) and `session.peers` (to everyone when a member joins or leaves). The page can't send those
  (`ErrReserved`).
- A guest whose queue falls 4096 messages behind is dropped rather than holding up the order for
  everyone. Either side reads messages up to 256 MB (`ReadLimit`), for a whole map.
- The host's own messages are delivered to its page from inside the lock (so they keep the order):
  the `deliver` callback must not block or call back into the `Host`.

## The bindings (`app_session.go`)

- `HostSession(port, name)` (0 for the default port), `JoinSession(addr, code, name)` (`host:port`,
  or `host` for the default port), `LeaveSession()` (a host ends the session for everyone),
  `SessionSend(to, kind, data)` (data is JSON text; to 0 is everyone), `SessionState()`. One session
  at a time; `SessionInfo` gives the role, the member id, the code, the port, the host's network
  addresses (`Addrs`, IPv4, not loopback) and the members.
- Every message reaches the page as the `session:message` event (a `session.Message`, the page's own
  broadcasts too), and the end of this Meld's part as `session:ended` with the reason ("" when this
  Meld left or ended it). Shutting Meld down leaves the session.
- What a message says (the edit wire format) is the page's; Go only carries and orders it.

## The page side (`lib/session/`)

- `shared.svelte.ts` holds this Meld's part (`shared`: `role`, `you`, `code`, `port`, `addrs`, `peers`,
  and `docId`, the session map's tab), subscribes to the two events while in a session, and sends every
  page message through one serial queue (`sessionSend`, `serialQueue` in `peers.ts`). `shared` is
  reactive since it changes only when someone joins or leaves; the last `seq` seen (`lastSeq`) is a
  plain variable, as the edits (#1001) move it with every message.
- **File › Host Session…** (`HostSessionDialog.svelte`) takes the name and the port (prefs `shareName`,
  `sharePort`) and then shows the code, the addresses and the members; the tab active then becomes the
  session's map (`docId`). A world view can't be hosted. While hosting, the File item is Session Code
  and Addresses…, and the status bar's chip opens the same dialog. **End Session** ends it for everyone.
- **File › Join Session…** (`JoinSessionDialog.svelte`) takes the address, the code and the name (prefs
  `shareAddr`, `shareName`); **Leave Session** leaves.
- **The map handoff.** When a `session.peers` message shows a new member, the host page sends it the
  session map with `to` set to its id: kind `map` (`KIND_MAP`), data `{seq, map}` (`MapHandoff`), the
  map as `toMapData(engine.snapshotOf(doc))` gives it and `seq` the last message the host page had seen
  then. The guest opens it with `engine.openDocument(fromMapData(map), '')`: a new tab with no path (Save
  is Save As), which takes an untouched empty tab's place as Open does. It goes through the page twice
  (the binding, then the WebSocket) as JSON; a Go-side path (`internal/mapfile` and `internal/handoff`)
  is the fallback if a large map turns out too slow.
- **The host exports.** While this Meld is a guest and the active tab is the session's map (`isGuestMap`), Compile to Client, Server and All, Save Spawns, Export Spawn SQL, Launch and Play Here are off in the menus with the reason (`GUEST_EXPORT_REASON`) as the tooltip, and the actions (`compileRegion`, `saveSpawns`, `exportSpawnSql`, `publishVmangosMap`, `saveOrPublish`, `launchGame`, `playHere`) refuse through `refuseGuestExport`. A guest's other tabs keep them. A new write into the client or server needs the same two guards.
- **Heights (#1001, `heights.ts`, `HeightSync`).** Every height change to the session's map (a stroke,
  Flatten, a script, an import, an undo) goes out as state, kind `heights` (`KIND_HEIGHTS`), data
  `{id, rect: {x0, z0, x1, z1}, h}`: an inclusive vertex rect and its heights now, base64 float32s row by
  row, and `id` the sender's own count. `Terrain.markDirty`, which every height write already calls,
  also grows a rect of its own for the session (`takeSessionChange`, apart from the walkable-ground
  view's `takeGroundChange`); a timer every `HEIGHTS_FLUSH_MS` (100 ms, about 10 Hz) takes it, compares it
  against `mirror` (the heights as this member last sent or received them) and sends the bounding rect
  of the vertices that differ, so a stroke shows live and a mark that changed nothing (holes, a reload's
  `markAllDirty`) sends nothing. A timer and not `Engine.frame`, so the session code stays out of the
  engine; edits only happen while the window draws anyway.
  - **The order.** Every member applies the others' `heights` in `seq` order; its own come back as the
    acknowledgement (matched by `id`) and are not applied again. A remote one that arrives while some of
    mine are unacknowledged comes before them in the host's order, so `applyData` first flushes my
    unsent edits, writes the remote heights, then writes my unacknowledged values back over them where
    they overlap: every member shows what the host's order ends with (`tests/sessionHeights.test.ts`
    runs two members through a scripted host).
  - **Echo.** Applying calls `markDirty` (for the GPU, the ground effects, the walkable view) and then
    takes the session rect at once, so the apply is not sent back; the mirror would catch it anyway.
    The objects on the ground follow (`markRegionDirty`) and the map is marked unsaved.
  - **The map.** Only the session's map syncs (`shared.docId`): the host binds it on Host, a guest on
    opening the handoff. A guest holds the `heights` that arrive before its map (`HeightSync.wait`) and
    applies those after the handoff's `seq` once it opens. Closing the session's map stops the sync.
- The members show in the status bar (`StatusBar.svelte`, `peersLabel`/`peersTitle`), the session's tab
  carries a `session` badge (`DocTabs.svelte`), and a join, a leave and the end are status lines.

## Traps

- **Two sends can swap.** Wails runs each bound call in its own goroutine, so two `SessionSend` calls
  the page does not await one after the other can reach the host in either order. The page sends
  through one serial queue.
- **History's commands are closures**, so edits sync as state (the changed heights, paint chunks or
  objects), not as commands; each member's History holds only their own steps, which is what makes
  undo touch only one's own edits. An undo writes its before-values back even where another member
  changed the ground since, and that syncs like any edit: accepted for now (#1001); a step that crosses
  others' later edits could warn.
- **The heights sync lives as long as the session map's tab.** A Grow Region or a reopen replaces the document
  (a new id), so the sync stops there; a larger heights message (a whole-map import) is a few MB of
  JSON through the bridge twice.
- **The firewall.** On Windows, the first `HostSession` makes the firewall ask whether Meld may listen.
  The Go tests bind loopback (`sessionBind` in `app_session.go`) so the test binary doesn't ask.
- **The same client.** A map refers to the client's assets by path, so every member needs the same
  client for the map to look the same.
- Hosting over the internet needs a port forward or a VPN; there is no relay.
