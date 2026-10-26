// The image imports and exports: heightmaps, watermaps, alphamaps, the normal map, the minimap image,
// and the minimap tiles written into the client.
import { OpenHeightmapDialog, OpenImageDialog, ReadHeightmap, SaveHeightmapDialog, SaveImageDialog, WritePNG, WriteHeightmap, WriteNormalMap, WriteMinimapTiles } from '../../../wailsjs/go/main/App'
import { guarded } from './backend'
import type { Engine } from '../engine/Engine'
import { editor, prefs, setStatus, ui } from '../state/editor.svelte'
import { TILE_CELLS } from '../wow/format'
import { maskBytes } from '../terrain/tileMask'
import { minimapScale, shadeHeights } from './minimapImage'
import { watermapCells } from './watermapImport'
import { IMAGE_MAX, IMAGE_MIN, imageRatios, importHeights, importHeightsOnTile, type HeightmapMode } from './heightmapImport'
import { normalMapPixels, toBase64 } from './normalMap'

/**
 * Saves the map's heights as a 16-bit grey PNG. The image has one sample per vertex, so
 * (cells + 1) on each side, and maps -1024..+1024 yards to black..white.
 */
export function exportHeightmap(engine: Engine) {
	return guarded('Export heightmap', async () => {
		const path = await SaveHeightmapDialog(editor.mapName)
		if (!path) return
		await WriteHeightmap(path, engine.terrain.size + 1, Array.from(engine.outerHeights()))
		setStatus(`Exported the heightmap to ${path}.`)
	})
}

/** Saves the map's ground normals as an RGB PNG, one pixel a vertex (Noggit Red's Export normalmap, #44). */
export function exportNormalMap(engine: Engine) {
	return guarded('Export normal map', async () => {
		const path = await SaveImageDialog('Export Normal Map', `${editor.mapName}-normals`)
		if (!path) return
		const t = engine.terrain
		const side = t.size + 1
		await WriteNormalMap(path, side, toBase64(normalMapPixels(engine.outerHeights(), side, t.cellSize)))
		setStatus(`Exported the normal map (${side}×${side}) to ${path}.`, 6000)
	})
}

/**
 * Puts a heightmap PNG onto the map's heights by `opts.mode`, as one undoable step: over the whole
 * map, or with `opts.scope` 'tile' over the client tile under the camera (Noggit Red's per-tile
 * import), where `opts.tiledEdges` leaves the vertices it shares with the next tiles alone (#44).
 */
export function importHeightmap(engine: Engine, opts: { mode: HeightmapMode; min: number; max: number; scope?: 'map' | 'tile'; tiledEdges?: boolean } = { mode: 'set', min: IMAGE_MIN, max: IMAGE_MAX }) {
	return guarded('Import heightmap', async () => {
		if (opts.scope === 'tile' && !engine.tileUnderCamera()) {
			setStatus('The camera is not over the map, so there is no tile to import onto.', 4000)
			return
		}
		const path = await OpenHeightmapDialog()
		if (!path) return
		const img = await ReadHeightmap(path)
		const tile = opts.scope === 'tile' ? engine.tileUnderCamera() : null
		if (tile) {
			const n = tile.cells + (opts.tiledEdges ? 0 : 1)
			const next = importHeightsOnTile(engine.outerHeights(), engine.terrain.size + 1, imageRatios(img, n), tile.x0, tile.z0, opts.mode, opts.min, opts.max)
			engine.setHeights(next, `Import heightmap on ${tile.name}`)
			setStatus(`Imported the heightmap from ${path} onto ${tile.name}${img.side !== n ? ` (stretched from ${img.side}×${img.side} to ${n}×${n})` : ''}. Undo reverts it.`, 6000)
			return
		}
		const side = engine.terrain.size + 1
		// The image's greys between Min and Max, put onto the ground by the mode; another size is stretched over the map.
		const ratios = imageRatios(img, side)
		engine.setHeights(importHeights(engine.outerHeights(), ratios, opts.mode, opts.min, opts.max), 'Import heightmap')
		const stretched = img.side !== side ? ` (stretched from ${img.side}×${img.side} to the map's ${side}×${side})` : ''
		setStatus(`Imported the heightmap from ${path}${stretched}. Undo reverts it.`, 6000)
	})
}

