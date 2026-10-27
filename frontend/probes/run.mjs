// The probe runner (docs/TESTS.md, "Probes"): runs named checks in the dev page over a headless
// Chrome and prints one JSON line a probe. Needs `make dev` running (http://localhost:34115).
//
//   bun run probe smoke undo-sculpt      run these probes
//   bun run probe probes/scratch/x.js    run a probe file from any path (one-off checks; probes/scratch is git-ignored)
//   bun run probe --all                  every probe in this folder but the benchmarks (bench, perf-*; name those)
//   bun run probe bench --shot out       also save a screenshot a probe as out/<name>.png
//   bun run probe bench --profile        also print the probe's top functions by CPU time
//   bun run probe --smoke                the probes marked `// tier: smoke` (#398): fast, deterministic, guarding shared code; `make probe-smoke`
//   bun run probe --list                 list the probes with their first comment line and their touches line
//   bun run probe --touching HEAD~3..HEAD  the probes whose `// touches:` globs match a file the git range changed (#397)
//   bun run probe --touching <range> --list  name those probes without running them
//
// A probe is `probes/<name>.js`: the body of an async function run in the page, with `P` (lib.js)
// in scope. It returns an object; `ok: false` (or a throw) fails it, and the runner exits 1.
// Its leading comment block holds a `// touches: <repo-root paths or globs, comma-separated>` line naming the source files it
// checks, which --touching reads; a probe without one is picked by every range.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// `nosession`: a fresh blank map, not the owner's last session (a restored region takes the probe's tab, #250); `defaults`: every preference at its default, not the owner's (#253).
const PAGE = process.env.MELD_URL ?? 'http://localhost:34115/?nosave&nosession&defaults'
// Chrome picks its own DevTools port (--remote-debugging-port=0, read back from DevToolsActivePort, #602), so two runs never share one; DEBUG_PORT forces a port.
const DEBUG_PORT = process.env.DEBUG_PORT ?? '0'
// A probe that runs longer is stopped and reports the step it was waiting on (#301); PROBE_TIMEOUT (seconds) changes the limit.
const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 300) * 1000
// `bun run` starts the script in frontend/ and doesn't set INIT_CWD; a path is meant from there, or from where `bun probes/run.mjs` was typed.
const CWD = process.env.INIT_CWD ?? process.cwd()
// PROBE_GPU=1 draws on the machine's GPU instead of SwiftShader (#747): a fault that only a real GPU's rasteriser shows (depth precision, a
// huge triangle's clipping) never shows on SwiftShader, and frames are far faster. The probes' numbers and baselines are SwiftShader's.
const GPU = process.env.PROBE_GPU === '1'
const APP_JS = join(here, '..', 'wailsjs', 'go', 'main', 'App.js')

const args = process.argv.slice(2)
let shotDir = null
let profiling = false
let touching = null
let smoke = false
const names = []
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--shot') shotDir = args[++i]
	else if (args[i] === '--profile') profiling = true
	else if (args[i] === '--smoke') smoke = true
	else if (args[i] === '--touching') touching = args[++i] ?? fail('--touching needs a git range, e.g. HEAD~3..HEAD')
	else names.push(args[i])
}
const all = readdirSync(here)
	.filter((f) => f.endsWith('.js') && f !== 'lib.js')
	.map((f) => f.slice(0, -3))
	.sort()

/**
 * A probe's header (#397): its first comment line, and the globs of its `// touches:` line (repo-root paths, comma-separated,
 * anywhere in the leading comment block), or null when it has none, which counts as touching every file.
 */
const header = (name) => {
	const lines = readFileSync(join(here, name + '.js'), 'utf8').split(/\r?\n/)
	let touches = null
	let tier = null
	for (const l of lines) {
		if (!l.startsWith('//')) break
		const m = /^\/\/\s*touches:\s*(.*)$/.exec(l)
		const t = /^\/\/\s*tier:\s*(\S+)/.exec(l)
		if (t) tier = t[1]
		if (m)
			touches = m[1]
				.split(',')
				.map((g) => g.trim())
				.filter(Boolean)
	}
	return { first: lines[0].replace(/^\/\/\s*/, ''), touches, tier }
}
/** A glob as a RegExp over repo-root paths: `**` any run of folders, `*` within one name; a path ending in / matches what is under it. */
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?|\*/g, (m) => (m === '*' ? '[^/]*' : '.*')) + (g.endsWith('/') ? '.*' : '') + '$')

