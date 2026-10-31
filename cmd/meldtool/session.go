package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"Meld/internal/session"
)

// lineWriter prints one JSON line at a time, from any goroutine.
type lineWriter struct {
	mu  sync.Mutex
	out io.Writer
}

func (w *lineWriter) print(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	fmt.Fprintf(w.out, "%s\n", b)
}

// readSendFile reads the --send file: one frame a line, {"to":0,"kind":"...","data":{...}}; blank lines
// are skipped.
func readSendFile(path string) ([]session.Message, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var msgs []session.Message
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 256<<20)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var m session.Message
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			return nil, fmt.Errorf("%s line %d: %w", path, n, err)
		}
		if m.Kind == "" {
			return nil, fmt.Errorf("%s line %d: a message needs a kind", path, n)
		}
		msgs = append(msgs, m)
	}
	return msgs, sc.Err()
}

// sessionCmd is meldtool session host|join: a scripted member of a shared session (#999), which prints
// every message it receives as a JSON line (seq, from, to, kind, data) so a probe can read the other
// side of a session the page hosts or joins. It runs until --for seconds pass or the session ends.
func sessionCmd(sub string, args []string, out io.Writer) error {
	return sessionRun(context.Background(), sub, args, out)
}

func sessionRun(ctx context.Context, sub string, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("session "+sub, flag.ContinueOnError)
	name := fs.String("name", "", "the member's name in the peer list")
	sendFile := fs.String("send", "", "a file of messages to send once in the session, one JSON frame a line")
	forSecs := fs.Float64("for", 0, "leave after this many seconds (0: until the session ends)")
	code := fs.String("code", "", "host only: the session code (default: a new one)")
	bind := fs.String("bind", "127.0.0.1", "host only: the address to listen on")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	var msgs []session.Message
	if *sendFile != "" {
		if msgs, err = readSendFile(*sendFile); err != nil {
			return err
		}
	}
	if *forSecs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(*forSecs*float64(time.Second)))
		defer cancel()
	}
	w := &lineWriter{out: out}
	ended := make(chan error, 1)
	switch sub {
	case "join":
		if len(pos) != 2 {
			return fmt.Errorf("%w: session join wants <addr> <code>", errUsage)
		}
		g, err := session.Join(ctx, pos[0], pos[1], *name, func(m session.Message) { w.print(m) }, func(e error) { ended <- e })
		if err != nil {
			return err
		}
		defer g.Leave()
		welcome, _ := json.Marshal(session.Welcome{You: g.You(), Peers: g.Peers()})
		w.print(session.Message{From: session.HostID, To: g.You(), Kind: session.KindWelcome, Data: welcome})
		for _, m := range msgs {
			if err := g.Send(m.To, m.Kind, m.Data); err != nil {
				return err
			}
		}
	case "host":
		if len(pos) > 1 {
			return fmt.Errorf("%w: session host wants [port]", errUsage)
		}
		port := 0
		if len(pos) == 1 {
			if port, err = strconv.Atoi(pos[0]); err != nil || port < 0 || port > 65535 {
				return fmt.Errorf("%w: %q is not a port", errUsage, pos[0])
			}
		}
		c := strings.ToUpper(*code)
		if c == "" {
			c = session.NewCode()
		}
		h, err := session.Listen(net.JoinHostPort(*bind, strconv.Itoa(port)), c, *name, func(m session.Message) { w.print(m) })
		if err != nil {
			return err
		}
		defer h.Close()
		w.print(map[string]any{"hosting": true, "port": h.Port(), "code": h.Code(), "addr": net.JoinHostPort(*bind, strconv.Itoa(h.Port()))})
		for _, m := range msgs {
			if err := h.Send(m.To, m.Kind, m.Data); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("%w: session host|join", errUsage)
	}
	select {
	case <-ctx.Done():
		return nil
	case e := <-ended:
		if e != nil && sub == "join" {
			w.print(map[string]any{"ended": e.Error()})
		}
		return nil
	}
}
