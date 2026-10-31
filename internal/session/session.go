// Package session is the transport of a shared editing session (#728): one Meld hosts, the others
// join it over a WebSocket (github.com/coder/websocket, ISC), and the host puts every message into one
// order. Each message gets the host's next sequence number and goes to every member, its sender too (the
// sender's copy is its acknowledgement), so all members see the same messages in the same order: the
// host-ordered edit log the owner chose. A message can also go to one member alone (To), such as the map
// a joining guest starts from; it still takes its place in the order.
//
// The package carries opaque JSON (Message.Data); what an edit says is the page's wire format, not this
// package's. Kinds starting "session." are the transport's own (KindWelcome, KindPeers).
package session

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Protocol is the transport's version; a guest of another version is refused.
const Protocol = 1

// Path is where the host accepts guests.
const Path = "/meld-session"

// DefaultPort is the port a host listens on when none is given.
const DefaultPort = 34180

// ReadLimit is the largest message either side reads: a whole map sent to a joining guest can be tens
// of MB.
const ReadLimit = 256 << 20

// MaxGuests is the most guests one host takes.
const MaxGuests = 15

// HostID is the host's member id; guests get 2, 3, ... in the order they join.
const HostID = 1

// queueLen is how many messages wait for one guest before it counts as too slow and is dropped,
// rather than holding up the host and every other member.
const queueLen = 4096

// The transport's own kinds.
const (
	// KindWelcome goes to a guest that joined, first: Welcome.
	KindWelcome = "session.welcome"
	// KindPeers goes to everyone when a member joins or leaves: []Peer.
	KindPeers = "session.peers"
)

// Errors a guest's Join returns.
var (
	ErrCode     = errors.New("the host refused the session code")
	ErrProtocol = errors.New("the host runs another version of Meld's session protocol: use the same Meld version on both")
	ErrFull     = errors.New("the session is full")
)

// ErrReserved is what sending a kind of the transport's own returns.
var ErrReserved = errors.New(`message kinds starting "session." are the transport's own`)

// Message is one message of a session as every member receives it.
type Message struct {
	// Seq is the host's order, from 1, shared by every message of the session.
	Seq uint64 `json:"seq"`
	// From is the sender's member id (HostID for the host and the transport's own kinds).
	From int `json:"from"`
	// To is the one member the message went to, or 0 for everyone.
	To   int             `json:"to,omitempty"`
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data,omitempty"`
}

// Peer is a member of the session.
type Peer struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// Welcome is KindWelcome's data: the guest's own id and the members at the time.
type Welcome struct {
	You   int    `json:"you"`
	Peers []Peer `json:"peers"`
}

// frame is what a guest sends the host: the host fills in Seq and From.
type frame struct {
	To   int             `json:"to,omitempty"`
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data,omitempty"`
}

// checkKind refuses an empty kind or one of the transport's own.
func checkKind(kind string) error {
	if kind == "" {
		return errors.New("a session message needs a kind")
	}
	if strings.HasPrefix(kind, "session.") {
		return ErrReserved
	}
	return nil
}

// cleanName trims a member's name to something a peer list can show.
func cleanName(name, fallback string) string {
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > 40 {
		name = string(r[:40])
	}
	if name == "" {
		return fallback
	}
	return name
}

// codeChars leaves out the letters and digits that read alike (0/O, 1/I/L).
const codeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// NewCode makes a session code: six characters a guest types to join.
func NewCode() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = codeChars[int(b[i])%len(codeChars)]
	}
	return string(b)
}

// member is a guest as the host keeps it.
type member struct {
	peer Peer
	conn *websocket.Conn
	out  chan []byte
	// gone closes once the guest is dropped, so its writer stops.
	gone chan struct{}
	once sync.Once
}

func (m *member) drop() {
	m.once.Do(func() { close(m.gone) })
}

// Host is the hosting side of a session.
type Host struct {
	code    string
	self    Peer
	deliver func(Message)

	ln     net.Listener
	srv    *http.Server
	ctx    context.Context
	cancel context.CancelFunc

	mu      sync.Mutex
	seq     uint64
	next    int
	members map[int]*member
	closed  bool
}

