// File › Check Map's World data group (#951): the id columns of the creature and game object
// templates the map's spawns use that name a row the world database (or the client, for a lock)
// lacks, and roles a template has without the rows they need. Which columns name what comes from the
// editors' own field lists (creatureFields.ts, objectFields.ts: the pickers' `ref` kinds), so a column
// a picker names is checked; Go (CheckWorldData, internal/vmangos/worlddata.go) checks the kinds it
// knows a table for and leaves the rest out. This file only turns its report into findings.
import { CREATURE_FIELD_GROUPS } from '../world/creatureFields'
import { objectDataRefs } from '../world/objectFields'
import { NPC_FLAGS } from '../world/spawnInfo'
import { goMap } from '../wails/maps'
import type { vmangos } from '../wails/models'
import { capped, type Finding } from './findings'

/** A template column that names a row: Go's `vmangos.RefColumn`, with the editor's label. `type` is the object type (-1 for a creature's). */
export interface RefColumn {
	type: number
	col: string
	kind: string
	label: string
}

/** creature_template's columns whose editor field names a row. */
export const CREATURE_REFS: readonly RefColumn[] = CREATURE_FIELD_GROUPS.flatMap((g) => g.fields)
	.filter((f) => f.ref)
	.map((f) => ({ type: -1, col: f.col, kind: f.ref!, label: f.label }))

/** gameobject_template's columns that name a row: its data columns by object type, and its faction (type -1, any object's). */
export const OBJECT_REFS: readonly RefColumn[] = [...objectDataRefs().map((r) => ({ type: r.type, col: r.col, kind: r.ref, label: r.label })), { type: -1, col: 'faction', kind: 'faction template', label: 'Faction' }]

/** A template as Go's report has it, and the report (`vmangos.WorldTemplate`, `vmangos.WorldDataReport`). */
export type WorldTemplate = vmangos.WorldTemplate
export type WorldDataReport = vmangos.WorldDataReport
/** A broken link behind a template's gossip menu or loot list (#975): Go's `vmangos.RowFault`. */
export type RowFault = vmangos.RowFault

/** A spawn on the map, for finding a template's nearest. */
export interface WorldSpawn {
	key: string
	kind: string
	entry: number
	x: number
	z: number
}

/** Each template's spawn on the map nearest `from` (any one without it), by `creature:<entry>` or `object:<entry>`. */
export function nearestSpawns(spawns: readonly WorldSpawn[], from: { x: number; z: number } | null): Map<string, WorldSpawn> {
	const nearest = new Map<string, WorldSpawn>()
	for (const s of spawns) {
		const k = `${s.kind === 'object' ? 'object' : 'creature'}:${s.entry}`
		const had = nearest.get(k)
		if (!had || (from && Math.hypot(s.x - from.x, s.z - from.z) < Math.hypot(had.x - from.x, had.z - from.z))) nearest.set(k, s)
	}
	return nearest
}

const flag = (name: string) => NPC_FLAGS.find(([, n]) => n === name)![0]
const GOSSIP = flag('gossip')
const VENDOR = flag('vendor')
const TRAINER = flag('trainer')

/** Object types and their data column whose missing row breaks the object: a chest's or fishing hole's loot, a book's page. */
const NEEDED_OBJECT_COLS: Record<number, string> = { 3: 'data1', 25: 'data1', 9: 'data0' }
/** What breaks then, said after the finding. */
const OBJECT_BREAKS: Record<number, string> = { 3: 'it opens empty', 25: 'fishing it gives nothing', 9: 'reading it shows nothing' }

const IDS = 'Ids without a row'
const BEHIND = 'Rows behind the ids'
const ROLES = 'Roles without rows'
const EVENTAI = 'EventAI without events'

/**
 * A broken link behind a template's gossip menu or loot list as a finding's severity and message, after
 * the template's name. `named` is the column's label and id ("Gossip menu 900"); `shown` says whether
 * the game shows the menu (a creature flagged as gossip, or a game object): a row the server drops is
 * an error then, a warning otherwise.
 */
export function faultFinding(f: RowFault, named: string, shown: boolean): [Finding['severity'], string] {
	const where = f.in === f.root ? named : `${named}'s ${f.kind === 'gossip' ? 'menu' : 'reference list'} ${f.in}`
	const dropped = shown ? 'error' : 'warning'
	const menuGone = 'so the server drops that text (and the menu with its options, if it has no other text)'
	switch (f.what) {
		case 'text':
			return [dropped, `${where} shows npc_text ${f.id}, which has no row, ${menuGone}.`]
		case 'menu script':
			return [dropped, `${where} runs gossip script ${f.id} with npc_text ${f.text}, which has no gossip_scripts rows, ${menuGone}.`]
		case 'broadcast':
			return ['warning', `${where} shows npc_text ${f.text}, whose broadcast text ${f.id} has no row, so that text shows empty.`]
		case 'option menu':
			return ['warning', `option ${f.option} of ${where} opens menu ${f.id}, which has no gossip_menu row, so picking it opens an empty menu.`]
		case 'option script':
			return [dropped, `option ${f.option} of ${where} runs gossip script ${f.id}, which has no gossip_scripts rows, so the server drops the option.`]
	}
	return ['warning', `${where} refers to reference loot ${f.id}, which has no reference_loot_template rows, so nothing drops from it.`]
}

