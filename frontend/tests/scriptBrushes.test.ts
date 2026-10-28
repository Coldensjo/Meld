import './runes.ts'
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { ScriptBrushes } from '../src/lib/engine/ScriptBrushes.ts'
import { EngineScriptHost, type ScriptView } from '../src/lib/engine/ScriptRun.ts'
import { openScript } from '../src/lib/script/scriptApi.ts'
import { scriptBrush } from '../src/lib/script/scriptBrush.svelte.ts'
import { History } from '../src/lib/state/history.ts'
import { Terrain } from '../src/lib/terrain/Terrain.ts'
import { ObjectLayer } from '../src/lib/world/ObjectLayer.ts'
import { LiquidMap } from '../src/lib/water/liquids.ts'

// The Script Brush tool's engine side driving a brush script's strokes on the editor's own host: which
// button's events a stroke sends (#762), since the right mouse button moves the camera in Meld.

const BRUSH = `
local b = brush("Both")
function b:on_left_click() print("lclick", holding_left_mouse(), holding_right_mouse()) end
function b:on_left_release() print("lrelease") end
function b:on_right_click(evt) print("rclick", holding_left_mouse(), holding_right_mouse()) end
function b:on_right_hold(evt) select_origin(evt:pos(), 3):verts()[1]:add_height(1) end
function b:on_right_release() print("rrelease") end
local r = brush("Right only")
function r:on_right_click() print("only") end
`

const keys = (left: boolean) => ({ alt: false, shift: false, ctrl: false, space: false, left, right: false })

async function setup() {
	const t = new Terrain(16, 2)
	const objects = new ObjectLayer(t)
	const liquids = new LiquidMap(16)
	const history = new History()
	const out: string[] = []
	const view: ScriptView = {
		print: (s) => out.push(s),
		camera: () => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0 }),
		target: () => ({ x: 0, y: 0, z: 0 }),
		mapId: 0,
		areaAt: () => 0,
		area: null,
		loadImage: async () => 'no files here',
		palette: () => [],
		setPalette: () => {},
		effect: () => 0,
		scopedEffects: () => ({ zones: {}, tiles: {} }),
		setScopedEffects: () => {},
	}
	const { session } = await openScript(BRUSH, 'both', new EngineScriptHost(t, objects, liquids, view, 'x'))
	const brushes = new ScriptBrushes({ host: (label) => ({ host: new EngineScriptHost(t, objects, liquids, view, label), history }), after: () => {} })
	brushes.use(session!, '')
	const stroke = async () => {
		out.length = 0
		const at = new THREE.Vector3(8, 0, 8)
		brushes.begin(at, keys(true))
		// A hold waits for the click to finish.
		await brushes.settled()
		brushes.hold(at, 0.1, keys(true))
		await brushes.settled()
		brushes.end(at, keys(false))
		await brushes.settled()
		return [...out]
	}
	return { t, history, brushes, stroke }
}

describe('Script brush strokes (#762)', () => {
	test('a stroke sends the left events, or the right ones with Right button on, as one undo step', async () => {
		const w = await setup()
		scriptBrush.right = false
		expect(await w.stroke()).toEqual(['lclick\ttrue\tfalse', 'lrelease'])
		expect(w.history.position).toBe(0)
		scriptBrush.right = true
		expect(await w.stroke()).toEqual(['rclick\tfalse\ttrue', 'rrelease'])
		expect(w.history.position).toBe(1)
		expect(w.history.peek()?.label).toBe('Script brush Both')
		expect(Math.max(...w.t.heights)).toBe(1)
		w.history.undo()
		expect(Math.max(...w.t.heights)).toBe(0)
		w.brushes.unload()
	})

	test('a brush that handles only the right button paints with the left', async () => {
		const w = await setup()
		scriptBrush.right = false
		scriptBrush.active = 1
		expect(await w.stroke()).toEqual(['only'])
		scriptBrush.active = 0
		w.brushes.unload()
	})
})
