// Projects (#48, Noggit Red's): a project folder, where its worlds are kept (the Open and Save
// dialogs start there). Meld opens straight into a world; a project is never needed.

import { CloseProject, ForgetProject, OpenProject, Projects } from '../../../wailsjs/go/main/App'
import { setStatus, ui, type ProjectInfo } from '../state/editor.svelte'
import { hasBackend } from './mapio'

const info = (p: { name: string; path: string }): ProjectInfo => ({ name: p.name, path: p.path })

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

/** Opens a project: it goes to the front of the recent list. Returns the error, or '' when it opened. */
export async function openProject(name: string, path: string): Promise<string> {
	if (!hasBackend()) return 'Projects need the desktop app.'
	try {
		await OpenProject(name, path)
	} catch (e) {
		return String(e)
	}
	await refreshProjects()
	setStatus(`Project ${ui.project?.name ?? name}: worlds in ${path}.`, 6000)
	return ''
}

/** Leaves the open project. */
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
