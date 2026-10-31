// A scripted guest for the probes that test a shared session (#999): `meldtool session join` run from
// the probe runner (Bun), so one page can host and the bot be the second Meld.
//
//   import { joinBot } from './session-bot.mjs'
//   const info = await window.go.main.App.HostSession(0, 'Probe')            // in the page
//   const bot = await joinBot(`127.0.0.1:${info.port}`, info.code, { send: [{ kind: 'edit', data: {} }], seconds: 3 })
//   const lines = await bot.done()                                            // every message the bot saw
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let built = null

/** Builds cmd/meldtool once per run (a `go run` per bot would compile every time). */
function meldtool() {
	if (!built) {
		const exe = join(mkdtempSync(join(tmpdir(), 'meldtool-')), process.platform === 'win32' ? 'meldtool.exe' : 'meldtool')
		built = new Promise((ok, fail) => {
			const p = spawn('go', ['build', '-o', exe, './cmd/meldtool'], { cwd: root, stdio: 'inherit' })
			p.on('exit', (c) => (c === 0 && existsSync(exe) ? ok(exe) : fail(new Error('go build ./cmd/meldtool failed'))))
		})
	}
	return built
}

/**
 * Starts the bot. `send` is an array of `{to?, kind, data}` messages sent once it is in; `seconds` is how
 * long it stays (it also leaves when the host ends the session). Returns `{ done() }`, which resolves to the
 * bot's output lines parsed (the welcome first, with `data.you` and `data.peers`), or rejects with its stderr.
 */
export async function joinBot(addr, code, { name = 'Bot', send = [], seconds = 3 } = {}) {
	const exe = await meldtool()
	const args = ['session', 'join', '--name', name, '--for', String(seconds)]
	if (send.length) {
		const file = join(mkdtempSync(join(tmpdir(), 'session-bot-')), 'send.jsonl')
		writeFileSync(file, send.map((m) => JSON.stringify(m)).join('\n') + '\n')
		args.push('--send', file)
	}
	args.push(addr, code)
	const p = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
	let out = ''
	let err = ''
	p.stdout.on('data', (d) => (out += d))
	p.stderr.on('data', (d) => (err += d))
	const exited = new Promise((ok) => p.on('exit', ok))
	return {
		async done() {
			const code = await exited
			if (code !== 0) throw new Error(`meldtool session join exited ${code}: ${err.trim()}`)
			return out
				.split('\n')
				.filter(Boolean)
				.map((l) => JSON.parse(l))
		},
	}
}
