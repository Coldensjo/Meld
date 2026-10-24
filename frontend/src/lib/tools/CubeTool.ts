// The Cubes tool (#31): builds a cube world of the game. A click puts the picked cube (kind, shape
// and turn, editor.cube*) against the face of the cube under the cursor, or removes or replaces that
// cube; Box mode fills (Ctrl: empties) the box between the press and the release. Alt+click copies the
// cube under the cursor. Every press is one History step (CubeChanges), which rebuilds the chunks it
// touched. Nothing changes in the metal layers or outside the world (cubes/edit.ts).
// Object mode (#32) attaches the picked object (editor.cubeObject: a door, window, lever, button,
// teleporter or torch, a torch burning editor.cubeFire, #137) to the face clicked, Ctrl+click removes
// the object there and Shift+click selects it (a selected torch takes the options bar's fire); Link
// mode selects an object with a click and then makes it act on (or stop acting on) each other object
// clicked, Shift+click selecting another. The selected object's links are drawn as lines (ObjectMarks).
// Each attach, removal and link is one History step (cubes/objects.ts editObjects).
// Paint mode (#83) paints the face clicked (or dragged over, on the layer the drag began on) with the
// picked texture (editor.cubeTexture), Shift the whole cube, Ctrl clears the paint; Alt+click picks the
// texture a face shows. A stroke is one History step, its paint undone with its CubeChanges.
// With Blend edges on (editor.cubeBlend, #84), Paint mode instead switches the edge of the face clicked
// nearest the click between fading into the texture beside it and not; a drag sets each edge it passes
// near the way the first click did; Shift blends all four edges of a face, Ctrl none. One History step
// a stroke, as painting.
// Monster mode (#91) puts a spawn point of the picked kind (editor.cubeMonster) in the cell beside the
// face clicked, where a placed cube would go; a drag from a spawn point (its body, or the cell it is in)
// moves it to the cell released over, Ctrl+click removes one, Shift+click adds another to a cube that
// has one, Alt+click picks a spawn point's kind. Each is one History step (cubes/monsters.ts).
// NPC mode (#99) works the same way on NPCs (editor.cubeNpc, one of the game's): a click on an empty cell
// puts the NPC there and selects it, a press on an NPC or a marker of its route selects it and a drag
// moves that point, Shift+click adds the cell to the selected NPC's route (after the route cube last
// pressed, else at its end), Ctrl+click removes the route cube or the NPC, Alt+click picks its name, Del
// removes the selected NPC and Esc deselects. Each is one History step (cubes/npcs.ts).
// Prop mode (#133) places the picked model (editor.cubeProp, one of assets/models) where the cursor meets
// the cubes, its place put on the grid of editor.propSnap metres across, turned editor.propTurn and at
// editor.propScale, shown as a ghost first; a press on a prop's model selects it and a drag moves it,
// R turns it (or the next prop) 15° (Shift the other way), Ctrl+click removes one, Alt+click picks its
// model, turn and scale, Shift+click places another over it, Del removes the selected prop and Esc
// deselects; the options bar's Turn and Scale change the selected prop. Each is one History step
// (cubes/props.ts).
// Mood mode (3dgame #143) paints mood regions: a drag from cell to cell (the cells a placed cube would go
// in) gives the box between them, reaching editor.cubeBoxExtra layers higher, the picked mood
// (editor.cubeMood); Shift+click selects the innermost region at the cell, Ctrl+click removes it,
// Alt+click picks its mood, Del removes the selected one and Esc deselects; the options bar's mood
// changes the selected region. The regions are drawn only in this mode (CubeLayer.moodsShown). Each is
// one History step (cubes/moodRegions.ts).

import * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { CubeChanges, MAX_BOX_CUBES, boxOf, boxSize, chunksAround, editBlock, fillBox, paintChunks } from '../cubes/edit'
import { pickCube, sliceShows, type CubeAt, type CubePick } from '../cubes/pick'
import { BLEND_EDGES, CHUNK_SIZE, FACE_COUNT, FIRE_COLOURS, GROUND_LAYER, KIND_TEXTURE, KINDS, OBJECT_KINDS, SHAPES, TEXTURES, paintFaceOf, withPaintFace, withTexture } from '../cubes/world'
import { CUBE_DIMS, CUBE_HEIGHT, CUBE_SIZE, FACE_NORMALS } from '../cubes/shapes'
import { FACE_WORDS, TELEPORTER, TORCH, attachObject, detachObject, editObjects, objectAt, objectWords, setFireColour, toggleLink } from '../cubes/objects'
import { clearCells } from '../cubes/clip'
import { restoreObjects, snapshotObjects, type ObjectsSnapshot } from '../cubes/objects'
import { editMonsters, monsterBlock, monsterWords, monstersAt, moveMonster, placeMonster, removeMonster } from '../cubes/monsters'
import { monsterKind } from '../cubes/monsterKinds'
import { addRoutePoint, blockedNote, editNpcs, moveNpcPoint, npcAt, npcBlock, npcPointPos, npcWords, placeNpc, removeNpc, removeRoutePoint, routePointAt, type NpcPoint } from '../cubes/npcs'
import { npcLook } from '../cubes/npcNames'
import { layerBottom } from '../cubes/mesher'
import type { CubeLayer } from '../cubes/CubeLayer'
import { copyProps, degrees, editProps, moveProp, placeProp, propBlock, propWords, recordProps, removeProp, shapeProp, wrapTurn } from '../cubes/props'
import type { WorldProp } from '../cubes/world'
import { hasModel, loadPropModel, modelGroup, propModel } from '../cubes/propModels'
import { editRegions, moodRegionAt, paintRegion, regionWords, removeRegion, setRegionMood } from '../cubes/moodRegions'
import { MOODS } from '../engine/moods'

/** How far the cursor reaches into the world, in metres. */
const REACH = 4000

const COLOUR_PLACE = 0x7fe07f
const COLOUR_REMOVE = 0xff5a50
const COLOUR_REPLACE = 0xffd24a
const COLOUR_BLOCKED = 0x8a8a8a

/** What R turns a prop by, in radians. */
const PROP_TURN_STEP = Math.PI / 12

/** The cube the tool puts down, in words. */
export function cubeName(kind = editor.cubeKind, shape = editor.cubeShape, rotation = editor.cubeRotation) {
	const s = SHAPES[shape]
	const turn = s?.turns ? ` turned ${(rotation & 3) * 90}°` : ''
	const flip = s?.flips && rotation & 4 ? ' upside down' : ''
	return `${KINDS[kind]} ${s?.name ?? shape}${turn}${flip}`
}

/** What the cursor is over, by the slice's rules, from the ray the engine set. */
export function pickUnder(ctx: ToolContext, cubes: CubeLayer): CubePick | null {
	const r = ctx.raycaster.ray
	const slice = ui.cubeSlice
	const floor = slice.mode === 'off' ? GROUND_LAYER : slice.layer
	return pickCube(cubes.world, { ox: r.origin.x, oy: r.origin.y, oz: r.origin.z, dx: r.direction.x, dy: r.direction.y, dz: r.direction.z }, sliceShows(slice), REACH, floor, editor.cubeMode === 'paint' || editor.cubeMode === 'prop')
}

/** Where a prop would stand under the cursor: where the ray meets the cubes (or the floor), its x and z put on the grid of `snap` metres (0 for none); null when it meets nothing. */
export function propSpot(ctx: ToolContext, p: CubePick | null, snap = editor.propSnap): { x: number; y: number; z: number } | null {
	if (!p || !(p.t >= 0) || !Number.isFinite(p.t)) return null
	const r = ctx.raycaster.ray
	const on = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v)
	return { x: on(r.origin.x + r.direction.x * p.t), y: r.origin.y + r.direction.y * p.t, z: on(r.origin.z + r.direction.z * p.t) }
}

