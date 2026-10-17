// The probe runner (docs/TESTS.md, "Probes"): runs named checks in the dev page over a headless
// Chrome and prints one JSON line a probe. Needs `make dev` running (http://localhost:34115).
//
//   pnpm probe smoke undo-sculpt      run these probes
//   pnpm probe --all                  every probe in this folder
//   pnpm probe bench --shot out       also save a screenshot a probe as out/<name>.png
//   pnpm probe --list                 list the probes with their first comment line
//
// A probe is `probes/<name>.js`: the body of an async function run in the page, with `P` (lib.js)
// in scope. It returns an object; `ok: false` (or a throw) fails it, and the runner exits 1.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PAGE = process.env.MELD_URL ?? 'http://localhost:34115/?nosave'
const PORT = 9333 + Math.floor(Math.random() * 500)
const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 600) * 1000

const args = process.argv.slice(2)
let shotDir = null
const names = []
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--shot') shotDir = args[++i]
	else names.push(args[i])
}
const all = readdirSync(here).filter((f) => f.endsWith('.js') && f !== 'lib.js').map((f) => f.slice(0, -3)).sort()

if (names[0] === '--list' || names.length === 0) {
	for (const n of all) {
		const first = readFileSync(join(here, n + '.js'), 'utf8').split('\n')[0].replace(/^\/\/\s*/, '')
		console.log(`${n.padEnd(20)} ${first}`)
	}
	if (names.length === 0) console.log('\nUsage: pnpm probe <name...> | --all [--shot <dir>]')
	process.exit(0)
}
const run = names[0] === '--all' ? all : names
for (const n of run) if (!all.includes(n)) fail(`no probe named ${n} (pnpm probe --list)`)

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
	let failed = 0
	for (const name of run) {
		const t0 = Date.now()
		pageErrors.length = 0
		let out
		try {
			// A fresh page a probe, so one probe's state never leaks into the next.
			await send('Page.navigate', { url: PAGE })
			await evaluate(`(async () => { for (let i = 0; i < 600; i++) { if (window.__engine && window.__loadScene) return; await new Promise((r) => setTimeout(r, 100)) } throw new Error('the page never set up __engine') })()`, 90_000)
			const body = readFileSync(join(here, name + '.js'), 'utf8')
			const value = await evaluate(`(async () => {\n${lib}\n;return await (async () => {\n${body}\n})()\n})()`)
			out = { probe: name, ok: value?.ok !== false, ...value }
		} catch (err) {
			out = { probe: name, ok: false, error: err.message }
		}
		out.seconds = Math.round((Date.now() - t0) / 100) / 10
		if (pageErrors.length) {
			out.pageErrors = pageErrors.slice(0, 5)
			out.ok = false
		}
		if (shotDir) {
			mkdirSync(shotDir, { recursive: true })
			const shot = await send('Page.captureScreenshot', { format: 'png' })
			if (shot.result?.data) writeFileSync(join(shotDir, name + '.png'), Buffer.from(shot.result.data, 'base64'))
		}
		if (!out.ok) failed++
		console.log(JSON.stringify(out))
	}
	ws.close()
	cleanup()
	process.exit(failed ? 1 : 0)
}

main().catch((err) => fail(err.stack ?? String(err)))
