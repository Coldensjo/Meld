package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"Meld/internal/session"
)

// TestSessionJoin runs the scripted guest against a host on a free loopback port: it prints its welcome,
// sends the file's messages, and prints what the host and it sent, in the host's order.
func TestSessionJoin(t *testing.T) {
	var mu sync.Mutex
	var got []session.Message
	h, err := session.Listen("127.0.0.1:0", "ABC234", "Page", func(m session.Message) {
		mu.Lock()
		got = append(got, m)
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()

	file := filepath.Join(t.TempDir(), "send.jsonl")
	if err := os.WriteFile(file, []byte("{\"kind\":\"edit\",\"data\":{\"n\":1}}\n\n{\"kind\":\"edit\",\"data\":{\"n\":2}}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- sessionRun(context.Background(), "join", []string{"--name", "Bot", "--send", file, "--for", "1.5", addr(h), "ABC234"}, &out)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for len(h.Peers()) < 2 {
		if time.Now().After(deadline) {
			t.Fatal("the bot never joined")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := h.Send(0, "page.hello", json.RawMessage(`{"x":true}`)); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}

	var kinds []string
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		var m session.Message
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("not a JSON line: %q", line)
		}
		kinds = append(kinds, m.Kind)
		if m.Kind == "edit" && m.From != 2 {
			t.Errorf("edit from %d, want the bot's id 2", m.From)
		}
	}
	for _, want := range []string{session.KindWelcome, "edit", "edit"} {
		found := false
		for _, k := range kinds {
			found = found || k == want
		}
		if !found {
			t.Errorf("no %s line in %v", want, kinds)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	edits := 0
	for _, m := range got {
		if m.Kind == "edit" {
			edits++
		}
	}
	if edits != 2 {
		t.Errorf("the host got %d edits, want 2", edits)
	}
}

// TestSessionJoinWrongCode says the host refused the code.
func TestSessionJoinWrongCode(t *testing.T) {
	h, err := session.Listen("127.0.0.1:0", "ABC234", "Page", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	var out bytes.Buffer
	if err := sessionRun(context.Background(), "join", []string{addr(h), "ZZZZZZ"}, &out); err != session.ErrCode {
		t.Fatalf("got %v, want ErrCode", err)
	}
}

func addr(h *session.Host) string {
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(h.Port()))
}