export class CubeTool implements Tool {
	readonly usesBrush = false
	private preview: THREE.LineSegments | null = null
	private ctrl = false
	/** Shift held: Paint mode paints the whole cube. */
	private shift = false
	/** The press under way: its changes and, for Remove and Replace, the layer the stroke keeps to. */
	private stroke: { changes: CubeChanges; cubes: CubeLayer; layer: number; label: string; objects: ObjectsSnapshot; blendOn?: boolean } | null = null
	/** Box mode's drag: its corners and whether it empties the box. */
	private box: { a: CubeAt; b: CubeAt; empty: boolean; cubes: CubeLayer } | null = null
	/** Monster mode's drag: the spawn point pressed on (its index in CubeWorld.monsters) and the cell it would go to. */
	private monsterDrag: { index: number; to: CubeAt | null; cubes: CubeLayer } | null = null
	/** NPC mode's drag: the point pressed on (an NPC's start or a cube of its route) and the cell it would go to. */
	private npcDrag: { from: NpcPoint; to: CubeAt | null; cubes: CubeLayer } | null = null
	/** NPC mode: the cube of the selected NPC's route that Shift+click adds after (the one last pressed or added); undefined for the end. */
	private routeAfter: number | undefined = undefined
	/** Prop mode's drag: the prop pressed on (its index in CubeWorld.props), the props before it moved, and how far its origin is from the spot pressed. */
	private propDrag: { index: number; before: WorldProp[]; dx: number; dz: number; moved: boolean; cubes: CubeLayer } | null = null
	/** Prop mode's ghost: the model to place, drawn translucent at the cursor, and the name it was made for. */
	private ghost: THREE.Group | null = null
	private ghostModel = ''
	private readonly ghostMaterial = new THREE.MeshBasicMaterial({ color: COLOUR_PLACE, transparent: true, opacity: 0.45, depthWrite: false })
	/** The turn and scale the options bar last showed for the selected prop, so a change there turns or scales it. */
	private shownTurn = NaN
	private shownScale = NaN
	private shownProp: { cubes: CubeLayer; index: number } | null = null
	private readonly propBox = new THREE.Box3()
	private readonly propMatrix = new THREE.Matrix4()
	/** Mood mode's drag: its corner cells. */
	private moodBox: { a: CubeAt; b: CubeAt; cubes: CubeLayer } | null = null
	/** The selected mood region and the mood the options bar last showed for it, so a change there changes it. */
	private shownMood: { cubes: CubeLayer; index: number; mood: string } | null = null
	/** The selected torch and the fire colour the options bar shows for it (syncTorchFire). */
	private shownFire: { cubes: CubeLayer; id: number; colour: number } | null = null

	constructor() {
		// Ctrl turns the outline to removing; the tool lives as long as the engine.
		const track = (e: KeyboardEvent) => {
			this.ctrl = e.ctrlKey || e.metaKey
			this.shift = e.shiftKey
		}
		window.addEventListener('keydown', track)
		window.addEventListener('keyup', track)
		window.addEventListener('blur', () => (this.ctrl = this.shift = false))
	}

