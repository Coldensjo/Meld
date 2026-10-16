/** A WoW 1.12 ADT tile is 533 1/3 yards across. */
const TILE_SIZE = 533 + 1 / 3

/** The zero point the 1.12 client measures positions from (internal/adt ZeroPoint). */
const ZERO_POINT = 32 * TILE_SIZE

const fmt = (v: number) => (Math.round(v * 100) / 100).toFixed(2)

/**
 * The port commands for a point in the editor's map, as noggit writes them: a `Map: <area> on ADT x y`
 * line naming the zone of the chunk there (`area`, '' for none) and the tile, then the Trinity `.go`
 * line and the ArcEmu `.worldport` line. The editor's x and z swap and mirror into the client's, as
 * they do for tiles: the client's X is ZERO_POINT less z, and its Y is ZERO_POINT less x. Height is y.
 * The tile is the editor's column and row (x, then z), as the tiles are named.
 *
 * The Trinity line uses the `xyz` subcommand, which the in-app publish hint also uses. noggit's line
 * leaves it out.
 */
export function formatPortCoords(pos: { x: number; y: number; z: number }, mapId: number, area = ''): string {
  const wowX = fmt(ZERO_POINT - pos.z)
  const wowY = fmt(ZERO_POINT - pos.x)
  const h = fmt(pos.y)
  return [
    `Map: ${area || 'Unknown area'} on ADT ${Math.floor(pos.x / TILE_SIZE)} ${Math.floor(pos.z / TILE_SIZE)}`,
    'Trinity:',
    teleportCommand(pos, mapId),
    'ArcEmu:',
    `.worldport ${mapId} ${wowX} ${wowY} ${h}`,
    '',
  ].join('\n')
}

/**
 * The VMaNGOS (and Trinity) command that teleports a GM to a point of the editor's map: `.go xyz <x> <y>
 * <z> <map>` in the client's coordinates. `tileX` and `tileY` are the client tile at the map's
 * north-west corner: a region's first tile, 0 for a map made with New World, whose tiles start at 0.
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
  const x = pos.x + tileX * TILE_SIZE
  const z = pos.z + tileY * TILE_SIZE
  const turn = 2 * Math.PI
  return { map: mapId, x: ZERO_POINT - z, y: ZERO_POINT - x, z: pos.y, o: ((yaw % turn) + turn) % turn }
}

/** The inverse of serverSpot's position: a point of the server's map in the editor's map of a block whose first tile is (tileX, tileY). */
export function editorPoint(s: { x: number; y: number; z: number }, tileX = 0, tileY = 0): { x: number; y: number; z: number } {
  return { x: ZERO_POINT - s.y - tileX * TILE_SIZE, y: s.z, z: ZERO_POINT - s.x - tileY * TILE_SIZE }
}
