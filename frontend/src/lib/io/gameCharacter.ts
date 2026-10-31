// The Game Login character's test actions (#962): set its level, mail it items, through the running
// world server's SOAP console, from the right-click menus of a spawn, a loot row and the item
// editor's list. The menus open with what was last known of the character (whether the console can
// reach it), then ask again and replace their items in the open menu once Go answers.
import { GameCharacter, MailItem, SetCharacterLevel } from '../wails/App'
import type { main } from '../wails/models'
import { setStatus, ui, type ContextItem } from '../state/editor.svelte'
import { hasBackend } from './backend'

/** The tag of the character items in a menu (ContextItem.tag). */
const TAG = 'gameCharacter'

/** What Go said of the character the last time a menu asked; null before the first answer. */
let known: main.GameCharacterInfo | null = null
/** Counts the menus built, so a late answer patches only the newest. */
let seq = 0

/** One character action: its label for the character's name, and what it sends. */
export interface CharacterAction {
	label: (who: string) => string
	run: () => Promise<string>
	/** The status line once the server answered, with the server's own reply. */
	done: (who: string, reply: string) => string
}

/** The menu items of `actions` for character `c`: greyed out with the reason when the console can't reach it. */
function itemsFor(actions: CharacterAction[], c: main.GameCharacterInfo | null): ContextItem[] {
	const who = c?.character || 'the Game Login character'
	const reason = c === null ? 'Asking the server…' : c.reason
	return actions.map((a) => ({
		label: a.label(who),
		tag: TAG,
		disabled: !!reason,
		hint: reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : undefined,
		run: () => void runAction(a, who),
	}))
}

async function runAction(a: CharacterAction, who: string) {
	try {
		const reply = await a.run()
		setStatus(a.done(who, reply.trim()), 8000)
	} catch (e) {
		setStatus(`The server didn't do it: ${e}`, 10000)
	}
}

/**
 * The menu items of `actions`, built from what is known of the character, to put in a menu opened
 * now; then asks Go again and replaces them in the open menu (a later menu's ask wins). Nothing
 * without a backend.
 */
export function characterItems(actions: CharacterAction[]): ContextItem[] {
	if (!hasBackend() || !actions.length) return []
	const mine = ++seq
	void (async () => {
		let c: main.GameCharacterInfo
		try {
			c = await GameCharacter()
		} catch (e) {
			c = { character: known?.character ?? '', reason: `${e}` }
		}
		known = c
		const menu = ui.contextMenu
		if (mine !== seq || !menu) return
		const at = menu.items.findIndex((i) => i.tag === TAG)
		if (at < 0) return
		const n = menu.items.filter((i) => i.tag === TAG).length
		ui.contextMenu = { ...menu, items: [...menu.items.slice(0, at), ...itemsFor(actions, c), ...menu.items.slice(at + n)] }
	})()
	return itemsFor(actions, known)
}

/** A creature's level range as text: "12", or "10–12". */
export function levelOf(min: number, max: number): string {
	return min > 0 && max > min ? `${min}–${max}` : `${max || min}`
}

/** Set the character's level to a creature's (the top of its range): the spawn menu's item. */
export function levelAction(levelMin: number, levelMax: number): CharacterAction | null {
	const level = Math.min(Math.max(levelMax, levelMin), 60)
	if (level < 1) return null
	const range = levelOf(levelMin, levelMax)
	return {
		label: (who) => `Set ${who}'s level to ${level}${range === String(level) ? '' : ` (this creature is ${range})`}`,
		run: () => SetCharacterLevel(level),
		done: (who, reply) => `${who} is level ${level} now${reply ? ` (the server: ${reply})` : ''}.`,
	}
}

/** Mail `count` of item `entry` (named `name`) to the character: a loot row's or an item's menu item. */
export function mailAction(entry: number, name: string, count = 1): CharacterAction {
	const what = `${count > 1 ? `${count} × ` : ''}${name || `item ${entry}`}`
	return {
		label: (who) => (count > 1 ? `Mail ${count} to ${who}` : `Mail to ${who}`),
		run: () => MailItem(entry, count),
		done: (who, reply) => `Sent ${what} to ${who} by mail: it's in the mailbox${reply ? ` (the server: ${reply})` : ''}.`,
	}
}
