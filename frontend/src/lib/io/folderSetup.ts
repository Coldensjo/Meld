import { VmangosPath } from '../../../wailsjs/go/main/App'
import { prefs, ui, wow } from '../state/editor.svelte'
import { hasBackend } from './backend'
import { folderGaps } from './folderGaps'

/** Opens the folder dialog at the start when the client or the server folder is unset and no other dialog is up. */
export async function offerFolderSetup() {
	if (!hasBackend()) return
	const server = await VmangosPath().catch(() => 'set')
	if (ui.dialog !== null) return
	if (folderGaps(wow.path, server, prefs.skipFolderSetup)) ui.dialog = 'folderSetup'
}
