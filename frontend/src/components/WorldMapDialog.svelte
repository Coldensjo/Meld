<script lang="ts">
	import Modal from './Modal.svelte'
	import { MapEntries, OpenImageDialog, ReadImageFile, ReadWorldMap, SaveImageDialog, WritePNG, WriteWorldMap } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { base64ToBytes, bytesToBase64 } from '../lib/io/base64'
	import { loadAreas } from '../lib/wow/areas'
	import { CHUNK_CELLS } from '../lib/terrain/chunkPaint'
	import {
		areasUnder,
		artName,
		boxRect,
		drawOverlays,
		explored,
		extentToRect,
		feather,
		fitAspect,
		intersect,
		mapLook,
		paste,
		pixelBox,
		rectToExtent,
		WORLD_MAP_H,
		WORLD_MAP_W,
		zoneBounds,
		type EditorRect,
		type OverlayPiece,
	} from '../lib/io/worldMap'

	// World › World Map (#181): a zone's map for the game's World Map (M). Generate draws the zone from
	// straight above in the client's map look; a zone the client already maps (a part of Azeroth) keeps
	// its rectangle and art, with the open block drawn over its part. Import takes a picture painted
	// elsewhere (Export gives the render to paint over). Write to Client puts the twelve tiles and the
	// WorldMapArea.dbc row into Meld's patch. With Overlays on (#219), each subzone painted in the drawn
	// part gets its exploration overlay (WorldMapOverlay.dbc and its art), and the base art leaves it
	// out as parchment, as the client's maps do. A form written with its button, not an undo step.

	let { onclose }: { onclose: () => void } = $props()

	interface ZoneOption {
		id: number
		name: string
	}
	let error = $state('')
	let busy = $state(false)
	let mapId = $state<number | null>(null)
	let tileX = 0
	let tileY = 0
	let zones = $state<ZoneOption[]>([])
	let zoneId = $state(0)
	let name = $state('')
	let rect = $state<EditorRect | null>(null)
	/** The client's row of the zone, when it has one: its ID and rectangle are kept. */
	let existing = $state<vmangos.WorldMapRow | null>(null)
	/** The picture to write, WORLD_MAP_W by WORLD_MAP_H RGBA; the client's art until Generate or Import. */
	let pixels = $state<Uint8Array | null>(null)
	let models = $state<'buildings' | 'all' | 'none'>('buildings')
	/** The zone's exploration overlays: the client's, and those Generate drew. */
	let overlays = $state<OverlayPiece[]>([])
	/** Whether Generate draws a subzone into its overlay (and leaves it out of the base art). */
	let explore = $state(true)
	/** Whether the preview shows the overlays over the base, as a player who has explored it all. */
	let showExplored = $state(true)
	let canvas = $state<HTMLCanvasElement>()

	async function init() {
		if (!hasBackend()) {
			error = 'The world map needs the desktop app and a WoW client.'
			return
		}
		const e = engineRef.current
		if (!e) return
		try {
			const ref = e.activeVmangos()
			const region = e.activeRegion()
			if (ref) {
				mapId = ref.mapId
				// A map made for the client sits where it was picked on the grid (#46).
				tileX = ref.tileX ?? 0
				tileY = ref.tileY ?? 0
			} else if (region) {
				const maps = (await MapEntries()) ?? []
				mapId = maps.find((m) => m.Dir.toLowerCase() === region.mapName.toLowerCase())?.ID ?? null
				tileX = region.x
				tileY = region.y
			}
			if (mapId === null) {
				error = 'A world map is for a map in the client: open a part of Azeroth, or a map made for the client (File › New World for the client).'
				return
			}
			// The zones the Map data tool painted, each subzone counted as its zone.
			const areas = await loadAreas()
			const byId = new Map(areas.map((a) => [a.id, a]))
			const seen = new Set<number>()
			for (const id of e.terrain.areaIds) {
				if (!id) continue
				const a = byId.get(id)
				seen.add(a?.parent || id)
			}
			zones = [...seen].map((id) => ({ id, name: byId.get(id)?.name ?? `Area ${id}` })).sort((a, b) => a.name.localeCompare(b.name))
			if (!zones.length) {
				error = 'No zone is painted on this map: paint one with the Map data tool (Zone mode) first.'
				return
			}
			await pick(zones[0].id)
		} catch (err) {
			error = String(err)
		}
	}
	void init()

	/** The zone's areas: itself and its subzones. */
	async function inZoneTest(id: number) {
		const areas = await loadAreas()
		const byId = new Map(areas.map((a) => [a.id, a]))
		return (a: number) => a === id || byId.get(a)?.parent === id
	}

	async function pick(id: number) {
		zoneId = id
		error = ''
		pixels = null
		existing = null
		overlays = []
		try {
			const view = await ReadWorldMap(mapId!, id)
			const e = engineRef.current!
			if (view.row) {
				existing = view.row
				name = view.row.name
				rect = extentToRect(view.row, tileX, tileY)
				if (view.pixels) pixels = base64ToBytes(view.pixels as unknown as string)
				overlays = (view.overlays ?? []).map((o) => ({
					id: o.id,
					areas: o.areas ?? [],
					name: o.name,
					box: { u0: o.offsetX, v0: o.offsetY, u1: o.offsetX + o.width, v1: o.offsetY + o.height },
					hit: { top: o.hitTop, left: o.hitLeft, bottom: o.hitBottom, right: o.hitRight },
					pixels: o.pixels ? base64ToBytes(o.pixels as unknown as string) : null,
					changed: false,
				}))
			} else {
				name = artName(zones.find((z) => z.id === id)?.name ?? `Zone${id}`)
				const t = e.terrain
				const b = zoneBounds(t.areaIds, t.paintChunksPerSide, CHUNK_CELLS * t.cellSize, await inZoneTest(id))
				rect = b ? fitAspect(b) : null
			}
		} catch (err) {
			error = String(err)
		}
	}

	$effect(() => {
		const px = pixels && showExplored && overlays.length ? explored(pixels, overlays) : pixels
		if (!canvas) return
		const ctx = canvas.getContext('2d')!
		ctx.fillStyle = '#c9b68c'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		if (!px) return
		const img = new ImageData(new Uint8ClampedArray(px), WORLD_MAP_W, WORLD_MAP_H)
		const full = document.createElement('canvas')
		full.width = WORLD_MAP_W
		full.height = WORLD_MAP_H
		full.getContext('2d')!.putImageData(img, 0, 0)
		ctx.drawImage(full, 0, 0, canvas.width, canvas.height)
	})

	/** Draws the zone: the whole rectangle for a new map, else the open block's part of the client's. */
	async function generate() {
		const e = engineRef.current
		if (!e || !rect) return
		busy = true
		try {
			for (let i = 0; i < 240 && e.modelsLoading(); i++) {
				setStatus(`Waiting for ${e.modelsLoading()} models to load…`, 1000)
				await new Promise((done) => setTimeout(done, 250))
			}
			setStatus('Drawing the zone from above…', 0)
			await new Promise((done) => setTimeout(done, 0))
			const map = { x0: 0, z0: 0, x1: e.terrain.worldSize, z1: e.terrain.worldSize }
			const base = existing && pixels ? pixels.slice() : null
			// With the client's art under it, only the block's part is drawn; a new zone is drawn whole.
			const part = base ? intersect(rect, map) : rect
			if (!part) {
				error = 'The open block is outside this zone’s map, so there is nothing to draw.'
				return
			}
			const box = pixelBox(rect, part)
			const w = box.u1 - box.u0
			const h = box.v1 - box.v0
			const at = boxRect(rect, box)
			const shot = e.renderTopDown(at.x0, at.z0, at.x1, at.z1, models, w, h)
			const edges = { left: box.u0 === 0, top: box.v0 === 0, right: box.u1 === WORLD_MAP_W, bottom: box.v1 === WORLD_MAP_H }
			let look = mapLook(shot, w, h, base ? { left: false, top: false, right: false, bottom: false } : edges)
			if (explore) {
				const t = e.terrain
				const areas = await loadAreas()
				const byId = new Map(areas.map((a) => [a.id, a]))
				const drawn = drawOverlays({
					look,
					box,
					under: areasUnder(t.areaIds, t.paintChunksPerSide, CHUNK_CELLS * t.cellSize, rect, box),
					zoneId,
					parentOf: (id) => byId.get(id)?.parent,
					nameOf: (id) => byId.get(id)?.name ?? `Area${id}`,
					overlays,
					band: base ? 16 : 0,
				})
				look = drawn.base
				overlays = drawn.overlays
			}
			const out = base ?? new Uint8Array(WORLD_MAP_W * WORLD_MAP_H * 4)
			if (base) feather(out, WORLD_MAP_W, WORLD_MAP_H, look, w, h, box.u0, box.v0)
			else paste(out, WORLD_MAP_W, look, w, h, box.u0, box.v0)
			pixels = out
			setStatus(`Drew ${zones.find((z) => z.id === zoneId)?.name ?? 'the zone'}'s map. Write to Client puts it into the game.`, 6000)
		} catch (err) {
			error = String(err)
		} finally {
			busy = false
		}
	}

	async function importImage() {
		const path = await OpenImageDialog('Import World Map Picture')
		if (!path) return
		try {
			const bytes = base64ToBytes(await ReadImageFile(path))
			const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
			const c = document.createElement('canvas')
			c.width = WORLD_MAP_W
			c.height = WORLD_MAP_H
			const ctx = c.getContext('2d')!
			ctx.drawImage(bmp, 0, 0, WORLD_MAP_W, WORLD_MAP_H)
			const data = ctx.getImageData(0, 0, WORLD_MAP_W, WORLD_MAP_H).data
			const px = new Uint8Array(data.length)
			px.set(data)
			for (let i = 3; i < px.length; i += 4) px[i] = 255
			pixels = px
			setStatus(`Imported ${path} (${bmp.width}x${bmp.height}, drawn at ${WORLD_MAP_W}x${WORLD_MAP_H}).`, 6000)
		} catch (err) {
			error = `The picture could not be read: ${err}`
		}
	}

	async function exportImage() {
		if (!pixels) return
		const path = await SaveImageDialog('Export World Map Picture', name || 'worldmap')
		if (!path) return
		const c = document.createElement('canvas')
		c.width = WORLD_MAP_W
		c.height = WORLD_MAP_H
		c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), WORLD_MAP_W, WORLD_MAP_H), 0, 0)
		const blob = await new Promise<Blob | null>((done) => c.toBlob(done, 'image/png'))
		if (!blob) return
		await WritePNG(path, bytesToBase64(new Uint8Array(await blob.arrayBuffer())))
		setStatus(`Exported the world map picture to ${path}.`, 6000)
	}

	async function write() {
		if (!pixels || !rect || mapId === null) return
		busy = true
		error = ''
		try {
			const ext = rectToExtent(rect, tileX, tileY)
			const row = vmangos.WorldMapRow.createFrom({ id: existing?.id ?? 0, mapId, areaId: zoneId, name, ...ext })
			const pieces = overlays.map((o) =>
				vmangos.WorldMapOverlay.createFrom({
					id: o.id,
					areas: o.areas,
					name: o.name,
					width: o.box.u1 - o.box.u0,
					height: o.box.v1 - o.box.v0,
					offsetX: o.box.u0,
					offsetY: o.box.v0,
					hitTop: o.hit.top,
					hitLeft: o.hit.left,
					hitBottom: o.hit.bottom,
					hitRight: o.hit.right,
					// An unchanged overlay keeps the client's art.
					pixels: o.changed && o.pixels ? (bytesToBase64(o.pixels) as unknown as number[]) : null,
				}),
			)
			const res = await WriteWorldMap(vmangos.WorldMapSpec.createFrom({ row, pixels: bytesToBase64(pixels) as unknown as number[], overlays: pieces }))
			existing = res.row
			overlays = overlays.map((o, i) => ({ ...o, id: res.overlays?.[i]?.id ?? o.id }))
			setStatus(`Wrote the world map of ${name} (WorldMapArea row ${res.row.id}, ${overlays.length} overlays) into ${res.patch}. In the game, M shows it in the zone.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			busy = false
		}
	}

	const overlayCount = $derived.by(() => {
		const redrawn = overlays.filter((o) => o.changed).length
		return `${overlays.length} overlay${overlays.length === 1 ? '' : 's'}${redrawn ? `, ${redrawn} drawn` : ''}`
	})
	const size = $derived(rect ? `${Math.round(rect.x1 - rect.x0)} × ${Math.round(rect.z1 - rect.z0)} yd` : '')
</script>

<Modal title="World Map" width={620} {onclose}>
	{#if error}<p class="error">{error}</p>{/if}
	{#if zones.length}
		<div class="grid">
			<label class="k" for="wm-zone">Zone</label>
			<select id="wm-zone" value={zoneId} disabled={busy} onchange={(e) => void pick(Number((e.target as HTMLSelectElement).value))}>
				{#each zones as z (z.id)}
					<option value={z.id}>{z.name} ({z.id})</option>
				{/each}
			</select>
			<label class="k" for="wm-name">Art folder</label>
			<input id="wm-name" bind:value={name} disabled={busy || !!existing} title="Interface\WorldMap\<name>\<name>1..12.blp" />
			<span class="k">Extent</span>
			<span class="dim">{size}{existing ? ` · the client's (row ${existing.id})` : ' · from the zone’s chunks'}</span>
			<label class="k" for="wm-models">Models</label>
			<select id="wm-models" bind:value={models} disabled={busy}>
				<option value="buildings">Buildings</option>
				<option value="all">All models</option>
				<option value="none">Ground only</option>
			</select>
			<span class="k">Overlays</span>
			<span class="row">
				<label title="Generate draws each subzone painted in the zone into its exploration overlay (WorldMapOverlay.dbc), revealed in the game as the player explores it, and leaves it out of the base art"
					><input type="checkbox" bind:checked={explore} disabled={busy} /> One per subzone</label
				>
				<label title="Show the overlays over the base, as a player who has explored the whole zone sees it"><input type="checkbox" bind:checked={showExplored} /> Preview explored</label>
				<span class="dim">{overlayCount}</span>
			</span>
		</div>
		<canvas bind:this={canvas} width={WORLD_MAP_W / 2} height={WORLD_MAP_H / 2}></canvas>
		<p class="dim">
			{#if existing}
				The client already maps this zone: Generate draws the open block over its part of the client's map and keeps the rest.
			{:else}
				Generate draws the zone from above in the map's parchment look; or paint one from the export and import it.
			{/if}
			{#if explore}A subzone (World › Zones) shows once the player has explored it; Import replaces only the base art.{/if}
			Write to Client puts it into Meld's patch with the game closed.
		</p>
	{/if}
	{#snippet actions()}
		<button onclick={onclose}>Close</button>
		<button disabled={busy || !rect} onclick={() => void generate()}>Generate</button>
		<button disabled={busy || !zones.length} onclick={() => void importImage()}>Import…</button>
		<button disabled={busy || !pixels} onclick={() => void exportImage()}>Export…</button>
		<button class="active" disabled={busy || !pixels || !rect || ui.busy} onclick={() => void write()}>{busy ? 'Working…' : 'Write to Client'}</button>
	{/snippet}
</Modal>

<style>
	.grid {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 10px;
		align-items: center;
		margin-bottom: 8px;
	}
	.k {
		color: var(--text-dim);
	}
	.row {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 3 / 2;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	.dim {
		color: var(--text-dim);
	}
	p {
		margin: 8px 0 0;
	}
</style>
