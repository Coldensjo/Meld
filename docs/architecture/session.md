# Shared sessions

A shared session lets two or more people edit one map at the same time, each in their own Meld
(#728). The owner chose its shape on 2026-10-30: one Meld hosts and the others join it directly (no
separate relay), terrain heights and texture paint sync first, every edit goes through one
host-ordered log, each user undoes only their own edits, and only the host exports to the client and
server. #728 is the umbrella; its parts are separate issues:

| Part | Issue | State |
| --- | --- | --- |
| The transport: host, join, the host's order | #998 | Done (`internal/session`, `app_session.go`) |
| A scripted guest for the probes (`meldtool session join`) | #999 | Open |
| File > Host and Join Session, the members, the map a guest starts from | #1000 | Open |
| Terrain heights sync | #1001 | Open |
| Texture paint sync, with the palette | #1002 | Open |
| Placed objects sync | #1003 | Open |
| Presence: the others' cameras and brushes | #1004 | Open |
| Compile, publish and launch by the host only | #1005 | Open |

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

## Traps

- **Two sends can swap.** Wails runs each bound call in its own goroutine, so two `SessionSend` calls
  the page does not await one after the other can reach the host in either order. The page sends
  through one serial queue.
- **History's commands are closures**, so edits sync as state (the changed heights, paint chunks or
  objects), not as commands; each member's History holds only their own steps, which is what makes
  undo touch only one's own edits. An undo then writes old values back even where another member
  changed the map since (#1001 notes this).
- **The firewall.** On Windows, the first `HostSession` makes the firewall ask whether Meld may listen.
  The Go tests bind loopback (`sessionBind` in `app_session.go`) so the test binary doesn't ask.
- **The same client.** A map refers to the client's assets by path, so every member needs the same
  client for the map to look the same.
- Hosting over the internet needs a port forward or a VPN; there is no relay.
