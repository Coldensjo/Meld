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
	// The server asked for follows the client's build, which is known once the client the app opens at
	// start has reported: a 3.3.5a client would otherwise be taken for 1.12 and get the VMaNGOS question.
	await clientReported()
	const path = setupServer(wow.build) === 'azerothcore' ? AzerothcorePath : VmangosPath
	const server = await path().catch(() => 'set')
	if (ui.dialog !== null) return
	if (folderGaps(wow.path, server, prefs.skipFolderSetup)) ui.dialog = 'folderSetup'
}

/**
 * Waits for the client's status: while it opens (up to two minutes, as a 3.3.5a client's archives take a
 * while), or, when none has reported yet, a few seconds for the start's own report.
 */
async function clientReported() {
	const start = Date.now()
	const seen = wow.revision
	const sleep = () => new Promise((r) => setTimeout(r, 250))
	while (wow.loading && Date.now() - start < 120000) await sleep()
	while (!wow.path && wow.revision === seen && Date.now() - start < 5000) await sleep()
}