/**
 * Lays a watermap image's water over the map (see io/watermapImport.ts): black is no water, and a grey
 * is the water's depth above the ground, between `min` and `max` yards.
 */
export function importWatermap(engine: Engine, opts: { min: number; max: number }) {
	return guarded('Import watermap', async () => {
		const path = await OpenHeightmapDialog()
		if (!path) return
		const img = await ReadHeightmap(path)
		const size = engine.terrain.size
		const cells = watermapCells(imageRatios(img, size + 1), engine.outerHeights(), size, opts.min, opts.max)
		const n = engine.importWatermap(cells)
		setStatus(n ? `Laid water on ${n} cells from ${path}. Undo removes it.` : `The watermap ${path} is all black, so no water was laid.`, 6000)
	})
}

/** The paint texture's name for a file, or '' when it is a colour. */
function paintTextureName(): string {
	const path = editor.palette[editor.paintLayer] ?? ''
	return path.startsWith('#') ? '' : path.slice(path.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
}

/**
 * Saves the paint texture's alphamap: its weight at every splat texel as a 16-bit grey PNG, black for
 * none and white for all of it (terrain/alphamap.ts).
 */
export function exportAlphamap(engine: Engine) {
	return guarded('Export alphamap', async () => {
		const name = paintTextureName()
		if (!name) {
			setStatus('Pick a client texture to paint with first: its alphamap is what gets exported.', 5000)
			return
		}
		const path = await SaveImageDialog('Export Alphamap', `${editor.mapName}-${name}`)
		if (!path) return
		const values = engine.alphamapOf(editor.paintLayer)
		const side = engine.terrain.splatRes
		const heights = Array.from(values, (v) => IMAGE_MIN + v * (IMAGE_MAX - IMAGE_MIN))
		await WriteHeightmap(path, side, heights)
		setStatus(`Exported the alphamap of ${name} (${side}×${side}) to ${path}.`, 6000)
	})
}

/**
 * Reads a grey image into the paint texture's alphamap (stretched to the map), so the texture covers
 * each texel as much as the image is light. One undo step.
 */
export function importAlphamap(engine: Engine) {
	return guarded('Import alphamap', async () => {
		const name = paintTextureName()
		if (!name) {
			setStatus('Pick a client texture to paint with first: the alphamap is laid into it.', 5000)
			return
		}
		const path = await OpenImageDialog(`Import Alphamap into ${name}`)
		if (!path) return
		const img = await ReadHeightmap(path)
		const refused = engine.importAlphamap(editor.paintLayer, imageRatios(img, engine.terrain.splatRes))
		setStatus(`Laid the alphamap from ${path} into ${name}.${refused ? ` ${refused} chunks already hold four other textures and kept their paint.` : ''} Undo reverts it.`, 8000)
	})
}

/**
 * Import/Export › Write Minimap Tiles to the Client (B-129): draws each tile of the map from above and
 * puts it into the client's minimap, so the game's minimap and world map show the edited ground. A
 * region's tiles keep their place in its map; a map made for the client's are under its folder. The
 * buildings are drawn, not the trees (as the client's own tiles are), unless
 * `prefs.minimapAllModels`. The game is closed around the write, as for any patch write.
 */
export function writeMinimapTiles(engine: Engine) {
	return guarded('Write minimap', async () => {
		const region = engine.activeRegion()
		const ref = engine.activeVmangos()
		const target = region ? { dir: region.mapName, x: region.x, y: region.y } : ref ? { dir: ref.dir, x: ref.tileX ?? 0, y: ref.tileY ?? 0 } : null
		if (!target) {
			setStatus('Only a part of Azeroth or a map made for the client has a minimap in the game.')
			return
		}
		ui.busy = true
		try {
			// Placeholders would be drawn as boxes: wait for the meshes (a minute at most).
			for (let i = 0; i < 240 && engine.modelsLoading(); i++) {
				setStatus(`Waiting for ${engine.modelsLoading()} models to load…`, 1000)
				await new Promise((done) => setTimeout(done, 250))
			}
			const n = engine.terrain.size / TILE_CELLS
			const models = prefs.minimapAllModels ? 'all' : 'buildings'
			// The tiles a map made for the client leaves out of its square have none (#46).
			const present = ref && !region ? maskBytes(ref.tiles, n) : null
			const count = present ? present.reduce((a, b) => a + b, 0) : n * n
			const tiles = []
			for (let tz = 0; tz < n; tz++) {
				for (let tx = 0; tx < n; tx++) {
					if (present && !present[tz * n + tx]) continue
					setStatus(`Drawing minimap tile ${tiles.length + 1} of ${count}…`, 0)
					await new Promise((done) => setTimeout(done, 0))
					tiles.push({ x: target.x + tx, y: target.y + tz, pixels: toBase64(engine.renderMinimapTile(tx, tz, models)) })
				}
			}
			setStatus('Writing the minimap into the client…', 0)
			const patch = await WriteMinimapTiles(target.dir, tiles)
			setStatus(`Wrote ${tiles.length} minimap ${tiles.length === 1 ? 'tile' : 'tiles'} of ${target.dir} into ${patch}.`, 8000)
		} finally {
			ui.busy = false
		}
	})
}

/**
 * Saves the map from above as a PNG: the ground shaded by height (or, for a part of Azeroth, the
 * client's overview of the block), with the tile borders, at a few pixels a cell for a small map.
 */
export function saveMinimapImage(engine: Engine) {
	// A world view's terrain is a hidden stand-in; its menu item is greyed out, and its key (#15) refuses.
	if (engine.refuseInWorld()) return
	return guarded('Save minimap image', async () => {
		const t = engine.terrain
		const size = t.size
		const scale = minimapScale(size)
		const side = size * scale
		const flat = document.createElement('canvas')
		flat.width = flat.height = size
		const fctx = flat.getContext('2d')!
		const img = fctx.createImageData(size, size)
		shadeHeights(t.heights, size, editor.waterEnabled ? editor.waterLevel : -Infinity, img.data)
		fctx.putImageData(img, 0, 0)
		const out = document.createElement('canvas')
		out.width = out.height = side
		const ctx = out.getContext('2d')!
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(flat, 0, 0, side, side)
		const block = editor.regionBlock
		if (block && editor.regionMap) {
			// The continent's overview is 64 tiles a side; the block is cut from it.
			const ov = new Image()
			ov.src = `/wow/overview?map=${encodeURIComponent(editor.regionMap)}`
			try {
				await ov.decode()
				const per = ov.naturalWidth / 64
				ctx.imageSmoothingEnabled = true
				ctx.drawImage(ov, block.x * per, block.y * per, block.size * per, block.size * per, 0, 0, side, side)
			} catch (err) {
				console.warn('overview not drawn', err)
			}
		}
		if (size > TILE_CELLS) {
			ctx.strokeStyle = 'rgba(255, 184, 51, 0.85)'
			ctx.lineWidth = Math.max(1, scale)
			ctx.beginPath()
			for (let i = TILE_CELLS; i < size; i += TILE_CELLS) {
				ctx.moveTo(i * scale, 0)
				ctx.lineTo(i * scale, side)
				ctx.moveTo(0, i * scale)
				ctx.lineTo(side, i * scale)
			}
			ctx.stroke()
		}
		const path = await SaveImageDialog('Save Minimap Image', `${editor.mapName}-minimap`)
		if (!path) return
		await WritePNG(path, out.toDataURL('image/png').slice('data:image/png;base64,'.length))
		setStatus(`Saved the minimap (${side}×${side}) to ${path}.`)
	})
}
