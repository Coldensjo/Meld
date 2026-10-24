// The Select tool in a cube world (#70): a drag from a cube to a cube selects the box between them
// (reaching editor.cubeBoxExtra layers higher), a click one cube. Ctrl+C copies the box's cubes to a
// clipboard kept here, outside any document, so Ctrl+V pastes them into this world or another world
// tab: the box follows the cursor, R turns it a quarter, a click or Enter puts it down. The arrows move
// the selected cubes a column the way the camera faces (a burst of moves is one History step), PgUp and
// PgDn a layer, Delete empties the box and Ctrl+X cuts it (copy, then empty). While pasting, M mirrors
// the clip east to west and Shift+M north to south (mirrorClip). Each change is one History step through CubeChanges whose undo
// and redo rebuild the chunks it touched and put the selection back where it was. The selection is the
// world's own (CubeLayer.selection), so each world tab keeps its own; ui.cubeSelection mirrors the
// active one for the menus and the options bar. J joins the box's cubes into one group (#32) and
// Shift+J splits the groups that reach into it, each one History step; the groups in the box are
// outlined (ObjectMarks). The objects attached to the cubes and their groups go with them (#101), and
// the monster spawn points (#109) and props (#177) in the box: each step records the world's groups,
// objects, spawn points and props before and after with its cubes, so undo puts them back.

import * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { CubeChanges, boxOf, FIRST_METAL_LAYER } from '../cubes/edit'
import { boxAt, boxBlock, boxWords, clipCount, copyBox, emptyBox, mirrorClip, moveBox, moveBoxBy, pasteClip, sameBox, turnClip, type CubeBox, type CubeClip } from '../cubes/clip'
import type { CubeAt } from '../cubes/pick'
import type { CubeLayer } from '../cubes/CubeLayer'
import { CUBE_HEIGHT, CUBE_SIZE } from '../cubes/shapes'
import { layerBottom } from '../cubes/mesher'
import { pickUnder } from './CubeTool'
import { cubesIn, editObjects, groupsIn, joinCubes, restoreObjects, snapshotObjects, splitBox, type ObjectsSnapshot } from '../cubes/objects'

const COLOUR_SELECTED = 0x4ad8ff
const COLOUR_DRAG = 0xffffff
const COLOUR_PASTE = 0x7fe07f
const COLOUR_PASTE_CUT = 0xffa040

/** A run of moves this close together merges into one History step, as the models' nudges do. */
const MOVE_MERGE_MS = 1500

/** The cube outlines' boxes, as CubeTool draws its own. */
function outline(colour: number): THREE.LineSegments {
	const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5))
	const mat = new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.9 })
	const v = new THREE.LineSegments(geo, mat)
	v.renderOrder = 10
	v.frustumCulled = false
	v.visible = false
	return v
}

/** Places an outline round a box of cubes. */
function showBox(v: THREE.LineSegments, b: CubeBox, colour: number, pad = 0.05) {
	v.position.set(b.x0 * CUBE_SIZE - pad, layerBottom(b.bottom) - pad, b.z0 * CUBE_SIZE - pad)
	v.scale.set((b.x1 - b.x0 + 1) * CUBE_SIZE + 2 * pad, (b.bottom - b.top + 1) * CUBE_HEIGHT + 2 * pad, (b.z1 - b.z0 + 1) * CUBE_SIZE + 2 * pad)
	;(v.material as THREE.LineBasicMaterial).color.setHex(colour)
	v.visible = true
}

/** Whether every cube of a box can be changed: inside the world and above the metal layers. */
function boxInside(cubes: CubeLayer, b: CubeBox) {
	const w = cubes.world
	return b.x0 >= 0 && b.z0 >= 0 && b.x1 < w.sizeX && b.z1 < w.sizeZ && b.top >= 0 && b.bottom < FIRST_METAL_LAYER
}

/** Whether a world's groups or objects differ from a copy of them taken before an edit. */
const objectsDiffer = (world: CubeLayer['world'], before: ObjectsSnapshot) => JSON.stringify(snapshotObjects(world)) !== JSON.stringify(before)

