<script lang="ts">
	import * as THREE from 'three'
	import { onMount } from 'svelte'
	import { buildWowAsset, releaseWowAsset, texturesReady, type ModelAsset } from '../lib/models/assets'
	import { helperGeometry, helperMaterial, isHelper } from '../lib/models/helpers'
	import { fetchMesh, texturePreview } from '../lib/wow/api'
	import type { SearchItem } from '../lib/wow/search'
	import { materialsMove, PREVIEW_SPIN, PreviewRenderer } from '../lib/ui/previewRenderer'
	import { prefs } from '../lib/state/editor.svelte'

	// A live view of one model or texture: a model shown spins for a few seconds, and while the pointer
	// is over the view, and can be turned by dragging, so an author can tell what a thing is before
	// placing it. It has its own small renderer (lib/ui/previewRenderer.ts), which draws only while the
	// model spins or its textures move (#589), so a still preview costs nothing beside the viewport.

	interface Props {
		item: SearchItem | null
	}
	let { item }: Props = $props()

	let canvas: HTMLCanvasElement | undefined = $state()
	let texUrl = $state('')
	let loading = $state(false)
	let failed = $state(false)
	let info = $state<{ w: number; h: number; d: number; tris: number } | null>(null)

	/** How long a newly shown model spins, in ms. */
	const SPIN_MS = 6000
	/** How long a model turned by a drag holds still before the pointer over it spins it again, in ms. */
	const HOLD_MS = 4000
	const pivot = new THREE.Group()
	let mesh: THREE.Mesh | null = null
	let asset: ModelAsset | null = null
	/** The shown model's textures or colours move, so the view keeps drawing. */
	let moves = false
	/** It spins until then (performance.now()'s ms, as rAF's are). */
	let spinUntil = 0
	/** And not before then, after a drag. */
	let holdUntil = 0
	/** The pointer is over the view. */
	let over = false
	let loadId = 0

	const view = new PreviewRenderer({
		fov: 30,
		yaw: 0.6,
		pitch: 0.35,
		distance: 10,
		minPitch: -0.5,
		turn: 1,
		step,
		ondrag(on) {
			if (on) return
			holdUntil = performance.now() + HOLD_MS
			clearTimeout(resume)
			resume = setTimeout(() => view.wake(), HOLD_MS)
		},
	})
	view.scene.add(pivot)
	let resume: ReturnType<typeof setTimeout> | undefined

	function step(now: number, dt: number): boolean | null {
		if (!mesh) return null
		const spin = !view.dragging && now >= holdUntil && (over || now < spinUntil)
		if (spin) view.yaw += PREVIEW_SPIN * dt
		view.place()
		return spin || moves
	}

	function dropMesh() {
		if (mesh) {
			pivot.remove(mesh)
			mesh = null
		}
		// Its geometry, and the materials of its own, which leave the animated lists (#506).
		if (asset) releaseWowAsset(asset)
		asset = null
		moves = false
	}

	async function show(it: SearchItem | null) {
		const id = ++loadId
		dropMesh()
		texUrl = ''
		failed = false
		info = null
		if (!it) return
		loading = true
		try {
			if (it.kind === 'tex') {
				const u = await texturePreview(it.path, 256)
				if (id === loadId) texUrl = u
				return
			}
			// A helper shape gets a geometry of its own here, since the preview disposes what it drew.
			const helper = isHelper(it.key) ? helperGeometry(it.key) : null
			if (helper) helper.computeBoundingBox()
			const a: ModelAsset = helper ? { geometry: helper, material: helperMaterial(), bbox: helper.boundingBox!.clone(), ready: true, effects: [], emitters: [], ribbons: [] } : buildWowAsset(await fetchMesh(it.path))
			await texturesReady(a.material)
			if (id !== loadId) {
				releaseWowAsset(a)
				return
			}
			asset = a
			moves = materialsMove(a)
			mesh = new THREE.Mesh(a.geometry, a.material)
			pivot.add(mesh)
			const size = a.bbox.getSize(new THREE.Vector3())
			a.bbox.getCenter(view.target)
			view.setPanRange(a.bbox.min.y, a.bbox.max.y)
			const r = Math.max(size.length() / 2, 0.3)
			view.distance = (r / Math.sin(THREE.MathUtils.degToRad(15))) * 0.95
			view.camera.near = view.distance / 100
			view.camera.far = view.distance * 4
			view.camera.updateProjectionMatrix()
			// Tall things are looked at from lower down, flat things from higher up.
			view.pitch = size.y > Math.max(size.x, size.z) * 1.5 ? 0.15 : size.y < Math.max(size.x, size.z) * 0.3 ? 0.8 : 0.35
			info = { w: size.x, h: size.y, d: size.z, tris: a.geometry.index ? a.geometry.index.count / 3 : 0 }
			spinUntil = performance.now() + SPIN_MS
			view.wake()
		} catch {
			if (id === loadId) failed = true
		} finally {
			if (id === loadId) loading = false
		}
	}

	$effect(() => {
		void show(item)
	})

	/** The path without a look query (a weapon's texture), which is noise to a reader. */
	const shownPath = $derived(item ? item.path.split('?')[0] : '')

	onMount(() => {
		if (canvas) view.attach(canvas)
		return () => {
			clearTimeout(resume)
			dropMesh()
			view.dispose()
		}
	})

	function enter() {
		over = true
		view.wake()
	}

	const yards = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1))
