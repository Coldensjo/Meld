package adt

// The editor's map and the server's (and the client's world) measure along swapped and mirrored
// axes: the server's x is ZeroPoint less the editor's z, and its y is ZeroPoint less the editor's x.
// Height is the editor's y and the server's z, unchanged. A block (a region of tiles) starts at
// tile (tileX, tileY), so its editor origin is that tile's corner. The frontend has the same pair
// in frontend/src/lib/wow/format.ts (toServer, fromServer); TestFormatFixture checks they agree.

// ToServer is the server's (x, y) of the editor point (x, z) in the block whose first tile is
// (tileX, tileY).
func ToServer(x, z float64, tileX, tileY int) (sx, sy float64) {
	return ZeroPoint - z - float64(tileY)*TileSize, ZeroPoint - x - float64(tileX)*TileSize
}

// FromServer is the inverse of ToServer: the editor's (x, z) of the server point (sx, sy).
func FromServer(sx, sy float64, tileX, tileY int) (x, z float64) {
	return ZeroPoint - sy - float64(tileX)*TileSize, ZeroPoint - sx - float64(tileY)*TileSize
}
