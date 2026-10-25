// Projects (#48, Noggit Red's): a project folder, where the maps of it are kept (the Open and Save
// dialogs start there), with the client folder it edits. Meld opens straight into a map; only
// opening a part of Azeroth asks for a project first (the owner's limit on the approval).

import { CloseProject, ForgetProject, OpenProject, Projects } from '../../../wailsjs/go/main/App'
import { setStatus, ui, wow, type ProjectInfo } from '../state/editor.svelte'
import { applyStatus } from '../wow/api'
import { hasBackend } from './backend'
const info = (p: { name: string; path: string; clientPath: string }): ProjectInfo => ({ name: p.name, path: p.path, clientPath: p.clientPath })

/** Reads the open project and the recent list from the config into `ui`. */
export async function refreshProjects(): Promise<void> {
	if (!hasBackend()) return
	try {
		const l = await Projects()
		ui.project = l.current ? info(l.current) : null
		ui.recentProjects = (l.recent ?? []).map(info)
	} catch (e) {
		console.warn('projects', e)
	}
}

/**
 * Opens a project: its client is loaded (the Preferences client folder becomes it) and it goes to the
 * front of the recent list. Returns the error, or '' when it opened.
 */
export async function openProject(name: string, path: string, clientPath: string): Promise<string> {
	if (!hasBackend()) return 'Projects need the desktop app.'
	wow.loading = true
	try {
		applyStatus(await OpenProject(name, path, clientPath))
	} catch (e) {
		wow.loading = false
		return String(e)
	}
	await refreshProjects()
	setStatus(`Project ${ui.project?.name ?? name}: maps in ${path}, client ${clientPath}.`, 6000)
	return ''
}

/** Leaves the open project; the client stays loaded. */
export async function closeProject(): Promise<void> {
	if (!hasBackend()) return
	await CloseProject()
	await refreshProjects()
	setStatus('Project closed.')
}

/** Drops a project from the recent list; its folder and files stay. */
export async function forgetProject(path: string): Promise<void> {
	if (!hasBackend()) return
	await ForgetProject(path)
	await refreshProjects()
}

/** What Open Part of Azeroth needs before it opens: a project, with its client loaded. */
export const projectReady = () => !!ui.project && wow.loaded
