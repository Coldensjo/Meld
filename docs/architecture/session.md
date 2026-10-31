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
| Texture paint sync, with the palette | #1002 | Done (`lib/session/paint.ts`) |
| Placed objects sync, with the id lanes | #1003 | Done (`lib/session/objects.ts`) |
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
  (the binding, then the WebSocket) as JSON. Timed (#1006, hills terrain and 20000 objects, the
  SwiftShader page): 4x4 tiles (512 cells) is 26 MB of JSON, `toMapData` 3 ms, `JSON.stringify` 11 ms,
  the guest's parse and `fromMapData` 25 ms, the longest page gap 70 ms and the bot got it: no stall.
  - **In parts (#1010).** Wails refuses a binding call over 64 MB ("assembled body too large"; 8x8 tiles
    of hills alone is 98 MB), so a handoff whose JSON is over `MAP_PART_CHARS` (8M characters, `peers.ts`)
    goes as kind `map.part` messages instead (`KIND_MAP_PART`, data `{part, parts, text}`: slices of the
    handoff's JSON, `sendHandoff`), one after the other in the send queue so nothing comes between them
    from this page. The guest joins them (`PartJoiner`; a part 0 starts over) and opens the map once the
    last is in, with a status line for each part. The parts stay well below the 26 MB the event to the
    guest's page was timed at. A smaller map is still one `map` message. `sessionSend` still throws
    with the size over `MAX_SEND_BYTES` (60 MB) for any other message. The `session-map-parts` probe
    checks both sides. Timed once (a scratch copy of that probe, the SwiftShader page): 1024 cells of
    hills (98 MB, 13 parts) opened on the guest page about 6 s after it joined.
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
- **Texture paint (#1002, `paint.ts`, `PaintSync`).** Every paint change to the session's map (a stroke,
  a fill, a script, an undo) goes out as whole paint chunks, kind `paint` (`KIND_PAINT`), data
  `{id, chunks: [{c, slots, w}]}`: the chunk's index, its four slots as texture paths (`''` for an empty
  slot) and every texel's four weights (base64 bytes, row by row). Whole chunks, since a texel's weights
  mean nothing without its chunk's slots, and a stroke can reorder those anywhere in a chunk it touches
  (`settleSlots`, `compactChunk`). `Terrain.markSplatDirty` grows a texel region for the session too
  (`takeSessionPaint`; null for all of the map); the same timer as the heights compares the chunks it
  covers against a mirror of the weights and slots and sends the ones that differ. The order, the
  replay of one's own unacknowledged chunks over a remote one, the echo and the guest's held messages
  are the heights' (above), with a chunk the unit instead of a vertex: two members painting one chunk
  at once both end with the chunk as the later message in the host's order has it.
  - **The palette.** Slots go out as paths, not palette indices: each member keeps its own palette, and
    a path the receiver's lacks is appended to it there (not a History step). So two members adding
    textures at once can't collide on an index, no index is ever renumbered (History's paint steps hold
    raw slot indices), and the four-texture limit holds everywhere because a chunk arrives whole. The
    cost: two textures added at once sit in the two palettes in either order, so the saves hold the
    same paint but not always the same palette order.
  - **The palette only grows** while in the session: an undo of Add Texture sets the palette back to
    its earlier, shorter list, which would drop a texture another member painted with since; the sync
    puts the list back when a chunk still uses an index past its end (`checkPalette`). A shrink nothing
    uses stands.
  - The paint mask is per-user selection state and stays local. A memory cost: the mirror is a second
    copy of the weights (4 bytes a texel).
