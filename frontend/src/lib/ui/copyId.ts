import { setStatus, ui, type ContextItem } from '../state/editor.svelte'
import { copyToClipboard } from './clipboard'

// Copy id (#681): a right-click on anything that has an id (a spawn, a region model, a list row or
// picker hit in the editors) offers to copy it, and its name where it has one, as plain text: the
// number GM commands, SQL and the other editors ask for.

/** One id a thing has: what it is ("creature entry", "spawn guid") and its value. */
export interface IdRef {
	what: string
	id: number | string
}

/** What a right-click on a thing offers to copy: its ids, its name, and the menu's title. */
export interface IdMenu {
	ids: IdRef[]
	name?: string
	title?: string
}

/** Copies `text` and says what was copied in the status line. */
export async function copyValue(text: string, what: string) {
	try {
		await copyToClipboard(text)
		setStatus(`Copied ${what} ${text}.`, 4000)
	} catch (err) {
		setStatus(`Copying the ${what} failed: ${err}`, 6000)
	}
}

/** The menu items that copy each id of `m` ("Copy creature entry 1234"), then its name. */
export function copyItems(m: IdMenu): ContextItem[] {
	const items: ContextItem[] = m.ids.map((r) => ({ label: `Copy ${r.what} ${r.id}`, run: () => void copyValue(String(r.id), r.what) }))
	const name = m.name?.trim()
	if (name) items.push({ label: 'Copy name', run: () => void copyValue(name, 'name') })
	return items
}

/** Opens the copy menu of `m` at a right-click, with `before` (the row's own actions) above it. */
export function openIdMenu(e: MouseEvent, m: IdMenu, before: ContextItem[] = []) {
	const copy = copyItems(m)
	if (!copy.length && !before.length) return
	e.preventDefault()
	e.stopPropagation()
	const items = before.length && copy.length ? [...before, { separator: true }, ...copy] : [...before, ...copy]
	ui.contextMenu = { x: e.clientX, y: e.clientY, title: m.title ?? m.name ?? m.ids[0]?.what, items }
}

/**
 * `use:idMenu={...}`: a right-click on the element opens its copy menu. Null, or no id, leaves the
 * page's own menu (a text field's copy and paste).
 */
export function idMenu(node: HTMLElement, m: IdMenu | null) {
	let cur = m
	const on = (e: MouseEvent) => {
		if (cur && (cur.ids.length || cur.name?.trim())) openIdMenu(e, cur)
	}
	node.addEventListener('contextmenu', on)
	return {
		update(next: IdMenu | null) {
			cur = next
		},
		destroy() {
			node.removeEventListener('contextmenu', on)
		},
	}
}

/** The id of a thing of kind `kind` (a RefField's or a list's): an entry for a template row, else an id. */
export function idOf(kind: string, id: number): IdRef {
	return { what: kind === 'item' || kind === 'creature' || kind === 'object' ? `${kind} entry` : `${kind} id`, id }
}