/**
 * The findings of a World data report: a set id column whose row is missing (an error where the game
 * needs it: a gossip menu of an NPC flagged as gossip, a vendor or trainer list of a vendor or trainer
 * with no rows of its own, a chest's loot, a book's page, a faction template; info for an event, which
 * the core may run itself; a warning otherwise), a broken row behind a gossip menu or loot list (Rows
 * behind the ids, faultFinding), a quest relation naming no quest, a vendor or trainer with nothing to
 * sell or teach, and an EventAI creature without events. Each points at the template's spawn nearest
 * `from` (the camera), and opens its editor on the column.
 */
export function checkWorldData(spawns: readonly WorldSpawn[], report: WorldDataReport, from: { x: number; z: number } | null): Finding[] {
	const nearest = nearestSpawns(spawns, from)
	const missing = new Map(Object.entries(goMap(report.missing)).map(([kind, ids]) => [kind, new Set(ids)]))
	const tables = goMap(report.tables)
	const gone = (kind: string, id: number) => missing.get(kind)?.has(id) ?? false
	const table = (kind: string) => tables[kind] ?? kind
	const ids: Finding[] = []
	const behind: Finding[] = []
	const roles: Finding[] = []
	const faults = new Map<string, RowFault[]>()
	for (const f of report.faults) {
		const k = `${f.kind}:${f.root}`
		faults.set(k, [...(faults.get(k) ?? []), f])
	}
	const ai: Finding[] = []

	const visit = (template: 'creature' | 'object', t: WorldTemplate, refs: readonly RefColumn[]) => {
		const s = nearest.get(`${template}:${t.entry}`)
		if (!s) return
		const values = goMap(t.values)
		const who = `${t.name || `#${t.entry}`} (${template} ${t.entry})`
		const at = (field?: string) => ({ x: s.x, z: s.z, group: 'world' as const, target: { kind: 'template' as const, key: s.key, template, entry: t.entry, ...(field ? { field } : {}) } })
		for (const r of refs) {
			if (template === 'object' && r.type >= 0 && r.type !== t.type) continue
			const id = values[r.col]
			if (!id) continue
			for (const f of faults.get(`${r.kind}:${id}`) ?? []) {
				const [severity, message] = faultFinding(f, `${r.label} ${id}`, template === 'object' || (t.npcFlags & GOSSIP) !== 0)
				behind.push({ check: BEHIND, severity, message: `${who}: ${message}`, ...at(r.col) })
			}
			if (!gone(r.kind, id)) continue
			const base = `${who}: ${r.label} ${id} has no ${table(r.kind)} row`
			let severity: Finding['severity'] = 'warning'
			let why = ''
			if (template === 'creature') {
				if (r.col === 'gossip_menu_id' && t.npcFlags & GOSSIP) [severity, why] = ['error', ', so talking to it opens no menu']
				else if (r.col === 'vendor_id' && t.npcFlags & VENDOR && !t.ownVendor) [severity, why] = ['error', ', so it sells nothing']
				else if (r.col === 'trainer_id' && t.npcFlags & TRAINER && !t.ownTrainer) [severity, why] = ['error', ', so it teaches nothing']
			}
			if (r.kind === 'faction template') [severity, why] = ['error', ', so the server knows no faction for it: whom it fights and who may use it']
			else if (template === 'object' && NEEDED_OBJECT_COLS[t.type] === r.col) [severity, why] = ['error', `, so ${OBJECT_BREAKS[t.type]}`]
			else if (r.kind === 'event') [severity, why] = ['info', ' (fine if the core runs the event itself)']
			ids.push({ check: IDS, severity, message: `${base}${why}.`, ...at(r.col) })
		}
		for (const [list, verb] of [
			[t.starts, 'starts'],
			[t.ends, 'ends'],
		] as const) {
			for (const q of list) if (gone('quest', q)) ids.push({ check: IDS, severity: 'warning', message: `${who} ${verb} quest ${q}, which has no ${table('quest')} row.`, ...at() })
		}
		if (template !== 'creature') return
		if (t.npcFlags & VENDOR && !t.ownVendor && !values.vendor_id) roles.push({ check: ROLES, severity: 'error', message: `${who} is a vendor with no npc_vendor rows and no vendor list, so it sells nothing.`, ...at('vendor_id') })
		if (t.npcFlags & TRAINER && !t.ownTrainer && !values.trainer_id)
			roles.push({ check: ROLES, severity: 'error', message: `${who} is a trainer with no npc_trainer rows and no trainer list, so it teaches nothing.`, ...at('trainer_id') })
		if (t.aiName === 'EventAI' && t.aiEvents === 0) ai.push({ check: EVENTAI, severity: 'warning', message: `${who} runs EventAI but has no creature_ai_events rows, so it does nothing EventAI would.`, ...at('ai_name') })
	}
	for (const t of report.creatures) visit('creature', t, CREATURE_REFS)
	for (const t of report.objects) visit('object', t, OBJECT_REFS)

	const rank = { error: 0, warning: 1, info: 2 }
	ids.sort((a, b) => rank[a.severity] - rank[b.severity])
	behind.sort((a, b) => rank[a.severity] - rank[b.severity])
	const out = [...capped(IDS, ids), ...capped(BEHIND, behind), ...capped(ROLES, roles), ...capped(EVENTAI, ai)]
	for (const kind of report.unchecked) {
		out.push({
			check: 'World data',
			severity: 'info',
			group: 'world',
			message: kind === 'lock' ? "Locks weren't checked: the client's Lock.dbc could not be read." : `${kind} ids weren't checked.`,
			x: NaN,
			z: NaN,
			target: { kind: 'none' },
		})
	}
	return out
}
