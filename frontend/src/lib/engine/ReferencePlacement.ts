import * as THREE from 'three'
import { editor, setStatus, ui } from '../state/editor.svelte'
import type { Terrain } from '../terrain/Terrain'
import type { Command } from '../state/history'
import type { MapDocument } from './MapDocument'
import { TerrainStroke } from '../tools/brush'
import { ChunkDataStroke } from '../tools/chunkDataStroke'
import { CHUNK_CELLS } from '../wow/format'
import {
	areasFromImage,
	colourIndices,
	copyReference,
	dragCorner,
	dragTurn,
	fitPlace,
	heightsFromImage,
	maskFromImage,
	refHit,
	sameReference,
	texturesFromImage,
	type RefColour,
	type RefHeightMode,
	type ReferenceImage,
	type ReferencePlace,
} from '../terrain/referenceImage'
import { readReferenceFile, type LoadedReference } from '../io/referenceLoad'

/** What ReferencePlacement needs of the Engine. */
export interface ReferenceHost {
	/** The active tab, whose reference image is drawn and edited. */
	readonly doc: MapDocument
	/** The open tabs: a read that ends after its tab closed is dropped. */
	readonly documents: readonly MapDocument[]
	readonly terrain: Terrain
	readonly history: { push(c: Command): void }
	/** The top-down view's camera. */
	readonly ortho: THREE.OrthographicCamera
	/** The pointer in normalized device coordinates. */
	readonly ndc: THREE.Vector2
	/** The viewport's element, for its size. */
	readonly container: HTMLElement
	/** The 3D view's canvas, whose cursor the placing sets. */
	readonly canvas: HTMLCanvasElement
	/** Whether the view looks straight down. */
	readonly topDown: boolean
	/** Whether a minimap picture is being taken, which leaves the image out. */
	readonly minimapShot: boolean
	/** Sets the heights as one undo step. */
	setHeights(next: Float32Array, label: string): void
	/** Runs `fn` on the paint mask as one undo step. */
	editMask(label: string, fn: (m: Uint8Array) => void): void
}

/**
 * The map's reference image (#184), out of Engine (#558): reading it for a document, its record's
 * undo steps, its drape over the ground each frame, its placing in the top-down view (a corner scales
 * it, a drag moves it, Ctrl+drag turns it) and its conversions into heights, zones, textures and the
 * mask. Engine forwards the public names the Reference Image window and the probes call.
 */
export class ReferencePlacement {
	/** The image's drag in the top-down view: what it holds, where it started and the record before. */
	private drag: { kind: number | 'move' | 'turn'; x0: number; z0: number; before: ReferenceImage } | null = null
	private cursor = ''
	private v = new THREE.Vector3()

	constructor(private host: ReferenceHost) {}

	/** Whether a press started a drag of the image. */
	get dragging(): boolean {
		return this.drag !== null
	}

	/** Drops a drag without recording it (a tab switch). */
	cancelDrag() {
		this.drag = null
	}

	/**
	 * Reads the image at `path` for document `d` (the active one by default), unless it holds it
	 * already. A failed read leaves the map's record as it is and says so. Returns whether it is there.
	 */
	async load(path: string, d: MapDocument = this.host.doc): Promise<boolean> {
		if (d.referenceImage?.path === path) return true
		try {
			const img = await readReferenceFile(path)
			if (!this.host.documents.includes(d)) {
				img.dispose()
				return false
			}
			this.use(img, d)
			return true
		} catch (err) {
			setStatus(`Reference image ${path} not read: ${err}`, 8000)
			return false
		}
	}

	/** Makes `img` document `d`'s reference pixels, freeing the ones it had. */
	use(img: LoadedReference, d: MapDocument = this.host.doc) {
		if (d.referenceImage && d.referenceImage !== img) d.referenceImage.dispose()
		d.referenceImage = img
		if (d !== this.host.doc) return
		ui.referenceUrl = img.url
		ui.referenceVersion++
	}

	/**
	 * Sets the active map's reference record (null removes it) as one undo step named `label`, from
	 * `before` (the record now, unless an interaction already changed it live). Nothing is recorded
	 * when it ends as it began.
	 */
	set(next: ReferenceImage | null, label: string, before: ReferenceImage | null = copyReference(editor.reference)) {
		const after = copyReference(next)
		this.apply(after)
		if (sameReference(before, after)) return
		this.host.history.push({ label, undo: () => this.apply(before), redo: () => this.apply(after) })
	}

