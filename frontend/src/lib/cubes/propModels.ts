// The models props are drawn with (#133): the game's glTF models in the repository's assets/models,
// fitted and tinted by its model table, crates/gameplay/models.toml, as the client draws them
// (crates/client props.rs: scale, offset to the ground, facing, tint, bare trees). Vite imports the
// models' URLs (and the one texture the Kenney kit's models name beside them), so the build carries
// them and `make dev` serves them (vite.config.ts lets it reach the folder). A model is loaded once,
// when first drawn, and kept as its parts: a geometry and a matte material each, placed in the
// model's fitted frame, which PropLayer draws instanced and the palette pictures.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { parse } from 'smol-toml'
import tableText from '../../../../../crates/gameplay/models.toml?raw'

const MODEL_FILES = import.meta.glob('../../../../../assets/models/**/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const MODEL_IMAGES = import.meta.glob('../../../../../assets/models/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const ROOT = '../../../../../assets/models/'

/** A model's name from its file's path: its path under assets/models without .glb. */
const nameOf = (path: string) => path.slice(ROOT.length).replace(/\.glb$/, '')

/** Every model's name, sorted (`nature/pine_1`). */
export const MODEL_NAMES: readonly string[] = Object.keys(MODEL_FILES).map(nameOf).sort()

/** Whether the game has a model of this name. */
export function hasModel(name: string): boolean {
	return Object.hasOwn(MODEL_FILES, `${ROOT}${name}.glb`)
}

/** A model's folder (`props/graveyard`), the palette's categories. */
export function modelFolder(name: string): string {
	const i = name.lastIndexOf('/')
	return i < 0 ? '' : name.slice(0, i)
}

/** A model's own name, without its folder, in words (`gravestone cross`). */
export function modelWords(name: string): string {
	return name.slice(name.lastIndexOf('/') + 1).replace(/[-_]/g, ' ')
}

/** As much of a model's entry in models.toml as a prop is drawn by. */
export interface ModelEntry {
	scale: number
	offset: [number, number, number]
	turn: number
	tint: [number, number, number] | null
	bare: boolean
	/** A lamp's light, its height over the origin in the model's own units (props.rs spawn_prop); null for none. */
	light: number | null
}

interface TableRow extends ModelEntry {
	file: string
}

/** Reads models.toml's [[model]] entries (crates/gameplay models.rs), skipping one without a file. */
export function parseModelTable(text: string): TableRow[] {
	const doc = parse(text) as { model?: unknown }
	const rows: TableRow[] = []
	const nums = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x))
	for (const m of (Array.isArray(doc.model) ? doc.model : []) as Record<string, unknown>[]) {
		if (typeof m?.file !== 'string' || !m.file) continue
		rows.push({
			file: m.file,
			scale: typeof m.scale === 'number' && m.scale > 0 ? m.scale : 1,
			offset: nums(m.offset, 3) ? (m.offset as [number, number, number]) : [0, 0, 0],
			turn: typeof m.turn === 'number' && Number.isFinite(m.turn) ? m.turn : 0,
			tint: nums(m.tint, 3) ? (m.tint as [number, number, number]) : null,
			bare: m.bare === true,
			light: typeof m.light === 'number' && Number.isFinite(m.light) ? m.light : null,
		})
	}
	return rows
}

const TABLE = parseModelTable(tableText)
const DEFAULT_ENTRY: ModelEntry = { scale: 1, offset: [0, 0, 0], turn: 0, tint: null, bare: false, light: null }

/** A model's entry as the game picks it: the one with its exact name, else the longest "prefix*" that fits, else the defaults. */
export function modelEntry(name: string, table: readonly TableRow[] = TABLE): ModelEntry {
	let best: TableRow | null = null
	let bestLen = -1
	for (const row of table) {
		if (row.file === name) return row
		if (row.file.endsWith('*')) {
			const prefix = row.file.slice(0, -1)
			if (name.startsWith(prefix) && prefix.length > bestLen) {
				best = row
				bestLen = prefix.length
			}
		}
	}
	return best ?? DEFAULT_ENTRY
}

/** A part of a model: a geometry and its material, placed by `matrix` in the prop's own frame (fitted: offset, scaled and turned). */
export interface ModelPart {
	geometry: THREE.BufferGeometry
	material: THREE.Material
	matrix: THREE.Matrix4
}

/** A loaded model: its parts and their bounds in the prop's own frame. */
export interface PropModel {
	parts: ModelPart[]
	bounds: THREE.Box3
}

const loaded = new Map<string, PropModel | null>()
const loading = new Map<string, Promise<PropModel | null>>()

/** The model `name` if it is loaded (null when it failed or does not exist), undefined while it is not yet. */
export function propModel(name: string): PropModel | null | undefined {
	return loaded.get(name)
}

/** The fitting transform of a model's entry: moved by its offset in its own units, then scaled and turned (props.rs fit). */
export function fitMatrix(e: ModelEntry): THREE.Matrix4 {
	const m = new THREE.Matrix4().makeRotationY(e.turn)
	m.multiply(new THREE.Matrix4().makeScale(e.scale, e.scale, e.scale))
	return m.multiply(new THREE.Matrix4().makeTranslation(e.offset[0], e.offset[1], e.offset[2]))
}

