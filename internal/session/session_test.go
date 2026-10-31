package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"testing"
	"time"
)

// inbox collects one member's messages for the tests.
type inbox struct {
	mu    sync.Mutex
	msgs  []Message
	ended chan error
}

func newInbox() *inbox {
	return &inbox{ended: make(chan error, 1)}
}

func (b *inbox) deliver(m Message) {
	b.mu.Lock()
	b.msgs = append(b.msgs, m)
	b.mu.Unlock()
}

func (b *inbox) end(err error) {
	b.ended <- err
}

// of returns the messages of kind received so far.
func (b *inbox) of(kind string) []Message {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []Message
	for _, m := range b.msgs {
		if m.Kind == kind {
			out = append(out, m)
		}
	}
	return out
}

// wait waits until ok holds for the inbox.
func (b *inbox) wait(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func host(t *testing.T) (*Host, *inbox) {
	t.Helper()
	in := newInbox()
	h, err := Listen("127.0.0.1:0", "ABC234", "Ann", in.deliver)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)
	return h, in
}

func join(t *testing.T, h *Host, name string) (*Guest, *inbox) {
	t.Helper()
	in := newInbox()
	g, err := Join(context.Background(), "127.0.0.1:"+strconv.Itoa(h.Port()), "abc234", name, in.deliver, in.end)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(g.Leave)
	return g, in
}

func TestJoinNeedsTheCode(t *testing.T) {
	h, _ := host(t)
	_, err := Join(context.Background(), "127.0.0.1:"+strconv.Itoa(h.Port()), "WRONG1", "Bob", nil, nil)
	if !errors.Is(err, ErrCode) {
		t.Fatalf("Join with a wrong code = %v, want ErrCode", err)
	}
}

func TestJoinWelcomesAndListsPeers(t *testing.T) {
	h, hin := host(t)
	g1, in1 := join(t, h, "Bob")
	if g1.You() != 2 || len(g1.Peers()) != 2 || g1.Peers()[0].Name != "Ann" || g1.Peers()[1].Name != "Bob" {
		t.Fatalf("first guest: you %d, peers %v", g1.You(), g1.Peers())
	}
	g2, _ := join(t, h, "  Cy  ")
	if g2.You() != 3 || len(g2.Peers()) != 3 || g2.Peers()[2].Name != "Cy" {
		t.Fatalf("second guest: you %d, peers %v", g2.You(), g2.Peers())
	}
	// The first guest and the host hear of the second.
	in1.wait(t, "the peer list with Cy", func() bool {
		ps := in1.of(KindPeers)
		return len(ps) > 0 && string(ps[len(ps)-1].Data) == `[{"id":1,"name":"Ann"},{"id":2,"name":"Bob"},{"id":3,"name":"Cy"}]`
	})
	hin.wait(t, "the host's peer list", func() bool { return len(hin.of(KindPeers)) == 2 })
	// A guest that leaves is taken off the list.
	g2.Leave()
	in1.wait(t, "the peer list without Cy", func() bool {
		ps := in1.of(KindPeers)
		return string(ps[len(ps)-1].Data) == `[{"id":1,"name":"Ann"},{"id":2,"name":"Bob"}]`
	})
	if got := h.Peers(); len(got) != 2 {
		t.Fatalf("host peers after a leave = %v", got)
	}
}

// Every member sees the same messages in the same order, though three of them send at once.
func TestEveryMemberSeesOneOrder(t *testing.T) {
	h, hin := host(t)
	g1, in1 := join(t, h, "Bob")
	g2, in2 := join(t, h, "Cy")
	const n = 200
	var wg sync.WaitGroup
	send := func(who string, f func(int, string, json.RawMessage) error) {
		defer wg.Done()
		for i := range n {
			if err := f(0, "edit", json.RawMessage(fmt.Sprintf(`{"who":%q,"i":%d}`, who, i))); err != nil {
				t.Error(err)
				return
			}
		}
	}
	wg.Add(3)
	go send("host", h.Send)
	go send("g1", g1.Send)
	go send("g2", g2.Send)
	wg.Wait()
	for _, in := range []*inbox{hin, in1, in2} {
		in.wait(t, "every edit", func() bool { return len(in.of("edit")) == 3*n })
	}
	want := hin.of("edit")
	for k, in := range []*inbox{in1, in2} {
		got := in.of("edit")
		for i := range want {
			if got[i].Seq != want[i].Seq || string(got[i].Data) != string(want[i].Data) || got[i].From != want[i].From {
				t.Fatalf("guest %d message %d = %+v, host saw %+v", k+1, i, got[i], want[i])
			}
			if i > 0 && got[i].Seq <= got[i-1].Seq {
				t.Fatalf("guest %d: seq %d after %d", k+1, got[i].Seq, got[i-1].Seq)
			}
		}
	}
	// Each sender's own messages keep the order it sent them in, and carry its id.
	last := map[int]int{}
	for _, m := range want {
		var d struct{ I int }
		_ = json.Unmarshal(m.Data, &d)
		if prev, ok := last[m.From]; ok && d.I != prev+1 {
			t.Fatalf("member %d: %d after %d", m.From, d.I, prev)
		}
		last[m.From] = d.I
	}
	if len(last) != 3 || last[HostID] != n-1 || last[g1.You()] != n-1 || last[g2.You()] != n-1 {
		t.Fatalf("last message of each sender = %v", last)
	}
}