export class CubeSelectTool implements Tool {
	readonly usesBrush = false
	private selected: THREE.LineSegments | null = null
	private ghost: THREE.LineSegments | null = null
	/** The drag under way: its corners and the world it is in. */
	private drag: { a: CubeAt; b: CubeAt; cubes: CubeLayer } | null = null
	/** The copied cubes, kept across tabs. */
	clip: CubeClip | null = null
	/** Whether the clip follows the cursor to be put down. */
	pasting = false
	/** Where the paste would go now, from the last frame. */
	private pasteBox: CubeBox | null = null
	/** The run of moves under way, merged into one step. */
	private moves: { cmd: object; changes: CubeChanges; objects: ObjectsSnapshot; cubes: CubeLayer; before: CubeBox | null; time: number } | null = null

	activate(ctx: ToolContext) {
		this.selected ??= outline(COLOUR_SELECTED)
		this.ghost ??= outline(COLOUR_DRAG)
		this.selected.name = 'cube selection'
		this.ghost.name = 'cube selection drag'
		ctx.scene.add(this.selected, this.ghost)
	}

	deactivate(ctx: ToolContext) {
		if (this.drag) this.onUp(ctx)
		// A paste carries over to another world tab (the tool stays), not to another tool or a Meld map.
		this.pasting = false
		this.pasteBox = null
		ui.cubePasting = false
		this.selected?.removeFromParent()
		this.ghost?.removeFromParent()
	}

	onDown(ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
		const cubes = ctx.cubes
		if (!cubes || e.altKey) return
		if (this.pasting) {
			this.frame(ctx)
			this.placePaste(ctx)
			return
		}
		const p = pickUnder(ctx, cubes)
		const a = p?.cube ?? p?.place
		if (!a) return this.deselect(ctx)
		this.drag = { a, b: a, cubes }
	}

	onMove(ctx: ToolContext) {
		const d = this.drag
		if (!d || ctx.cubes !== d.cubes) return
		const p = pickUnder(ctx, d.cubes)
		const b = p?.cube ?? p?.place
		if (b) d.b = b
	}

	onUp(_ctx: ToolContext) {
		const d = this.drag
		this.drag = null
		if (!d) return
		const box: CubeBox = boxOf(d.a, d.b, editor.cubeBoxExtra)
		d.cubes.selection = box
		this.moves = null
		const n = clipCount(copyBox(d.cubes.world, box))
		setStatus(`Selected ${boxWords(box)} cubes (${n} not empty). Ctrl+C copies, Ctrl+X cuts, the arrows and PgUp/PgDn move them, Del empties the box.`, 5000)
		this.publish(d.cubes)
	}

	onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
		const cubes = ctx.cubes
		if (!cubes || e.ctrlKey || e.metaKey) return false
		if (this.pasting) {
			if (e.key === 'r' || e.key === 'R') {
				this.clip = turnClip(this.clip!)
				setStatus(`Paste turned a quarter: ${this.clip.w} × ${this.clip.d} × ${this.clip.h}.`, 2000)
				return true
			}
			if (e.key === 'm' || e.key === 'M') {
				this.mirror(e.shiftKey ? 'z' : 'x')
				return true
			}
			if (e.key === 'Enter') {
				this.placePaste(ctx)
				return true
			}
			if (e.key === 'Escape') {
				this.cancelPaste()
				return true
			}
		}
		if (this.drag && e.key === 'Escape') {
			this.drag = null
			return true
		}
		if (!cubes.selection) return false
		const big = e.shiftKey ? 4 : 1
		switch (e.key) {
			case 'ArrowUp':
			case 'ArrowDown':
			case 'ArrowLeft':
			case 'ArrowRight': {
				const [dx, dz] = this.arrowStep(ctx, e.key)
				this.move(ctx, dx * big, dz * big, 0)
				return true
			}
			case 'PageUp':
				this.move(ctx, 0, 0, -big)
				return true
			case 'PageDown':
				this.move(ctx, 0, 0, big)
				return true
			case 'Delete':
			case 'Backspace':
				this.deleteSelection(ctx)
				return true
			case 'Escape':
				this.deselect(ctx)
				return true
			case 'j':
			case 'J':
				if (e.shiftKey) this.split(ctx)
				else this.join(ctx)
				return true
		}
		return false
	}

	/** Joins the selected box's cubes that are not empty into one group (J), taking them out of other groups; one History step. */
	join(ctx: ToolContext) {
		const cubes = ctx.cubes
		const box = cubes?.selection
		if (!cubes || !box) return setStatus('No cubes selected: drag over the cubes to join with the Select tool (V) first.', 4000)
		const world = cubes.world
		const r = editObjects(world, ctx.history, 'Join cubes', () => cubes.objectsChanged(), () => joinCubes(world, cubesIn(world, box)))
		if (typeof r === 'string') return setStatus(`Not joined: ${r}.`, 4000)
		setStatus(`Joined ${r.cubes.length} cubes into group ${r.id}. Shift+J splits it.`, 4000)
	}

	/** Splits every group with a cube in the selected box (Shift+J); one History step. */
	split(ctx: ToolContext) {
		const cubes = ctx.cubes
		const box = cubes?.selection
		if (!cubes || !box) return setStatus('No cubes selected: drag over joined cubes with the Select tool (V) first.', 4000)
		const world = cubes.world
		if (!groupsIn(world, box).length) return setStatus('No joined cubes in the selected box.', 3000)
		const n = editObjects(world, ctx.history, 'Split cubes', () => cubes.objectsChanged(), () => splitBox(world, box))
		setStatus(`Split ${n} group${n === 1 ? '' : 's'}.`, 3000)
	}

	frame(ctx: ToolContext) {
		const sel = this.selected
		const ghost = this.ghost
		if (!sel || !ghost) return
		const cubes = ctx.cubes
		this.publish(cubes)
		if (!cubes) {
			sel.visible = ghost.visible = false
			return
		}
		if (cubes.selection) showBox(sel, cubes.selection, COLOUR_SELECTED)
		else sel.visible = false
		ghost.visible = false
		if (this.drag && this.drag.cubes === cubes) {
			showBox(ghost, boxOf(this.drag.a, this.drag.b, editor.cubeBoxExtra), COLOUR_DRAG, 0.08)
		} else if (this.pasting && this.clip) {
			const at = ctx.pointerInside() ? pickUnder(ctx, cubes)?.place : null
			if (at) {
				const c = this.clip
				this.pasteBox = boxAt(at.x - Math.floor((c.w - 1) / 2), at.z - Math.floor((c.d - 1) / 2), at.layer, c.w, c.d, c.h)
			}
			if (this.pasteBox) showBox(ghost, this.pasteBox, boxInside(cubes, this.pasteBox) ? COLOUR_PASTE : COLOUR_PASTE_CUT, 0.08)
		}
	}

	/** Whether the arrows move the selection rather than the camera. */
	movesWithArrows(ctx: ToolContext) {
		return !!ctx.cubes?.selection || this.pasting
	}

	/** Copies the selected box's cubes to the clipboard (Ctrl+C). */
	copy(ctx: ToolContext): boolean {
		const cubes = ctx.cubes
		const box = cubes?.selection
		if (!cubes || !box) {
			setStatus('No cubes selected: drag over cubes with the Select tool (V) first.', 4000)
			return false
		}
		const why = boxBlock(box)
		if (why) {
			setStatus(`Nothing copied: ${why}.`, 5000)
			return false
		}
		this.clip = copyBox(cubes.world, box)
		ui.hasCubeClip = true
		setStatus(`Copied ${boxWords(box)} cubes (${clipCount(this.clip)} not empty). Ctrl+V pastes them under the cursor, in any world tab.`, 5000)
		return true
	}

	/** The selected box's cubes as a clip (a prefab's, 3dgame #73), or null with the reason in the status bar. */
	selectionClip(ctx: ToolContext): CubeClip | null {
		const cubes = ctx.cubes
		const box = cubes?.selection
		if (!cubes || !box) {
			setStatus('No cubes selected: drag over cubes with the Select tool (V) first.', 4000)
			return null
		}
		const why = boxBlock(box)
		if (why) {
			setStatus(`Not saved: ${why}.`, 5000)
			return null
		}
		const clip = copyBox(cubes.world, box)
		if (!clipCount(clip)) {
			setStatus('The selected box has no cubes to keep.', 4000)
			return null
		}
		return clip
	}

	/** Starts putting the clipboard's cubes down under the cursor (Ctrl+V), or `clip` (a prefab named `name`), which becomes the clipboard. */
	startPaste(clip?: CubeClip, name?: string): boolean {
		if (clip) {
			this.clip = clip
			ui.hasCubeClip = true
		}
		if (!this.clip) {
			setStatus('No cubes copied: select a box of cubes with the Select tool (V) and press Ctrl+C.', 4000)
			return false
		}
		this.drag = null
		this.pasting = true
		this.pasteBox = null
		ui.cubePasting = true
		setStatus(`Click to put ${name ? `"${name}"` : 'the copied cubes'} down · R turns them · M mirrors them (Shift+M the other way) · Enter puts them down · Esc cancels`, 0)
		return true
	}

	/** Mirrors the cubes waiting to be pasted east to west (`x`) or north to south (`z`). */
	mirror(axis: 'x' | 'z') {
		if (!this.pasting || !this.clip) return
		this.clip = mirrorClip(this.clip, axis)
		setStatus(axis === 'x' ? 'Paste mirrored east to west.' : 'Paste mirrored north to south.', 2000)
	}

	/** Copies the selected box and empties it (Ctrl+X): the copy goes to the clipboard, the emptying is one History step. */
	cut(ctx: ToolContext) {
		if (!this.copy(ctx)) return
		this.deleteSelection(ctx)
	}

	cancelPaste() {
		if (!this.pasting) return
		this.pasting = false
		this.pasteBox = null
		ui.cubePasting = false
		setStatus('Paste cancelled.', 2000)
	}

	/** Empties the selected box (Delete), one History step. */
	deleteSelection(ctx: ToolContext) {
		const cubes = ctx.cubes
		const box = cubes?.selection
		if (!cubes || !box) return
		const why = boxBlock(box)
		if (why) return setStatus(`Nothing deleted: ${why}.`, 5000)
		const changes = new CubeChanges(cubes.world)
		const objects = snapshotObjects(cubes.world)
		const n = emptyBox(changes, box)
		if (!n && !objectsDiffer(cubes.world, objects)) return setStatus('The selected box has no cubes to delete.', 3000)
		cubes.rebuild(changes.dirty())
		this.push(ctx, cubes, changes, 'Delete cubes', box, box, objects)
		this.moves = null
		setStatus(`Deleted ${n} cube${n === 1 ? '' : 's'}.`, 3000)
	}

	/** Clears the selection and stops a paste. */
	deselect(ctx: ToolContext) {
		this.cancelPaste()
		this.drag = null
		this.moves = null
		const cubes = ctx.cubes
		if (cubes) cubes.selection = null
		this.publish(cubes)
	}

	/** Moves the selected cubes by dx, dz and dl (positive dl down) and the selection with them; a run of moves is one step. */
	move(ctx: ToolContext, dx: number, dz: number, dl: number) {
		const cubes = ctx.cubes
		const box = cubes?.selection
		if (!cubes || !box) return
		const why = boxBlock(box)
		if (why) return setStatus(`Not moved: ${why}.`, 5000)
		const now = performance.now()
		const m = this.moves
		const going = !!m && m.cubes === cubes && ctx.history.peek() === m.cmd && now - m.time < MOVE_MERGE_MS
		const changes = going ? m.changes : new CubeChanges(cubes.world)
		const before = going ? m.before : box
		const objects = going ? m.objects : snapshotObjects(cubes.world)
		const refused = moveBox(changes, box, dx, dz, dl)
		if (refused) return setStatus(`Not moved: ${refused}.`, 4000)
		const after = moveBoxBy(box, dx, dz, dl)
		cubes.selection = after
		cubes.rebuild(changes.dirty())
		const cmd = this.push(ctx, cubes, changes, 'Move cubes', before, after, objects, going)
		this.moves = { cmd, changes, objects, cubes, before, time: now }
		this.publish(cubes)
	}

	/** The column step (dx, dz) an arrow key means, the way the camera faces, along the nearer axis. */
	private arrowStep(ctx: ToolContext, key: string): [number, number] {
		const yaw = ctx.cameraYaw()
		// As Engine.nudgeSelected: forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw).
		let fx = -Math.sin(yaw)
		let fz = -Math.cos(yaw)
		if (key === 'ArrowDown') [fx, fz] = [-fx, -fz]
		else if (key === 'ArrowRight') [fx, fz] = [-fz, fx]
		else if (key === 'ArrowLeft') [fx, fz] = [fz, -fx]
		return Math.abs(fx) >= Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)]
	}

	/** Puts the clip down where the paste box is, one History step, and selects what was put down. */
	private placePaste(ctx: ToolContext) {
		const cubes = ctx.cubes
		const clip = this.clip
		const box = this.pasteBox
		if (!cubes || !clip) return
		if (!box) return setStatus('Point at the world where the cubes go.', 3000)
		const changes = new CubeChanges(cubes.world)
		const objects = snapshotObjects(cubes.world)
		const r = pasteClip(changes, clip, box)
		this.pasting = false
		this.pasteBox = null
		ui.cubePasting = false
		const before = cubes.selection
		cubes.selection = box
		this.moves = null
		const left = r.refused ? `; ${r.refused} fell outside the world or in the metal layers and were left out` : ''
		if (changes.size || objectsDiffer(cubes.world, objects)) {
			cubes.rebuild(changes.dirty())
			this.push(ctx, cubes, changes, 'Paste cubes', before, box, objects)
		}
		setStatus(`Pasted ${r.placed} cube${r.placed === 1 ? '' : 's'}${left}.`, 4000)
		this.publish(cubes)
	}

	/**
	 * Records changes as one step (or as the step on top, `replace`), its undo and redo putting the
	 * selection back too, and the world's groups and objects as they were (`objects`, taken before the
	 * change) and are now.
	 */
	private push(ctx: ToolContext, cubes: CubeLayer, changes: CubeChanges, label: string, before: CubeBox | null, after: CubeBox | null, objects: ObjectsSnapshot, replace = false) {
		const world = cubes.world
		const now = snapshotObjects(world)
		const same = !objectsDiffer(world, objects)
		// The props too (#177): drawn again, and the selected prop dropped, since its index may have moved.
		const propsSame = JSON.stringify(now.props) === JSON.stringify(objects.props)
		const changed = () => {
			cubes.objectsChanged()
			if (propsSame) return
			cubes.selectedProp = null
			cubes.propsChanged()
		}
		if (!same) changed()
		const cmd = {
			label,
			bytes: changes.bytes + (same ? 0 : JSON.stringify(now).length * 8),
			undo: () => {
				cubes.rebuild(changes.undo())
				if (!same) {
					restoreObjects(world, objects)
					changed()
				}
				cubes.selection = before
			},
			redo: () => {
				cubes.rebuild(changes.redo())
				if (!same) {
					restoreObjects(world, now)
					changed()
				}
				cubes.selection = after
			},
		}
		if (replace) ctx.history.replaceTop(cmd)
		else ctx.history.push(cmd)
		return cmd
	}

	/** Mirrors the active world's selection into ui.cubeSelection when it changed. */
	private publish(cubes: CubeLayer | null) {
		const s = cubes?.selection ?? null
		if (!sameBox(ui.cubeSelection, s)) ui.cubeSelection = s ? { ...s } : null
	}
}

