package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
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
