package main

import (
	"errors"
	"net"
	"strconv"
	"testing"
	"time"
)

// freePort finds a port nothing listens on.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return port
}

func TestSessionBindings(t *testing.T) {
	sessionBind = "127.0.0.1"
	t.Cleanup(func() { sessionBind = "" })
	host, guest := &App{}, &App{}
	t.Cleanup(host.LeaveSession)
	t.Cleanup(guest.LeaveSession)
	if s := host.SessionState(); s.Role != "" || s.Peers == nil || s.Addrs == nil {
		t.Fatalf("state outside a session = %+v", s)
	}
	if err := host.SessionSend(0, "edit", "{}"); err == nil {
		t.Fatal("SessionSend outside a session was taken")
	}
	port := freePort(t)
	hs, err := host.HostSession(port, "Ann")
	if err != nil {
		t.Fatal(err)
	}
	if hs.Role != "host" || hs.You != 1 || hs.Port != port || len(hs.Code) != 6 || len(hs.Peers) != 1 {
		t.Fatalf("HostSession = %+v", hs)
	}
	if _, err := host.HostSession(port+1, "Ann"); !errors.Is(err, errInSession) {
		t.Fatalf("hosting twice = %v", err)
	}
	gs, err := guest.JoinSession("127.0.0.1:"+strconv.Itoa(port), hs.Code, "Bob")
	if err != nil {
		t.Fatal(err)
	}
	if gs.Role != "guest" || gs.You != 2 || len(gs.Peers) != 2 {
		t.Fatalf("JoinSession = %+v", gs)
	}
	if err := guest.SessionSend(0, "edit", `{"x":1}`); err != nil {
		t.Fatal(err)
	}
	if err := guest.SessionSend(0, "edit", `{x`); err == nil {
		t.Fatal("SessionSend took data that is not JSON")
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(host.SessionState().Peers) != 2 {
		if time.Now().After(deadline) {
			t.Fatal("the host does not list the guest")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// The host ending it ends it for the guest.
	host.LeaveSession()
	for guest.SessionState().Role != "" {
		if time.Now().After(deadline) {
			t.Fatal("the guest is still in the session after the host left")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