// Listen starts hosting a session on addr (":34180", or ":0" for any free port) for guests that give
// code. name is the host's own name in the peer list. deliver gets every message in the host's order,
// the host's own included; it runs with the host's lock held, so it must not block or call the Host.
func Listen(addr, code, name string, deliver func(Message)) (*Host, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("listen for the session on %s: %w", addr, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	h := &Host{
		code:    code,
		self:    Peer{ID: HostID, Name: cleanName(name, "Host")},
		deliver: deliver,
		ln:      ln,
		ctx:     ctx,
		cancel:  cancel,
		next:    HostID + 1,
		members: map[int]*member{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc(Path, h.accept)
	h.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = h.srv.Serve(ln) }()
	return h, nil
}

// Port is the port the host listens on.
func (h *Host) Port() int {
	return h.ln.Addr().(*net.TCPAddr).Port
}

// Code is the session code guests give.
func (h *Host) Code() string {
	return h.code
}

// Peers lists the members, the host first.
func (h *Host) Peers() []Peer {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.peersLocked()
}

func (h *Host) peersLocked() []Peer {
	ps := []Peer{h.self}
	for id := HostID + 1; id < h.next; id++ {
		if m, ok := h.members[id]; ok {
			ps = append(ps, m.peer)
		}
	}
	return ps
}

// Send puts a message of the host's own into the order: to 0 sends it to everyone (the host's deliver
// too), otherwise to that member alone.
func (h *Host) Send(to int, kind string, data json.RawMessage) error {
	if err := checkKind(kind); err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return errors.New("the session has ended")
	}
	h.postLocked(HostID, to, kind, data)
	return nil
}

// postLocked numbers a message and hands it to its receivers.
func (h *Host) postLocked(from, to int, kind string, data json.RawMessage) {
	h.seq++
	msg := Message{Seq: h.seq, From: from, To: to, Kind: kind, Data: data}
	if to == 0 || to == HostID {
		if h.deliver != nil {
			h.deliver(msg)
		}
		if to == HostID {
			return
		}
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	var slow []int
	for id, m := range h.members {
		if to != 0 && id != to {
			continue
		}
		select {
		case m.out <- b:
		default:
			slow = append(slow, id)
		}
	}
	// Too slow: drop it rather than block the order for everyone, once this message is out (dropping one
	// posts the peer list, which must come after it for every member).
	for _, id := range slow {
		h.removeLocked(id, websocket.StatusPolicyViolation, "too far behind the session")
	}
}

// removeLocked drops a guest and tells the rest.
func (h *Host) removeLocked(id int, code websocket.StatusCode, reason string) {
	m, ok := h.members[id]
	if !ok {
		return
	}
	delete(h.members, id)
	m.drop()
	go func() { _ = m.conn.Close(code, reason) }()
	if !h.closed {
		h.postPeersLocked()
	}
}

func (h *Host) postPeersLocked() {
	b, _ := json.Marshal(h.peersLocked())
	h.postLocked(HostID, 0, KindPeers, b)
}

// accept takes a guest's WebSocket.
func (h *Host) accept(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("v") != strconv.Itoa(Protocol) {
		http.Error(w, "session protocol "+strconv.Itoa(Protocol)+" only", http.StatusUpgradeRequired)
		return
	}
	if subtle.ConstantTimeCompare([]byte(strings.ToUpper(strings.TrimSpace(q.Get("code")))), []byte(h.code)) != 1 {
		http.Error(w, "wrong session code", http.StatusForbidden)
		return
	}
	h.mu.Lock()
	full := len(h.members) >= MaxGuests
	closed := h.closed
	h.mu.Unlock()
	if closed {
		http.Error(w, "the session has ended", http.StatusGone)
		return
	}
	if full {
		http.Error(w, "the session is full", http.StatusServiceUnavailable)
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(ReadLimit)

	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		_ = conn.Close(websocket.StatusGoingAway, "the session has ended")
		return
	}
	id := h.next
	h.next++
	m := &member{peer: Peer{ID: id, Name: cleanName(q.Get("name"), "Guest "+strconv.Itoa(id-1))}, conn: conn, out: make(chan []byte, queueLen), gone: make(chan struct{})}
	h.members[id] = m
	welcome, _ := json.Marshal(Welcome{You: id, Peers: h.peersLocked()})
	h.postLocked(HostID, id, KindWelcome, welcome)
	h.postPeersLocked()
	h.mu.Unlock()

	go h.write(m)
	h.read(m)
}

// write sends a guest its queue, in order.
func (h *Host) write(m *member) {
	for {
		select {
		case b := <-m.out:
			ctx, cancel := context.WithTimeout(h.ctx, 30*time.Second)
			err := m.conn.Write(ctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				h.mu.Lock()
				h.removeLocked(m.peer.ID, websocket.StatusInternalError, "write failed")
				h.mu.Unlock()
				return
			}
		case <-m.gone:
			return
		}
	}
}

// read puts a guest's messages into the order until it leaves.
func (h *Host) read(m *member) {
	defer func() {
		h.mu.Lock()
		h.removeLocked(m.peer.ID, websocket.StatusNormalClosure, "")
		h.mu.Unlock()
	}()
	for {
		_, b, err := m.conn.Read(h.ctx)
		if err != nil {
			return
		}
		var f frame
		if json.Unmarshal(b, &f) != nil || checkKind(f.Kind) != nil {
			continue
		}
		h.mu.Lock()
		if _, ok := h.members[m.peer.ID]; !ok || h.closed {
			h.mu.Unlock()
			return
		}
		h.postLocked(m.peer.ID, f.To, f.Kind, f.Data)
		h.mu.Unlock()
	}
}

// Close ends the session: every guest is told the host left, and the port is freed.
func (h *Host) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true
	for id := range h.members {
		h.removeLocked(id, websocket.StatusGoingAway, "the host ended the session")
	}
	h.mu.Unlock()
	_ = h.srv.Close()
	// Give the guests' close frames a moment before the context cuts their connections.
	time.AfterFunc(time.Second, h.cancel)
}

// Guest is the joining side of a session.
type Guest struct {
	conn    *websocket.Conn
	you     int
	peers   []Peer
	ctx     context.Context
	cancel  context.CancelFunc
	closing sync.Once
	// left is set by Leave, so the reader doesn't take the close it causes for the host's.
	left    atomic.Bool
	writeMu sync.Mutex
}

// URL is the WebSocket address of the host at addr ("host:port", "host" for DefaultPort, or a ws:// URL).
func URL(addr, code, name string) (string, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return "", errors.New("give the host's address")
	}
	if !strings.Contains(addr, "://") {
		addr = "ws://" + addr
	}
	u, err := url.Parse(addr)
	if err != nil {
		return "", fmt.Errorf("the host's address: %w", err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("the host's address must be host:port, not a %s URL", u.Scheme)
	}
	if u.Port() == "" {
		u.Host = net.JoinHostPort(u.Hostname(), strconv.Itoa(DefaultPort))
	}
	u.Path = Path
	u.RawQuery = url.Values{"v": {strconv.Itoa(Protocol)}, "code": {code}, "name": {name}}.Encode()
	return u.String(), nil
}

// Join connects to the host at addr with the session code. deliver gets every message after the
// welcome in the host's order, from one goroutine; ended gets the reason once the session ends for this
// guest (the host left, the connection broke, or Leave: then err is nil).
func Join(ctx context.Context, addr, code, name string, deliver func(Message), ended func(error)) (*Guest, error) {
	u, err := URL(addr, code, name)
	if err != nil {
		return nil, err
	}
	dctx, dcancel := context.WithTimeout(ctx, 10*time.Second)
	defer dcancel()
	conn, resp, err := websocket.Dial(dctx, u, nil)
	if err != nil {
		if resp != nil {
			switch resp.StatusCode {
			case http.StatusForbidden:
				return nil, ErrCode
			case http.StatusUpgradeRequired:
				return nil, ErrProtocol
			case http.StatusServiceUnavailable:
				return nil, ErrFull
			}
		}
		return nil, fmt.Errorf("join the session at %s: %w", addr, err)
	}
	conn.SetReadLimit(ReadLimit)
	gctx, cancel := context.WithCancel(context.Background())
	g := &Guest{conn: conn, ctx: gctx, cancel: cancel}
	// The welcome comes first.
	_, b, err := conn.Read(dctx)
	var msg Message
	var w Welcome
	if err == nil {
		err = json.Unmarshal(b, &msg)
	}
	if err == nil && msg.Kind != KindWelcome {
		err = fmt.Errorf("the host sent %q before its welcome", msg.Kind)
	}
	if err == nil {
		err = json.Unmarshal(msg.Data, &w)
	}
	if err != nil {
		cancel()
		_ = conn.Close(websocket.StatusProtocolError, "no welcome")
		return nil, fmt.Errorf("join the session at %s: %w", addr, err)
	}
	g.you, g.peers = w.You, w.Peers
	go g.read(deliver, ended)
	return g, nil
}

// You is the guest's own member id.
func (g *Guest) You() int {
	return g.you
}

// Peers lists the members as the welcome gave them; later changes come as KindPeers messages.
func (g *Guest) Peers() []Peer {
	return g.peers
}

func (g *Guest) read(deliver func(Message), ended func(error)) {
	var reason error
	for {
		_, b, err := g.conn.Read(g.ctx)
		if err != nil {
			if g.ctx.Err() == nil && !g.left.Load() {
				reason = err
				if s := websocket.CloseStatus(err); s == websocket.StatusGoingAway || s == websocket.StatusNormalClosure {
					reason = errors.New("the host ended the session")
				}
			}
			break
		}
		var msg Message
		if json.Unmarshal(b, &msg) == nil && deliver != nil {
			deliver(msg)
		}
	}
	g.cancel()
	if ended != nil {
		ended(reason)
	}
}

// Send puts a message into the session: to 0 sends it to everyone (this guest too, as its
// acknowledgement), otherwise to that member alone. Messages sent one after another, from one
// goroutine, keep their order.
func (g *Guest) Send(to int, kind string, data json.RawMessage) error {
	if err := checkKind(kind); err != nil {
		return err
	}
	b, err := json.Marshal(frame{To: to, Kind: kind, Data: data})
	if err != nil {
		return err
	}
	g.writeMu.Lock()
	defer g.writeMu.Unlock()
	ctx, cancel := context.WithTimeout(g.ctx, 30*time.Second)
	defer cancel()
	return g.conn.Write(ctx, websocket.MessageText, b)
}

// Leave ends the session for this guest.
func (g *Guest) Leave() {
	g.closing.Do(func() {
		g.left.Store(true)
		_ = g.conn.Close(websocket.StatusNormalClosure, "")
		g.cancel()
	})
}
