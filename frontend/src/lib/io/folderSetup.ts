import { AzerothcorePath, VmangosPath } from '../wails/App'
import { prefs, ui, wow } from '../state/editor.svelte'
import { hasBackend } from './backend'
import { folderGaps, setupServer } from './folderGaps'

/**
 * Opens the folder dialog at the start when the client or the server folder is unset and no other dialog
 * is up. The server is the one the client's build calls for (setupServer): AzerothCore for 3.3.5a.
 */
export async function offerFolderSetup() {
	if (!hasBackend()) return
	const path = setupServer(wow.build) === 'azerothcore' ? AzerothcorePath : VmangosPath
	const server = await path().catch(() => 'set')
	if (ui.dialog !== null) return
	if (folderGaps(wow.path, server, prefs.skipFolderSetup)) ui.dialog = 'folderSetup'
}
