package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// The server's movement maps (#240), for the walkable-ground view's "server" mode: the navmesh tiles
// VMaNGOS's MoveMapGenerator wrote into data/mmaps, one a client tile, handed to the frontend's Detour
// (recast-navigation-js) as they are but for one thing: the server's Detour is built with 64-bit
// polygon refs (DT_POLYREF64, dep/recastnavigation/Detour/Include/DetourNavMesh.h), which widens each
// dtLink to 16 bytes, while the WASM's uses 32-bit refs and 12-byte links. The links are only room
// Detour fills when it adds the tile, so the block is cut down and zeroed; the rest is copied.

const (
	mmapMagic        = 0x4d4d4150 // 'MMAP', MoveMapSharedDefines.h
	mmapVersion      = 6
	dtNavMeshMagic   = 'D'<<24 | 'N'<<16 | 'A'<<8 | 'V'
	dtNavMeshVersion = 7
	// MmapTileHeader: magic, dtVersion, mmapVersion, size, usesLiquids.
	mmapHeaderSize = 20
	// dtMeshHeader: 15 ints, walkable height, radius and climb, bmin, bmax and bvQuantFactor.
	dtHeaderSize = 100
	// The .mmap file's dtNavMeshParams: orig[3], tileWidth, tileHeight, maxTiles, maxPolys.
	navParamsSize = 28
	// NavTileParams is the size of the params NavTile puts before the tile's data.
	NavTileParams = 20
)

// NavTile reads tile (x, y) of map mapID's movement maps (data/mmaps/MMMYYXX.mmtile, x the client
// tile's column, y its row) from the VMaNGOS folder serverRoot. It returns the map's navmesh origin and
// tile size (five little-endian float32s: orig x, y, z, tile width, tile height, from MMM.mmap), then the
// tile's Detour data in the 32-bit layout. The error wraps fs.ErrNotExist when the server has no tile there.
func NavTile(serverRoot string, mapID, x, y int) ([]byte, error) {
	if mapID < 0 || mapID > 999 || x < 0 || x > 63 || y < 0 || y > 63 {
		return nil, fmt.Errorf("no such tile: map %d, %d_%d", mapID, x, y)
	}
	dir := filepath.Join(serverRoot, "data", "mmaps")
	params, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("%03d.mmap", mapID)))
	if err != nil {
		return nil, err
	}
	if len(params) < navParamsSize {
		return nil, fmt.Errorf("%03d.mmap: too short", mapID)
	}
	file, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("%03d%02d%02d.mmtile", mapID, y, x)))
	if err != nil {
		return nil, err
	}
	tile, err := mmtileData(file)
	if err != nil {
		return nil, fmt.Errorf("%03d%02d%02d.mmtile: %w", mapID, y, x, err)
	}
	out := make([]byte, 0, NavTileParams+len(tile))
	out = append(out, params[:NavTileParams]...)
	return append(out, tile...), nil
}

// IsNotExist reports whether NavTile's error means the server has no such tile (or no mmaps at all).
func IsNotExist(err error) bool { return errors.Is(err, fs.ErrNotExist) }

// mmtileData checks an .mmtile file's header and returns its Detour tile in the 32-bit layout.
func mmtileData(file []byte) ([]byte, error) {
	if len(file) < mmapHeaderSize {
		return nil, errors.New("too short")
	}
	le := binary.LittleEndian
	if le.Uint32(file) != mmapMagic {
		return nil, errors.New("not a movement map tile")
	}
	if v := le.Uint32(file[8:]); v != mmapVersion {
		return nil, fmt.Errorf("built by generator version %d, not %d", v, mmapVersion)
	}
	size := int(le.Uint32(file[12:]))
	if size > len(file)-mmapHeaderSize {
		return nil, errors.New("cut short")
	}
	return detourTile32(file[mmapHeaderSize : mmapHeaderSize+size])
}

func align4(n int) int { return (n + 3) &^ 3 }

// detourTile32 rewrites a Detour tile built with 64-bit polygon refs into the layout of one built with
// 32-bit refs: the same sections in the same order (dtNavMesh::addTile's), with the links' block sized
// for 12-byte links instead of 16.
func detourTile32(d []byte) ([]byte, error) {
	if len(d) < dtHeaderSize {
		return nil, errors.New("tile too short")
	}
	le := binary.LittleEndian
	if le.Uint32(d) != dtNavMeshMagic {
		return nil, errors.New("not a Detour tile")
	}
	if v := le.Uint32(d[4:]); v != dtNavMeshVersion {
		return nil, fmt.Errorf("Detour version %d, not %d", v, dtNavMeshVersion)
	}
	count := func(i int) int { return int(le.Uint32(d[24+i*4:])) }
	polys, verts, links := count(0), count(1), count(2)
	detailMeshes, detailVerts, detailTris := count(3), count(4), count(5)
	bvNodes, offMesh := count(6), count(7)
	head := dtHeaderSize + align4(12*verts) + align4(32*polys)
	links64 := align4(16 * links)
	tail := align4(12*detailMeshes) + align4(12*detailVerts) + align4(4*detailTris) + align4(16*bvNodes) + align4(36*offMesh)
	if head+links64+tail != len(d) {
		return nil, fmt.Errorf("tile is %d bytes, its counts make %d", len(d), head+links64+tail)
	}
	out := make([]byte, head+12*links+tail)
	copy(out, d[:head])
	copy(out[head+12*links:], d[head+links64:])
	return out, nil
}
