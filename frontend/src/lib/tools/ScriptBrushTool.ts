import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import type { BrushKeys } from '../script/scriptApi'
import type { ScriptBrushes } from '../engine/ScriptBrushes'

// The Script Brush tool (#29, tool `script`): paints with a brush of the loaded Lua script
// (engine/ScriptBrushes.ts), whose handlers do the work. The tool only passes the stroke on with the keys
// held: Shift, Ctrl and Alt from the pointer, Space from the keyboard. The right mouse button moves the
// camera in Meld, so a brush's on_right_* handlers never run.
export class ScriptBrushTool implements Tool {
	readonly usesBrush = true
	private keys: BrushKeys = { alt: false, shift: false, ctrl: false, space: false, left: false, right: false }
	private space = false
	private abort: AbortController | null = null

	constructor(private brushes: ScriptBrushes) {}

	activate() {
		this.abort = new AbortController()
		const track = (e: KeyboardEvent) => {
			if (e.code === 'Space') this.space = e.type === 'keydown'
		}
		window.addEventListener('keydown', track, { signal: this.abort.signal })
		window.addEventListener('keyup', track, { signal: this.abort.signal })
		window.addEventListener('blur', () => (this.space = false), { signal: this.abort.signal })
	}

	deactivate() {
		this.abort?.abort()
		this.abort = null
		this.space = false
	}

	/** The keys held, kept from the last pointer event (a held key changes the next one). */
	private read(e: PointerEvent | undefined, left: boolean): BrushKeys {
		const k = this.keys
		this.keys = { alt: e ? e.altKey : k.alt, shift: e ? e.shiftKey : k.shift, ctrl: e ? e.ctrlKey || e.metaKey : k.ctrl, space: this.space, left, right: false }
		return this.keys
	}

	onDown(_ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
		this.brushes.begin(hit, this.read(e, true))
	}

	onMove(_ctx: ToolContext, _hit: THREE.Vector3 | null, e?: PointerEvent) {
		this.read(e, true)
	}

	tick(_ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		this.brushes.hold(hit, dt, this.keys.space === this.space ? this.keys : this.read(undefined, true))
	}

	onUp(_ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
		this.brushes.end(hit, this.read(e, false))
	}
}
