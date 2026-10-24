<script lang="ts">
	import * as THREE from 'three'
	import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
	import { onDestroy, onMount, untrack } from 'svelte'
	import { SvelteMap } from 'svelte/reactivity'
	import Modal from './Modal.svelte'
	import { prefs, setStatus } from '../lib/state/editor.svelte'
	import { hasBackend } from '../lib/io/mapio'
	import { ConvertSprite, ListSprites, OpenSprite, OpenSpriteFolder, SaveSpriteModel, SpriteThumb } from '../../wailsjs/go/main/App'
	import type { main } from '../../wailsjs/go/models'

	// Tools › Sprite to 3D Model: a sprite drawn slanted (a Tibia item, such as a pillar, or 2:1
	// isometric) made into a 3D model by internal/spritemodel. On the left a folder's sprites to pick
	// from (the arrow keys step through them); in the middle the model in 3D, and under it the sprite
	// beside the model drawn back from its four sides as the sprite was (the first should match it);
	// on the right how the sprite is read, what was made, and Save .glb. Every change converts again.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	type View = 'drawn' | 'front' | 'side' | 'top'

	let files = $state<main.SpriteFile[]>([])
	let search = $state('')
	let path = $state('')
	let centre = $state(false)
	let centreX = $state(48)
	let centreY = $state(48)
	/** The frame (row) of an outfit sheet read, from 0. */
	let frame = $state(0)
	let busy = $state(false)
	let error = $state('')
	let result = $state<main.SpriteModel | null>(null)
	let turning = $state(true)
	let wire = $state(false)
	let textured = $state(true)
	let showGrid = $state(true)
	let canvas = $state<HTMLCanvasElement>()
	let list = $state<HTMLElement>()
	const thumbs = new SvelteMap<string, string>()

	const shown = $derived.by(() => {
		const q = search.trim().toLowerCase()
		return files.filter((f) => (!prefs.spriteBigOnly || f.width > 32 || f.height > 32) && (!q || (/^\d+$/.test(q) ? String(f.id).startsWith(q) : f.name.toLowerCase().includes(q))))
	})
	const folderName = $derived(prefs.spriteFolder.split(/[\\/]/).filter(Boolean).pop() ?? '')
	const fileName = $derived(path.split(/[\\/]/).pop() ?? '')

	// The 3D view.
	let renderer: THREE.WebGLRenderer | null = null
	let controls: OrbitControls | null = null
	let resize: ResizeObserver | null = null
	let raf = 0
	const scene = new THREE.Scene()
	scene.background = new THREE.Color(0x202024)
	const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100)
	scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x302820, 1.4))
	const sun = new THREE.DirectionalLight(0xffffff, 2.2)
	sun.position.set(-2, 4, -1.5)
	scene.add(sun)
	// Tiles of the game under the model: one unit each, the size a converted tile is.
	const grid = new THREE.GridHelper(5, 5, 0x75757f, 0x3a3a42)
	scene.add(grid)
	let model: THREE.Object3D | null = null
	/** The model's own textures, kept while the view shows it untextured. */
	const maps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>()
	let radius = 1

	onMount(() => {
		if (prefs.spriteFolder && hasBackend()) void listFolder(prefs.spriteFolder)
	})

	$effect(() => {
		if (!canvas || renderer) return
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
		renderer.setPixelRatio(window.devicePixelRatio)
		const fit = () => {
			if (!canvas || !renderer) return
			renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
			camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
			camera.updateProjectionMatrix()
		}
		fit()
		resize = new ResizeObserver(fit)
		resize.observe(canvas)
		camera.position.set(2.2, 2.2, 2.2)
		controls = new OrbitControls(camera, canvas)
		controls.target.set(0, 0.5, 0)
		controls.enableDamping = true
		controls.autoRotateSpeed = 1.5
		// Dragging the view stops it turning, so it stays where it was put.
		controls.addEventListener('start', () => (turning = false))
		const tick = () => {
			raf = requestAnimationFrame(tick)
			if (controls) controls.autoRotate = turning
			controls?.update()
			renderer?.render(scene, camera)
		}
		tick()
	})

	$effect(() => {
		grid.visible = showGrid
	})

	$effect(() => {
		const w = wire
		const t = textured
		void result
		for (const [mat, map] of maps) {
			mat.wireframe = w
			mat.map = t ? map : null
			mat.needsUpdate = true
		}
	})

	onDestroy(() => {
		cancelAnimationFrame(raf)
		clearTimeout(timer)
		dropModel()
		resize?.disconnect()
		controls?.dispose()
		renderer?.dispose()
		observer.disconnect()
	})

	function dropModel() {
		if (!model) return
		scene.remove(model)
		model.traverse((o) => {
			const mesh = o as THREE.Mesh
			if (!mesh.isMesh) return
			mesh.geometry.dispose()
			const mat = mesh.material as THREE.MeshStandardMaterial
			maps.get(mat)?.dispose()
			mat.dispose()
		})
		maps.clear()
		model = null
	}

	function show(glb: string, keepView: boolean) {
		const bytes = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0))
		new GLTFLoader().parse(
			bytes.buffer,
			'',
			(gltf) => {
				dropModel()
				model = gltf.scene
				model.traverse((o) => {
					const mesh = o as THREE.Mesh
					if (!mesh.isMesh) return
					const mat = mesh.material as THREE.MeshStandardMaterial
					maps.set(mat, mat.map)
					mat.wireframe = wire
					if (!textured) mat.map = null
				})
				scene.add(model)
				const box = new THREE.Box3().setFromObject(model)
				radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.3)
				if (!keepView) setView('drawn', box.getCenter(new THREE.Vector3()))
			},
			(err) => (error = `The model did not load: ${err}`),
		)
	}

	/** Puts the camera to look at the model from one side: as the sprite was drawn (from the south-east, above), or square on. */
	function setView(view: View, target = controls?.target.clone() ?? new THREE.Vector3(0, 0.5, 0)) {
		const dir = {
			drawn: new THREE.Vector3(1, 1, 1),
			front: new THREE.Vector3(0, 0.15, 1),
			side: new THREE.Vector3(1, 0.15, 0),
			top: new THREE.Vector3(0.001, 1, 0.001),
		}[view].normalize()
		controls?.target.copy(target)
		camera.position.copy(target).addScaledVector(dir, radius * 3.4)
		controls?.update()
	}

	let seq = 0
	let timer: ReturnType<typeof setTimeout> | undefined
	/** Converts the picked sprite with the options; a later call wins over one still running. */
	async function convert(keepView: boolean) {
		if (!path) return
		const mine = ++seq
		busy = true
		error = ''
		try {
			const r = await ConvertSprite(path, {
				projection: prefs.spriteProjection,
				reading: prefs.spriteReading,
				keepOutline: prefs.spriteOutline,
				scale: 1,
				centre,
				centreX,
				centreY,
				frame,
			})
			if (mine !== seq) return
			result = r
			show(r.glb, keepView)
		} catch (err) {
			if (mine !== seq) return
			result = null
			dropModel()
			error = String(err)
		} finally {
			if (mine === seq) busy = false
		}
	}

	// A new sprite frames the view again; a changed option keeps it, to compare.
	let lastPath = ''
	$effect(() => {
		void [path, prefs.spriteProjection, prefs.spriteReading, prefs.spriteOutline, centre, centreX, centreY, frame]
		untrack(() => {
			const fresh = path !== lastPath
			lastPath = path
			clearTimeout(timer)
			timer = setTimeout(() => void convert(!fresh), fresh ? 60 : 150)
		})
	})

	async function listFolder(dir: string) {
		try {
			files = await ListSprites(dir)
			prefs.spriteFolder = dir
		} catch (err) {
			files = []
			error = String(err)
		}
	}

	async function openFolder() {
		const dir = await OpenSpriteFolder(prefs.spriteFolder)
		if (dir) await listFolder(dir)
	}

	async function openFile() {
		const p = await OpenSprite(prefs.spriteFolder)
		if (!p) return
		const dir = p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')))
		if (dir && dir !== prefs.spriteFolder) await listFolder(dir)
		search = ''
		pick(p)
	}

	function pick(p: string) {
		if (p !== path) frame = 0
		path = p
		// The centre follows the sprite's tile until the user sets it.
		const f = files.find((x) => x.path === p)
		if (f && !centre) {
			centreX = f.width - 16
			centreY = f.height - 16
		}
	}

	/** The arrow keys step through the list. */
	function onListKey(e: KeyboardEvent) {
		const step = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 }[e.key]
		if (!step || !shown.length) return
		e.preventDefault()
		const at = shown.findIndex((f) => f.path === path)
		const next = shown[Math.min(shown.length - 1, Math.max(0, at < 0 ? 0 : at + step))]
		pick(next.path)
		list?.querySelector(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' })
	}

	// The list's pictures load as they scroll into sight.
	const observer = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue
				const p = (e.target as HTMLElement).dataset.path
				observer.unobserve(e.target)
				if (!p || thumbs.has(p)) continue
				thumbs.set(p, '')
				SpriteThumb(p)
					.then((b) => thumbs.set(p, b))
					.catch(() => thumbs.delete(p))
			}
		},
		{ rootMargin: '200px' },
	)
	function lazy(node: HTMLElement) {
		observer.observe(node)
		return { destroy: () => observer.unobserve(node) }
	}

	async function save() {
		if (!result) return
		try {
			const out = await SaveSpriteModel(result.name, result.glb)
			if (out) setStatus(`Saved ${out}`, 6000)
		} catch (err) {
			error = `Save failed: ${err}`
		}
	}

	const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)
	const READING_NAMES: Record<string, string> = { box: 'Box', round: 'Round', wall: 'Wall', cutout: 'Cut-out', hull: 'Hull', outfit: 'Outfit sheet' }
	const readingName = (r: string) => READING_NAMES[r] ?? r
