package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The debug log (#626): started with MELD_DEBUG_LOG set (to anything but 0), the built app writes
// each asset server request and the page's console warnings and errors to the session log, so a
// check in the built app, whose console can't be reached, needs no throwaway build. Off by default:
// it would flood the file.
const debugLogEnv = "MELD_DEBUG_LOG"

// debugLogPath answers the page whether the debug log is on ("1" or "0"), once at its start.
const debugLogPath = "/meld/debug-log"

// debugLogOn reads the switch from the environment.
func debugLogOn() bool {
	v := os.Getenv(debugLogEnv)
	return v != "" && v != "0"
}

// serveDebugLog answers debugLogPath.
func (a *App) serveDebugLog(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Cache-Control", "no-store")
	if a.debugLog {
		_, _ = w.Write([]byte("1"))
	} else {
		_, _ = w.Write([]byte("0"))
	}
}

// statusWriter keeps the status a handler answered with.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the writer underneath (a flush).
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// logRequests writes each request through h to the session log, with its status and time taken,
// when the debug log is on; otherwise it is h.
func (a *App) logRequests(h http.Handler) http.Handler {
	if !a.debugLog {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		defer func() {
			if a.slog == nil || r.URL.Path == debugLogPath {
				return
			}
			status := sw.status
			if status == 0 {
				status = http.StatusOK
			}
			line := fmt.Sprintf("%s asset %s %s %d %d ms", start.Format("15:04:05"), r.Method, r.URL.RequestURI(), status, time.Since(start).Milliseconds())
			_ = a.slog.Append([]string{line})
		}()
		h.ServeHTTP(sw, r)
	})
}

// The tool-window switch (#917): MELD_DEBUG_WINDOWS, a comma-separated list of tool window kinds
// ("history,inspector"), makes the built app open those windows a few seconds after it starts, and write
// each channel message between the main page and the tool windows (toolwin:state, :cmd, :reply, :args,
// :closed, :close-asked) to the session log with its kind and a short summary, so a desktop check of a
// tool window needs no scratch build. It turns the debug log on as well, and only opens windows and
// logs: it edits nothing, so no map goes dirty.
const debugWindowsEnv = "MELD_DEBUG_WINDOWS"

// debugWindowsDelay is how long after the start the windows open, for the main page to have loaded.
const debugWindowsDelay = 6 * time.Second

// debugWindowKinds reads the tool window kinds the switch names.
func debugWindowKinds() []string {
	var kinds []string
	for _, k := range strings.Split(os.Getenv(debugWindowsEnv), ",") {
		if k = strings.TrimSpace(k); k != "" {
			kinds = append(kinds, k)
		}
	}
	return kinds
}

// channelEvents are the Wails events of the tool windows' channel (lib/toolwin/channel.ts).
var channelEvents = []string{"toolwin:state", "toolwin:cmd", "toolwin:reply", "toolwin:args", "toolwin:closed", "toolwin:close-asked"}

// channelSummary is a log line's text for a channel message: the event, the window's kind and a short
// summary (a command's type, a state's size, otherwise the start of the message).
func channelSummary(name string, data any) string {
	if list, ok := data.([]any); ok && len(list) == 1 {
		data = list[0]
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return name
	}
	var m map[string]json.RawMessage
	_ = json.Unmarshal(raw, &m)
	var kind string
	_ = json.Unmarshal(m["kind"], &kind)
	var what string
	switch name {
	case "toolwin:state":
		what = fmt.Sprintf("state %d bytes", len(m["state"]))
	case "toolwin:cmd":
		var c struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal(m["cmd"], &c)
		what = "cmd " + c.Type
	default:
		what = string(raw)
		if len(what) > 160 {
			what = what[:160] + "..."
		}
	}
	return fmt.Sprintf("%s channel %s %s: %s", time.Now().Format("15:04:05"), name, kind, what)
}

// startDebugWindows logs the channel and opens the windows MELD_DEBUG_WINDOWS names.
func (a *App) startDebugWindows(kinds []string) {
	if a.app == nil || len(kinds) == 0 {
		return
	}
	for _, name := range channelEvents {
		a.app.Event.On(name, func(e *application.CustomEvent) {
			if a.slog != nil {
				_ = a.slog.Append([]string{channelSummary(e.Name, e.Data)})
			}
		})
	}
	go func() {
		time.Sleep(debugWindowsDelay)
		for _, k := range kinds {
			if _, err := a.OpenToolWindow(k, nil); err != nil && a.slog != nil {
				_ = a.slog.Append([]string{time.Now().Format("15:04:05") + " channel open " + k + ": " + err.Error()})
			}
		}
	}()
}