</script>

<div class="preview">
	<div
		class="view"
		role="img"
		aria-label="Model preview"
		class:hidden={!item || item.kind === 'tex'}
		onpointerenter={enter}
		onpointerleave={() => (over = false)}
		onpointerdown={view.down}
		onpointermove={view.move}
		onpointerup={view.up}
		onpointercancel={view.up}
		oncontextmenu={view.contextmenu}
		onwheel={view.wheel}
	>
		<canvas bind:this={canvas}></canvas>
	</div>
	{#if item?.kind === 'tex'}
		<div class="tex">
			{#if texUrl}<img src={texUrl} alt="" draggable="false" />{/if}
		</div>
	{/if}
	{#if !item}
		<p class="hint">Hover a tile to see it here. Drag to turn a model, right-drag to move up and down it, scroll to zoom.</p>
	{:else}
		{#if loading}<p class="hint">Loading…</p>{/if}
		{#if failed}<p class="hint">Nothing to show (an effect-only model).</p>{/if}
		<!-- Names off (#655) leaves only the picture: no name, kind, size or path under it. -->
		{#if prefs.browserNames}<div class="details">
				<div class="name" title={shownPath}>{item.name}</div>
				<div class="dim">{item.kind === 'tex' ? 'Texture' : item.kind === 'm2' ? 'Doodad' : 'Building'} · {item.category} · {item.zone}</div>
				{#if info}
					<div class="dim">{yards(info.w)} × {yards(info.d)} yd, {yards(info.h)} yd tall · {info.tris.toLocaleString()} tris</div>
				{/if}
				<div class="path">{shownPath}</div>
			</div>{/if}
	{/if}
</div>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		gap: 6px;
	}
	.view {
		position: relative;
		flex: 1;
		min-height: 0;
		border-radius: 4px;
		background: radial-gradient(circle at 50% 40%, var(--preview-glow), var(--preview-edge) 80%);
		overflow: hidden;
		cursor: grab;
	}
	.view.hidden {
		display: none;
	}
	.view:active {
		cursor: grabbing;
	}
	/* Out of flow, so the canvas's own size never stops the panel from shrinking. */
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.tex {
		flex: 1;
		min-height: 0;
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: var(--bg);
		overflow: hidden;
	}
	.tex img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		image-rendering: auto;
	}
	.hint,
	.dim {
		color: var(--text-dim);
		font-size: 11px;
		margin: 0;
	}
	.details {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
	}
	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.path {
		font: 10px var(--mono);
		color: var(--text-dim);
		word-break: break-all;
		max-height: 28px;
		overflow: hidden;
	}
</style>
