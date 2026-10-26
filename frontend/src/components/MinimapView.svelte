<script lang="ts">
	import { untrack } from 'svelte'
	import { editor, prefs, stats } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { MinimapDrawn, shadeHeights } from '../lib/io/minimapImage'
	import { worldExtent, type TileSquare } from '../lib/world/worldMinimap'
	import { blockAround } from '../lib/world/teleport'
	import { TILE_YARDS } from '../lib/terrain/Terrain'

	// The minimap itself, after noggit's minimap window: the whole map from above, with the client's
	// overview behind it for a part of Azeroth, the tile borders, and the camera's spot and facing. A
	// click moves the camera there. The ground is drawn from the heights (grey by height, blue under
	// the sea) so a new world has a map too; it is redrawn when the map or its heights change, checked
	// with the 2 Hz stats. Shown in the dock (Dock.svelte) or in the floating MinimapWindow (#749),
	// one at a time; it fills its parent's width and stays square. In a world view (#15) it is the
	// client's overview of the whole map instead, cut to the square of its tiles (`worldExtent`), with
	// the block File › Edit Here would open outlined; a click there flies the camera to it.

	const TILE_CELLS = 128
	let canvas: HTMLCanvasElement | undefined = $state()
	const drawn = new MinimapDrawn()

	/** The world view's map, its tiles' square (null until its tile list is read) and how many tiles that took. */
	let world = $state<{ map: string; square: TileSquare | null; tiles: number } | null>(null)

	/** Redraws the heights when the map or its heights changed. Runs with every stats refresh. */
	$effect(() => {
		const view = stats.view
		const e = engineRef.current
		if (!view || !e || !canvas) return
		const map = editor.worldMap
		if (map) {
			// A world tab's terrain is a hidden stand-in: the overview is the map.
			const keys = e.worldTiles()
			const n = keys?.size ?? 0
			const was = untrack(() => world)
			if (was?.map !== map || was.tiles !== n) world = { map, square: keys ? worldExtent(keys) : null, tiles: n }
			return
		}
		world = null
		const t = e.terrain
		const sea = editor.waterEnabled ? editor.waterLevel : -Infinity
		if (!drawn.stale(t, t.heightsVersion, sea)) return
		draw(canvas, t.heights, t.size, sea)
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
		if (world) return ''
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
		// A world view's minimap is in tiles, a region's in cells.
		const sq = world?.square
		if (world && !sq) return null
		const cs = sq ? TILE_YARDS : v.world / Math.max(1, v.cells)
		const side = sq ? sq.n : v.cells
		const x = (jumped?.x ?? v.x) / cs
		const z = (jumped?.z ?? v.z) / cs
		// Facing: the way the camera looks, in map cells (the yaw's forward is (-sin, -cos)).
		const fx = -Math.sin(v.yaw)
		const fz = -Math.cos(v.yaw)
		const len = sq ? side / 16 : Math.max(3, side / 24)
		return { x, z, tipX: x + fx * len, tipZ: z + fz * len, size: sq ? side / 70 : Math.max(1.5, side / 60) }
	})

	/** In a world view, the block File › Edit Here would open around the camera's target, in tiles. */
	const editBlock = $derived.by(() => {
		const v = stats.view
		const keys = world?.square ? engineRef.current?.worldTiles() : null
		if (!v || !keys) return null
		return blockAround({ x: Math.floor(v.x / TILE_YARDS), y: Math.floor(v.z / TILE_YARDS) }, keys, 3)
	})

	// Light zones (#26): the map's Light.dbc lights, read when shown and when the map changes.
	type Zone = { id: number; x: number; z: number; inner: number; outer: number; global: boolean }
	let zones = $state<Zone[]>([])
	let zonesFor = ''
	$effect(() => {
		const e = engineRef.current
		const key = `${docKey()}`
		if (!prefs.minimapLights || !e || key === zonesFor || editor.worldMap) return
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
		if (!v || !prefs.minimapLights || world) return []
		const cs = v.world / Math.max(1, v.cells)
		return zones.filter((l) => l.x + l.outer > 0 && l.z + l.outer > 0 && l.x - l.outer < v.world && l.z - l.outer < v.world).map((l) => ({ id: l.id, x: l.x / cs, z: l.z / cs, inner: l.inner / cs, outer: l.outer / cs }))
	})

	function jump(e: MouseEvent) {
		const v = stats.view
		const eng = engineRef.current
		const el = e.currentTarget as HTMLElement
		if (!v || !eng || (world && !world.square)) return
		const r = el.getBoundingClientRect()
		const fx = (e.clientX - r.left) / r.width
		const fz = (e.clientY - r.top) / r.height
		const sq = world?.square
		if (sq) eng.lookAtGround((sq.x + fx * sq.n) * TILE_YARDS, (sq.y + fz * sq.n) * TILE_YARDS)
		else eng.controller.focus(fx * v.world, fz * v.world)
		jumped = { x: eng.controller.target.x, z: eng.controller.target.z }
	}
</script>

<button type="button" class="map" onclick={jump} title="Click to move the camera there" aria-label="The map: click to move the camera there">
	<canvas bind:this={canvas} class:hidden={!!world}></canvas>
	{#if stats.view && world}
		{@const sq = world.square}
		{#if sq}
			<svg viewBox="{sq.x} {sq.y} {sq.n} {sq.n}" preserveAspectRatio="none" data-world={world.map}>
				<!-- The map's overview is 64 tiles a side, in tiles here. -->
				<image href="/wow/overview?map={encodeURIComponent(world.map)}" x="0" y="0" width="64" height="64" preserveAspectRatio="none" />
				{#if editBlock}
					<rect x={editBlock.x} y={editBlock.y} width={editBlock.size} height={editBlock.size} class="block"><title>File › Edit Here opens these tiles</title></rect>
				{/if}
				{#if marker}
					<line x1={marker.x} y1={marker.z} x2={marker.tipX} y2={marker.tipZ} class="facing" />
					<circle cx={marker.x} cy={marker.z} r={marker.size} class="camera" />
				{/if}
			</svg>
		{/if}
	{:else if stats.view}
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

<style>
	.map {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 1;
		padding: 0;
		border: none;
		border-radius: 0;
		cursor: crosshair;
		background: #0b0d10;
		flex: none;
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
	canvas.hidden {
		visibility: hidden;
	}
	.block {
		fill: none;
		stroke: #ffb833;
		stroke-opacity: 0.9;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
	.tiles {
		fill: none;
		stroke: #ffb833;
		stroke-opacity: 0.8;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
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
