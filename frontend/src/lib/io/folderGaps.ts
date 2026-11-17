/** The folders the start dialog (#689) can still ask for. */
export interface FolderGaps {
	client: boolean
	server: boolean
}

/** Which folders are unset, and so whether to ask: not once the user ticked "Don't ask again". */
export function folderGaps(clientPath: string, serverPath: string, dontAsk: boolean): FolderGaps | null {
	if (dontAsk) return null
	const gaps = { client: clientPath.trim() === '', server: serverPath.trim() === '' }
	return gaps.client || gaps.server ? gaps : null
}

/** The 3.3.5a client's build (clientbuild.WotLK). */
export const WOTLK_BUILD = 12340

/**
 * The server the start dialog asks for with the client of `build`: AzerothCore for a 3.3.5a client, whose
 * maps Meld compiles for that core (#1094), VMaNGOS for any other.
 */
export function setupServer(build: number): 'azerothcore' | 'vmangos' {
	return build === WOTLK_BUILD ? 'azerothcore' : 'vmangos'
}
