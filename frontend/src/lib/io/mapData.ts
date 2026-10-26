/**
 * The `.wmap` snapshot as the Go side reads and writes it (`internal/mapfile`), kept apart from
 * mapio.ts so the conversion can be unit-tested without the runes state.
 */
import { mapfile } from '../../../wailsjs/go/models'
import type { MapSnapshot } from '../engine/Engine'
import { defaultMapInfo, type MapInfo } from '../engine/mapInfo'
import type { ScopedEffects, TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'
import { base64ToBytes, bytesToBase64 } from './base64'
import { readReference } from '../terrain/referenceImage'
import { readPaths } from '../terrain/paths'
import { readLiquidKinds } from '../water/liquids'

export function toMapData(s: MapSnapshot): mapfile.MapData {
	// Not MapData.createFrom: Wails generates its embedded header's region, vmangos and roles with a null
	// class, which throws "classs is not a constructor" for any map that has one. The binding only
	// needs the fields, which it sends as JSON.
	return Object.assign(new mapfile.MapData(), {
		name: s.name,
		size: s.size,
		cellSize: s.cellSize,
		splatRes: s.splatRes,
		waterLevel: s.waterLevel,
		waterEnabled: s.waterEnabled,
		objects: s.objects,
		region: s.region ?? undefined,
		// The info travels as JSON the Go side keeps opaque (mapfile.VmangosFolder.Info).
		// The place on the tile grid and the mask of present tiles (#46) are left out where they are the default.
		vmangos: s.vmangos ? { dir: s.vmangos.dir, mapId: s.vmangos.mapId, info: s.vmangos.info, tileX: s.vmangos.tileX || undefined, tileY: s.vmangos.tileY || undefined, tiles: s.vmangos.tiles || undefined } : undefined,
		palette: s.palette,
		roles: s.roles ?? undefined,
		textureEffects: Object.keys(s.textureEffects).length ? s.textureEffects : undefined,
		textureLooks: Object.keys(s.textureLooks).length ? s.textureLooks : undefined,
		zoneEffects: Object.keys(s.scopedEffects.zones).length ? s.scopedEffects.zones : undefined,
		tileEffects: Object.keys(s.scopedEffects.tiles).length ? s.scopedEffects.tiles : undefined,
		reference: s.reference ? Object.assign(new mapfile.ReferenceImage(), s.reference) : undefined,
		paths: s.paths.length ? s.paths.map((p) => mapfile.MapPath.createFrom(p)) : undefined,
		// A map opened without the client's holes, liquids or chunk data says so (#525, #663): the blobs
		// below then hold only what was drawn since, and must not read back as the whole of it.
		holesUnknown: s.holesKnown ? undefined : true,
		liquidsUnknown: s.liquidsKnown ? undefined : true,
		chunkDataUnknown: s.chunkDataKnown ? undefined : true,
		heights: bytesToBase64(s.heights),
		weights: bytesToBase64(s.weights),
		chunkSlots: bytesToBase64(s.chunkSlots),
		holes: bytesToBase64(s.holes),
		liquids: s.liquids ? bytesToBase64(s.liquids) : undefined,
		// The kinds of the building liquids the layers use, keyed by ID as JSON keys are (#540).
		liquidKinds: s.liquidKinds && Object.keys(s.liquidKinds).length ? s.liquidKinds : undefined,
		areaIds: s.chunkData ? bytesToBase64(u32Bytes(s.chunkData.areaIds)) : undefined,
		chunkFlags: s.chunkData ? bytesToBase64(s.chunkData.chunkFlags) : undefined,
		noEffect: s.chunkData ? bytesToBase64(s.chunkData.noEffect) : undefined,
		shadows: s.shadows ? bytesToBase64(s.shadows) : undefined,
	})
}

/** The bytes of a Uint32Array, little endian as the map file stores them (every target is little endian). */
function u32Bytes(a: Uint32Array) {
	return new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
}

/** A Uint32Array read from little-endian bytes. */
function bytesU32(b: Uint8Array) {
	return new Uint32Array(b.slice().buffer, 0, b.byteLength >> 2)
}

/**
 * Clears the `parent` of every object whose parent is not in the list (or is itself), and warns with
 * its id and type. An attachment without its parent would be drawn with its local offsets as world
 * coordinates and exported there (#516). Only the link goes: the object keeps its values.
 */
export function dropOrphanParents<T extends { id: number; type: string; parent?: number }>(objects: T[]): T[] {
	const ids = new Set<number>()
	for (const o of objects) ids.add(o.id)
	for (const o of objects) {
		if (o.parent === undefined || (o.parent !== o.id && ids.has(o.parent))) continue
		console.warn(`Object ${o.id} (${o.type}) names parent ${o.parent}, which is not in the map; it is placed as a root object`)
		o.parent = undefined
	}
	return objects
}

export function fromMapData(m: mapfile.MapData): MapSnapshot {
	const common = {
		name: m.name,
		size: m.size,
		cellSize: m.cellSize,
		splatRes: m.splatRes,
		waterLevel: m.waterLevel,
		waterEnabled: m.waterEnabled,
		objects: dropOrphanParents((m.objects ?? []).map((o) => ({ ...o, id: o.id ?? 0, parent: o.parent || undefined, uid: o.uid || undefined }))),
		region: m.region ? { mapName: m.region.mapName, x: m.region.x, y: m.region.y, size: m.region.size } : null,
		vmangos: m.vmangos
			? {
					dir: m.vmangos.dir,
					mapId: m.vmangos.mapId,
					info: m.vmangos.info ? ({ ...defaultMapInfo(), ...(m.vmangos.info as Partial<MapInfo>) } as MapInfo) : undefined,
					...(m.vmangos.tileX ? { tileX: m.vmangos.tileX } : {}),
					...(m.vmangos.tileY ? { tileY: m.vmangos.tileY } : {}),
					...(m.vmangos.tiles ? { tiles: m.vmangos.tiles } : {}),
				}
			: null,
		roles: m.roles ? { rock: m.roles.rock, dirt: m.roles.dirt } : null,
		textureEffects: { ...((m.textureEffects ?? {}) as TextureEffects) },
		textureLooks: { ...((m.textureLooks ?? {}) as TextureLooks) },
		scopedEffects: { zones: (m.zoneEffects ?? {}) as ScopedEffects['zones'], tiles: (m.tileEffects ?? {}) as ScopedEffects['tiles'] },
		reference: readReference(m.reference),
		paths: readPaths(m.paths),
		heights: base64ToBytes(m.heights),
	}
	if (m.version === 1) {
		// Format 1: eight global layers, converted when the map opens.
		return {
			...common,
			palette: [],
			weights: new Uint8Array(0),
			chunkSlots: new Uint8Array(0),
			holes: new Uint8Array(0),
			holesKnown: false,
			liquids: null,
			liquidsKnown: false,
			chunkData: null,
			chunkDataKnown: false,
			shadows: null,
			legacy: { layerTextures: m.layerTextures ?? [], splatA: base64ToBytes(m.splatA ?? ''), splatB: base64ToBytes(m.splatB ?? '') },
		}
	}
	const version = m.version ?? 0
	return {
		...common,
		palette: m.palette ?? [],
		weights: base64ToBytes(m.weights ?? ''),
		chunkSlots: base64ToBytes(m.chunkSlots ?? ''),
		// A format 2 map has no holes, and a format 3 map no liquids.
		holes: base64ToBytes(m.holes ?? ''),
		holesKnown: version >= 3 && !m.holesUnknown,
		liquids: version >= 4 ? base64ToBytes(m.liquids ?? '') : null,
		liquidsKnown: version >= 4 && !m.liquidsUnknown,
		liquidKinds: readLiquidKinds(m.liquidKinds),
		// A format 4 map has no area IDs, chunk flags or no-effect cells.
		chunkData: version >= 5 ? { areaIds: bytesU32(base64ToBytes(m.areaIds ?? '')), chunkFlags: base64ToBytes(m.chunkFlags ?? ''), noEffect: base64ToBytes(m.noEffect ?? '') } : null,
		chunkDataKnown: version >= 5 && !m.chunkDataUnknown,
		// Format 6 keeps the baked shadows; empty means the map holds none of its own.
		shadows: m.shadows ? base64ToBytes(m.shadows) : null,
	}
}