// --list with --touching names the probes it would run, without running them.
const listOnly = touching && names[0] === '--list'
if (listOnly) names.shift()
if (names[0] === '--list' || (names.length === 0 && !touching && !smoke)) {
	for (const n of all) {
		const { first, touches } = header(n)
		console.log(`${n.padEnd(20)} ${first}`)
		console.log(`${''.padEnd(20)}   touches: ${touches ? touches.join(', ') : '(no touches line: every change)'}`)
	}
	if (names.length === 0) console.log('\nUsage: bun run probe <name or path.js...> | --all | --touching <git range> [--shot <dir>] [--profile]')
	process.exit(0)
}
/** A probe by name (in this folder) or by path (ends in .js or has a slash), as { name, file }. */
const probeFile = (arg) => {
	if (arg.endsWith('.js') || /[\\/]/.test(arg)) {
		const file = resolve(CWD, arg)
		if (!existsSync(file)) fail(`no probe file ${file}`)
		return { name: basename(file, '.js'), file }
	}
	if (!all.includes(arg)) fail(`no probe named ${arg} (bun run probe --list)`)
	return { name: arg, file: join(here, arg + '.js') }
}
// A name ending in * runs every probe whose name starts with the rest (`perf-*`: every benchmark map, #322).
const expand = (n) => {
	if (!n.endsWith('*')) return [n]
	const found = all.filter((a) => a.startsWith(n.slice(0, -1)))
	if (!found.length) fail(`no probe matches ${n} (bun run probe --list)`)
	return found
}
// --all leaves out the benchmarks (bench, perf-*): they print numbers for a before/after and check nothing a feature breaks, and
// their ~8 minutes would take `make probe` past the agent harness's 30-minute task limit (#390). `make probe-perf` runs them.
const isBenchmark = (n) => n === 'bench' || n.startsWith('perf-')
/**
 * --touching <range> (#397): the probes (not the benchmarks) whose `touches` globs match a file `git diff --name-only <range>` lists.
 * A probe also touches its own file, and lib.js (every probe's P) touches them all; a probe with no `touches` line is always picked.
 */
const touchingProbes = (range) => {
	const r = spawnSync('git', ['diff', '--name-only', range], { cwd: join(here, '..', '..'), encoding: 'utf8' })
	if (r.status !== 0) fail(`git diff --name-only ${range} failed: ${(r.stderr ?? '').trim()}`)
	const changed = r.stdout.split(/\r?\n/).filter(Boolean)
	const libChanged = changed.includes('frontend/probes/lib.js')
	return all.filter((n) => {
		if (isBenchmark(n)) return false
		const { touches } = header(n)
		if (!touches || libChanged) return true
		const res = [...touches, `frontend/probes/${n}.js`].map(globRe)
		return changed.some((f) => res.some((re) => re.test(f)))
	})
}
let picked = names[0] === '--all' ? all.filter((n) => !isBenchmark(n)) : names.flatMap(expand)
if (smoke) picked = [...new Set([...picked, ...all.filter((n) => header(n).tier === 'smoke')])]
if (touching) {
	const found = touchingProbes(touching)
	console.error(`probe: --touching ${touching}: ${found.length ? found.join(' ') : 'no probe touches it'}`)
	picked = [...new Set([...picked, ...found])]
	if (listOnly) {
		for (const n of found) console.log(n)
		process.exit(0)
	}
	if (!picked.length) process.exit(0)
}
const run = picked.map(probeFile)

function fail(msg) {
	console.error(`probe: ${msg}`)
	process.exit(2)
}

function findChrome() {
	const c = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
	return c.find((p) => p && existsSync(p)) ?? fail('no Chrome found; set CHROME to its path')
}