	/** Puts a record into `editor`, reading its image when the map doesn't hold that one. */
	private apply(r: ReferenceImage | null) {
		editor.reference = copyReference(r)
		if (r && this.host.doc.referenceImage?.path !== r.path) void this.load(r.path)
	}

	/** The record that lays `img` over the whole map, more than half seen. */
	recordFor(img: LoadedReference): ReferenceImage {
		const place = fitPlace(img.pixels.w, img.pixels.h, this.host.terrain.worldSize)
		return { path: img.path, mode: 'ground', opacity: 0.6, shown: true, ...place }
	}

	/**
	 * Where the screen overlay lies on the ground in the top-down view: the image fitted inside the
	 * viewport (as the overlay's object-fit: contain draws it), its centre and edges unprojected through
	 * the top-down camera. Null outside the top-down view.
	 */
	fromScreen(): ReferencePlace | null {
		const h = this.host
		const img = h.doc.referenceImage
		if (!img || !h.topDown) return null
		const cw = Math.max(1, h.container.clientWidth)
		const ch = Math.max(1, h.container.clientHeight)
		const s = Math.min(cw / img.pixels.w, ch / img.pixels.h)
		// The drawn image's half size as shares of the viewport's half size (NDC).
		const hx = (img.pixels.w * s) / cw
		const hy = (img.pixels.h * s) / ch
		const at = (x: number, y: number): [number, number] => {
			this.v.set(x, y, 0).unproject(h.ortho)
			return [this.v.x, this.v.z]
		}
		const [cx, cz] = at(0, 0)
		const [rx, rz] = at(hx, 0)
		// NDC's y runs up the screen, the image's rows down it.
		const [bx, bz] = at(0, -hy)
		return { x: cx, z: cz, w: 2 * Math.hypot(rx - cx, rz - cz), h: 2 * Math.hypot(bx - cx, bz - cz), turn: Math.atan2(rz - cz, rx - cx) }
	}

	/** The corner handles' half size while placing, in world units: about 7 pixels of the top-down view. */
	private handle(): number {
		return (7 * 2 * this.host.ortho.top) / Math.max(1, this.host.container.clientHeight)
	}

	/** Whether the reference image is being placed in the view now. */
	private placing(): boolean {
		const r = editor.reference
		return ui.referenceAdjust && this.host.topDown && !this.host.minimapShot && !!r && r.mode === 'ground'
	}

	/** Drapes the active map's reference image, or not, each frame. */
	update() {
		const r = editor.reference
		const img = this.host.doc.referenceImage
		const show = !!r && r.mode === 'ground' && !this.host.minimapShot && r.shown && !!img && img.path === r.path
		const placing = this.placing()
		this.host.terrain.setReference(show ? img!.texture : null, show ? r!.opacity : 0, show || placing ? r : null, placing ? this.handle() : 0)
	}

	/** The ground point under the pointer in the top-down view (straight down, so any height will do). */
	private topDownPoint(): [number, number] {
		this.v.set(this.host.ndc.x, this.host.ndc.y, 0).unproject(this.host.ortho)
		return [this.v.x, this.v.z]
	}

	/**
	 * A left press while the reference image is being placed: a corner scales it (Shift frees its
	 * shape), the image moves, Ctrl+drag turns it. Every press is taken, so no tool acts meanwhile.
	 */
	press(e: PointerEvent): boolean {
		if (!this.placing()) return false
		const r = editor.reference!
		const [x, z] = this.topDownPoint()
		const hit = refHit(r, x, z, this.handle() * 1.5)
		if (hit === null) return true
		this.drag = { kind: e.ctrlKey ? 'turn' : hit === 'inside' ? 'move' : hit, x0: x, z0: z, before: { ...r } }
		return true
	}

	/** Moves the drag a press started; call only while `dragging`. */
	moveDrag(e: PointerEvent) {
		const d = this.drag!
		const r = editor.reference
		if (!r || !this.host.topDown) {
			this.drag = null
			return
		}
		const [x, z] = this.topDownPoint()
		const b = d.before
		const p: ReferencePlace = d.kind === 'move' ? { x: b.x + x - d.x0, z: b.z + z - d.z0, w: b.w, h: b.h, turn: b.turn } : d.kind === 'turn' ? dragTurn(b, d.x0, d.z0, x, z) : dragCorner(b, d.kind, x, z, !e.shiftKey)
		r.x = p.x
		r.z = p.z
		r.w = p.w
		r.h = p.h
		r.turn = p.turn
	}

