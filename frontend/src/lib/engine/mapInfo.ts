/** What a map made for the client says about itself (vmangos.MapInfo): written on publish. */
export interface MapInfo {
	/** 0 a world map, 1 a dungeon, 2 a raid, 3 a battleground. */
	type: number
	name: string
	areaId: number
	loadingScreen: number
	maxPlayers: number
	ghostMap: number
	ghostX: number
	ghostY: number
	/** A WMO-only map: the map is its first building, with no ground, as the client's Blackfathom Deeps. */
	wmoOnly?: boolean
}

export const defaultMapInfo = (): MapInfo => ({ type: 0, name: '', areaId: 0, loadingScreen: 0, maxPlayers: 0, ghostMap: -1, ghostX: 0, ghostY: 0 })
