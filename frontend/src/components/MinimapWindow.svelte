<script lang="ts">
	import { editor, prefs, stats, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { shadeHeights } from '../lib/io/minimapImage'

	// A floating minimap over the viewport (M opens and closes it), after noggit's minimap window: the
	// whole map from above, with the client's overview behind it for a part of Azeroth, the tile
	// borders, and the camera's spot and facing. A click moves the camera there. The ground is drawn
	// from the heights (grey by height, blue under the sea) so a new world has a map too; it is
	// redrawn when the heights change, checked with the 2 Hz stats.

	const TILE_CELLS = 128
	let canvas: HTMLCanvasElement | undefined = $state()
	let drawnFor = ''

	/** Redraws the heights when the map or its heights changed. Runs with every stats refresh. */
	$effect(() => {
		const view = stats.view
		const e = engineRef.current
		if (!view || !e || !canvas || !ui.minimap) return
		const t = e.terrain
		const key = `${t.size}|${t.heightsVersion}|${editor.waterEnabled ? editor.waterLevel : 'dry'}`
		if (key === drawnFor) return
		drawnFor = key
		draw(canvas, t.heights, t.size, editor.waterEnabled ? editor.waterLevel : -Infinity)
	})

	function draw(c: HTMLCanvasElement, heights: Float32Array, size: number, sea: number) {
		c.width = size
		c.height = size
		const ctx = c.getContext('2d')
		if (!ctx) return
		const img = ctx.createImageData(size, size)
		shadeHeights(heights, size, sea, img.data)
		ctx.putImageData(img, 0, 0)
	}

	/** The map's tile borders, in cells, as one path; none for a map smaller than a tile. */
	const grid = $derived.by(() => {
		const size = stats.view?.cells ?? 0
		if (size <= TILE_CELLS) return ''
		let p = ''
		for (let i = TILE_CELLS; i < size; i += TILE_CELLS) p += `M${i} 0V${size}M0 ${i}H${size}`
		return p
	})

	/**
	 * Where a click sent the camera, until the next stats refresh (2 Hz) reports it: the marker moves
	 * with the click rather than up to half a second later (#129).
	 */
	let jumped = $state<{ x: number; z: number } | null>(null)
	$effect(() => {
		void stats.view
		jumped = null
	})

	/** The camera's spot and facing as a small arrow in cells. */
	const marker = $derived.by(() => {
		const v = stats.view
		if (!v) return null
		const cs = v.world / Math.max(1, v.cells)
		const x = (jumped?.x ?? v.x) / cs
		const z = (jumped?.z ?? v.z) / cs
		// Facing: the way the camera looks, in map cells (the yaw's forward is (-sin, -cos)).
		const fx = -Math.sin(v.yaw)
		const fz = -Math.cos(v.yaw)
		const len = Math.max(3, v.cells / 24)
		return { x, z, tipX: x + fx * len, tipZ: z + fz * len, size: Math.max(1.5, v.cells / 60) }
	})

	// Light zones (#26): the map's Light.dbc lights, read when shown and when the map changes.
	type Zone = { id: number; x: number; z: number; inner: number; outer: number; global: boolean }
	let zones = $state<Zone[]>([])
	let zonesFor = ''
	$effect(() => {
		const e = engineRef.current
		const key = `${docKey()}`
		if (!prefs.minimapLights || !ui.minimap || !e || key === zonesFor) return
		zonesFor = key
		e.lightZones()
			.then((z) => (zones = z.filter((l) => !l.global)))
			.catch(() => (zones = []))
	})
	/** What tells one open map from another, for re-reading the lights. */
	const docKey = () => `${editor.regionMap}|${editor.regionBlock?.x}|${editor.regionBlock?.y}|${editor.mapName}`
	/** The zones near the block, in cells. */
	const zoneCircles = $derived.by(() => {
		const v = stats.view
		if (!v || !prefs.minimapLights) return []
		const cs = v.world / Math.max(1, v.cells)
		return zones.filter((l) => l.x + l.outer > 0 && l.z + l.outer > 0 && l.x - l.outer < v.world && l.z - l.outer < v.world).map((l) => ({ id: l.id, x: l.x / cs, z: l.z / cs, inner: l.inner / cs, outer: l.outer / cs }))
	})

	function jump(e: MouseEvent) {
		const v = stats.view
		const eng = engineRef.current
		const el = e.currentTarget as HTMLElement
		if (!v || !eng) return
		const r = el.getBoundingClientRect()
		const x = ((e.clientX - r.left) / r.width) * v.world
		const z = ((e.clientY - r.top) / r.height) * v.world
		eng.controller.focus(x, z)
		jumped = { x: eng.controller.target.x, z: eng.controller.target.z }
	}
</script>

{#if ui.minimap}
	<aside class="minimap" aria-label="Minimap">
		<header>
			<span>Minimap{editor.region ? ` · ${editor.region}` : ''}</span>
			<label class="opt" title="The map's Light.dbc light zones: full inside the solid ring, fading out to the dashed one"><input type="checkbox" bind:checked={prefs.minimapLights} /> Light zones</label>
			<button class="close" onclick={() => (ui.minimap = false)} title="Close (M)" aria-label="Close the minimap">✕</button>
		</header>
		<button type="button" class="map" onclick={jump} title="Click to move the camera there" aria-label="The map: click to move the camera there">
			<canvas bind:this={canvas}></canvas>
			{#if stats.view}
				{@const v = stats.view}
				<svg viewBox="0 0 {v.cells} {v.cells}" preserveAspectRatio="none">
					{#if editor.regionBlock && editor.regionMap}
						{@const b = editor.regionBlock}
						<!-- The continent's overview, cropped to the open block: the whole map is 64 tiles a side. -->
						<svg x="0" y="0" width={v.cells} height={v.cells} viewBox="{b.x} {b.y} {b.size} {b.size}" preserveAspectRatio="none">
							<image href="/wow/overview?map={encodeURIComponent(editor.regionMap)}" x="0" y="0" width="64" height="64" preserveAspectRatio="none" />
						</svg>
					{/if}
					{#if grid}<path d={grid} class="tiles" />{/if}
					{#each zoneCircles as z (z.id)}
						<circle cx={z.x} cy={z.z} r={z.outer} class="light-outer"><title>Light {z.id}</title></circle>
						<circle cx={z.x} cy={z.z} r={z.inner} class="light-inner" />
					{/each}
					{#if marker}
						<line x1={marker.x} y1={marker.z} x2={marker.tipX} y2={marker.tipZ} class="facing" />
						<circle cx={marker.x} cy={marker.z} r={marker.size} class="camera" />
					{/if}
				</svg>
			{/if}
		</button>
	</aside>
{/if}

<style>
	.minimap {
		position: fixed;
		top: 96px;
		left: 50px;
		width: 260px;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: 40;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.close:hover {
		color: var(--text);
	}
	.map {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		padding: 0;
		border: none;
		border-radius: 0;
		cursor: crosshair;
		background: #0b0d10;
	}
	canvas,
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
	}
	svg {
		image-rendering: auto;
	}
	.tiles {
		fill: none;
		stroke: #ffb833;
		stroke-opacity: 0.8;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-left: auto;
		font-size: 11px;
		color: var(--text-dim);
	}
	.light-outer {
		fill: rgba(255, 210, 63, 0.08);
		stroke: #ffd23f;
		stroke-width: 0.6;
		stroke-dasharray: 2 2;
		vector-effect: non-scaling-stroke;
	}
	.light-inner {
		fill: rgba(255, 210, 63, 0.14);
		stroke: #ffd23f;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.camera {
		fill: #fff;
		stroke: #000;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.facing {
		stroke: #fff;
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}
</style>
