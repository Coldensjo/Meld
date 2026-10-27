import type * as THREE from 'three'
import type { History } from '../state/history'
import { MAX_BRUSH_RADIUS, editor, prefs, setStatus } from '../state/editor.svelte'
import type { BrushEventKind, BrushKeys, ScriptSession, TagSpec, TagValue } from '../script/scriptApi'
import { scriptBrush, scriptSay } from '../script/scriptBrush.svelte'
import type { EngineScriptHost } from './ScriptRun'

// The Script Brush tool's engine side (#29): holds the Lua state of a script that made brushes
// (`brush(name)`, Noggit Red's script brushes) and drives a stroke through it. The press sends
// on_left_click, each frame the button stays down sends on_left_hold with the seconds since the last
// (one at a time: a frame whose hold is still running adds its time to the next), and the release sends
// on_left_release. A stroke's edits gather in one host, and so in one undo step, named after the brush.
// The events run one after another on a promise chain, since a handler may wait for a file (load_png).

/** Where the runner reaches the editor: the active map's script host and history. */
export interface ScriptBrushEnv {
	/** A host on the active map for a step named `label`, or null where scripts can't run (a world view). */
	host(label: string): { host: EngineScriptHost; history: History } | null
	/** After a stroke's step is pushed (the Inspector follows a moved selection). */
	after(): void
}

interface Stroke {
	host: EngineScriptHost
	history: History
	session: ScriptSession
	brush: number
	label: string
	failed: boolean
}

/** The key under `file/brush` in prefs.scriptBrushTags. */
const tagsKey = (file: string, brush: string) => `${file}/${brush}`

/** A saved value, if it still fits the tag (its kind, range or list). */
function savedValue(t: TagSpec, v: unknown): TagValue | undefined {
	switch (t.kind) {
		case 'int':
		case 'real':
			return typeof v === 'number' && Number.isFinite(v) ? Math.min(t.high, Math.max(t.low, v)) : undefined
		case 'bool':
			return typeof v === 'boolean' ? v : undefined
		case 'string':
			return typeof v === 'string' ? v : undefined
		case 'list':
			return typeof v === 'string' && t.values.includes(v) ? v : undefined
		default:
			return undefined
	}
}

export class ScriptBrushes {
	private session: ScriptSession | null = null
	private stroke: Stroke | null = null
	private chain: Promise<void> = Promise.resolve()
	/** Events sent and not finished. */
	private queued = 0
	/** Hold time not sent yet, while an event still runs. */
	private pendingDt = 0
	private last: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }

	constructor(private env: ScriptBrushEnv) {}

	/** Whether a brush script is loaded. */
	get loaded(): boolean {
		return !!this.session
	}

	/** Takes a script's session as the tool's brushes (the last one is closed), with the values saved for its tags. */
	use(session: ScriptSession, file: string) {
		// A reload of the same script keeps the brush picked.
		const was = scriptBrush.name === session.name ? scriptBrush.brushes[scriptBrush.active]?.name : undefined
		this.unload()
		this.session = session
		session.onRadius = (outer, inner) => {
			if (Number.isFinite(outer)) editor.brush.radius = Math.min(MAX_BRUSH_RADIUS, Math.max(1, outer))
			if (Number.isFinite(inner)) editor.brush.falloff = Math.min(1, Math.max(0, 1 - inner))
		}
		const saved = file ? prefs.scriptBrushTags : {}
		scriptBrush.brushes = session.brushes.map((b, i) => {
			const keep = saved[tagsKey(file, b.name)] ?? {}
			b.tags.forEach((t, k) => {
				const v = savedValue(t, keep[t.label])
				if (v !== undefined) session.setTag(i, k, v)
			})
			return { name: b.name, tags: b.tags, values: [...session.values[i]], handles: b.handles }
		})
		scriptBrush.active = Math.max(
			0,
			session.brushes.findIndex((b) => b.name === was),
		)
		scriptBrush.name = session.name
		scriptBrush.file = file
		if (file) prefs.scriptBrush = file
	}

	/** Lets go of the brush script, once any stroke on it has finished. */
	unload() {
		const old = this.session
		if (!old) return
		this.session = null
		this.chain = this.chain.then(() => old.close())
		scriptBrush.name = ''
		scriptBrush.file = ''
		scriptBrush.brushes = []
	}

	/** Sets tag `tag` of brush `brush`, as its control in the options bar changes it, and keeps it for next time. */
	setTag(brush: number, tag: number, v: TagValue) {
		const b = scriptBrush.brushes[brush]
		if (!this.session || !b || tag >= b.values.length) return
		this.session.setTag(brush, tag, v)
		b.values[tag] = v
		if (!scriptBrush.file) return
		const key = tagsKey(scriptBrush.file, b.name)
		const keep: Record<string, TagValue> = { ...(prefs.scriptBrushTags[key] ?? {}) }
		keep[b.tags[tag].label] = v
		prefs.scriptBrushTags = { ...prefs.scriptBrushTags, [key]: keep }
	}

	/** The press: starts a stroke and sends on_left_click. */
	begin(hit: THREE.Vector3 | null, keys: BrushKeys) {
		const session = this.session
		if (!session) {
			setStatus('No brush script is loaded: pick one in the options bar, or Run one in Tools › Scripts.', 5000)
			return
		}
		if (!hit) return
		const brush = Math.min(scriptBrush.active, session.brushes.length - 1)
		const label = `Script brush ${session.brushes[brush].name}`
		const at = this.env.host(label)
		if (!at) return
		this.stroke = { ...at, session, brush, label, failed: false }
		this.pendingDt = 0
		this.send('left_click', hit, 0, keys)
	}

	/** A frame with the button held: sends on_left_hold, unless the last event still runs. */
	hold(hit: THREE.Vector3 | null, dt: number, keys: BrushKeys) {
		if (!this.stroke) return
		this.pendingDt += dt
		if (this.queued || !hit) return
		const d = this.pendingDt
		this.pendingDt = 0
		this.send('left_hold', hit, d, keys)
	}

	/** The release: sends on_left_release, then makes the stroke's edits one undo step. */
	end(hit: THREE.Vector3 | null, keys: BrushKeys) {
		const s = this.stroke
		if (!s) return
		this.send('left_release', hit, 0, keys)
		this.stroke = null
		this.chain = this.chain.then(() => {
			const cmd = s.host.finish(s.label)
			if (cmd) s.history.push(cmd)
			this.env.after()
		})
	}

	/** Whether a stroke is going on or its events are still running (for the probes). */
	get busy(): boolean {
		return !!this.stroke || this.queued > 0
	}

	/** Waits for the events sent so far (for the probes). */
	settled(): Promise<void> {
		return this.chain
	}

	private send(kind: BrushEventKind, hit: THREE.Vector3 | null, dt: number, keys: BrushKeys) {
		const s = this.stroke
		if (!s || s.failed) return
		if (hit) this.last = { x: hit.x, y: hit.y, z: hit.z }
		const e = { ...this.last, outer: editor.brush.radius, inner: 1 - editor.brush.falloff, dt }
		this.queued++
		this.chain = this.chain.then(async () => {
			try {
				if (s.failed) return
				s.session.host = s.host
				s.session.keys = keys
				const r = await s.session.event(s.brush, kind, e)
				if (!r.ok) {
					s.failed = true
					scriptSay(r.error ?? `${s.label} failed.`, 'err')
					setStatus(`${s.session.name} failed: ${(r.error ?? '').split('\n')[0]}`, 8000)
				}
			} finally {
				this.queued--
			}
		})
	}
}
