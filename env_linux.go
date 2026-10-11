//go:build linux

package main

import "os"

func init() {
	// WebKitGTK's DMA-BUF renderer crashes on some Wayland compositors/drivers
	// ("Error 71 (Protocol error) dispatching to Wayland display"). Disabling it
	// keeps WebGL hardware accelerated. Users can still override via the env.
	if _, ok := os.LookupEnv("WEBKIT_DISABLE_DMABUF_RENDERER"); !ok {
		os.Setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
	}
}