	activate(ctx: ToolContext) {
		if (!this.preview) {
			const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5))
			const mat = new THREE.LineBasicMaterial({ color: COLOUR_PLACE, depthTest: false, transparent: true, opacity: 0.9 })
			this.preview = new THREE.LineSegments(geo, mat)
			this.preview.name = 'cube tool preview'
			this.preview.renderOrder = 10
			this.preview.frustumCulled = false
		}
		this.preview.visible = false
		ctx.scene.add(this.preview)
		if (!ctx.cubes) setStatus('The Cubes tool builds in cube worlds: open a .world file or make one (File › New Cube World…).', 5000)
	}

	deactivate(ctx: ToolContext) {
		this.finish(ctx)
		this.box = null
		this.monsterDrag = null
		this.npcDrag = null
		this.moodBox = null
		this.endPropDrag(ctx)
		if (ctx.cubes) ctx.cubes.moodsShown = false
		this.preview?.removeFromParent()
		this.ghost?.removeFromParent()
	}

	onDown(ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
		const cubes = ctx.cubes
		if (!cubes) {
			setStatus('The Cubes tool builds in cube worlds: open a .world file or make one (File › New Cube World…).', 5000)
			return
		}
		this.ctrl = e.ctrlKey || e.metaKey
		const p = pickUnder(ctx, cubes)
		const mode = editor.cubeMode
		if (mode === 'monster') return this.monsterDown(ctx, cubes, p, e)
		if (mode === 'npc') return this.npcDown(ctx, cubes, p, e)
		if (mode === 'prop') return this.propDown(ctx, cubes, p, e)
		if (mode === 'mood') return this.moodDown(ctx, cubes, p, e)
		if (e.altKey) return mode === 'paint' ? this.texturePipette(cubes, p) : this.pipette(cubes, p)
		if (mode === 'paint') {
			const at = p?.cube
			if (!at || p.face < 0) return
			const clear = this.ctrl
			if (editor.cubeBlend) {
				this.stroke = { changes: new CubeChanges(cubes.world), cubes, layer: at.layer, label: 'Blend edges', objects: snapshotObjects(cubes.world) }
				this.blendEdges(ctx, p, e.shiftKey, clear)
				return
			}
			const label = clear ? 'Clear paint' : `Paint ${cubes.world.textureName(editor.cubeTexture)}`
			this.stroke = { changes: new CubeChanges(cubes.world), cubes, layer: at.layer, label, objects: snapshotObjects(cubes.world) }
			this.paint(at, p.face, e.shiftKey, clear)
			return
		}
		if (mode === 'object') return this.objectClick(ctx, cubes, p, e)
		if (mode === 'link') return this.linkClick(ctx, cubes, p, e)
		if (mode === 'box') {
			const a = this.ctrl ? p?.cube : p?.place
			if (!a) return
			this.box = { a, b: a, empty: this.ctrl, cubes }
			return
		}
		const removing = mode === 'remove' || (mode === 'place' && this.ctrl)
		const label = removing ? 'Remove cubes' : mode === 'replace' ? 'Replace cubes' : `Place ${cubeName()}`
		const at = removing || mode === 'replace' ? p?.cube : p?.place
		if (!at) return
		this.stroke = { changes: new CubeChanges(cubes.world), cubes, layer: at.layer, label, objects: snapshotObjects(cubes.world) }
		this.apply(at, removing)
	}

	onMove(ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
		const cubes = ctx.cubes
		if (!cubes) return
		if (this.monsterDrag) {
			this.monsterDrag.to = this.monsterCell(ctx, cubes, pickUnder(ctx, cubes), true)?.at ?? this.monsterDrag.to
			return
		}
		if (this.npcDrag) {
			this.npcDrag.to = pickUnder(ctx, cubes)?.place ?? this.npcDrag.to
			return
		}
		if (this.propDrag) return this.propMove(ctx, cubes)
		if (this.moodBox) {
			const p = pickUnder(ctx, cubes)
			const b = p?.place ?? p?.cube
			if (b) this.moodBox.b = b
			return
		}
		if (this.box) {
			const p = pickUnder(ctx, cubes)
			const b = this.box.empty ? p?.cube : p?.place
			if (b) this.box.b = b
			return
		}
		// Remove, Replace and Paint go over the cubes of the layer the stroke began on; Place puts one cube a click.
		const s = this.stroke
		if (!s || editor.cubeMode === 'place') return
		const p = pickUnder(ctx, cubes)
		const at = p?.cube
		if (!at || at.layer !== s.layer) return
		if (editor.cubeMode === 'paint') {
			if (p.face < 0) return
			if (s.label === 'Blend edges') this.blendEdges(ctx, p, e.shiftKey, this.ctrl)
			else this.paint(at, p.face, e.shiftKey, s.label === 'Clear paint')
		} else this.apply(at, editor.cubeMode === 'remove')
	}

	onUp(ctx: ToolContext) {
		if (this.monsterDrag) return this.monsterUp(ctx)
		if (this.npcDrag) return this.npcUp(ctx)
		if (this.propDrag) return this.endPropDrag(ctx)
		if (this.moodBox) return this.moodUp(ctx)
		if (this.box) {
			const { a, b, empty, cubes } = this.box
			this.box = null
			const box = boxOf(a, b, editor.cubeBoxExtra)
			const n = boxSize(box)
			if (n > MAX_BOX_CUBES) return setStatus(`That box holds ${n} cubes; one fill changes at most ${MAX_BOX_CUBES}.`, 5000)
			const changes = new CubeChanges(cubes.world)
			const objects = snapshotObjects(cubes.world)
			if (empty) {
				fillBox(changes, box, 0)
				clearCells(cubes.world, changes.cells())
			}
			else {
				fillBox(changes, box, editor.cubeKind, editor.cubeShape, editor.cubeRotation)
				if (!editor.cubeKind) clearCells(cubes.world, changes.cells())
			}
			this.stroke = { changes, cubes, layer: -1, label: empty ? 'Empty a box of cubes' : `Fill a box with ${cubeName()}`, objects }
			cubes.rebuild(changes.dirty())
		}
		this.finish(ctx)
	}

	onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
		if (e.ctrlKey || e.metaKey || e.altKey) return false
		// R turns the cube a quarter clockwise, Shift+R turns it upside down.
		if ((e.key === 'r' || e.key === 'R') && editor.cubeMode === 'prop') return this.turnProp(ctx, e.shiftKey ? -PROP_TURN_STEP : PROP_TURN_STEP)
		if (e.key === 'r' || e.key === 'R') {
			editor.cubeRotation = e.shiftKey ? editor.cubeRotation ^ 4 : (editor.cubeRotation & 4) | ((editor.cubeRotation + 1) & 3)
			setStatus(`Cube: ${cubeName()}`, 2000)
			return true
		}
		if (e.key === 'Escape' && (this.box || this.monsterDrag || this.npcDrag || this.moodBox)) {
			this.box = null
			this.monsterDrag = null
			this.npcDrag = null
			this.moodBox = null
			return true
		}
		const cubes = ctx.cubes
		if (e.key === 'Escape' && this.propDrag) {
			const { cubes: c, before } = this.propDrag
			this.propDrag = null
			c.world.props = copyProps(before)
			c.propsChanged()
			return true
		}
		if (editor.cubeMode === 'prop' && cubes && cubes.selectedProp !== null) {
			if (e.key === 'Escape') {
				this.selectProp(cubes, null)
				return true
			}
			if (e.key === 'Delete' || e.key === 'Backspace') {
				const i = cubes.selectedProp
				const p = cubes.world.props[i]
				if (p) this.props(ctx, cubes, `Remove ${p.model}`, () => removeProp(cubes.world, i))
				this.selectProp(cubes, null)
				if (p) setStatus(`Removed ${propWords(p)}.`, 3000)
				return true
			}
		}
		if (editor.cubeMode === 'mood' && cubes && cubes.selectedMood !== null) {
			if (e.key === 'Escape') {
				cubes.selectedMood = null
				return true
			}
			if (e.key === 'Delete' || e.key === 'Backspace') {
				const i = cubes.selectedMood
				const r = cubes.world.moods[i]
				if (r) this.regions(ctx, cubes, `Remove the ${r.mood} region`, () => removeRegion(cubes.world, i))
				cubes.selectedMood = null
				if (r) setStatus(`Removed ${regionWords(r)}.`, 3000)
				return true
			}
		}
		if (editor.cubeMode === 'npc' && cubes && cubes.selectedNpc !== null) {
			if (e.key === 'Escape') {
				cubes.selectedNpc = null
				return true
			}
			if (e.key === 'Delete' || e.key === 'Backspace') {
				const i = cubes.selectedNpc
				const n = cubes.world.npcs[i]
				if (n) this.npcs(ctx, cubes, `Remove ${n.name}`, () => removeNpc(cubes.world, i))
				cubes.selectedNpc = null
				if (n) setStatus(`Removed ${npcWords(n)}.`, 3000)
				return true
			}
		}
		if ((editor.cubeMode === 'object' || editor.cubeMode === 'link') && cubes && cubes.selectedObject !== null) {
			if (e.key === 'Escape') {
				cubes.selectedObject = null
				return true
			}
			if (e.key === 'Delete' || e.key === 'Backspace') {
				const id = cubes.selectedObject
				const o = cubes.world.objects.find((it) => it.id === id)
				if (o) this.objects(ctx, cubes, `Remove ${OBJECT_KINDS[o.kind]}`, () => detachObject(cubes.world, id))
				cubes.selectedObject = null
				if (o) setStatus(`Removed ${objectWords(o)}.`, 3000)
				return true
			}
		}
		return false
	}

	frame(ctx: ToolContext) {
		const v = this.preview
		if (!v) return
		const cubes = ctx.cubes
		if (this.ghost) this.ghost.visible = false
		if (cubes && editor.cubeMode === 'prop') this.syncPropShape(ctx, cubes)
		if (cubes) cubes.moodsShown = editor.cubeMode === 'mood'
		if (cubes && editor.cubeMode === 'mood') this.syncRegionMood(ctx, cubes)
		if (cubes && editor.cubeMode === 'object') this.syncTorchFire(ctx, cubes)
		if (!cubes || !ctx.pointerInside()) {
			v.visible = false
			return
		}
		if (this.box) {
			const b = boxOf(this.box.a, this.box.b, editor.cubeBoxExtra)
			this.show(v, b.x0, b.z0, b.bottom, b.x1 - b.x0 + 1, b.z1 - b.z0 + 1, b.bottom - b.top + 1, boxSize(b) > MAX_BOX_CUBES ? COLOUR_BLOCKED : this.box.empty ? COLOUR_REMOVE : COLOUR_PLACE)
			return
		}
		if (this.moodBox) {
			const b = boxOf(this.moodBox.a, this.moodBox.b, editor.cubeBoxExtra)
			this.show(v, b.x0, b.z0, b.bottom, b.x1 - b.x0 + 1, b.z1 - b.z0 + 1, b.bottom - b.top + 1, COLOUR_PLACE)
			return
		}
		const p = pickUnder(ctx, cubes)
		const mode = editor.cubeMode
		if (mode === 'mood') {
			const i = this.regionUnder(cubes, p)
			const r = i >= 0 ? cubes.world.moods[i] : undefined
			if (r && (this.ctrl || this.shift)) {
				this.show(v, r.min.x, r.min.z, r.max.layer, r.max.x - r.min.x + 1, r.max.z - r.min.z + 1, r.max.layer - r.min.layer + 1, this.ctrl ? COLOUR_REMOVE : COLOUR_REPLACE)
				return
			}
			const at = p?.place ?? p?.cube
			if (!at) {
				v.visible = false
				return
			}
			const b = boxOf(at, at, editor.cubeBoxExtra)
			this.show(v, at.x, at.z, at.layer, 1, 1, b.bottom - b.top + 1, this.ctrl || this.shift ? COLOUR_BLOCKED : COLOUR_PLACE)
			return
		}
		if (mode === 'monster') {
			const drag = this.monsterDrag
			const cell = drag ? (drag.to ? { at: drag.to, index: -1 } : null) : this.monsterCell(ctx, cubes, p, false)
			if (!cell) {
				v.visible = false
				return
			}
			const { at, index } = cell
			const colour = monsterBlock(cubes.world, at) ? COLOUR_BLOCKED : drag ? COLOUR_REPLACE : index >= 0 ? (this.ctrl ? COLOUR_REMOVE : this.shift ? COLOUR_PLACE : COLOUR_REPLACE) : this.ctrl ? COLOUR_BLOCKED : COLOUR_PLACE
			this.show(v, at.x, at.z, at.layer, 1, 1, 1, colour)
			return
		}
		if (mode === 'prop') return this.propFrame(ctx, cubes, v, p)
		if (mode === 'npc') {
			const drag = this.npcDrag
			const cell = drag ? (drag.to ? { at: drag.to, hit: null } : null) : this.npcCell(ctx, cubes, p)
			if (!cell) {
				v.visible = false
				return
			}
			const { at, hit } = cell
			const selected = cubes.selectedNpc !== null && !!cubes.world.npcs[cubes.selectedNpc]
			const colour = npcBlock(cubes.world, at)
				? COLOUR_BLOCKED
				: drag
					? COLOUR_REPLACE
					: this.shift
						? selected
							? COLOUR_PLACE
							: COLOUR_BLOCKED
						: hit
							? this.ctrl
								? COLOUR_REMOVE
								: COLOUR_REPLACE
							: this.ctrl
								? COLOUR_BLOCKED
								: COLOUR_PLACE
			this.show(v, at.x, at.z, at.layer, 1, 1, 1, colour)
			return
		}
		if (mode === 'paint') {
			const at = p?.cube
			if (!at || p.face < 0) {
				v.visible = false
				return
			}
			const colour = editBlock(cubes.world, at.x, at.z, at.layer) ? COLOUR_BLOCKED : this.ctrl ? COLOUR_REMOVE : COLOUR_REPLACE
			if (this.shift) this.show(v, at.x, at.z, at.layer, 1, 1, 1, colour)
			else this.showFace(v, at, p.face, colour)
			return
		}
		if (mode === 'object' || mode === 'link') {
			const at = p?.cube
			if (!at) {
				v.visible = false
				return
			}
			const face = mode === 'object' && editor.cubeObject === TELEPORTER ? 4 : p.face
			const colour = editBlock(cubes.world, at.x, at.z, at.layer) ? COLOUR_BLOCKED : mode === 'link' ? COLOUR_REPLACE : this.ctrl ? COLOUR_REMOVE : COLOUR_PLACE
			if (face < 0) this.show(v, at.x, at.z, at.layer, 1, 1, 1, colour)
			else this.showFace(v, at, face, colour)
			return
		}
		const removing = mode === 'remove' || (this.ctrl && (mode === 'place' || mode === 'box'))
		const at = removing || mode === 'replace' ? p?.cube : p?.place
		if (!at) {
			v.visible = false
			return
		}
		const blocked = !!editBlock(cubes.world, at.x, at.z, at.layer)
		this.show(v, at.x, at.z, at.layer, 1, 1, 1, blocked ? COLOUR_BLOCKED : removing ? COLOUR_REMOVE : mode === 'replace' ? COLOUR_REPLACE : COLOUR_PLACE)
	}

	/** Places the outline over cubes from (x, z) of `layer` (the lowest), w by d cubes and h layers up. */
	private show(v: THREE.LineSegments, x: number, z: number, layer: number, w: number, d: number, h: number, colour: number) {
		const pad = 0.03
		v.position.set(x * CUBE_SIZE - pad, layerBottom(layer) - pad, z * CUBE_SIZE - pad)
		v.scale.set(w * CUBE_SIZE + 2 * pad, h * CUBE_HEIGHT + 2 * pad, d * CUBE_SIZE + 2 * pad)
		;(v.material as THREE.LineBasicMaterial).color.setHex(colour)
		v.visible = true
	}

	/** Places the outline as a thin slab over `face` of cube `at`. */
	private showFace(v: THREE.LineSegments, at: CubeAt, face: number, colour: number) {
		const n = FACE_NORMALS[face]
		const t = 0.12
		const pos = [at.x * CUBE_SIZE, layerBottom(at.layer), at.z * CUBE_SIZE]
		const size: number[] = [...CUBE_DIMS]
		for (let a = 0; a < 3; a++) {
			if (n[a] === 0) continue
			pos[a] += (n[a] > 0 ? CUBE_DIMS[a] : 0) - t / 2
			size[a] = t
		}
		v.position.set(pos[0], pos[1], pos[2])
		v.scale.set(size[0], size[1], size[2])
		;(v.material as THREE.LineBasicMaterial).color.setHex(colour)
		v.visible = true
	}

	/** Object mode: a click attaches the picked object to the face, Ctrl+click removes the object there, Shift+click selects it. */
	private objectClick(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null, e: PointerEvent) {
		const at = p?.cube
		if (!at) return setStatus('Point at a cube to attach an object to.', 3000)
		const world = cubes.world
		if (e.shiftKey || this.ctrl) {
			const o = objectAt(world, at, p.face)
			if (!o) return setStatus('No object on that cube.', 2000)
			if (e.shiftKey) return this.select(cubes, o.id)
			this.objects(ctx, cubes, `Remove ${OBJECT_KINDS[o.kind]}`, () => detachObject(world, o.id))
			if (cubes.selectedObject === o.id) cubes.selectedObject = null
			return setStatus(`Removed ${objectWords(o)}.`, 3000)
		}
		const kind = editor.cubeObject
		const made = this.objects(ctx, cubes, `Attach ${OBJECT_KINDS[kind]}`, () => attachObject(world, kind, at, p.face, editor.cubeFire))
		if (typeof made === 'string') return setStatus(`Not attached: ${made}.`, 4000)
		cubes.selectedObject = made.id
		const next = kind === TELEPORTER ? ' Link mode (or Shift+click in it) leads it to another pad.' : kind === 2 || kind === 3 ? ' Link mode makes it open a door or window.' : ''
		setStatus(`Attached ${objectWords(made)} to the ${FACE_WORDS[made.face]} of the cube.${next}`, 5000)
	}

	/** Link mode: a click selects an object, then each click on another makes the selected one act on it, or stop. */
	private linkClick(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null, e: PointerEvent) {
		const world = cubes.world
		const o = p?.cube ? objectAt(world, p.cube, p.face) : null
		const from = cubes.selectedObject === null ? undefined : world.objects.find((it) => it.id === cubes.selectedObject)
		if (!o) {
			cubes.selectedObject = null
			return setStatus('No object there: click an object to select it, then the objects it should act on.', 3000)
		}
		if (!from || e.shiftKey || from.id === o.id) {
			if (from?.id === o.id) {
				cubes.selectedObject = null
				return setStatus(`Deselected ${objectWords(o)}.`, 2000)
			}
			return this.select(cubes, o.id)
		}
		const r = this.objects(ctx, cubes, 'Link objects', () => toggleLink(world, from.id, o.id))
		if (typeof r === 'string') return setStatus(`Not linked: ${r}.`, 4000)
		setStatus(r.linked ? `${objectWords(from)} now acts on ${objectWords(o)}.` : `${objectWords(from)} no longer acts on ${objectWords(o)}.`, 4000)
	}

	/**
	 * Monster mode's cell under the cursor: the cube of the spawn point whose body the ray meets, else the
	 * cell beside the face clicked (where a cube would be placed), with the last spawn point in it (its
	 * index, -1 for none). With `free` (a drag's target) the body met is ignored, so a spawn point dragged
	 * over another goes into the cell under the cursor.
	 */
	private monsterCell(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null, free: boolean): { at: CubeAt; index: number } | null {
		const world = cubes.world
		const hit = free ? -1 : cubes.marks.monsterHit(ctx.raycaster)
		if (hit >= 0 && world.monsters[hit]) return { at: { ...world.monsters[hit].pos }, index: hit }
		const at = p?.place
		if (!at) return null
		const here = monstersAt(world, at)
		return { at, index: here.length ? here[here.length - 1] : -1 }
	}

	/** Monster mode's press: places, removes, picks or starts dragging a spawn point. */
	private monsterDown(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null, e: PointerEvent) {
		const world = cubes.world
		const cell = this.monsterCell(ctx, cubes, p, false)
		if (!cell) return setStatus('Point at a cube to put a monster on.', 3000)
		const { at, index } = cell
		if (e.altKey) {
			if (index < 0) return setStatus('No monster spawn point there to copy.', 2000)
			editor.cubeMonster = world.monsters[index].kind
			return setStatus(`Picked the monster kind ${editor.cubeMonster}.`, 2000)
		}
		if (this.ctrl) {
			if (index < 0) return setStatus('No monster spawn point there.', 2000)
			const m = world.monsters[index]
			this.monsters(ctx, cubes, `Remove ${m.kind}`, () => removeMonster(world, index))
			return setStatus(`Removed ${monsterWords(m)}.`, 3000)
		}
		if (index >= 0 && !e.shiftKey) {
			this.monsterDrag = { index, to: null, cubes }
			return
		}
		const kind = editor.cubeMonster
		const made = this.monsters(ctx, cubes, `Place ${kind}`, () => placeMonster(world, kind, at))
		if (typeof made === 'string') return setStatus(`No monster placed: ${made}.`, 4000)
		const note = monsterKind(kind) ? '' : ` The game has no monster kind ${kind}: the server will refuse the world.`
		setStatus(`${monsterWords(made)} spawns there (${world.monsters.length} spawn points in the world). Drag it to move it, Ctrl+click removes it.${note}`, 5000)
	}

	/** Monster mode's release after pressing on a spawn point: moves it to the cell released over. */
	private monsterUp(ctx: ToolContext) {
		const drag = this.monsterDrag!
		this.monsterDrag = null
		const { cubes, index, to } = drag
		const world = cubes.world
		const m = world.monsters[index]
		if (!m) return
		const from = m.pos
		if (!to || (to.x === from.x && to.z === from.z && to.layer === from.layer)) {
			return setStatus(`${monsterWords(m)}: drag it to move it, Ctrl+click removes it, Shift+click adds another here.`, 4000)
		}
		const moved = this.monsters(ctx, cubes, `Move ${m.kind}`, () => moveMonster(world, index, to))
		if (typeof moved === 'string') return setStatus(`Not moved: ${moved}.`, 4000)
		setStatus(`Moved the ${moved.kind} to (${to.x}, ${to.z}, layer ${to.layer}).`, 3000)
	}

	/**
	 * NPC mode's cell under the cursor: the cube of the NPC point (a body or a route marker) the ray meets,
	 * else the cell beside the face pointed at (where a cube would be placed), with the point in it: a cube
	 * of the selected NPC's route there, else the last NPC starting there, else none.
	 */
	private npcCell(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null): { at: CubeAt; hit: NpcPoint | null } | null {
		const world = cubes.world
		const hit = cubes.marks.npcHit(ctx.raycaster)
		const pos = hit ? npcPointPos(world, hit) : undefined
		if (hit && pos) return { at: { ...pos }, hit }
		const at = p?.place
		if (!at) return null
		const sel = cubes.selectedNpc
		const r = sel !== null && world.npcs[sel] ? routePointAt(world, sel, at) : -1
		if (r >= 0) return { at, hit: { npc: sel!, point: r } }
		const n = npcAt(world, at)
		return { at, hit: n >= 0 ? { npc: n, point: -1 } : null }
	}

	/** NPC mode's press: places an NPC, adds to or removes from a route, removes or picks an NPC, or starts dragging a point. */
	private npcDown(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null, e: PointerEvent) {
		const world = cubes.world
		const cell = this.npcCell(ctx, cubes, p)
		if (!cell) return setStatus('Point at a cube to put an NPC on.', 3000)
		const { at, hit } = cell
		if (e.altKey) {
			if (!hit) return setStatus('No NPC there to copy.', 2000)
			editor.cubeNpc = world.npcs[hit.npc].name
			return setStatus(`Picked the NPC ${editor.cubeNpc}.`, 2000)
		}
		const sel = cubes.selectedNpc
		if (e.shiftKey) {
			const n = sel === null ? undefined : world.npcs[sel]
			if (sel === null || !n) return setStatus('Select an NPC first (click it), then Shift+click the cubes of its route.', 4000)
			const after = this.routeAfter
			const done = this.npcs(ctx, cubes, `Add to ${n.name}'s route`, () => addRoutePoint(world, sel, at, after))
			if (typeof done === 'string') return setStatus(`Not added: ${done}.`, 4000)
			if (after !== undefined) this.routeAfter = after + 1
			return setStatus(`${n.name}'s route has ${n.route.length} cubes; it walks them in turn and back to its start, straight from each to the next.${blockedNote(world, n)}`, 5000)
		}
		if (this.ctrl) {
			if (!hit) return setStatus('No NPC or route cube there.', 2000)
			const n = world.npcs[hit.npc]
			if (hit.point >= 0) {
				this.npcs(ctx, cubes, `Remove from ${n.name}'s route`, () => removeRoutePoint(world, hit.npc, hit.point))
				this.routeAfter = undefined
				return setStatus(`Removed a cube of ${n.name}'s route (${n.route.length} left).`, 3000)
			}
			this.npcs(ctx, cubes, `Remove ${n.name}`, () => removeNpc(world, hit.npc))
			if (sel !== null) cubes.selectedNpc = sel === hit.npc ? null : sel > hit.npc ? sel - 1 : sel
			return setStatus(`Removed ${npcWords(n)}.`, 3000)
		}
		if (hit) {
			cubes.selectedNpc = hit.npc
			this.routeAfter = hit.point >= 0 ? hit.point : undefined
			this.npcDrag = { from: hit, to: null, cubes }
			return
		}
		const name = editor.cubeNpc
		const made = this.npcs(ctx, cubes, `Place ${name}`, () => placeNpc(world, name, at))
		if (typeof made === 'string') return setStatus(`No NPC placed: ${made}.`, 4000)
		cubes.selectedNpc = world.npcs.length - 1
		this.routeAfter = undefined
		const note = npcLook(name) ? '' : ` The game has no NPC named ${name}: the server will refuse the world.`
		setStatus(`${npcWords(made)} stands there. Shift+click cubes to give it a route, drag it to move it, Ctrl+click removes it.${note}`, 6000)
	}

	/** NPC mode's release after pressing on a point: moves it to the cell released over, else says what it is. */
	private npcUp(ctx: ToolContext) {
		const drag = this.npcDrag!
		this.npcDrag = null
		const { cubes, from, to } = drag
		const world = cubes.world
		const n = world.npcs[from.npc]
		const pos = npcPointPos(world, from)
		if (!n || !pos) return
		const what = from.point < 0 ? n.name : `cube ${from.point + 1} of ${n.name}'s route`
		if (!to || (to.x === pos.x && to.z === pos.z && to.layer === pos.layer)) {
			const route = n.route.length ? `a route of ${n.route.length} cubes` : 'no route (it stands)'
			return setStatus(`${what === n.name ? npcWords(n) : what}, ${route}: Shift+click cubes to add to its route, drag to move, Ctrl+click removes.`, 5000)
		}
		const moved = this.npcs(ctx, cubes, `Move ${what}`, () => moveNpcPoint(world, from, to))
		if (typeof moved === 'string') return setStatus(`Not moved: ${moved}.`, 4000)
		setStatus(`Moved ${what} to (${to.x}, ${to.z}, layer ${to.layer}).${blockedNote(world, n)}`, 5000)
	}

	/** The prop under the cursor (its index), when its model is nearer than the cubes the cursor is over; -1 for none. */
	private propUnder(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null): number {
		// The meshes are placed again on the next update, so right after an edit they may name a prop gone.
		if (cubes.propsPending) return -1
		const hit = cubes.props.hit(ctx.raycaster)
		return hit && cubes.world.props[hit.index] && (!p?.cube || hit.t <= p.t + 0.05) ? hit.index : -1
	}

	/** Selects prop `i` (null for none) and shows its turn and scale in the options bar. */
	private selectProp(cubes: CubeLayer, i: number | null) {
		cubes.selectedProp = i
		const p = i === null ? undefined : cubes.world.props[i]
		if (p) {
			editor.propTurn = p.turn
			editor.propScale = p.scale
		}
		this.shownProp = p && i !== null ? { cubes, index: i } : null
		this.shownTurn = editor.propTurn
		this.shownScale = editor.propScale
	}

	/** A change of Turn or Scale in the options bar turns or scales the selected prop, one History step. */
	private syncPropShape(ctx: ToolContext, cubes: CubeLayer) {
		const sel = this.shownProp
		if (!sel || sel.cubes !== cubes || cubes.selectedProp !== sel.index) {
			// Selected another way (an undo, a tab switch): show it without changing it.
			if (cubes.selectedProp !== null && cubes.world.props[cubes.selectedProp]) this.selectProp(cubes, cubes.selectedProp)
			else this.shownProp = null
			return
		}
		if (editor.propTurn === this.shownTurn && editor.propScale === this.shownScale) return
		const p = cubes.world.props[sel.index]
		if (!p) return
		const done = this.props(ctx, cubes, `Turn or scale ${p.model}`, () => shapeProp(cubes.world, sel.index, editor.propTurn, editor.propScale))
		if (typeof done === 'string') setStatus(`Not changed: ${done}.`, 3000)
		this.selectProp(cubes, sel.index)
	}

	/** R in Prop mode: turns the selected prop, else the next one placed, by `by` radians. */
	private turnProp(ctx: ToolContext, by: number): boolean {
		const cubes = ctx.cubes
		const i = cubes?.selectedProp ?? null
		const p = cubes && i !== null ? cubes.world.props[i] : undefined
		if (cubes && p && i !== null) {
			this.props(ctx, cubes, `Turn ${p.model}`, () => shapeProp(cubes.world, i, p.turn + by, p.scale))
			this.selectProp(cubes, i)
			setStatus(`Turned ${p.model} to ${degrees(cubes.world.props[i]?.turn ?? 0)}°.`, 2000)
		} else {
			editor.propTurn = wrapTurn(editor.propTurn + by)
			this.shownTurn = editor.propTurn
			setStatus(`The next prop is turned ${degrees(editor.propTurn)}°.`, 2000)
		}
		return true
	}

	/** Prop mode's press: places a prop, removes or picks one, or selects one and starts dragging it. */
	private propDown(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null, e: PointerEvent) {
		const world = cubes.world
		const under = this.propUnder(ctx, cubes, p)
		if (e.altKey) {
			if (under < 0) return setStatus('No prop there to copy.', 2000)
			const it = world.props[under]
			editor.cubeProp = it.model
			editor.propTurn = it.turn
			editor.propScale = it.scale
			this.shownTurn = it.turn
			this.shownScale = it.scale
			return setStatus(`Picked ${it.model}, turned ${degrees(it.turn)}° at scale ${it.scale}.`, 3000)
		}
		if (this.ctrl) {
			if (under < 0) return setStatus('No prop there.', 2000)
			const it = world.props[under]
			const sel = cubes.selectedProp
			this.props(ctx, cubes, `Remove ${it.model}`, () => removeProp(world, under))
			this.selectProp(cubes, sel === null || sel === under ? null : sel > under ? sel - 1 : sel)
			return setStatus(`Removed ${propWords(it)} (${world.props.length} props in the world).`, 3000)
		}
		if (under >= 0 && !e.shiftKey) {
			const it = world.props[under]
			this.selectProp(cubes, under)
			// The prop keeps where it stands against the spot pressed as it is dragged.
			const spot = propSpot(ctx, p, 0)
			this.propDrag = { index: under, before: copyProps(world.props), dx: spot ? it.x - spot.x : 0, dz: spot ? it.z - spot.z : 0, moved: false, cubes }
			return
		}
		const spot = propSpot(ctx, p)
		if (!spot) return setStatus('Point at the cubes to put a prop on.', 3000)
		const model = editor.cubeProp
		const made = this.props(ctx, cubes, `Place ${model}`, () => placeProp(world, model, spot.x, spot.y, spot.z, editor.propTurn, editor.propScale))
		if (typeof made === 'string') return setStatus(`No prop placed: ${made}.`, 4000)
		this.selectProp(cubes, world.props.length - 1)
		const note = hasModel(model) ? '' : ` The game has no model ${model}: it draws nothing there.`
		setStatus(`${propWords(made)} placed (${world.props.length} props in the world). Drag it to move it, R turns it, Ctrl+click removes it.${note}`, 5000)
	}

	/** Prop mode's drag: moves the prop pressed on to follow the cursor over the cubes, drawn there at once. */
	private propMove(ctx: ToolContext, cubes: CubeLayer) {
		const drag = this.propDrag!
		// The ray must not stop on the prop being moved: pick the cubes only.
		const spot = propSpot(ctx, pickUnder(ctx, cubes), 0)
		if (!spot) return
		const snap = editor.propSnap
		const on = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v)
		const x = on(spot.x + drag.dx)
		const z = on(spot.z + drag.dz)
		const it = cubes.world.props[drag.index]
		if (!it || (it.x === x && it.y === spot.y && it.z === z)) return
		if (typeof moveProp(cubes.world, drag.index, x, spot.y, z) === 'string') return
		drag.moved = true
		cubes.propsChanged()
	}

	/** Ends a prop's drag: its move becomes one History step, or, without a move, says what it is. */
	private endPropDrag(ctx: ToolContext) {
		const drag = this.propDrag
		this.propDrag = null
		if (!drag) return
		const { cubes, index, before } = drag
		const it = cubes.world.props[index]
		if (!it) return
		if (!drag.moved || !recordProps(cubes.world, ctx.history, `Move ${it.model}`, () => cubes.propsChanged(), before)) {
			return setStatus(`${propWords(it)}, turned ${degrees(it.turn)}° at scale ${it.scale}: drag to move it, R turns it, Del or Ctrl+click removes it.`, 5000)
		}
		setStatus(`Moved ${propWords(it)}.`, 3000)
	}

	/** Prop mode's outline and ghost: the prop under the cursor outlined, else the model to place drawn where it would stand. */
	private propFrame(ctx: ToolContext, cubes: CubeLayer, v: THREE.LineSegments, p: CubePick | null) {
		v.visible = false
		if (this.propDrag) return
		const under = this.shift ? -1 : this.propUnder(ctx, cubes, p)
		if (under >= 0) {
			const it = cubes.world.props[under]
			const model = propModel(it.model)
			if (!model) return
			const b = this.propBox.copy(model.bounds).applyMatrix4(cubes.props.placement(it, this.propMatrix))
			v.position.copy(b.min)
			b.getSize(v.scale)
			;(v.material as THREE.LineBasicMaterial).color.setHex(this.ctrl ? COLOUR_REMOVE : COLOUR_REPLACE)
			v.visible = true
			return
		}
		const spot = propSpot(ctx, p)
		const ghost = this.ghostOf(ctx, editor.cubeProp)
		if (!spot || !ghost || this.ctrl) return
		const blocked = !!propBlock(cubes.world, spot.x, spot.y, spot.z)
		this.ghostMaterial.color.setHex(blocked ? COLOUR_BLOCKED : COLOUR_PLACE)
		ghost.position.set(spot.x, spot.y, spot.z)
		ghost.rotation.set(0, editor.propTurn, 0)
		ghost.scale.setScalar(editor.propScale)
		ghost.visible = true
	}

	/** The ghost of model `name`, made once it is loaded (null until then, or when it cannot be). */
	private ghostOf(ctx: ToolContext, name: string): THREE.Group | null {
		if (this.ghostModel !== name) {
			this.ghost?.removeFromParent()
			this.ghost = null
			const model = propModel(name)
			if (model === undefined) {
				void loadPropModel(name)
				return null
			}
			this.ghostModel = name
			if (!model) return null
			this.ghost = modelGroup(model, this.ghostMaterial)
			this.ghost.name = 'prop ghost'
		}
		if (this.ghost && this.ghost.parent !== ctx.scene) ctx.scene.add(this.ghost)
		return this.ghost
	}

	/** Runs an edit of the world's props as one History step (cubes/props.ts editProps). */
	/** Mood mode's cell under the cursor and the innermost region holding it: the cell a placed cube would go in, else the cube's; -1 for none. */
	private regionUnder(cubes: CubeLayer, p: CubePick | null): number {
		for (const at of [p?.place, p?.cube]) {
			if (!at) continue
			const i = moodRegionAt(cubes.world, at.x, at.z, at.layer)
			if (i >= 0) return i
		}
		return -1
	}

	/** Mood mode's press: selects, removes or picks the mood of the region under the cursor, or starts dragging a new one. */
	private moodDown(ctx: ToolContext, cubes: CubeLayer, p: CubePick | null, e: PointerEvent) {
		const world = cubes.world
		if (e.altKey || this.ctrl || e.shiftKey) {
			const i = this.regionUnder(cubes, p)
			const r = world.moods[i]
			if (!r) {
				if (e.shiftKey) cubes.selectedMood = null
				return setStatus('No mood region there.', 2000)
			}
			if (e.altKey) {
				cubes.selectedMood = null
				editor.cubeMood = r.mood
				return setStatus(`Picked the mood ${r.mood}.`, 2000)
			}
			if (this.ctrl) {
				this.regions(ctx, cubes, `Remove the ${r.mood} region`, () => removeRegion(world, i))
				cubes.selectedMood = null
				return setStatus(`Removed ${regionWords(r)}.`, 3000)
			}
			cubes.selectedMood = i
			return setStatus(`Selected ${regionWords(r)}: the options bar's mood changes it, Del removes it.`, 4000)
		}
		const a = p?.place ?? p?.cube
		if (!a) return
		cubes.selectedMood = null
		this.moodBox = { a, b: a, cubes }
	}

	/** Mood mode's release: gives the box dragged over the picked mood, as a new region, and selects it. */
	private moodUp(ctx: ToolContext) {
		const { a, b, cubes } = this.moodBox!
		this.moodBox = null
		const mood = editor.cubeMood
		const made = this.regions(ctx, cubes, `Paint the ${mood} region`, () => paintRegion(cubes.world, mood, boxOf(a, b, editor.cubeBoxExtra)))
		if (typeof made === 'string') return setStatus(`No region painted: ${made}.`, 3000)
		cubes.selectedMood = cubes.world.moods.length - 1
		const note = MOODS.raw.has(mood) ? '' : ` The game has no mood ${mood}: it keeps the layer's there.`
		setStatus(`Painted ${regionWords(made)}.${note}`, 4000)
	}

	/** A change of the options bar's mood while a region is selected gives it that mood, one History step. */
	private syncRegionMood(ctx: ToolContext, cubes: CubeLayer) {
		const i = cubes.selectedMood
		const r = i === null ? undefined : cubes.world.moods[i]
		if (!r || i === null) {
			this.shownMood = null
			return
		}
		const s = this.shownMood
		if (!s || s.cubes !== cubes || s.index !== i || s.mood !== r.mood) {
			// Selected (or changed by an undo, or another tab): show its mood without changing it.
			this.shownMood = { cubes, index: i, mood: r.mood }
			if (editor.cubeMood !== r.mood) editor.cubeMood = r.mood
			return
		}
		if (editor.cubeMood === s.mood) return
		const mood = editor.cubeMood
		this.regions(ctx, cubes, `Give a region the mood ${mood}`, () => setRegionMood(cubes.world, i, mood))
		s.mood = cubes.world.moods[i]?.mood ?? mood
	}

	/**
	 * Object mode with a torch selected: selecting it shows its fire in the options bar (and picks the
	 * torch there), and a change of the bar's fire colour then gives the torch that colour, one
	 * History step.
	 */
	private syncTorchFire(ctx: ToolContext, cubes: CubeLayer) {
		const id = cubes.selectedObject
		const o = id === null ? undefined : cubes.world.objects.find((it) => it.id === id)
		if (!o || o.kind !== TORCH) {
			this.shownFire = null
			return
		}
		const colour = o.colour ?? 0
		const s = this.shownFire
		if (!s || s.cubes !== cubes || s.id !== o.id || s.colour !== colour) {
			// Selected (or changed by an undo): show its fire without changing it.
			this.shownFire = { cubes, id: o.id, colour }
			if (editor.cubeObject !== TORCH) editor.cubeObject = TORCH
			if (editor.cubeFire !== colour) editor.cubeFire = colour
			return
		}
		if (editor.cubeObject !== TORCH || editor.cubeFire === s.colour) return
		const fire = editor.cubeFire
		this.objects(ctx, cubes, `Make ${objectWords(o)} burn ${FIRE_COLOURS[fire]}`, () => setFireColour(cubes.world, o.id, fire))
		s.colour = o.colour ?? 0
	}

	private regions<T>(ctx: ToolContext, cubes: CubeLayer, label: string, edit: () => T): T {
		return editRegions(cubes.world, ctx.history, label, () => cubes.moodsChanged(), edit)
	}

	private props<T>(ctx: ToolContext, cubes: CubeLayer, label: string, edit: () => T): T {
		return editProps(cubes.world, ctx.history, label, () => cubes.propsChanged(), edit)
	}

	/** Runs an edit of the world's NPCs as one History step (cubes/npcs.ts editNpcs). */
	private npcs<T>(ctx: ToolContext, cubes: CubeLayer, label: string, edit: () => T): T {
		return editNpcs(cubes.world, ctx.history, label, () => cubes.objectsChanged(), edit)
	}

	/** Runs an edit of the world's monster spawn points as one History step (cubes/monsters.ts editMonsters). */
	private monsters<T>(ctx: ToolContext, cubes: CubeLayer, label: string, edit: () => T): T {
		return editMonsters(cubes.world, ctx.history, label, () => cubes.objectsChanged(), edit)
	}

	/** Selects object `id`, so its links are drawn, and says what it acts on. */
	private select(cubes: CubeLayer, id: number) {
		cubes.selectedObject = id
		const o = cubes.world.objects.find((it) => it.id === id)
		if (!o) return
		const word = (t: number) => {
			const it = cubes.world.objects.find((x) => x.id === t)
			return it ? objectWords(it) : `object ${t}`
		}
		const acts = o.targets.length ? `acts on ${o.targets.map(word).join(', ')}` : 'acts on nothing'
		setStatus(`Selected ${objectWords(o)}: it ${acts}. Delete removes it, Esc deselects.`, 5000)
	}

	/** Runs an edit of the world's objects or groups as one History step (cubes/objects.ts editObjects). */
	private objects<T>(ctx: ToolContext, cubes: CubeLayer, label: string, edit: () => T): T {
		return editObjects(cubes.world, ctx.history, label, () => cubes.objectsChanged(), edit)
	}

	/** Changes one cube in the stroke under way and rebuilds its chunks; says why when it cannot. */
	private apply(at: CubeAt, removing: boolean) {
		const s = this.stroke!
		const why = editBlock(s.cubes.world, at.x, at.z, at.layer)
		if (why) return setStatus(`No cubes change ${why}.`, 3000)
		const changed = removing ? s.changes.set(at.x, at.z, at.layer, 0) : s.changes.set(at.x, at.z, at.layer, editor.cubeKind, editor.cubeShape, editor.cubeRotation)
		// A cube emptied loses its objects and its group; one replaced by another cube keeps them.
		if (changed && !s.cubes.world.get(at.x, at.z, at.layer).kind) clearCells(s.cubes.world, [at])
		if (changed) s.cubes.rebuild(chunksAround(s.cubes.world, at.x, at.z, at.layer))
	}

	/**
	 * Paint mode: paints `face` of cube `at` (every face with `whole`) with the picked texture, or clears
	 * it, in the stroke under way, and rebuilds its chunk; says why when it cannot.
	 */
	private paint(at: CubeAt, face: number, whole: boolean, clear: boolean) {
		const s = this.stroke!
		const world = s.cubes.world
		const why = editBlock(world, at.x, at.z, at.layer)
		if (why) return setStatus(`Nothing is painted ${why}.`, 3000)
		const texture = clear ? 0 : editor.cubeTexture
		let paint = world.paintOf(at.x, at.z, at.layer)
		if (whole) for (let f = 0; f < FACE_COUNT; f++) paint = withTexture(paint, f, texture)
		else paint = withTexture(paint, face, texture)
		// Paint hides nothing, so only the cube's own chunk changes, and those beside it where an edge blends
		// into what this cube shows (#84).
		if (s.changes.paint(at.x, at.z, at.layer, paint)) s.cubes.rebuild(paintChunks(world, at.x, at.z, at.layer))
	}

	/**
	 * Paint mode with Blend edges (#84): on the face `p` points at, in the stroke under way, blends all
	 * four edges (`all`), none (`none`), or else sets the edge nearest the point to the stroke's state,
	 * which the first click takes from switching that edge; rebuilds the cube's chunk. Says why when it
	 * cannot.
	 */
	private blendEdges(ctx: ToolContext, p: CubePick, all: boolean, none: boolean) {
		const s = this.stroke!
		const at = p.cube!
		const world = s.cubes.world
		const why = editBlock(world, at.x, at.z, at.layer)
		if (why) return setStatus(`Nothing blends ${why}.`, 3000)
		const face = p.face
		const blend = world.blendOf(at.x, at.z, at.layer)
		const now = paintFaceOf(blend, face)
		let next: number
		if (all || none) next = none ? 0 : BLEND_EDGES[face]
		else {
			// The point clicked in the cube's unit space, and the face's edge nearest it.
			const r = ctx.raycaster.ray
			const u = [(r.origin.x + r.direction.x * p.t) / CUBE_SIZE - at.x, (r.origin.y + r.direction.y * p.t - layerBottom(at.layer)) / CUBE_HEIGHT, (r.origin.z + r.direction.z * p.t) / CUBE_SIZE - at.z]
			let edge = -1
			let best = Infinity
			for (let e = 0; e < FACE_COUNT; e++) {
				if (!(BLEND_EDGES[face] & (1 << e))) continue
				const n = FACE_NORMALS[e]
				const axis = n[0] ? 0 : n[1] ? 1 : 2
				const d = n[axis] > 0 ? 1 - u[axis] : u[axis]
				if (d < best) {
					best = d
					edge = e
				}
			}
			if (edge < 0) return
			// The first click switches the edge; a drag sets the edges it passes near the same way.
			if (s.blendOn === undefined) s.blendOn = !(now & (1 << edge))
			else if (best > 0.3) return
			next = s.blendOn ? now | (1 << edge) : now & ~(1 << edge)
		}
		if (next === now) return
		if (s.changes.blend(at.x, at.z, at.layer, withPaintFace(blend, face, next))) s.cubes.rebuild([world.chunkKey(Math.floor(at.x / CHUNK_SIZE), Math.floor(at.z / CHUNK_SIZE), at.layer)])
	}

	/** Paint mode's Alt+click: the texture the face under the cursor shows becomes the one painted. */
	private texturePipette(cubes: CubeLayer, p: CubePick | null) {
		if (!p?.cube || p.face < 0) return setStatus('No cube face under the cursor to copy.', 2000)
		const { x, z, layer } = p.cube
		const texture = cubes.world.paintAt(x, z, layer, p.face) || KIND_TEXTURE[cubes.world.get(x, z, layer).kind]
		// An id this editor does not know (3dgame #215) is picked only when the world names it or has its picture (a Tibia texture, #227).
		if (!cubes.world.paintable(texture)) return setStatus(`That face's texture ${texture} is not one this editor knows.`, 3000)
		editor.cubeTexture = texture
		setStatus(`Picked the texture ${cubes.world.textureName(texture)}`, 2000)
	}

	/** Ends the stroke: its changes become one History step. */
	private finish(ctx: ToolContext) {
		const s = this.stroke
		this.stroke = null
		if (!s || !s.changes.size) return
		const { changes, cubes, objects } = s
		const world = cubes.world
		const now = snapshotObjects(world)
		const same = JSON.stringify(now) === JSON.stringify(objects)
		if (!same) cubes.objectsChanged()
		ctx.history.push({
			label: s.label,
			bytes: changes.bytes + (same ? 0 : JSON.stringify(now).length * 8),
			undo: () => {
				cubes.rebuild(changes.undo())
				if (!same) {
					restoreObjects(world, objects)
					cubes.objectsChanged()
				}
			},
			redo: () => {
				cubes.rebuild(changes.redo())
				if (!same) {
					restoreObjects(world, now)
					cubes.objectsChanged()
				}
			},
		})
	}

	/** Alt+click: the cube under the cursor becomes the one the tool puts down. */
	private pipette(cubes: CubeLayer, p: CubePick | null) {
		if (!p?.cube) return setStatus('No cube under the cursor to copy.', 2000)
		const c = cubes.world.get(p.cube.x, p.cube.z, p.cube.layer)
		editor.cubeKind = c.kind
		editor.cubeShape = c.shape
		editor.cubeRotation = c.rotation
		setStatus(`Picked ${cubeName()}`, 2000)
	}
}

