// The probe runner (docs/TESTS.md, "Probes"): runs named checks in the dev page over a headless
// Chrome and prints one JSON line a probe. Needs `make dev` running (http://localhost:34115).
//
//   pnpm probe smoke undo-sculpt      run these probes
//   pnpm probe probes/scratch/x.js    run a probe file from any path (one-off checks; probes/scratch is git-ignored)
//   pnpm probe --all                  every probe in this folder
//   pnpm probe bench --shot out       also save a screenshot a probe as out/<name>.png
//   pnpm probe bench --profile        also print the probe's top functions by CPU time
//   pnpm probe --list                 list the probes with their first comment line
//
// A probe is `probes/<name>.js`: the body of an async function run in the page, with `P` (lib.js)
// in scope. It returns an object; `ok: false` (or a throw) fails it, and the runner exits 1.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// `nosession`: a fresh blank map, not the owner's last session (a restored region takes the probe's tab, #250); `defaults`: every preference at its default, not the owner's (#253).
const PAGE = process.env.MELD_URL ?? 'http://localhost:34115/?nosave&nosession&defaults'
const PORT = 9333 + Math.floor(Math.random() * 500)
const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 600) * 1000
// pnpm runs the script in frontend/; a path is meant from where the command was typed.
const CWD = process.env.INIT_CWD ?? process.cwd()
const APP_JS = join(here, '..', 'wailsjs', 'go', 'main', 'App.js')

const args = process.argv.slice(2)
let shotDir = null
let profiling = false
const names = []
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--shot') shotDir = args[++i]
	else if (args[i] === '--profile') profiling = true
	else names.push(args[i])
}
const all = readdirSync(here).filter((f) => f.endsWith('.js') && f !== 'lib.js').map((f) => f.slice(0, -3)).sort()

if (names[0] === '--list' || names.length === 0) {
	for (const n of all) {
		const first = readFileSync(join(here, n + '.js'), 'utf8').split('\n')[0].replace(/^\/\/\s*/, '')
		console.log(`${n.padEnd(20)} ${first}`)
	}
	if (names.length === 0) console.log('\nUsage: pnpm probe <name or path.js...> | --all [--shot <dir>] [--profile]')
	process.exit(0)
}
/** A probe by name (in this folder) or by path (ends in .js or has a slash), as { name, file }. */
const probeFile = (arg) => {
	if (arg.endsWith('.js') || /[\\/]/.test(arg)) {
		const file = resolve(CWD, arg)
		if (!existsSync(file)) fail(`no probe file ${file}`)
		return { name: basename(file, '.js'), file }
	}
	if (!all.includes(arg)) fail(`no probe named ${arg} (pnpm probe --list)`)
	return { name: arg, file: join(here, arg + '.js') }
}
const run = (names[0] === '--all' ? all : names).map(probeFile)

function fail(msg) {
	console.error(`probe: ${msg}`)
	process.exit(2)
}