/** Other probe runs still alive (their Bun runner or headless Chrome), as 'pid: name' lines. A forgotten run doubles the load and skews every timing (#257). */
function otherRuns() {
	const lines = []
	try {
		if (process.platform === 'win32') {
			const ps = `Get-CimInstance Win32_Process -Filter "Name='bun.exe' OR Name='node.exe' OR Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -match 'meld-probe-|probes.run.mjs' } | ForEach-Object { "$($_.ProcessId): $($_.Name) $($_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))" }`
			const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 15000 })
			lines.push(...(r.stdout ?? '').split(/\r?\n/))
		} else {
			const r = spawnSync('ps', ['-eo', 'pid,comm,args'], { encoding: 'utf8', timeout: 15000 })
			for (const l of (r.stdout ?? '').split('\n')) {
				if (/meld-probe-|probes\/run\.mjs/.test(l) && !/^\s*\d+\s+(ps|sh|bash)\s/.test(l)) lines.push(l.trim().replace(/^(\d+)\s+(\S+).*/, '$1: $2'))
			}
		}
	} catch {
		/* listing is best effort */
	}
	return lines.map((l) => l.trim()).filter((l) => l && !l.startsWith(`${process.pid}:`))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Whether the dev server answers: the Go side (/wow/status) and the page through Vite (a dead Vite makes the Wails proxy answer 502, #258). Returns '' or the reason. */
async function devDown() {
	try {
		const s = await fetch(new URL('/wow/status', PAGE), { signal: AbortSignal.timeout(5000) })
		if (!s.ok) return `/wow/status answered ${s.status}`
		const p = await fetch(new URL('/', PAGE), { signal: AbortSignal.timeout(10000) })
		if (!p.ok) return `the page answered ${p.status}`
	} catch (err) {
		return err.message
	}
	return ''
}

/** When the dev server's Go side started (/wow/status `started`, Unix ms), or 0 when it doesn't answer. A change between two calls means wails dev rebuilt and restarted it (#656). */
async function devStarted() {
	try {
		const s = await fetch(new URL('/wow/status', PAGE), { signal: AbortSignal.timeout(5000) })
		return s.ok ? ((await s.json()).started ?? 0) : 0
	} catch {
		return 0
	}
}

/** The newest non-test .go file the app is built from (the repo root's, internal/ and cmd/), as { file, mtime }, or null. */
function newestGo() {
	const root = join(here, '..', '..')
	let best = null
	const walk = (dir, deep) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const f = join(dir, e.name)
			if (e.isDirectory()) {
				if (deep) walk(f, true)
			} else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) {
				const m = statSync(f).mtimeMs
				if (!best || m > best.mtime) best = { file: f, mtime: m }
			}
		}
	}
	walk(root, false)
	for (const d of ['internal', 'cmd']) if (existsSync(join(root, d))) walk(join(root, d), true)
	return best
}

/** Says so when a Go source file is newer than the running Go side: wails dev did not rebuild (#387), so a new binding is missing in the page. Returns '' or the message. */
async function staleBackend() {
	const started = await devStarted()
	const g = newestGo()
	if (!started || !g || g.mtime <= started + 5000) return ''
	return `the dev server's Go side started at ${new Date(started).toLocaleTimeString()}, before ${basename(g.file)} changed (${new Date(g.mtime).toLocaleTimeString()}): wails dev did not rebuild it, so a new binding is missing in the page. Stop wails.exe, Meld-dev.exe and the bun processes and rerun, and the runner starts \`make dev\` again`
}

/** Starts `make dev` detached (it outlives this run, for the next one) when the server is down, and waits for it. Only for the default local URL. */
async function ensureDev() {
	const why = await devDown()
	if (!why) return
	if (process.env.MELD_URL) fail(`the dev server doesn't answer at ${PAGE} (${why})`)
	const log = join(tmpdir(), 'meld-dev.log')
	console.error(`probe: the dev server is down (${why}); starting \`make dev\` (log ${log}), which takes a few minutes`)
	const out = openSync(log, 'w')
	spawn('make', ['dev'], { cwd: join(here, '..', '..'), detached: true, stdio: ['ignore', out, out], shell: process.platform === 'win32' }).unref()
	for (let i = 0; i < 120; i++) {
		await sleep(5000)
		if (!(await devDown())) return
	}
	fail(`the dev server did not come up in 10 minutes (see ${log})`)
}

