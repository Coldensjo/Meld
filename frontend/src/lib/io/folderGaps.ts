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
