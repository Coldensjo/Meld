import { setStatus } from '../state/editor.svelte'
import type { vmangos } from '../wails/models'
import { copyToClipboard } from './clipboard'

// What the item and spell editors share beyond TemplateEditor (#722): copying a GM command, and the
// SQL export and import of template rows. Each editor keeps its own plan bar text.

/** What these helpers need of an editor: its error and note lines, and leaving it with unsaved changes asked about. */
interface Flow {
	error: string
	note: string
	leave(run: () => void | Promise<void>): void
	reopen(): void
}

/** Copies a GM command and says so in the editor's note and the status line; `note` is the note's text after "Copied <command>: ". */
export async function copyCommand(ed: Flow, command: string, note: string) {
	ed.error = ''
	try {
		await copyToClipboard(command)
		ed.note = `Copied ${command}: ${note}`
		setStatus(`Copied ${command}.`, 6000)
	} catch (err) {
		ed.error = `Copying the command failed: ${err}`
	}
}

/** Writes one template row to an SQL script named after it (`write` is the binding), and notes where. */
export async function exportRow(ed: Flow, o: { kind: string; entry: number; name: string; unsaved: boolean; write: (entries: number[], file: string) => Promise<string> }) {
	ed.error = ''
	try {
		const fallback = `${o.kind}-${o.entry}`
		const file = (o.name || fallback).replace(/[^\w\- ]+/g, '').trim() || fallback
		const path = await o.write([o.entry], file)
		if (!path) return
		ed.note = `Exported ${o.name} (${o.kind} ${o.entry}) to ${path}${o.unsaved ? ', as saved: the unsaved changes are not in it' : ''}.`
		setStatus(ed.note, 8000)
	} catch (err) {
		ed.error = String(err)
	}
}

/** Asks for a script (leaving the open row first) and plans its import: `set` gets the path and the plan. */
export function askImport<P>(ed: Flow, o: { pick: () => Promise<string>; plan: (path: string) => Promise<P>; set: (p: { path: string; plan: P }) => void }) {
	ed.leave(async () => {
		ed.error = ''
		ed.note = ''
		try {
			const path = await o.pick()
			if (!path) return
			o.set({ path, plan: await o.plan(path) })
		} catch (err) {
			ed.error = String(err)
		}
	})
}

/**
 * Runs a confirmed import: `run` writes the script and returns the entries it wrote; the editor
 * forgets them, reads the open one again when it was among them (else opens the first), and notes it.
 */
export async function runImport(
	ed: Flow,
	o: {
		run: () => Promise<number[] | null>
		clear: () => void
		forget: (entries: number[]) => void
		open: number | undefined
		openEntry: (entry: number) => void
		note: (entries: number[]) => string
		status: number
		busy: (b: boolean) => void
	},
) {
	o.busy(true)
	ed.error = ''
	try {
		const entries = (await o.run()) ?? []
		o.clear()
		o.forget(entries)
		// The open row is read again when the import wrote it.
		if (o.open !== undefined && entries.includes(o.open)) {
			ed.reopen()
			o.openEntry(o.open)
		} else if (entries.length) o.openEntry(entries[0])
		ed.note = o.note(entries)
		setStatus(ed.note, o.status)
	} catch (err) {
		ed.error = String(err)
	} finally {
		o.busy(false)
	}
}

/** What an import brings that the templates name by ID (#991: loot, gossip menus, spell lists…), as the plan bar says it: the sets it writes under new IDs, then those this server holds the same already (under another ID where it holds a copy, such as an earlier import of the script wrote, #1043). */
export function carriedText(sets: vmangos.CarriedImport[]): string {
	const fresh = sets.filter((s) => !s.same)
	const kept = sets.filter((s) => s.same)
	const more = (n: number) => (n > 8 ? `; and ${n - 8} more` : '')
	const parts: string[] = []
	if (fresh.length) {
		const list = fresh.slice(0, 8).map((s) => `${s.what} ${s.id} as ${s.to} (${s.rows} ${s.rows === 1 ? 'row' : 'rows'})`)
		parts.push(`Writes what they name by ID under new IDs, since this server holds other rows under theirs (its other templates keep those): ${list.join('; ')}${more(fresh.length)}.`)
	}
	if (kept.length) {
		const list = kept.slice(0, 8).map((s) => (s.to === s.id ? `${s.what} ${s.id}` : `${s.what} ${s.id} (here ${s.to})`))
		parts.push(`Already here the same, left as they are: ${list.join('; ')}${more(kept.length)}.`)
	}
	return parts.join(' ')
}