func TestMessageToOneMember(t *testing.T) {
	h, hin := host(t)
	g1, in1 := join(t, h, "Bob")
	_, in2 := join(t, h, "Cy")
	if err := h.Send(g1.You(), "map", json.RawMessage(`{"for":"Bob"}`)); err != nil {
		t.Fatal(err)
	}
	if err := g1.Send(HostID, "hello", json.RawMessage(`1`)); err != nil {
		t.Fatal(err)
	}
	if err := h.Send(0, "edit", json.RawMessage(`2`)); err != nil {
		t.Fatal(err)
	}
	for _, in := range []*inbox{hin, in1, in2} {
		in.wait(t, "the broadcast", func() bool { return len(in.of("edit")) == 1 })
	}
	if len(in1.of("map")) != 1 || len(in2.of("map")) != 0 || len(hin.of("map")) != 0 {
		t.Fatalf("the map went to: host %d, Bob %d, Cy %d", len(hin.of("map")), len(in1.of("map")), len(in2.of("map")))
	}
	if len(hin.of("hello")) != 1 || len(in1.of("hello")) != 0 || len(in2.of("hello")) != 0 {
		t.Fatal("a message to the host reached a guest")
	}
	if m := in1.of("map")[0]; m.To != g1.You() || m.From != HostID || m.Seq >= in1.of("edit")[0].Seq {
		t.Fatalf("the map message = %+v", m)
	}
}

func TestReservedKindsAreRefused(t *testing.T) {
	h, hin := host(t)
	g, _ := join(t, h, "Bob")
	if err := h.Send(0, KindPeers, nil); !errors.Is(err, ErrReserved) {
		t.Fatalf("host sending %s = %v", KindPeers, err)
	}
	if err := g.Send(0, KindWelcome, nil); !errors.Is(err, ErrReserved) {
		t.Fatalf("guest sending %s = %v", KindWelcome, err)
	}
	if err := h.Send(0, "", nil); err == nil {
		t.Fatal("an empty kind was taken")
	}
	_ = hin
}

func TestHostClosingEndsTheGuests(t *testing.T) {
	h, _ := host(t)
	_, in := join(t, h, "Bob")
	h.Close()
	select {
	case err := <-in.ended:
		if err == nil {
			t.Fatal("the guest's session ended without a reason")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the guest was not told the host left")
	}
	if err := h.Send(0, "edit", nil); err == nil {
		t.Fatal("a closed host took a message")
	}
}

func TestLeaveEndsWithoutAReason(t *testing.T) {
	h, _ := host(t)
	g, in := join(t, h, "Bob")
	g.Leave()
	select {
	case err := <-in.ended:
		if err != nil {
			t.Fatalf("Leave ended the session with %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Leave did not end the session")
	}
}

func TestURL(t *testing.T) {
	for in, want := range map[string]string{
		"192.168.1.5:4000":     "ws://192.168.1.5:4000" + Path,
		"pc.lan":               "ws://pc.lan:" + strconv.Itoa(DefaultPort) + Path,
		"ws://[::1]:5000/x":    "ws://[::1]:5000" + Path,
		" 10.0.0.2:34180 ":     "ws://10.0.0.2:34180" + Path,
		"wss://example.org:99": "wss://example.org:99" + Path,
	} {
		got, err := URL(in, "C", "N")
		if err != nil {
			t.Fatalf("URL(%q): %v", in, err)
		}
		if got != want+"?code=C&name=N&v=1" {
			t.Errorf("URL(%q) = %s", in, got)
		}
	}
	for _, bad := range []string{"", "http://x:1"} {
		if _, err := URL(bad, "C", "N"); err == nil {
			t.Errorf("URL(%q) took it", bad)
		}
	}
}

func TestNewCode(t *testing.T) {
	c := NewCode()
	if len(c) != 6 {
		t.Fatalf("code %q", c)
	}
	for _, r := range c {
		if !containsRune(codeChars, r) {
			t.Fatalf("code %q has %q", c, r)
		}
	}
}

func containsRune(s string, r rune) bool {
	for _, c := range s {
		if c == r {
			return true
		}
	}
	return false
}