async function main() {
	await ensureDev()
	const stale = process.env.MELD_URL ? '' : await staleBackend()
	if (stale) console.error(`probe: warning: ${stale}`)

	const others = otherRuns()
	if (others.length) {
		console.error('probe: warning: another probe run seems alive, which skews timings (stop it with Stop-Process -Id <pid> on Windows, kill <pid> on Linux):')
		for (const o of others) console.error(`  ${o}`)
	}

	const profile = join(tmpdir(), `meld-probe-${process.pid}`)
	let chrome = null
	let ws = null
	let seq = 0
	const waiting = new Map()
	const pageErrors = []
	/** Everything the page said or failed to load (console at every level, failed and 4xx/5xx requests), kept to report a page that never sets up __engine. */
	const pageLog = []
	const note = (l) => {
		if (pageLog.length < 40) pageLog.push(l.slice(0, 300))
	}
	/** Kills Chrome with its children (taskkill /T on Windows, the process group on Linux, where launch detaches it). */
	const killChrome = () => {
		const pid = chrome?.pid
		if (!pid) return
		try {
			if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
			else process.kill(-pid, 'SIGKILL')
		} catch {
			/* already gone */
		}
		try {
			chrome.kill()
		} catch {
			/* already gone */
		}
	}
	const cleanup = () => {
		killChrome()
		try {
			rmSync(profile, { recursive: true, force: true })
		} catch {
			/* Chrome may still hold it */
		}
		// A stop during the App.js refresh (below) would leave the app without it until Wails regenerates it.
		try {
			if (existsSync(APP_JS + '.probe-refresh')) renameSync(APP_JS + '.probe-refresh', APP_JS)
		} catch {
			/* nothing to restore */
		}
	}
	process.on('exit', cleanup)
	// Node and Bun skip 'exit' handlers when a signal ends the process, so Ctrl-C, kill and a harness timeout left Chrome running (#601).
	for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'])
		process.on(s, () => {
			cleanup()
			process.exit(130)
		})
	// Profiles of runs that were killed before this (their pid is gone) pile up in the temp folder.
	for (const d of readdirSync(tmpdir())) {
		const m = /^meld-probe-(\d+)$/.exec(d)
		if (!m || Number(m[1]) === process.pid) continue
		try {
			process.kill(Number(m[1]), 0)
		} catch {
			try {
				rmSync(join(tmpdir(), d), { recursive: true, force: true })
			} catch {
				/* in use */
			}
		}
	}

	/** A CDP command. Rejects when the page's socket closes or nothing answers in time, so a closed page never stalls the run (#388). */
	const send = (method, params = {}, timeout = 60_000) =>
		new Promise((resolve, reject) => {
			if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error(`the probe page is closed (${method})`))
			const id = ++seq
			const timer = setTimeout(() => {
				waiting.delete(id)
				reject(new Error(`${method} got no answer in ${timeout / 1000} s`))
			}, timeout)
			waiting.set(id, {
				resolve: (m) => {
					clearTimeout(timer)
					resolve(m)
				},
				reject: (e) => {
					clearTimeout(timer)
					reject(e)
				},
			})
			ws.send(JSON.stringify({ id, method, params }))
		})
	const evaluate = async (expression, timeout = TIMEOUT) => {
		const res = await Promise.race([send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout + 5000), sleep(timeout).then(() => ({ timedOut: true }))])
		if (res.timedOut) throw new Error(`timed out after ${timeout / 1000} s`)
		if (res.error) throw new Error(res.error.message)
		const r = res.result
		if (r.exceptionDetails) {
			const description = r.exceptionDetails.exception?.description
			throw Object.assign(new Error(description?.split('\n')[0] ?? r.exceptionDetails.text), { description })
		}
		return r.result.value
	}

	/** Starts a headless Chrome with a fresh profile and connects to its page. Used at the start and again after a probe leaves the page unusable (#388). */
	const launch = async () => {
		chrome = spawn(
			findChrome(),
			[
				'--headless=new',
				`--remote-debugging-port=${DEBUG_PORT}`,
				`--user-data-dir=${profile}`,
				'--window-size=1400,900',
				...(GPU ? ['--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
				'--no-first-run',
				'--no-default-browser-check',
				'about:blank',
			],
			{ stdio: 'ignore', detached: process.platform !== 'win32' },
		)
		let target
		let port = DEBUG_PORT !== '0' ? DEBUG_PORT : null
		for (let i = 0; i < 100 && !target; i++) {
			await sleep(100)
			try {
				if (!port) port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\s/)[0].trim() || null
				if (!port) continue
				const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
				target = list.find((t) => t.type === 'page')
			} catch {
				/* not up yet */
			}
		}
		if (!target) fail('Chrome did not open its DevTools port')
		const sock = new WebSocket(target.webSocketDebuggerUrl)
		ws = sock
		await new Promise((r, j) => {
			sock.onopen = r
			sock.onerror = j
		})
		sock.onclose = () => {
			for (const w of waiting.values()) w.reject(new Error('the probe page closed'))
			waiting.clear()
		}
		sock.onmessage = (m) => {
			const msg = JSON.parse(m.data)
			if (msg.id && waiting.has(msg.id)) {
				waiting.get(msg.id).resolve(msg)
				waiting.delete(msg.id)
			} else if (msg.method === 'Runtime.consoleAPICalled') {
				note(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`)
			} else if (msg.method === 'Network.loadingFailed') {
				note(`request failed: ${msg.params.errorText}${msg.params.canceled ? ' (canceled)' : ''} ${msg.params.requestId}`)
			} else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
				note(`HTTP ${msg.params.response.status} ${msg.params.response.url}`)
			} else if (msg.method === 'Runtime.exceptionThrown') {
				const d = msg.params.exceptionDetails
				// The message and its first frames, enough to find the code. Wails' runtime throws in
				// /wails/ipc.js in a plain browser page (no desktop host); that is not the app's.
				if (d.exception?.description?.includes('/wails/ipc.js')) return
				pageErrors.push(
					d.exception?.description
						?.split('\n')
						.slice(0, 3)
						.map((l) => l.trim())
						.join(' ') ?? d.text,
				)
			}
		}
		await send('Runtime.enable')
		await send('Network.enable')
		// The page keeps only 250 resource entries by default, which the app's modules fill, and P.app (lib.js)
		// reads the module URLs from them; raise the limit before the page's scripts run.
		await send('Page.enable')
		await send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(100000)' })
	}
	/** Throws Chrome away (the probe's own, found by its profile) and starts another, since a timed-out or closed page does not recover. */
	const relaunch = async () => {
		try {
			ws?.close()
		} catch {
			/* already closed */
		}
		killChrome()
		await sleep(500)
		try {
			rmSync(profile, { recursive: true, force: true })
		} catch {
			/* Chrome may still hold it */
		}
		await launch()
	}
	await launch()
	const lib = readFileSync(join(here, 'lib.js'), 'utf8')

	/** One probe on a fresh page, so one probe's state never leaks into the next. */
	const runOnce = async ({ name, file }) => {
		pageErrors.length = 0
		pageLog.length = 0
		let out
		let prof = null
		let bodyStart = Infinity
		try {
			await send('Page.navigate', { url: PAGE })
			await evaluate(`(async () => { for (let i = 0; i < 600; i++) { if (window.__engine && window.__loadScene) return; await new Promise((r) => setTimeout(r, 100)) } throw new Error('the page never set up __engine') })()`, 90_000)
			const body = readFileSync(file, 'utf8')
			if (profiling) {
				await send('Profiler.enable')
				await send('Profiler.setSamplingInterval', { interval: 500 })
				await send('Profiler.start')
			}
			// PERF_WINDOWS (the number of measurePerf windows P.perf averages, #337) reaches the page this way.
			// Every PROBE_* variable too (#347), read in a probe as P.env('NAME', fallback) for PROBE_NAME.
			const probeEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k === 'PERF_WINDOWS' || k.startsWith('PROBE_')))
			// bench-baseline.json (#429) reaches the page the same way, for `bench`'s guard.
			const benchBaseline = readFileSync(join(here, 'bench-baseline.json'), 'utf8')
			const prefix = `(async () => {\nwindow.__probeEnv = ${JSON.stringify(probeEnv)};\nwindow.__benchBaseline = ${benchBaseline};\n${lib}\n;await P.flyingStart();\nreturn await (async () => {\n`
			bodyStart = prefix.split('\n').length
			try {
				const value = await evaluate(`${prefix}${body}\n})()\n})()`)
				out = { probe: name, ok: value?.ok !== false, ...value }
			} finally {
				if (profiling) prof = (await send('Profiler.stop')).result?.profile
			}
		} catch (err) {
			out = { probe: name, ok: false, error: err.message }
			// The page itself is lost (a timeout, a closed or navigated target, no answer): it needs a new Chrome (#388).
			if (/timed out after|got no answer|page (is )?closed|navigated or closed|Target closed|Session with given id|Cannot find context/.test(err.message)) out.lostPage = true
			// Where it stopped: the step a wait (P.until, P.settle) was in, and for a throw the first
			// stack line inside the probe's own body, as a line of the probe file.
			const step = await evaluate('window.__probeStep ?? null', 5000).catch(() => null)
			if (step) out.step = step
			// The page never set up __engine: say what it did instead (#727), so a stuck page over a dev server that answers is told from a dead one.
			if (/never set up __engine/.test(err.message)) {
				const state = await evaluate(
					`({ readyState: document.readyState, url: location.href, hasWindowGo: typeof window.go, hasWailsRuntime: typeof window.runtime, bodyChildren: document.body?.children.length ?? null })`,
					5000,
				).catch((e) => ({ unreadable: e.message }))
				out.pageState = state
				out.pageLog = pageLog.slice()
				out.hint = 'the page loaded but the app did not start; see pageLog and docs/TESTS.md, "a page that never sets up __engine"'
			}
			for (const m of (err.description ?? '').matchAll(/<anonymous>:(\d+):(\d+)/g)) {
				if (Number(m[1]) >= bodyStart) {
					out.line = `${basename(file)}:${Number(m[1]) - bodyStart + 1}:${m[2]}`
					break
				}
			}
		}
		// A probe that turned the throwaway client on (P.sandboxClient, #368) leaves it on when it fails:
		// end it here, so the next probe and the owner's dev window read the real client again.
		const ended = await evaluate('window.__probeSandbox ? window.go.main.App.EndClientSandbox() : null', 60_000).catch((e) => ({ error: e.message }))
		if (ended?.error) out.sandboxEnd = ended.error
		if (prof) out.profile = topFunctions(prof)
		if (pageErrors.length) {
			out.pageErrors = pageErrors.slice(0, 5)
			out.ok = false
		}
		return out
	}

	let failed = 0
	for (const p of run) {
		const t0 = Date.now()
		const bootBefore = await devStarted()
		let out = await runOnce(p)
		const recover = async () => {
			if (!out.lostPage && !out.sandboxEnd) return
			await relaunch()
			// The lost page could not end a throwaway client it had turned on; a new page ends it (a no-op when none is on).
			if (out.sandboxEnd) {
				await send('Page.navigate', { url: PAGE })
				await evaluate(`(async () => { for (let i = 0; i < 300; i++) { if (window.go?.main?.App) return window.go.main.App.EndClientSandbox(); await new Promise((r) => setTimeout(r, 100)) } })()`, 60_000).catch(() => null)
			}
		}
		// After a new Go binding, wails dev replaces wailsjs' App.js by rename, Vite's watcher misses it
		// and the page fails on "does not provide an export named" (docs/TESTS.md). Moving the file out
		// and back makes Vite see a new file; then run the probe again, once.
		if (!out.ok && out.pageErrors?.some((e) => e.includes('does not provide an export named')) && existsSync(APP_JS)) {
			renameSync(APP_JS, APP_JS + '.probe-refresh')
			await sleep(1000)
			renameSync(APP_JS + '.probe-refresh', APP_JS)
			await sleep(2000)
			out = { ...(await runOnce(p)), refreshedWailsjs: true }
		}
		// A failure gets one more try in a fresh page (a new Chrome when the page was lost), so a probe that fails only in a
		// long run is reported flaky instead of failing the run, and a real break still fails twice (#388).
		if (!out.ok) {
			const first = out
			// A dev server that died under the probe (or is rebuilding) fails the retry too: wait a minute for a rebuild to
			// finish, then start `make dev` again as at the start of the run (#391).
			if (!process.env.MELD_URL && (await devDown())) {
				for (let i = 0; i < 12 && (await devDown()); i++) await sleep(5000)
				const why = await devDown()
				if (why) {
					await ensureDev()
					first.devRestarted = why
				}
			}
			await recover().catch((e) => console.error(`probe: could not restart Chrome: ${e.message}`))
			out = await runOnce(p)
			if (first.devRestarted) out.devRestarted = first.devRestarted
			if (out.ok) out = { ...out, flaky: true, firstFailure: first.error ?? first.pageErrors?.[0] ?? 'ok: false', ...(first.step ? { firstStep: first.step } : {}) }
			else out.retried = true
		}
		await recover().catch((e) => console.error(`probe: could not restart Chrome: ${e.message}`))
		// The app restarted under the probe (a Go change rebuilt by wails dev, maybe another session's, #656): name it, so a
		// lost page or a failure here is read as the restart rather than the probe's own fault.
		const bootAfter = await devStarted()
		if (bootBefore && bootAfter && bootAfter !== bootBefore) {
			out.devRebuilt = `the dev server restarted during this probe (at ${new Date(bootAfter).toLocaleTimeString()}): wails dev rebuilt the Go side, so a lost page or failure here may come from that`
			console.error(`probe: ${p.name}: ${out.devRebuilt}`)
		}
		if (!out.ok && !process.env.MELD_URL) {
			const why = await staleBackend()
			if (why) out.staleBackend = why
		}
		out.seconds = Math.round((Date.now() - t0) / 100) / 10
		// Taken after every probe, so a later probe never writes this one's pictures.
		const saved = (await evaluate('(() => { const s = window.__probeShots ?? []; window.__probeShots = []; return s })()').catch(() => null)) ?? []
		if (shotDir) {
			mkdirSync(shotDir, { recursive: true })
			// lib.js stops the app's loop, so the canvas holds the probe's last stepped frame: draw one more
			// (and wait for the GPU) so the capture shows the state the probe ended in (#274).
			await evaluate(`(async () => {
				const e = window.__engine
				if (!e) return
				e.frame()
				const gl = e.renderer.getContext()
				const sync = gl.isContextLost() ? null : gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
				if (!sync) return
				gl.flush()
				const end = performance.now() + 30000
				while (!gl.isContextLost() && gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() < end) await new Promise((r) => setTimeout(r, 1))
				gl.deleteSync(sync)
			})()`).catch(() => null)
			const shot = await send('Page.captureScreenshot', { format: 'png' })
			if (shot.result?.data) writeFileSync(join(shotDir, p.name + '.png'), Buffer.from(shot.result.data, 'base64'))
			// Pictures the probe saved with P.save.
			for (const sh of saved) writeFileSync(join(shotDir, `${p.name}-${sh.name}.png`), Buffer.from(sh.data, 'base64'))
		}
		if (!out.ok) failed++
		console.log(JSON.stringify(out))
	}
	ws.close()
	cleanup()
	process.exit(failed ? 1 : 0)
}

/**
 * The 12 functions (`PROFILE_TOP` to change it) with the most CPU time in a CPU profile (Profiler.stop), by self time and with
 * their total (self plus callees), as "self ms / total ms name url:line <= caller < caller (share)", the
 * caller chain being the heaviest one up to the first frame in src/ (#298). Found #233's stalls in one run.
 */
function topFunctions(profile) {
	const byId = new Map(profile.nodes.map((n) => [n.id, { node: n, self: 0, parent: null }]))
	for (const e of byId.values()) for (const c of e.node.children ?? []) byId.get(c).parent = e
	for (let i = 0; i < profile.samples.length; i++) byId.get(profile.samples[i]).self += (profile.timeDeltas[i] ?? 0) / 1000
	// Sum by function (name and place), self and total; a recursive function's total counts once a stack.
	const fns = new Map()
	const fname = (n) => n.callFrame.functionName || '(anonymous)'
	const inSrc = (n) => n.callFrame.url.includes('/src/')
	const key = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`
	for (const e of byId.values()) {
		if (!e.self) continue
		// The callers of this sample's function, up to the first frame in Meld's src/ (or six frames).
		const chain = []
		for (let a = e.parent; a && chain.length < 6; a = a.parent) {
			const nm = fname(a.node)
			if (nm.startsWith('(')) break
			chain.push(nm)
			if (inSrc(a.node)) break
		}
		const chainKey = chain.join(' < ')
		const seen = new Set()
		for (let a = e, first = true; a; a = a.parent, first = false) {
			const k = key(a.node)
			const f = fns.get(k) ?? fns.set(k, { self: 0, total: 0, chains: new Map() }).get(k)
			if (first) {
				f.self += e.self
				f.chains.set(chainKey, (f.chains.get(chainKey) ?? 0) + e.self)
			}
			if (!seen.has(k)) {
				f.total += e.self
				seen.add(k)
			}
		}
	}
	return [...fns.entries()]
		.filter(([k]) => !k.startsWith('(root)') && !k.startsWith('(program)') && !k.startsWith('(idle)'))
		.sort((a, b) => b[1].self - a[1].self)
		.slice(0, Number(process.env.PROFILE_TOP) || 12)
		.map(([k, f]) => {
			// The heaviest caller chain, with the share of the function's self time it carries.
			const [chain, ms] = [...f.chains.entries()].sort((a, b) => b[1] - a[1])[0]
			const via = chain ? ` <= ${chain} (${((ms / f.self) * 100).toFixed(0)}%)` : ''
			return `${f.self.toFixed(0)} / ${f.total.toFixed(0)} ms ${k}${via}`
		})
}

main().catch((err) => fail(err.stack ?? String(err)))