	/** Ends the drag as one undo step. */
	endDrag() {
		const d = this.drag
		this.drag = null
		if (d) this.set(editor.reference, d.kind === 'move' ? 'Move reference image' : d.kind === 'turn' ? 'Turn reference image' : 'Scale reference image', d.before)
	}

	/** The cursor over the image while placing it: a corner, the image, or the default. */
	hover() {
		let cursor = ''
		if (this.placing()) {
			const [x, z] = this.topDownPoint()
			const hit = refHit(editor.reference!, x, z, this.handle() * 1.5)
			cursor = hit === null ? '' : hit === 'inside' ? 'move' : 'nwse-resize'
		}
		if (cursor === this.cursor) return
		this.cursor = cursor
		this.host.canvas.style.cursor = cursor
	}

	/** The image and its record when both are there for a conversion, or null after saying why. */
	private source(): { img: LoadedReference; place: ReferenceImage } | null {
		const r = editor.reference
		const img = this.host.doc.referenceImage
		if (!r || !img || img.path !== r.path) {
			setStatus('Choose a reference image first (View › Reference Image).', 4000)
			return null
		}
		return { img, place: r }
	}

	/** Reference image › Heights: its brightness from `min` (black) to `max` (white), set on the ground under it or added to it, one undo step. */
	toHeights(min: number, max: number, mode: RefHeightMode) {
		const src = this.source()
		if (!src) return
		const t = this.host.terrain
		const { next, count } = heightsFromImage(t.heights, t.verts, t.cellSize, src.img.pixels, src.place, min, max, mode)
		if (!count) {
			setStatus('The reference image lies off the map, so no height changed.', 4000)
			return
		}
		this.host.setHeights(next, 'Reference image to heights')
		setStatus(`Set ${count} vertices from the reference image's brightness. Undo reverts it.`, 5000)
	}

	/** Reference image › Zones: each chunk under a colour with a zone takes that zone (most of it wins), one undo step. */
	toZones(colours: RefColour[], areaOf: number[], tolerance: number) {
		const src = this.source()
		if (!src) return
		const t = this.host.terrain
		const stroke = new ChunkDataStroke(t, 'Reference image to zones')
		const n = areasFromImage(t.areaIds, t.paintChunksPerSide, CHUNK_CELLS * t.cellSize, colourIndices(src.img.pixels, colours, tolerance), src.img.pixels, src.place, areaOf)
		t.touchChunkData()
		const cmd = stroke.finish()
		if (cmd) this.host.history.push(cmd)
		setStatus(n ? `Set the zone of ${n} chunks from the reference image. Undo reverts it.` : 'No chunk changed: give a colour a zone, or move the image over the map.', 5000)
	}

	/** Reference image › Textures: the texels under a colour with a texture are painted with it alone, one undo step. */
	toTextures(colours: RefColour[], layerOf: number[], tolerance: number) {
		const src = this.source()
		if (!src) return
		const t = this.host.terrain
		const R = t.splatRes
		const stroke = new TerrainStroke(t, 'Reference image to textures', { splat: true })
		stroke.reserveSplat({ x0: 0, z0: 0, x1: R - 1, z1: R - 1 })
		const r = texturesFromImage(t.weights, t.chunkSlots, R, t.paintChunksPerSide, t.worldSize / R, colourIndices(src.img.pixels, colours, tolerance), src.img.pixels, src.place, layerOf)
		if (r.rect) {
			stroke.touchSplat(r.rect)
			t.markSplatDirty(r.rect)
		}
		const cmd = stroke.finish()
		if (cmd) this.host.history.push(cmd)
		const refused = r.refused ? `; ${r.refused} texels kept theirs, where a chunk had no slot left for another texture` : ''
		setStatus(r.painted ? `Painted ${r.painted} texels from the reference image${refused}. Undo reverts it.` : 'Nothing painted: give a colour a texture, or move the image over the map.', 6000)
	}

	/** Reference image › Mask: the texels under the chosen colours are added to the paint mask, one undo step. */
	toMask(colours: RefColour[], chosen: boolean[], tolerance: number) {
		const src = this.source()
		if (!src) return
		const t = this.host.terrain
		const idx = colourIndices(src.img.pixels, colours, tolerance)
		let count = 0
		this.host.editMask('Reference image to mask', (m) => {
			count = maskFromImage(m, t.splatRes, t.worldSize / t.splatRes, idx, src.img.pixels, src.place, chosen).count
		})
		setStatus(count ? `Added ${count} texels to the mask from the reference image.` : 'Nothing masked: tick a colour, or move the image over the map.', 5000)
	}
}
