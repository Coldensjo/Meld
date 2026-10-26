import { TILE_YARDS, ZERO_POINT, fromServer, toServer } from '../wow/format'

/** A WoW 1.12 ADT tile is 533 1/3 yards across (lib/wow/format.ts). */
export const TILE_SIZE = TILE_YARDS

const fmt = (v: number) => (Math.round(v * 100) / 100).toFixed(2)

/**
 * The port commands for a point in the editor's map, as noggit writes them: a `Map: <area> on ADT x y`
 * line naming the zone of the chunk there (`area`, '' for none) and the tile, then the Trinity `.go`
 * line and the ArcEmu `.worldport` line. The editor's x and z swap and mirror into the client's, as
 * they do for tiles: the client's X is ZERO_POINT less z, and its Y is ZERO_POINT less x. Height is y.
 * The tile is the editor's column and row (x, then z), as the tiles are named.
 *
 * The Trinity line uses the `xyz` subcommand, which the in-app publish hint also uses. noggit's line
 * leaves it out. `tileX` and `tileY` are as teleportCommand's.
 */
export function formatPortCoords(pos: { x: number; y: number; z: number }, mapId: number, area = '', tileX = 0, tileY = 0): string {
	const w = toServer(pos.x, pos.z, tileX, tileY)
	const wowX = fmt(w.x)
	const wowY = fmt(w.y)
	const h = fmt(pos.y)
	const adt = `${Math.floor(pos.x / TILE_SIZE + tileX)} ${Math.floor(pos.z / TILE_SIZE + tileY)}`
	return [`Map: ${area || 'Unknown area'} on ADT ${adt}`, 'Trinity:', teleportCommand(pos, mapId, tileX, tileY), 'ArcEmu:', `.worldport ${mapId} ${wowX} ${wowY} ${h}`, ''].join('\n')
}

/**
 * The VMaNGOS (and Trinity) command that teleports a GM to a point of the editor's map: `.go xyz <x> <y>
 * <z> <map>` in the client's coordinates. `tileX` and `tileY` are the client tile at the map's
 * north-west corner: a region's first tile, or a map made with New World's place on the grid (#46).
 */
export function teleportCommand(pos: { x: number; y: number; z: number }, mapId: number, tileX = 0, tileY = 0): string {
	const s = serverSpot(pos, mapId, tileX, tileY)
	return `.go xyz ${fmt(s.x)} ${fmt(s.y)} ${fmt(s.z)} ${mapId}`
}

/** A point on the server's map: its map ID, position and facing (vmangos.CharacterSpot). */
export interface ServerSpot {
	map: number
	x: number
	y: number
	z: number
	o: number
}

/**
 * A point of the editor's map in the server's coordinates (see teleportCommand for the tiles), facing
 * the way of the camera's `yaw`. The camera looks along (-sin yaw, -cos yaw) in the editor, which the
 * axis swap turns into (cos yaw, sin yaw) on the server, so the server's facing is the yaw itself.
 */
export function serverSpot(pos: { x: number; y: number; z: number }, mapId: number, tileX = 0, tileY = 0, yaw = 0): ServerSpot {
	const s = toServer(pos.x, pos.z, tileX, tileY)
	const turn = 2 * Math.PI
	return { map: mapId, x: s.x, y: s.y, z: pos.y, o: ((yaw % turn) + turn) % turn }
}

/** The inverse of serverSpot's position: a point of the server's map in the editor's map of a block whose first tile is (tileX, tileY). */
export function editorPoint(s: { x: number; y: number; z: number }, tileX = 0, tileY = 0): { x: number; y: number; z: number } {
	const e = fromServer(s.x, s.y, tileX, tileY)
	return { x: e.x, y: s.z, z: e.z }
}

/**
 * The client tile at the north-west corner of a WMO-only map made with New World, for serverSpot:
 * Publish writes its building at the world's middle whatever its spot in the editor (#272), so the
 * editor's frame is the one that puts the building (`building`, its editor position) there. Fractional.
 */
export function wmoOnlyTiles(building: { x: number; z: number }): { x: number; y: number } {
	return { x: 32 - building.x / TILE_SIZE, y: 32 - building.z / TILE_SIZE }
}
