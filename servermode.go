//go:build server

package main

// serverMode is whether this is the browser page's build (make dev-page, Wails' server mode), which has
// no window and no native clipboard or dialogs; /meld/backend.js tells the page (#854).
const serverMode = true