function findChrome() {
	const c = [
		process.env.CHROME,
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
	]
	return c.find((p) => p && existsSync(p)) ?? fail('no Chrome found; set CHROME to its path')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
	try {
		const s = await fetch(new URL('/wow/status', PAGE), { signal: AbortSignal.timeout(5000) })
		if (!s.ok) throw new Error(String(s.status))
	} catch (err) {
		fail(`the dev server doesn't answer at ${PAGE} (${err.message}); start \`make dev\` first`)
	}

	const profile = join(tmpdir(), `meld-probe-${PORT}`)
	const chrome = spawn(findChrome(), [
		'--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
		'--window-size=1400,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
		'--no-first-run', '--no-default-browser-check', 'about:blank',
	], { stdio: 'ignore' })
	const cleanup = () => {
		chrome.kill()
		try { rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may still hold it */ }
	}
	process.on('exit', cleanup)

	let target
	for (let i = 0; i < 100 && !target; i++) {
		await sleep(100)
		try {
			const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
			target = list.find((t) => t.type === 'page')
		} catch { /* not up yet */ }
	}
	if (!target) fail('Chrome did not open its DevTools port')

	const ws = new WebSocket(target.webSocketDebuggerUrl)
	await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
	let seq = 0
	const waiting = new Map()
	ws.onmessage = (m) => {
		const msg = JSON.parse(m.data)
		if (msg.id && waiting.has(msg.id)) {
			waiting.get(msg.id)(msg)
			waiting.delete(msg.id)
		} else if (msg.method === 'Runtime.exceptionThrown') {
			const d = msg.params.exceptionDetails
			// The message and its first frames, enough to find the code. Wails' runtime throws in
			// /wails/ipc.js in a plain browser page (no desktop host); that is not the app's.
			if (d.exception?.description?.includes('/wails/ipc.js')) return
			pageErrors.push(d.exception?.description?.split('\n').slice(0, 3).map((l) => l.trim()).join(' ') ?? d.text)
		}
	}
	const pageErrors = []
	const send = (method, params = {}) => new Promise((r) => {
		const id = ++seq
		waiting.set(id, r)
		ws.send(JSON.stringify({ id, method, params }))
	})
	const evaluate = async (expression, timeout = TIMEOUT) => {
		const res = await Promise.race([
			send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
			sleep(timeout).then(() => ({ timedOut: true })),
		])
		if (res.timedOut) throw new Error(`timed out after ${timeout / 1000} s`)
		if (res.error) throw new Error(res.error.message)
		const r = res.result
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text)
		return r.result.value
	}

	await send('Runtime.enable')
	// The page keeps only 250 resource entries by default, which the app's modules fill, and P.app (lib.js)
	// reads the module URLs from them; raise the limit before the page's scripts run.
	await send('Page.enable')
	await send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(100000)' })
	const lib = readFileSync(join(here, 'lib.js'), 'utf8')

	/** One probe on a fresh page, so one probe's state never leaks into the next. */
	const runOnce = async ({ name, file }) => {
		pageErrors.length = 0
		let out
		let prof = null
		try {
			await send('Page.navigate', { url: PAGE })
			await evaluate(`(async () => { for (let i = 0; i < 600; i++) { if (window.__engine && window.__loadScene) return; await new Promise((r) => setTimeout(r, 100)) } throw new Error('the page never set up __engine') })()`, 90_000)
			const body = readFileSync(file, 'utf8')
			if (profiling) {
				await send('Profiler.enable')
				await send('Profiler.setSamplingInterval', { interval: 500 })
				await send('Profiler.start')
			}
			try {
				const value = await evaluate(`(async () => {\n${lib}\n;return await (async () => {\n${body}\n})()\n})()`)
				out = { probe: name, ok: value?.ok !== false, ...value }
			} finally {
				if (profiling) prof = (await send('Profiler.stop')).result?.profile
			}
		} catch (err) {
			out = { probe: name, ok: false, error: err.message }
		}
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
		let out = await runOnce(p)
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
		out.seconds = Math.round((Date.now() - t0) / 100) / 10
		if (shotDir) {
			mkdirSync(shotDir, { recursive: true })
			const shot = await send('Page.captureScreenshot', { format: 'png' })
			if (shot.result?.data) writeFileSync(join(shotDir, p.name + '.png'), Buffer.from(shot.result.data, 'base64'))
		}
		if (!out.ok) failed++
		console.log(JSON.stringify(out))
	}
	ws.close()
	cleanup()
	process.exit(failed ? 1 : 0)
}

/**
 * The 12 functions with the most CPU time in a CPU profile (Profiler.stop), by self time and with
 * their total (self plus callees), as "self ms / total ms name url:line". Found #233's stalls in one run.
 */
function topFunctions(profile) {
	const byId = new Map(profile.nodes.map((n) => [n.id, { node: n, self: 0, parent: null }]))
	for (const e of byId.values()) for (const c of e.node.children ?? []) byId.get(c).parent = e
	for (let i = 0; i < profile.samples.length; i++) byId.get(profile.samples[i]).self += (profile.timeDeltas[i] ?? 0) / 1000
	// Sum by function (name and place), self and total; a recursive function's total counts once a stack.
	const fns = new Map()
	const key = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`
	for (const e of byId.values()) {
		if (!e.self) continue
		const seen = new Set()
		for (let a = e, first = true; a; a = a.parent, first = false) {
			const k = key(a.node)
			const f = fns.get(k) ?? fns.set(k, { self: 0, total: 0 }).get(k)
			if (first) f.self += e.self
			if (!seen.has(k)) {
				f.total += e.self
				seen.add(k)
			}
		}
	}
	return [...fns.entries()]
		.filter(([k]) => !k.startsWith('(root)') && !k.startsWith('(program)') && !k.startsWith('(idle)'))
		.sort((a, b) => b[1].self - a[1].self)
		.slice(0, 12)
		.map(([k, f]) => `${f.self.toFixed(0)} / ${f.total.toFixed(0)} ms ${k}`)
}

main().catch((err) => fail(err.stack ?? String(err)))
