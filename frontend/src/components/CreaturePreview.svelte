<script lang="ts">
	import * as THREE from 'three'
	import { onMount } from 'svelte'
	import { buildWowAsset, releaseWowAsset, texturesReady, type ModelAsset } from '../lib/models/assets'
	import { helperGeometry, helperMaterial, isHelper } from '../lib/models/helpers'
	import { fetchMesh } from '../lib/wow/api'
	import { ModelAnimation, modelMesh } from '../lib/world/Animator'
	import { ParticleLayer, PreviewSet } from '../lib/world/ParticleLayer'
	import { prefs } from '../lib/state/editor.svelte'
	import { spawnType } from '../lib/world/spawnInfo'
	import { materialsMove, PREVIEW_SPIN, PreviewRenderer } from '../lib/ui/previewRenderer'

	// A creature shown big and animated, as the creature editor sees it: the model dressed in its look
	// (see wow.Look) playing one of its animations. Drag turns it, the wheel (or Ctrl+wheel) zooms. It
	// has its own renderer (lib/ui/previewRenderer.ts), so the main scene is untouched, which draws only
	// while the model animates, has particles, moving textures or turns (#589). Given a `type` instead,
	// it shows any placeable model (a doodad, a building with its doodad set, a helper shape) the same
	// way (#197).

	interface Props {
		/** The client model path and its look query, as a spawn carries them. */
		model?: string
		look?: string
		/** The AnimationData ID to play; the model's Stand when it has no such loop. */
		anim?: number
		/** A model type (`m2:`, `wmo:`, `helper:`), shown instead of model, look and anim. */
		type?: string
		/** The creature's size in the world (template scale times display scale), or the model's scale. */
		scale: number
		/** Render at the screen's full pixel ratio (the preview window), not the capped one. */
		hq?: boolean
	}
	let { model = '', look = '', anim = 0, type = '', scale, hq = false }: Props = $props()

	let canvas: HTMLCanvasElement | undefined = $state()
	let loading = $state(false)
	let failed = $state('')
	let size = $state<{ h: number; tris: number } | null>(null)

	const view = new PreviewRenderer({ fov: 30, yaw: 0.5, pitch: 0.15, distance: 6, minPitch: -0.3, turn: -1, ownWheel: true, step })
	const { scene, camera } = view
	view.target.set(0, 1, 0)
	const pivot = new THREE.Group()
	let mesh: THREE.Mesh | null = null
	let animation: ModelAnimation | null = null
	/** The asset shown, released (its geometry and own materials, #506) when another replaces it. */
	let shown: ModelAsset | null = null
	/** The shown model's textures or colours move. */
	let moves = false
	/** The model and look shown, to tell a new creature (reframed) from a new animation of the same one. */
	let shownKey = ''
	let spinning = $state(false)
	let loadId = 0
	const start = performance.now()

	scene.add(pivot)
	// A disc for the creature to stand on, a yard per ring, so its size reads.
	const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a414c }))
	const rings = new THREE.PolarGridHelper(1, 8, 1, 48, 0x56606e, 0x4a525e)
	scene.add(ground, rings)
	// The model's particles and ribbons (#200), in a layer of the preview's own, so the main scene's
	// layer never draws this model; texture and colour animation run from the Engine's loop already.
	const unplaced = new PreviewSet()
	const particles = new ParticleLayer(unplaced)
	particles.light.setRGB(0.95, 0.95, 0.95)
	scene.add(particles.group)
	const frustum = new THREE.Frustum()
	const viewProj = new THREE.Matrix4()

	function drop() {
		if (mesh) {
			pivot.remove(mesh)
			unplaced.set(mesh, null)
		}
		if (shown) releaseWowAsset(shown)
		mesh = null
		animation = null
		shown = null
		moves = false
	}

	function step(now: number, dt: number): boolean {
		if (spinning) view.yaw += PREVIEW_SPIN * dt
		animation?.update(now - start)
		view.place()
		camera.updateMatrixWorld()
		frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
		particles.enabled = prefs.particles !== false
		particles.update(null, null, dt, prefs.animations === false ? 0 : now - start, camera, frustum)
		return spinning || animation !== null || moves || (particles.enabled && !!shown && (shown.emitters.length > 0 || shown.ribbons.length > 0))
	}

	async function show(model: string, look: string, anim: number, given: string, scale: number) {
		const id = ++loadId
		failed = ''
		if (!model && !given) {
			drop()
			size = null
			failed = 'This display has no model.'
			view.wake()
			return
		}
		const type = given || spawnType({ model, look, anim })
		loading = true
		try {
			// A helper shape is generated here, with a geometry of its own since the preview disposes what it drew.
			const helper = isHelper(type) ? helperGeometry(type) : null
			helper?.computeBoundingBox()
			const m = helper ? null : await fetchMesh(type.slice(type.indexOf(':') + 1))
			const a: ModelAsset = helper ? { geometry: helper, material: helperMaterial(), bbox: helper.boundingBox!.clone(), ready: true, effects: [], emitters: [], ribbons: [] } : buildWowAsset(m!)
			await texturesReady(a.material)
			if (id !== loadId) {
				releaseWowAsset(a)
				return
			}
			// Another creature (model or look) is framed whole; another animation of the same one keeps the view.
			const key = given || `${model}|${look}`
			const reframe = !mesh || shownKey !== key
			shownKey = key
			drop()
			shown = a
			moves = materialsMove(a)
			// The preview poses its own copy of the bones, so it never moves the scene's instances.
			if (m?.bones && m.boneIdx && m.boneW) animation = new ModelAnimation(a.geometry, m.bones, m.boneIdx, m.boneW)
			mesh = modelMesh(a.geometry, a.material, animation?.skeleton)
			const k = scale > 0 ? scale : 1
			mesh.scale.setScalar(k)
			pivot.add(mesh)
			// Emitters on a bone ride the preview's own pose.
			if (animation) a.anim = animation
			unplaced.set(mesh, a)
			// The box of the model as its pose places it (the bind-pose box can be far off), scaled.
			const box = a.bbox.clone()
			if (animation) {
				animation.update(0)
				animation.posedBounds(a.geometry, box)
				if (box.isEmpty()) box.copy(a.bbox)
			}
			box.min.multiplyScalar(k)
			box.max.multiplyScalar(k)
			const s = box.getSize(new THREE.Vector3())
			const r = Math.max(s.x, s.z) * 0.75 + 0.5
			ground.scale.setScalar(r)
			rings.scale.setScalar(r)
			// The disc goes under the pose's lowest point over its first two seconds, not at the model's
			// origin, which a pose can reach below or stand above, so the creature never sinks through it.
			let floor = box.min.y
			if (animation) {
				const at = new THREE.Box3()
				for (let ms = 250; ms <= 2000; ms += 250) {
					animation.update(ms)
					if (!animation.posedBounds(a.geometry, at).isEmpty()) floor = Math.min(floor, at.min.y * k)
				}
				animation.update(0)
			}
			ground.position.y = floor - 0.01
			rings.position.y = floor - 0.005
			size = { h: s.y, tris: a.geometry.index ? a.geometry.index.count / 3 : 0 }
			if (reframe) {
				// Look a little above the box's middle (the box, not the ground: a model's origin need not be at its feet).
				view.target.set((box.min.x + box.max.x) / 2, box.min.y + s.y * 0.55, (box.min.z + box.max.z) / 2)
				view.setPanRange(box.min.y, box.max.y)
				view.distance = (Math.max(s.y, s.x, s.z) / 2 / Math.tan(THREE.MathUtils.degToRad(15))) * 1.25
				view.pitch = 0.15
				camera.near = view.distance / 200
				camera.far = view.distance * 20
				camera.updateProjectionMatrix()
			}
			view.wake()
		} catch (err) {
			if (id === loadId) failed = `The model could not be loaded: ${err}`
		} finally {
			if (id === loadId) loading = false
		}
	}

	$effect(() => {
		void show(model, look, anim, type, scale)
	})
	// Checking Turn starts the loop again.
	$effect(() => {
		if (spinning) view.wake()
	})

	onMount(() => {
		if (canvas) view.attach(canvas, hq)
		return () => {
			drop()
			particles.dispose()
			ground.geometry.dispose()
			;(ground.material as THREE.Material).dispose()
			rings.dispose()
			view.dispose()
		}
	})
