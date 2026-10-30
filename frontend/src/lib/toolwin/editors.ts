// The database editors in their own OS windows (#912, #861): the item editor first, and the creature,
// object, quest and spell editors on the same plumbing. Each editor already reads and writes the world
// database only through bindings, which work from any window, so it runs whole in its tool window's page,
// on that page's own `ui` slot (`ui.itemEditor`). The main page opens the window when the slot is set
// there (and clears it), and the window page sends back what the main page must know: an editor of
// another kind to open, the status line, the preferences it changes, and the caches a save makes stale.
// This module holds only the shapes, so the tests load it.
import type { vmangos } from '../wails/models'
import type { ToolCommand } from './channel'
import { readMapCall, type MapCall, type SpawnFieldsView } from './spawnFields'

/** The editors that open in their own window: the tool window kind (app_toolwindows.go) and the `ui` slot that opens it. */
export const EDITOR_WINDOWS = {
	item: 'itemEditor',
	spell: 'spellEditor',
	quest: 'questEditor',
	creature: 'creatureEditor',
} as const

export type EditorKind = keyof typeof EDITOR_WINDOWS
export type EditorSlot = (typeof EDITOR_WINDOWS)[EditorKind]

/** Every `ui` slot of a database editor or tool, so a window page can send one of another kind to the main page. */
export const EDITOR_SLOTS = ['creatureEditor', 'objectEditor', 'questEditor', 'itemEditor', 'spellEditor', 'iconsTool', 'soundsTool', 'characterEditor'] as const
export type AnyEditorSlot = (typeof EDITOR_SLOTS)[number]

/** The tool window kind whose `ui` slot is `slot`, or '' when that editor stays in the main page. */
export function editorKindOf(slot: string): EditorKind | '' {
	for (const [kind, s] of Object.entries(EDITOR_WINDOWS)) if (s === slot) return kind as EditorKind
	return ''
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The window's arguments (OpenToolWindow's query) for opening the editor on `target`, the slot's value. */
export function editorArgs(target: object): Record<string, string> {
	return { target: JSON.stringify(target) }
}

/** The target the window's arguments open the editor on, or null when they hold none. */
export function editorTarget(args: Record<string, string | undefined>): Record<string, unknown> | null {
	try {
		const t: unknown = JSON.parse(args.target ?? '')
		return isObject(t) ? t : null
	} catch {
		return null
	}
}

/** A quest editor's giver (QuestsTab: the creature or object whose Quests tab opened it, #914). */
export interface QuestGiverRef {
	kind: 'creature' | 'object'
	id: number
	name: string
	ready: boolean
}

/** The giver in a quest target, or undefined when it holds none or a malformed one. */
function giverOf(v: unknown): QuestGiverRef | undefined {
	if (!isObject(v)) return undefined
	if ((v.kind !== 'creature' && v.kind !== 'object') || typeof v.id !== 'number' || typeof v.name !== 'string' || typeof v.ready !== 'boolean') return undefined
	return { kind: v.kind, id: v.id, name: v.name, ready: v.ready }
}

/** What an editor's `ui` slot holds: an entry, a quest's giver, and the spawn (its spawnKey, or null) a creature's editor was opened from. */
export interface SlotTarget {
	entry: number
	giver?: QuestGiverRef
	key?: string | null
}

/** The value of the editor's `ui` slot the window's arguments open it on: an entry (0, find one, when they hold none), a quest's giver, and a creature's spawn. */
export function slotTarget(kind: EditorKind, args: Record<string, string | undefined>): SlotTarget {
	const t = editorTarget(args)
	const entry = typeof t?.entry === 'number' ? t.entry : 0
	if (kind === 'creature') return { key: typeof t?.key === 'string' ? t.key : null, entry }
	const giver = kind === 'quest' ? giverOf(t?.giver) : undefined
	return giver ? { entry, giver } : { entry }
}

/** The arguments of the page's own query (`?window=item&target=...`). */
export function queryArgs(search: string): Record<string, string> {
	return Object.fromEntries(new URLSearchParams(search))
}

/** The preferences an editor window reads, copied from the main page (the one that saves them). */
export interface EditorPrefs {
	/** The item editor's search order (#677). */
	itemSort: string
	itemSortDesc: boolean
	/** The model preview's (CreaturePreview). */
	animations: boolean
	particles: boolean
}

export const EDITOR_PREF_KEYS = ['itemSort', 'itemSortDesc', 'animations', 'particles'] as const satisfies readonly (keyof EditorPrefs)[]