/** A matte copy of a glTF material, tinted (props.rs prepare_model): Lambert, as the cubes are lit. */
function matte(src: THREE.Material, tint: [number, number, number] | null): THREE.Material {
	const s = src as THREE.MeshStandardMaterial
	const m = new THREE.MeshLambertMaterial({
		color: s.color ? s.color.clone() : new THREE.Color(1, 1, 1),
		map: s.map ?? null,
		vertexColors: s.vertexColors,
		transparent: s.transparent,
		opacity: s.opacity,
		alphaTest: s.alphaTest,
		side: s.side,
	})
	if (tint) m.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]))
	m.name = s.name
	return m
}

/** Loads model `name` (once; later calls share it). Resolves null when it does not exist or fails to load. */
export function loadPropModel(name: string): Promise<PropModel | null> {
	const done = loaded.get(name)
	if (done !== undefined) return Promise.resolve(done)
	const pending = loading.get(name)
	if (pending) return pending
	const url = MODEL_FILES[`${ROOT}${name}.glb`]
	if (!url || typeof document === 'undefined') {
		loaded.set(name, null)
		return Promise.resolve(null)
	}
	// The Kenney kit's models name their texture beside them (Textures/colormap.png): give its URL.
	const folder = `${ROOT}${modelFolder(name)}/`
	const manager = new THREE.LoadingManager()
	// The loader resolves it against the model's URL, which the build renames: map what follows that URL's folder.
	const base = url.slice(0, url.lastIndexOf('/') + 1)
	manager.setURLModifier((u) => {
		if (u === url || !u.startsWith(base)) return u
		return MODEL_IMAGES[`${folder}${decodeURIComponent(u.slice(base.length))}`] ?? u
	})
	const entry = modelEntry(name)
	const p = new GLTFLoader(manager)
		.loadAsync(url)
		.then((gltf) => {
			const fit = fitMatrix(entry)
			const root = gltf.scene
			root.updateMatrixWorld(true)
			const parts: ModelPart[] = []
			const mats = new Map<THREE.Material, THREE.Material>()
			const bounds = new THREE.Box3()
			const box = new THREE.Box3()
			root.traverse((o) => {
				const mesh = o as THREE.Mesh
				if (!mesh.isMesh) return
				for (const src of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
					// A bare tree's leaves are hidden (props.rs: the meshes whose material is named Leaves...).
					if (entry.bare && src.name.startsWith('Leaves')) continue
					let mat = mats.get(src)
					if (!mat) mats.set(src, (mat = matte(src, entry.tint)))
					const matrix = fit.clone().multiply(mesh.matrixWorld)
					parts.push({ geometry: mesh.geometry, material: mat, matrix })
					if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
					bounds.union(box.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix))
				}
			})
			const model: PropModel = { parts, bounds }
			loaded.set(name, model)
			return model
		})
		.catch((err: unknown) => {
			console.warn(`prop model ${name}:`, err)
			loaded.set(name, null)
			return null
		})
		.finally(() => loading.delete(name))
	loading.set(name, p)
	return p
}

/** A model as a group of plain meshes (the tool's ghost, the pictures), its materials shared or replaced by `material`. */
export function modelGroup(model: PropModel, material?: THREE.Material): THREE.Group {
	const g = new THREE.Group()
	for (const part of model.parts) {
		const m = new THREE.Mesh(part.geometry, material ?? part.material)
		m.matrixAutoUpdate = false
		m.matrix.copy(part.matrix)
		g.add(m)
	}
	return g
}

// --- pictures for the palette ---------------------------------------------------------------------

const PICTURE = 128
let picRenderer: THREE.WebGLRenderer | null = null
let picScene: THREE.Scene | null = null
let picCamera: THREE.PerspectiveCamera | null = null
const pictures = new Map<string, string>()
const picturing = new Map<string, Promise<string>>()

/**
 * A picture of model `name` for the palette, a data URL ('' when it cannot be drawn), made once and
 * kept: the model seen from the south-east and a little above, on its own small WebGL renderer, so
 * the engine's renderer, its shadows and its state are left alone.
 */
export function modelPicture(name: string): Promise<string> {
	const done = pictures.get(name)
	if (done !== undefined) return Promise.resolve(done)
	const pending = picturing.get(name)
	if (pending) return pending
	const p = loadPropModel(name).then((model) => {
		let url = ''
		try {
			if (model && model.parts.length) url = drawPicture(model)
		} catch (err) {
			console.warn(`prop picture ${name}:`, err)
		}
		pictures.set(name, url)
		picturing.delete(name)
		return url
	})
	picturing.set(name, p)
	return p
}

function drawPicture(model: PropModel): string {
	if (!picRenderer) {
		picRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
		picRenderer.setSize(PICTURE, PICTURE, false)
		picRenderer.setClearColor(0x000000, 0)
		picScene = new THREE.Scene()
		picScene.add(new THREE.HemisphereLight(0xdde4ff, 0x40362c, 2.2))
		const sun = new THREE.DirectionalLight(0xffffff, 2.4)
		sun.position.set(3, 5, 4)
		picScene.add(sun)
		picCamera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000)
	}
	const scene = picScene!
	const camera = picCamera!
	const g = modelGroup(model)
	scene.add(g)
	const sphere = model.bounds.getBoundingSphere(new THREE.Sphere())
	const r = Math.max(sphere.radius, 0.01)
	const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05
	const dir = new THREE.Vector3(1, 0.7, 1.2).normalize()
	camera.position.copy(sphere.center).addScaledVector(dir, dist)
	camera.near = dist / 100
	camera.far = dist * 4
	camera.updateProjectionMatrix()
	camera.lookAt(sphere.center)
	picRenderer!.render(scene, camera)
	const url = picRenderer!.domElement.toDataURL('image/png')
	scene.remove(g)
	return url
}
