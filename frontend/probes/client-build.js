// The client's build (#1063): the loaded 1.12 client reads as build 5875 (1.12.1) with no unknown-build warning, in Go's /wow/status and in the page's `wow` state. A 2.4.3 or 3.3.5a client is checked by internal/clientbuild's synthetic Wow.exe only.
// touches: internal/clientbuild/*, internal/mpq/set.go, internal/wow/client.go, frontend/src/lib/wow/api.ts
const { wow } = await P.state()
const r = {}
r.status = await (await fetch('/wow/status')).json()
r.page = { build: wow.build, version: wow.version, loaded: wow.loaded }
r.ok = r.status.loaded && r.status.build === 5875 && r.status.version === '1.12.1' && !r.status.buildWarning && r.page.build === 5875 && r.page.version === '1.12.1'
return r
