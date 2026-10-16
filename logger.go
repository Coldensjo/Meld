package main

import (
	"strings"

	"github.com/wailsapp/wails/v2/pkg/logger"
)

// quietLogger is Wails' default logger without the runtime:ready errors. Wails' runtime sends
// "runtime:ready" when a page loads; the desktop window handles it, but a browser page on the dev
// server (wails dev, http://localhost:34115) sends it through the shared dispatcher, which doesn't
// know it and logs two errors a page load. Nothing is wrong, so they are dropped.
type quietLogger struct {
	logger.Logger
}

func newQuietLogger() logger.Logger {
	return quietLogger{logger.NewDefaultLogger()}
}

func (l quietLogger) Error(message string) {
	if strings.Contains(message, "Unknown message from front end: runtime:ready") {
		return
	}
	l.Logger.Error(message)
}
