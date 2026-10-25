// The text files: object lists, doodad brushes and model sets.
import { OpenBrushDialog, OpenModelSetDialog, OpenTextDialog, ReadTextFile, SaveBrushDialog, SaveModelSetDialog, SaveTextDialog, WriteTextFile } from '../../../wailsjs/go/main/App'
import { guarded } from './backend'
import type { Engine } from '../engine/Engine'
import { editor, prefs, setStatus } from '../state/editor.svelte'
import { formatBrush, parseBrush, uniqueName, type DoodadBrush } from '../tools/doodadBrush'
import { formatSet, parseSet, type ModelSet } from '../wow/modelSets'
import { formatObjectList, parseObjectList } from '../world/objectList'
import { isHelper } from '../models/helpers'

/** Saves the active map's models as a text list (see objectList.ts). */
export function exportObjectList(engine: Engine) {
	return guarded('Export object list', async () => {
		const path = await SaveTextDialog(editor.mapName)
		if (!path) return
		// The helper shapes are the editor's own and stay out of the list, as they stay out of the client.
		const objects = [...engine.objects.objects.values()].filter((o) => !isHelper(o.type))
		const count = objects.length
		await WriteTextFile(path, formatObjectList(objects))
		setStatus(`Exported ${count} models to ${path}.`)
	})
}

/** Saves a doodad brush as a TOML file (see tools/doodadBrush.ts). */
export function exportDoodadBrush(brush: DoodadBrush) {
	return guarded('Export doodad brush', async () => {
		const path = await SaveBrushDialog(brush.name.replace(/[\/:*?"<>|]+/g, '-'))
		if (!path) return
		await WriteTextFile(path, formatBrush(brush))
		setStatus(`Exported the brush "${brush.name}" to ${path}.`)
	})
}

/**
 * Reads doodad brush files into the brush list. A brush named like one already there is added under a
 * new name, so a shared brush never overwrites the user's own. Returns the names added.
 */
export function importDoodadBrushes() {
	const added: string[] = []
	return guarded('Import doodad brush', async () => {
		const paths = (await OpenBrushDialog()) ?? []
		if (!paths.length) return
		const problems: string[] = []
		for (const path of paths) {
			const { brush, errors } = parseBrush(await ReadTextFile(path))
			if (!brush) {
				problems.push(`${path}: ${errors[0] ?? 'no brush'}`)
				continue
			}
			brush.name = uniqueName(
				brush.name,
				prefs.doodadBrushes.map((b) => b.name),
			)
			prefs.doodadBrushes = [...prefs.doodadBrushes, brush]
			added.push(brush.name)
			if (errors.length) problems.push(`${path}: ${errors[0]}`)
		}
		if (added.length) prefs.doodadBrush = added[added.length - 1]
		const what = added.length === 1 ? `the brush "${added[0]}"` : `${added.length} brushes`
		const trouble = problems.length ? ` Skipped: ${problems.join('; ')}` : ''
		setStatus(added.length ? `Imported ${what}.${trouble}` : `No brush imported.${trouble}`, problems.length ? 10000 : 4000)
	}).then(() => added)
}

/** Saves a model set as a TOML file (see wow/modelSets.ts). */
export function exportModelSet(set: ModelSet) {
	return guarded('Export model set', async () => {
		const path = await SaveModelSetDialog(set.name.replace(/[\/:*?"<>|]+/g, '-'))
		if (!path) return
		await WriteTextFile(path, formatSet(set))
		setStatus(`Exported the set "${set.name}" to ${path}.`)
	})
}

/**
 * Reads model set files into the set list. A set named like one already there is added under a new
 * name, so a shared set never overwrites the user's own. Returns the names added.
 */
export function importModelSets() {
	const added: string[] = []
	return guarded('Import model set', async () => {
		const paths = (await OpenModelSetDialog()) ?? []
		if (!paths.length) return
		const problems: string[] = []
		for (const path of paths) {
			const { set, errors } = parseSet(await ReadTextFile(path))
			if (!set) {
				problems.push(`${path}: ${errors[0] ?? 'no set'}`)
				continue
			}
			set.name = uniqueName(
				set.name,
				prefs.modelSets.map((s) => s.name),
			)
			prefs.modelSets = [...prefs.modelSets, set]
			added.push(set.name)
			if (errors.length) problems.push(`${path}: ${errors[0]}`)
		}
		if (added.length) prefs.modelSet = added[added.length - 1]
		const what = added.length === 1 ? `the set "${added[0]}"` : `${added.length} sets`
		const trouble = problems.length ? ` Skipped: ${problems.join('; ')}` : ''
		setStatus(added.length ? `Imported ${what}.${trouble}` : `No set imported.${trouble}`, problems.length ? 10000 : 4000)
	}).then(() => added)
}

/** Places the models of a text list into the active map, as one undoable step. */
export function importObjectList(engine: Engine) {
	return guarded('Import object list', async () => {
		const path = await OpenTextDialog()
		if (!path) return
		const { objects, errors } = parseObjectList(await ReadTextFile(path))
		if (objects.length === 0) {
			setStatus(`${path} has no models${errors.length ? `; ${errors[0]}` : ''}.`, 8000)
			return
		}
		engine.addObjects(objects)
		const skipped = errors.length ? `, skipped ${errors.length} unreadable ${errors.length === 1 ? 'line' : 'lines'}` : ''
		setStatus(`Imported ${objects.length} models${skipped}. Undo removes them.`, 8000)
	})
}
