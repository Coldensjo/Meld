// The issue loop's lock (#656): one loop at a time on this checkout and its `make dev`, since two at once broke
// each other's whole-run probes. The coordinator takes it at the start of a run and releases it at the end
// (.claude/issue-loop.md, "Services").
//
//   bun probes/loop-lock.mjs take       take the lock, or exit 1 naming the live loop that holds it
//   bun probes/loop-lock.mjs release    drop it (exit 1 when another live loop holds it)
//   bun probes/loop-lock.mjs status     say who holds it
//   ... --pid <n>                       hold it for that process instead of the claude process above this one
//
// The lock is <user cache>/Meld/loop.lock (as Go's os.UserCacheDir): the holder's pid, the process's own start time
// (so a reused pid doesn't count as the holder) and when the run started. A lock whose holder is gone is stale and
// is taken over.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const cacheDir = process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')) : process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
const LOCK = join(cacheDir, 'Meld', 'loop.lock')

const args = process.argv.slice(2)
const cmd = args[0]
const pidArg = args.indexOf('--pid') >= 0 ? Number(args[args.indexOf('--pid') + 1]) : 0

/** Every process as pid -> { ppid, name, start }, start being a string that changes when the pid is reused. */
function processes() {
	const procs = new Map()
	if (process.platform === 'win32') {
		const ps = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CreationDate.ToString(\'o\'))" }'
		const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 30000 })
		for (const l of (r.stdout ?? '').split(/\r?\n/)) {
			const [pid, ppid, name, start] = l.split('\t')
			if (pid) procs.set(Number(pid), { ppid: Number(ppid), name, start })
		}
	} else {
		for (const d of spawnSync('ls', ['/proc'], { encoding: 'utf8' }).stdout.split('\n')) {
			if (!/^\d+$/.test(d)) continue
			try {
				const stat = readFileSync(`/proc/${d}/stat`, 'utf8')
				// pid (comm) state ppid ... starttime is field 22; comm may hold spaces and parentheses.
				const close = stat.lastIndexOf(')')
				const rest = stat.slice(close + 2).split(' ')
				procs.set(Number(d), { ppid: Number(rest[1]), name: stat.slice(stat.indexOf('(') + 1, close), start: rest[19] })
			} catch {
				/* gone */
			}
		}
	}
	return procs
}

/** The loop's coordinator: the nearest claude process above this one (its shell's parent), or --pid. */
function holder(procs) {
	if (pidArg) {
		const p = procs.get(pidArg)
		if (!p) fail(`no process ${pidArg}`)
		return { pid: pidArg, name: p.name, start: p.start }
	}
	for (let pid = process.pid, n = 0; pid && n < 30; n++) {
		const p = procs.get(pid)
		if (!p) break
		if (/^claude(\.exe)?$/i.test(p.name)) return { pid, name: p.name, start: p.start }
		pid = p.ppid
	}
	fail("found no claude process above this one; pass --pid <the coordinator's pid>")
}

function fail(msg) {
	console.error(`loop-lock: ${msg}`)
	process.exit(2)
}

const read = () => {
	if (!existsSync(LOCK)) return null
	try {
		return JSON.parse(readFileSync(LOCK, 'utf8'))
	} catch {
		return null
	}
}
const alive = (lock, procs) => procs.get(lock.pid)?.start === lock.start
const describe = (l) => `pid ${l.pid} (${l.name}), running since ${l.startedAt}, in ${l.cwd}`

const procs = processes()
const lock = read()
const live = lock && alive(lock, procs)

if (cmd === 'status') {
	console.log(!lock ? 'loop-lock: free' : `loop-lock: ${live ? 'held by' : 'stale, left by'} ${describe(lock)}`)
} else if (cmd === 'take') {
	const me = holder(procs)
	const mine = lock && lock.pid === me.pid && lock.start === me.start
	if (live && !mine) {
		console.error(`loop-lock: another loop runs on this checkout: ${describe(lock)}. Stop: two loops on one make dev break each other's probes (#656). If that loop is not running, end its process or delete ${LOCK}.`)
		process.exit(1)
	}
	if (lock && !live) console.log(`loop-lock: taking over a stale lock left by ${describe(lock)}`)
	mkdirSync(dirname(LOCK), { recursive: true })
	const next = { ...me, startedAt: mine ? lock.startedAt : new Date().toISOString(), cwd: process.cwd() }
	writeFileSync(LOCK, JSON.stringify(next, null, '\t') + '\n')
	console.log(`loop-lock: ${mine ? 'still held' : 'taken'} by ${describe(next)}`)
} else if (cmd === 'release') {
	if (!lock) {
		console.log('loop-lock: already free')
		process.exit(0)
	}
	const me = holder(procs)
	if (live && !(lock.pid === me.pid && lock.start === me.start)) {
		console.error(`loop-lock: held by another live loop, left in place: ${describe(lock)}`)
		process.exit(1)
	}
	rmSync(LOCK, { force: true })
	console.log('loop-lock: released')
} else {
	fail('usage: bun probes/loop-lock.mjs take | release | status [--pid <n>]')
}
