//go:build !production

package main

// devBuild is whether this is a dev build (make dev, make dev-page), which the probes' throwaway client
// needs; the release build (make build-*) sets the production tag (#854).
const devBuild = true