/** The ones the window changes itself (its sort controls), which it sends back with a `prefs` command. */
export const EDITOR_PREF_WRITES = ['itemSort', 'itemSortDesc'] as const satisfies readonly (keyof EditorPrefs)[]

/** What the main page publishes to an editor window: the preferences it reads. */
export interface EditorView {
	prefs: EditorPrefs
	/** The spawn selected on the map, which the quest editor's Givers tab offers as a giver (#914). */
	spawn: vmangos.WorldSpawn | null
	/** What the creature editor's spawn fields read of the map (#915). */
	spawnFields: SpawnFieldsView
	/** ui.questsVersion: a quest or its givers changed, so the Quests tabs read their lists again (#915). */
	questsVersion: number
}

/** The caches of the main page that an editor's save, import or delete made stale. */
export interface EditorForget {
	/** Item rows (lib/wow/items.ts forgetItemRow) and their names (refNames forgetName 'item'). */
	items?: number[]
	/** Every display's icon, after a display was added (forgetItemIcons). */
	itemIcons?: boolean
	/** The client's item displays the look picker lists (ItemLookPicker's forgetLooks). */
	looks?: boolean
	/** Spells (lib/wow/spells.ts forgetSpell) and their names (refNames forgetName 'spell'), #913. */
	spells?: number[]
	/** The client's spell tables the pickers read (refNames forgetSpellTables), after a save added an icon or category. */
	spellTables?: boolean
	/** Quests whose names changed (refNames forgetName 'quest'), #914. */
	quests?: number[]
	/** A quest or its givers changed: the creature and object editors' Quests tabs read their lists again (ui.questsVersion). */
	questLists?: boolean
	/** The creature displays the display picker lists (DisplayPicker's forgetCreatureDisplays), after a creature's save or copy (#915). */
	creatureDisplays?: boolean
}

/** An editor window's commands to the main page. */
export type EditorCommand =
	/** An editor of another kind to open: its `ui` slot and the value to set it to. */
	| { type: 'open'; slot: AnyEditorSlot; target: Record<string, unknown> }
	/** A line for the main window's status bar. */
	| { type: 'status'; text: string; timeout: number }
	/** Preferences the window changed. */
	| { type: 'prefs'; prefs: Partial<EditorPrefs> }
	/** Caches to forget. */
	| { type: 'forget'; forget: EditorForget }
	/** An action on the map, run by the main page (lib/toolwin/spawnFields.ts), #915. */
	| ({ type: 'map' } & MapCall)
	/** What the window's editor has open now (null: it closed), so the main page can move it to a spawn picked there. */
	| { type: 'target'; target: SlotTarget | null }

const numbers = (v: unknown): number[] | undefined => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : undefined)

/** The command if `cmd` is a well-formed editor window command, else null. */
export function readEditorCommand(cmd: ToolCommand): EditorCommand | null {
	const c = cmd as Record<string, unknown>
	switch (c.type) {
		case 'open':
			return typeof c.slot === 'string' && (EDITOR_SLOTS as readonly string[]).includes(c.slot) && isObject(c.target) ? { type: 'open', slot: c.slot as AnyEditorSlot, target: c.target } : null
		case 'status':
			return typeof c.text === 'string' ? { type: 'status', text: c.text, timeout: typeof c.timeout === 'number' ? c.timeout : 8000 } : null
		case 'prefs': {
			if (!isObject(c.prefs)) return null
			const p: Partial<EditorPrefs> = {}
			if (typeof c.prefs.itemSort === 'string') p.itemSort = c.prefs.itemSort
			if (typeof c.prefs.itemSortDesc === 'boolean') p.itemSortDesc = c.prefs.itemSortDesc
			return { type: 'prefs', prefs: p }
		}
		case 'forget': {
			if (!isObject(c.forget)) return null
			const f = c.forget
			return {
				type: 'forget',
				forget: {
					items: numbers(f.items),
					itemIcons: f.itemIcons === true,
					looks: f.looks === true,
					spells: numbers(f.spells),
					spellTables: f.spellTables === true,
					quests: numbers(f.quests),
					questLists: f.questLists === true,
					creatureDisplays: f.creatureDisplays === true,
				},
			}
		}
		case 'map': {
			const call = readMapCall(c.name, c.args)
			return call ? { type: 'map', ...call } : null
		}
		case 'target':
			if (c.target === null) return { type: 'target', target: null }
			return isObject(c.target) && typeof c.target.entry === 'number' ? { type: 'target', target: { entry: c.target.entry, key: typeof c.target.key === 'string' ? c.target.key : null } } : null
	}
	return null
}