</script>

<Modal title="Sprite to 3D Model" width={1180} {onclose}>
	<div class="bench">
		<section class="browser" aria-label="Sprites">
			<div class="row">
				<button onclick={openFolder} disabled={!hasBackend()} title="List a folder's sprites to pick from">Folder…</button>
				<button onclick={openFile} disabled={!hasBackend()} title="Open one sprite (its folder is listed)">Sprite…</button>
			</div>
			<div class="folder dim" title={prefs.spriteFolder}>{folderName || 'No folder'}{files.length ? ` · ${shown.length} of ${files.length}` : ''}</div>
			<input type="search" placeholder="Item id or name" bind:value={search} />
			<label class="check"><input type="checkbox" bind:checked={prefs.spriteBigOnly} /> Bigger than a tile only</label>
			<div class="thumbs" bind:this={list} role="listbox" aria-label="Sprites" tabindex="0" onkeydown={onListKey}>
				{#each shown as f (f.path)}
					<button class="thumb" class:on={f.path === path} data-path={f.path} use:lazy role="option" aria-selected={f.path === path} title="{f.name} · {f.width} x {f.height}" onclick={() => pick(f.path)}>
						{#if thumbs.get(f.path)}
							<img src="data:image/png;base64,{thumbs.get(f.path)}" alt="" />
						{:else}
							<span class="blank"></span>
						{/if}
						<span class="id">{f.id >= 0 ? f.id : f.name}</span>
					</button>
				{:else}
					<p class="dim empty">{files.length ? 'No sprites match.' : 'Pick a folder of sprites (Tibia item sprites: 1514_item_image.png), or one sprite.'}</p>
				{/each}
			</div>
		</section>

		<section class="stage">
			<div class="viewport">
				<canvas bind:this={canvas}></canvas>
				<div class="tools">
					<button onclick={() => setView('drawn')} title="From the south-east, above, as the sprite was drawn">As drawn</button>
					<button onclick={() => setView('front')} title="From the south">Front</button>
					<button onclick={() => setView('side')} title="From the east">Side</button>
					<button onclick={() => setView('top')} title="From above">Top</button>
					<span class="gap"></span>
					<button class:on={turning} aria-pressed={turning} onclick={() => (turning = !turning)} title="Turn the model (dragging stops it)">Turn</button>
					<button class:on={wire} aria-pressed={wire} onclick={() => (wire = !wire)} title="Show the mesh's triangles">Wire</button>
					<button class:on={textured} aria-pressed={textured} onclick={() => (textured = !textured)} title="Show the sprite's colours">Texture</button>
					<button class:on={showGrid} aria-pressed={showGrid} onclick={() => (showGrid = !showGrid)} title="Show the tiles, one unit each">Grid</button>
				</div>
				{#if !path}
					<div class="hint dim">Pick a sprite on the left. Drag to turn the view, the wheel to zoom.</div>
				{:else if busy}
					<div class="badge">Converting…</div>
				{/if}
			</div>
			<div class="flat">
				<figure>
					<figcaption>Sprite</figcaption>
					<div class="pic">
						{#if result}<img class="sprite" src="data:image/png;base64,{result.sprite}" alt="The sprite" />{/if}
					</div>
				</figure>
				<figure class="grow">
					<figcaption>{result?.reading === 'outfit' ? 'The model drawn facing south, west, north and east' : 'The model drawn the same way, from its four sides'}</figcaption>
					<div class="pic">
						{#if result}<img class="sides" src="data:image/png;base64,{result.sides}" alt="The model from its four sides" />{/if}
					</div>
				</figure>
			</div>
		</section>

		<section class="settings">
			<h3>{fileName || 'No sprite'}</h3>
			<label>
				Drawn as
				<select bind:value={prefs.spriteProjection}>
					<option value="tibia">Tibia (up and to the left)</option>
					<option value="iso">Isometric 2:1</option>
				</select>
			</label>
			<label title="One picture shows no depth: how to guess it. Auto tries Box (or Round), Wall and Cut-out and keeps the one that explains most of the sprite; a sheet of four columns (a creature facing north, east, south and west) it carves from the four views.">
				Read as
				<select bind:value={prefs.spriteReading}>
					<option value="auto">Auto (best fit)</option>
					<option value="box">Box (pillars, crates, furniture)</option>
					<option value="round">Round (columns, trees, rocks)</option>
					<option value="wall">Wall (walls, fences, corners)</option>
					<option value="cutout">Cut-out (statues, one-sided things)</option>
					<option value="hull">Hull (as wide as the picture allows)</option>
					<option value="outfit">Outfit sheet (a creature facing four ways)</option>
				</select>
			</label>
			{#if result && result.frames > 1}
				<label title="The sheet's rows are the frames of the creature's walk">
					Frame
					<select bind:value={frame}>
						{#each Array.from({ length: result.frames }, (_, i) => i) as i (i)}
							<option value={i}>{i + 1} of {result.frames}</option>
						{/each}
					</select>
				</label>
			{/if}
			<label class="check"><input type="checkbox" bind:checked={prefs.spriteOutline} /> Keep the dark outline</label>
			<label class="check" title="Where the thing's axis meets the ground, in the sprite's pixels; unset, the best fit of its tile's centre and where its foot is drawn">
				<input type="checkbox" bind:checked={centre} onchange={() => result && centre && ((centreX = result.centreX), (centreY = result.centreY))} /> Set the centre
			</label>
			{#if centre}
				<div class="row xy">
					<label>x <input type="number" bind:value={centreX} min="0" max={result?.width ?? 1024} /></label>
					<label>y <input type="number" bind:value={centreY} min="0" max={result?.height ?? 1024} /></label>
				</div>
			{/if}

			{#if error}
				<p class="error">{error}</p>
			{:else if result}
				<dl>
					<dt>Read as</dt>
					<dd>{readingName(result.reading)}{result.run ? ` (${result.run})` : ''}</dd>
					<dt>Centre</dt>
					<dd>{result.centreX}, {result.centreY}</dd>
					<dt>Sprite</dt>
					<dd>{result.width} x {result.height}</dd>
					<dt>Size</dt>
					<dd>{result.size.map((n) => n.toFixed(2)).join(' x ')} tiles</dd>
					<dt>Triangles</dt>
					<dd>{result.triangles.toLocaleString()}</dd>
					<dt>Voxels</dt>
					<dd>{result.voxels.toLocaleString()}</dd>
					<dt>Explains</dt>
					<dd title="How much of the sprite the reading draws; the rest became thin plates">{result.covered}% of the sprite</dd>
					<dt>Plates</dt>
					<dd>{result.extra.toLocaleString()} voxels</dd>
					{#if result.scores.length > 1}
						<dt>Tried</dt>
						<dd class="tried">
							{#each result.scores as sc (sc.reading)}
								<span class:chosen={sc.reading === result.reading}>{readingName(sc.reading)} {sc.covered}%</span>
							{/each}
						</dd>
					{/if}
					<dt>File</dt>
					<dd>{kb(result.bytes)}</dd>
				</dl>
			{/if}
			<p class="dim note">
				One picture shows no depth, so it is guessed: a box or round thing the same mirrored both ways, a wall the length of its tile,
				or a cut-out facing you. What a reading leaves out becomes thin plates. If Auto picks badly, choose the reading yourself.
			</p>
		</section>
	</div>
	{#snippet actions()}
		<button onclick={onclose}>Close</button>
		<button class="primary" onclick={save} disabled={!result || busy}>Save .glb…</button>
	{/snippet}
</Modal>

<style>
	.bench {
		display: flex;
		gap: 14px;
		height: min(640px, calc(100 * var(--vh) - 190px));
		min-height: 420px;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
	}
	.browser {
		width: 236px;
		flex: none;
	}
	.row {
		display: flex;
		gap: 6px;
	}
	.row > * {
		flex: 1;
	}
	.folder {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.thumbs {
		flex: 1;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		align-content: start;
		gap: 4px;
		padding: 4px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.thumbs:focus-visible {
		outline: 1px solid var(--accent);
	}
	.thumb {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 3px;
		min-width: 0;
		background: #26262a;
		border: 1px solid transparent;
		border-radius: var(--radius);
	}
	.thumb.on {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 25%, #26262a);
	}
	.thumb img,
	.thumb .blank {
		width: 64px;
		height: 64px;
		object-fit: contain;
		image-rendering: pixelated;
	}
	.thumb .id {
		font-size: 0.85em;
		color: var(--text-dim);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty {
		grid-column: 1 / -1;
		padding: 8px;
	}
	.stage {
		flex: 1;
		min-width: 0;
	}
	.viewport {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
		border-radius: var(--radius);
		cursor: grab;
	}
	.tools {
		position: absolute;
		top: 8px;
		left: 8px;
		right: 8px;
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.tools button {
		padding: 2px 8px;
		background: rgba(30, 30, 34, 0.85);
	}
	.tools button.on {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.tools .gap {
		flex: 1;
	}
	.hint {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}
	.badge {
		position: absolute;
		right: 10px;
		bottom: 10px;
		padding: 2px 8px;
		border-radius: var(--radius);
		background: rgba(30, 30, 34, 0.85);
		pointer-events: none;
	}
	.flat {
		display: flex;
		gap: 10px;
		flex: none;
	}
	figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	figure.grow {
		flex: 1;
		min-width: 0;
	}
	figcaption {
		color: var(--text-dim);
		font-size: 0.9em;
	}
	.pic {
		height: 136px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #303034;
		border-radius: var(--radius);
		padding: 4px;
		min-width: 136px;
	}
	.pic img {
		max-width: 100%;
		max-height: 128px;
		image-rendering: pixelated;
	}
	.sprite {
		width: 128px;
		height: 128px;
		object-fit: contain;
	}
	.sides {
		width: 100%;
		height: 128px;
		object-fit: contain;
	}
	.settings {
		width: 230px;
		flex: none;
		overflow-y: auto;
	}
	h3 {
		margin: 0;
		text-transform: none;
		letter-spacing: normal;
		font-size: 1em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.xy label {
		flex-direction: row;
		align-items: center;
	}
	.xy input {
		width: 100%;
		min-width: 0;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 3px 10px;
		margin: 4px 0 0;
	}
	dt {
		color: var(--text-dim);
	}
	dd {
		margin: 0;
	}
	.tried {
		display: flex;
		flex-direction: column;
	}
	.tried span {
		color: var(--text-dim);
	}
	.tried span.chosen {
		color: var(--text);
	}
	.dim {
		color: var(--text-dim);
	}
	.note {
		font-size: 0.9em;
		margin: auto 0 0;
	}
	.error {
		color: var(--danger-text);
	}
</style>
