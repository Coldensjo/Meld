import type { vmangos } from '../../../wailsjs/go/models'

// Lock.dbc as the game object and item editors name it (#702): kept apart from refNames.ts, which
// reads the editor's state, so the unit tests can load it.

/**
 * What opens a lock, such as "Pick Lock 25 or key Tower Key" (#702): each of its Lock.dbc slots, a
 * lock type (with the skill it needs) or an item by name, `itemName` naming items (null for an
 * unknown one).
 */
export function lockText(lock: Pick<vmangos.LockInfo, 'parts'>, lockTypes: Array<Pick<vmangos.NamedID, 'id' | 'name'>>, itemName: (id: number) => string | null): string {
	const parts: string[] = []
	for (const p of lock.parts ?? []) {
		if (p.type === 1) parts.push(`key ${itemName(p.index) ?? `item ${p.index}`}`)
		else if (p.type === 2) {
			const t = lockTypes.find((x) => x.id === p.index)?.name ?? `lock type ${p.index}`
			parts.push(p.skill ? `${t} ${p.skill}` : t)
		}
	}
	return [...new Set(parts)].join(' or ') || 'Nothing opens it'
}
