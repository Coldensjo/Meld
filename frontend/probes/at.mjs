// `bun run probe <names> --at <commit>` (#873): runs probes against an older commit's frontend without touching the checkout.
// The commit goes into a temporary git worktree in the user cache, with its own `bun install` (never a node_modules junction:
// `git worktree remove` deletes through one), and its Vite serves the page on a free port, proxying the Go side's paths
// (/wow, /wowx, /meld, /wails and its WebSockets) to the running dev page. So only the frontend is the old one: a probe that
// needs a binding the Go side no longer has (or does not have yet) cannot be run this way. Both are removed afterwards.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The user cache folder as Go's os.UserCacheDir gives it, with Meld's own folder in it. */
const meldCache = () => {
	const base = process.platform === 'win32' ? process.env.LOCALAPPDATA : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches') : process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
	return join(base ?? homedir(), 'Meld')
}

/** A free TCP port on 127.0.0.1. */
const freePort = () =>
	new Promise((resolve, reject) => {
		const s = createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address()
			s.close(() => resolve(port))
		})
	})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Kills a process with its children (taskkill /T on Windows, the process group elsewhere, where it is spawned detached). */
const killTree = (child) => {
	const pid = child?.pid
	if (!pid || child.exitCode !== null) return
	try {
		if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
		else process.kill(-pid, 'SIGKILL')
	} catch {
		/* already gone */
	}
}

// Run by `bun --bun -e` in the worktree's frontend, so it imports that commit's Vite and reads that commit's vite.config.ts
// (and svelte.config.js); the inline config is merged over the file's, and its port and proxy win.
const viteScript = (port, target) => `
import { createServer } from 'vite'
const target = ${JSON.stringify(target)}
// The Go side checks the Host (a loopback bind) and the Origin of /wails/runtime and its WebSockets against itself, so both name it.
const go = { target, changeOrigin: true, ws: true, headers: { origin: target } }
const server = await createServer({
	configFile: 'vite.config.ts',
	logLevel: 'warn',
	clearScreen: false,
	server: { host: '127.0.0.1', port: ${port}, strictPort: true, proxy: { '/wow': go, '/wowx': go, '/meld': go, '/wails': go, '/health': go } },
})
await server.listen()
console.log('at: vite ready')
`

/**
 * Checks out `commit` into a temporary worktree and serves its frontend against the Go side at `goOrigin`.
 * Returns { url, sha, stop }: the page's origin, the full hash, and a synchronous stop (safe in an exit handler, and twice).
 * @param {string} commit any git revision
 * @param {string} goOrigin the running dev page's origin, e.g. http://localhost:34115
 * @param {string} repo the repository root
 * @param {(msg: string) => never} fail
 */
export async function startAt(commit, goOrigin, repo, fail) {
	const rev = spawnSync('git', ['rev-parse', '--verify', `${commit}^{commit}`], { cwd: repo, encoding: 'utf8' })
	if (rev.status !== 0) fail(`--at ${commit}: not a commit (${(rev.stderr ?? '').trim()})`)
	const sha = rev.stdout.trim()
	const root = join(meldCache(), 'probe-at')
	mkdirSync(root, { recursive: true })
	const dir = join(root, `${sha.slice(0, 10)}-${process.pid}`)
	let vite = null
	let stopped = false
	const stop = () => {
		if (stopped) return
		stopped = true
		killTree(vite)
		// Windows keeps the files of a process that is still going down locked for a moment: try again once.
		for (let i = 0; i < 2; i++) {
			const r = spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo, stdio: 'ignore' })
			if (r.status === 0 || !existsSync(dir)) break
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)
		}
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {
			/* left for the next run's prune */
		}
		spawnSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'ignore' })
	}
	// Worktrees of runs that were killed before they could remove theirs (their pid is gone).
	spawnSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'ignore' })

	console.error(`probe: --at ${commit}: checking out ${sha.slice(0, 10)} into ${dir}`)
	const add = spawnSync('git', ['worktree', 'add', '--detach', dir, sha], { cwd: repo, encoding: 'utf8' })
	if (add.status !== 0) fail(`--at ${commit}: git worktree add failed: ${(add.stderr ?? '').trim()}`)
	const front = join(dir, 'frontend')
	console.error('probe: --at: bun install in the worktree')
	const inst = spawnSync('bun', ['install', '--frozen-lockfile'], { cwd: front, encoding: 'utf8', shell: process.platform === 'win32' })
	if (inst.status !== 0) {
		stop()
		fail(`--at ${commit}: bun install failed: ${(inst.stderr || inst.stdout || '').trim().slice(-800)}`)
	}

	const port = await freePort()
	vite = spawn('bun', ['--bun', '-e', viteScript(port, goOrigin)], {
		cwd: front,
		env: { ...process.env, WAILS_VITE_PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: process.platform !== 'win32',
	})
	let log = ''
	vite.stdout.on('data', (d) => (log += d))
	vite.stderr.on('data', (d) => (log += d))
	const url = `http://127.0.0.1:${port}`
	for (let i = 0; i < 120; i++) {
		await sleep(500)
		if (vite.exitCode !== null) break
		try {
			if ((await fetch(url + '/', { signal: AbortSignal.timeout(5000) })).ok) {
				console.error(`probe: --at: ${sha.slice(0, 10)}'s frontend at ${url}, its Go side ${goOrigin}`)
				return { url, sha, stop }
			}
		} catch {
			/* not up yet */
		}
	}
	stop()
	fail(`--at ${commit}: the worktree's Vite did not come up: ${log.trim().slice(-800)}`)
}
