package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"

	"Meld/internal/session"
)

// A shared editing session (#728, internal/session): one Meld hosts and the others join it, and every
// message goes to every member in the host's order. These bindings start, join and leave it and send
// the page's messages; every message comes to the page as a "session:message" event (a
// session.Message, the page's own sent ones too), and the end of the session for this Meld as
// "session:ended" with the reason ("" when this Meld left or ended it). What the messages say (the edit
// wire format) is the page's.

// SessionInfo is this Meld's part in a session.
type SessionInfo struct {
	// Role is "host", "guest", or "" outside a session.
	Role string `json:"role"`
	// You is this Meld's member id (session.HostID for the host).
	You int `json:"you"`
	// Code is the session code guests give (the host's only).
	Code string `json:"code"`
	// Port is the port the host listens on (the host's only).
	Port int `json:"port"`
	// Addrs are the host's addresses on its networks, with the port, for the guests to join at.
	Addrs []string `json:"addrs"`
	// Peers are the members, the host first.
	Peers []session.Peer `json:"peers"`
}

// sessionBind is the address HostSession listens on, all of this machine's by default; the tests bind
// loopback, which keeps Windows' firewall from asking about the test binary.
var sessionBind = ""

// errInSession is what hosting or joining says while a session is on.
var errInSession = errors.New("this Meld is already in a session: leave it first")

// HostSession starts hosting a session on port (0 for session.DefaultPort) under the given name.
func (a *App) HostSession(port int, name string) (SessionInfo, error) {
	a.sessMu.Lock()
	defer a.sessMu.Unlock()
	if a.sessHost != nil || a.sessGuest != nil {
		return SessionInfo{}, errInSession
	}
	if port == 0 {
		port = session.DefaultPort
	}
	if port < 0 || port > 65535 {
		return SessionInfo{}, fmt.Errorf("port %d is not a port", port)
	}
	h, err := session.Listen(net.JoinHostPort(sessionBind, strconv.Itoa(port)), session.NewCode(), name, func(m session.Message) { a.emit("session:message", m) })
	if err != nil {
		return SessionInfo{}, err
	}
	a.sessHost = h
	return a.sessionInfoLocked(), nil
}

// JoinSession joins the session hosted at addr ("host:port", or "host" for session.DefaultPort) with
// its code, under the given name.
func (a *App) JoinSession(addr, code, name string) (SessionInfo, error) {
	a.sessMu.Lock()
	if a.sessHost != nil || a.sessGuest != nil {
		a.sessMu.Unlock()
		return SessionInfo{}, errInSession
	}
	a.sessMu.Unlock()
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	// done closes when this guest's session ends; it tells this join's guest apart in the callback,
	// which can run before Join has returned it.
	done := make(chan struct{})
	g, err := session.Join(ctx, addr, code, name, func(m session.Message) { a.emit("session:message", m) }, func(err error) {
		a.sessMu.Lock()
		close(done)
		if a.sessDone == done {
			a.sessGuest, a.sessDone = nil, nil
		}
		a.sessMu.Unlock()
		reason := ""
		if err != nil {
			reason = err.Error()
		}
		a.emit("session:ended", reason)
	})
	if err != nil {
		return SessionInfo{}, err
	}
	a.sessMu.Lock()
	defer a.sessMu.Unlock()
	if a.sessHost != nil || a.sessGuest != nil {
		// Another call got in while this one dialled.
		g.Leave()
		return SessionInfo{}, errInSession
	}
	select {
	case <-done:
		return SessionInfo{}, errors.New("the session ended as it was joined")
	default:
	}
	a.sessGuest, a.sessDone = g, done
	return a.sessionInfoLocked(), nil
}

// LeaveSession ends this Meld's part in the session: a host ends it for everyone.
func (a *App) LeaveSession() {
	a.sessMu.Lock()
	h, g := a.sessHost, a.sessGuest
	a.sessHost, a.sessGuest, a.sessDone = nil, nil, nil
	a.sessMu.Unlock()
	if h != nil {
		h.Close()
		a.emit("session:ended", "")
	}
	if g != nil {
		g.Leave()
	}
}

// SessionSend sends a message of the page's into the session: data is JSON text, to 0 sends it to
// everyone (this Meld too), otherwise to that member alone. Two calls the page does not await one after
// the other can reach the session in either order.
func (a *App) SessionSend(to int, kind, data string) error {
	raw := json.RawMessage(data)
	if data == "" {
		raw = nil
	} else if !json.Valid(raw) {
		return errors.New("a session message's data must be JSON")
	}
	a.sessMu.Lock()
	h, g := a.sessHost, a.sessGuest
	a.sessMu.Unlock()
	switch {
	case h != nil:
		return h.Send(to, kind, raw)
	case g != nil:
		return g.Send(to, kind, raw)
	}
	return errors.New("this Meld is not in a session")
}

// SessionState is this Meld's part in a session now.
func (a *App) SessionState() SessionInfo {
	a.sessMu.Lock()
	defer a.sessMu.Unlock()
	return a.sessionInfoLocked()
}

func (a *App) sessionInfoLocked() SessionInfo {
	switch {
	case a.sessHost != nil:
		h := a.sessHost
		return SessionInfo{Role: "host", You: session.HostID, Code: h.Code(), Port: h.Port(), Addrs: lanAddrs(h.Port()), Peers: h.Peers()}
	case a.sessGuest != nil:
		return SessionInfo{Role: "guest", You: a.sessGuest.You(), Addrs: []string{}, Peers: a.sessGuest.Peers()}
	}
	return SessionInfo{Addrs: []string{}, Peers: []session.Peer{}}
}

// lanAddrs lists this machine's IPv4 addresses on its networks (not loopback), with port.
func lanAddrs(port int) []string {
	out := []string{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, ad := range addrs {
			ip, _, err := net.ParseCIDR(ad.String())
			if err != nil || ip.To4() == nil || ip.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, net.JoinHostPort(ip.String(), strconv.Itoa(port)))
		}
	}
	return out
}