- **Placed objects (#1003, `objects.ts`, `ObjectSync`).** Every change to the session map's models, WMOs
  and helper shapes (placing, deleting, moving, turning, scaling, attaching, a new model or group, an
  undo) goes out as kind `objects` (`KIND_OBJECTS`), data `{id, put, del}`: the added or changed objects
  whole in their saved form (`WireObject`, the `.wmap`'s `PlacedObject` without the client's unique ID,
  local to the parent when attached) and the removed ids. `ObjectLayer` notes the ids that `add`,
  `remove`, `touch`, `setType` and `setGroup` change while a session tracks them (`trackSession`,
  `takeSessionChanges`; null after `clear`, when every id is compared); the same timer as the heights
  compares those against a mirror of the objects as last sent or received, so a touch or a re-snap that
  changed nothing sends nothing, and a drag goes out about ten times a second. The order, the replay of
  one's own unacknowledged objects over a remote one and the guest's held messages are the heights'; an
  object is the unit, so two members moving one model at once both end with the later message's object
  whole. An existing object is written over in place (History's steps and the Inspector find it by id),
  then touched; this copies a state, as an undo's snapshot does, rather than moving through `place`. A
  remote delete takes the object out of the selection; a change to the selected one refreshes the
  Inspector's copy.
  - **Ids.** Each member makes new object ids and selection groups in a lane of its own
    (`ObjectLayer.setLane`): the numbers equal to its lane modulo `LANES` (16: the host and
    `session.MaxGuests` guests). The host is lane 0 and hands each guest the lowest free lane in the map
    handoff (`MapHandoff.ids`, `Lanes`), with its layer's counts (`ObjectLayer.counts`), so the guest
    counts from above every id the host's layer has held, the removed ones too (an undo brings those
    back under their id), and a guest taking a lane another left can't make one it made. Ending the
    session puts back the plain count. Ids are the editor's alone: the client export gives a new model
    its unique ID itself, and the host keeps the unique IDs its map read from the client by id
    (`RegionRef.uids`), so a guest's move of such a model exports under it.
  - Spawns (the server's creatures and objects) are not in it; `MaxGuests` growing past 15 needs `LANES`
    to grow with it.
- **The session's map keeps its document (#1007).** The sync is bound to the session map's document,
  so `setSessionDoc` marks it `shared` (`MapDocument.shared`) and nothing replaces it in its tab while
  in the session: `Engine.openDocument` with that tab as `replaceId` and `Engine.growWorld` throw
  `SESSION_MAP_REASON` (`peers.ts`), File › Revert to Saved is off with it as the tooltip
  (`isSessionMap`), Map Properties refuses a grow before asking, a recovered copy opens in a new tab
  rather than over it (`recover`), and a shared map is never `pristine`, so a map opened while hosting
  an untouched new map takes a new tab. Ending or leaving the session clears the mark.
- **The host makes the map again (#1008).** The host's Revert to Saved (`revertMap`) and Grow Region
  (Map Properties) go through `replaceSessionMap(docId, replace)`: it sends the host's unsent edits,
  lifts the `shared` mark for the one replacement, then marks the new document, binds the syncs to it
  and sends its whole map to everyone (kind `map` or `map.part` with no `to`, `MapHandoff.gen`, and
  `ids` with the host layer's counts but no lane: each guest keeps the lane its own handoff gave it,
  `myLane`). A guest opens it over its session tab (`openHandoff`: `openDocument(snap, path, docId)`):
  its unsent edits and History are dropped, a tab it saved keeps its file (unsaved), a grown map's
  camera and bookmarks move with the ground (`squareShift`), and a member working in another tab stays
  there. A guest's replacement throws `GUEST_REPLACE_REASON`, and its Revert and Grow are off with it.
  - **The map generation.** `mapGen` counts the host's replacements; every edit message carries the
    one it was made against as `g` (`tagged`; left out at 0) and a member drops the others' with
    another (`receiveEdit`, `editGen` in `peers.ts`). The `seq` alone can't tell: a guest's edit sent
    before the new map reached it can reach the host after the map's `seq`, and on a grown map its
    vertex rect or chunk index would land on shifted ground. One's own come back as acknowledgements
    whatever their `g`. A guest without a map yet holds the edits (`early`) until its handoff says
    which generation they need, then hands those to the syncs' `wait` hold before binding. A map to
    everyone reaching a guest with none yet is skipped: its own handoff comes after it in the order.
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
- **An attachment to a model another member deletes at once** keeps its `parent` on every member (each
  applies the same messages), with no parent to hang on: it is drawn at its local offsets as world
  values until someone moves it, and `dropOrphanParents` makes it a root when the map is opened again.
  A delete of one's own re-places the attachments first (`deleteSelected`), so only the race does this.
- **A new way to make an object id** must go through `ObjectLayer.add` without an id (or `newGroup` for
  a group), which counts in the member's lane; an id worked out by hand (the largest plus one) collides.
- **The sync lives as long as the session map's document.** A Grow Region or a reopen replaces the
  document (a new id) and would stop the sync on that member alone, so the engine refuses it while in a
  session (above) unless it goes through `replaceSessionMap`; a new way to make a map again in its tab
  must go through `Engine.openDocument` with `replaceId` inside `replaceSessionMap`, or check
  `MapDocument.shared` itself. File › Add the tiles to the north (`extendRegion`) opens a new tab and
  closes the session's, which stops the sync (#1012). A larger heights message (a whole-map import) is a
  few MB of JSON through the bridge twice.
- **The firewall.** On Windows, the first `HostSession` makes the firewall ask whether Meld may listen.
  The Go tests bind loopback (`sessionBind` in `app_session.go`) so the test binary doesn't ask.
- **The same client.** A map refers to the client's assets by path, so every member needs the same
  client for the map to look the same.
- Hosting over the internet needs a port forward or a VPN; there is no relay.