</script>

<div class="preview">
	<div class="view" role="img" aria-label="Creature preview" onpointerdown={view.down} onpointermove={view.move} onpointerup={view.up} onpointercancel={view.up} oncontextmenu={view.contextmenu} onwheel={view.wheel}>
		<canvas bind:this={canvas}></canvas>
		<div class="overlay">
			{#if loading}<span>Loading…</span>{/if}
			{#if failed}<span class="warn">{failed}</span>{/if}
		</div>
		<!-- The press must not reach the view: its pointer capture would take the click from the check (#204). -->
		<label class="spin" onpointerdown={(e) => e.stopPropagation()}><input type="checkbox" bind:checked={spinning} /> Turn</label>
	</div>
	{#if size}
		<p class="dim">{size.h.toFixed(1)} yd tall · {size.tris.toLocaleString()} triangles · drag to turn, right-drag to move up and down, scroll to zoom</p>
	{/if}
</div>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		gap: 6px;
		height: 100%;
		min-height: 0;
	}
	.view {
		position: relative;
		flex: 1;
		min-height: 0;
		border-radius: 4px;
		background: radial-gradient(circle at 50% 35%, var(--preview-glow), var(--preview-edge) 85%);
		overflow: hidden;
		cursor: grab;
	}
	.view:active {
		cursor: grabbing;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
	}
	.overlay {
		position: absolute;
		left: 10px;
		top: 8px;
		font-size: 12px;
		color: var(--text-dim);
		pointer-events: none;
	}
	.warn {
		color: var(--danger-text);
	}
	.spin {
		position: absolute;
		right: 10px;
		bottom: 8px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.dim {
		margin: 0;
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
