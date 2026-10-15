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
    `.go xyz ${wowX} ${wowY} ${h} ${mapId}`,
    'ArcEmu:',
    `.worldport ${mapId} ${wowX} ${wowY} ${h}`,
    '',
  ].join('\n')
}
