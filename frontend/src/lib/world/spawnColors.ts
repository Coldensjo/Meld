import type { vmangos } from '../wails/models'
import { RANKS } from './spawnInfo'

// Show › Spawn colours (#949): the spawn markers (and the spawn models, tinted) coloured by their
// kind, by a creature's level over the open map's spread, by how its faction treats a side, or by
// its rank, so a zone's level spread and who is hostile read at a glance. Pure, for the Bun tests;
// SpawnLayer writes the colours into its instances when a spawn, the mode or the side changes.

export type SpawnColorMode = 'kind' | 'level' | 'reaction' | 'rank'

export type Side = 'alliance' | 'horde'

/** How a faction template treats each side's player (vmangos.FactionInfo). */
export interface FactionReaction {
	alliance: string
	horde: string
}

/** Marker colours, by kind: red monsters, green NPCs, yellow objects. */
export const KIND_COLORS = {
	monster: 0xe0533d,
	npc: 0x4cc56b,
	object: 0xe8c547,
} as const

/** What a mode that only colours creatures draws a game object (or a creature it has nothing for) in. */
export const NO_COLOR = 0x8a8a8a

/** The reaction colours, as the names over the spawns draw them (#134). */
export const REACTION_COLORS: Record<'hostile' | 'neutral' | 'friendly', number> = {
	hostile: KIND_COLORS.monster,
	neutral: KIND_COLORS.object,
	friendly: KIND_COLORS.npc,
}

/** By rank (`creature_template.rank`, RANKS): normal, elite, rare elite, boss, rare. */
export const RANK_COLORS = [0xd8d8d8, 0xf0b030, 0xb060f0, 0xe0533d, 0x5aa8f0]

/** The level ramp, low to high: blue, cyan, green, yellow, red. */
export const LEVEL_RAMP = [0x4a6cf0, 0x3fc0d0, 0x5fd35f, 0xe8c547, 0xe0533d]

/** How a creature's faction treats `side`'s player: '' for a game object or a faction not known. */
export function reactionOf(s: vmangos.WorldSpawn, reactions: ReadonlyMap<number, FactionReaction> | null, side: Side): '' | 'hostile' | 'neutral' | 'friendly' {
	const r = s.kind === 'object' ? undefined : reactions?.get(s.faction)
	const how = r ? r[side] : ''
	return how === 'hostile' || how === 'neutral' || how === 'friendly' ? how : ''
}

/** A creature's level for the ramp: the middle of its range; 0 for a game object or no level. */
export function spawnLevel(s: vmangos.WorldSpawn): number {
	if (s.kind === 'object') return 0
	const lo = s.levelMin > 0 ? s.levelMin : s.levelMax
	const hi = s.levelMax > 0 ? s.levelMax : s.levelMin
	return lo > 0 ? (lo + hi) / 2 : 0
}

/**
 * The level ramp's ends for `spawns`: the levels of its monsters (of all its creatures when no
 * monster has one) at the 5th and 95th percentile, or the lowest and highest with fewer than 50 of
 * them ([0, 0] when none has a level). A level past an end takes the end's colour. The NPCs and the
 * few outliers would otherwise squeeze a zone's own levels into one end of the ramp: the block of
 * Northshire and Goldshire (Azeroth 31_48, size 2) holds Stormwind's level 55 to 62 guards and
 * trainers, and its monsters run 1 to 11 but for a score of them.
 */
export function levelRange(spawns: readonly vmangos.WorldSpawn[]): [number, number] {
	const monsters: number[] = []
	const all: number[] = []
	for (const s of spawns) {
		const l = spawnLevel(s)
		if (l <= 0) continue
		all.push(l)
		if (s.kind === 'monster') monsters.push(l)
	}
	const levels = monsters.length ? monsters : all
	if (!levels.length) return [0, 0]
	levels.sort((x, y) => x - y)
	const n = levels.length
	if (n < 50) return [levels[0], levels[n - 1]]
	return [levels[Math.floor(n * 0.05)], levels[Math.ceil(n * 0.95) - 1]]
}

/** The ramp's colour at `t` in [0, 1], blended between its stops. */
export function rampColor(t: number): number {
	const x = Math.min(1, Math.max(0, t)) * (LEVEL_RAMP.length - 1)
	const i = Math.min(LEVEL_RAMP.length - 2, Math.floor(x))
	const f = x - i
	const a = LEVEL_RAMP[i]
	const b = LEVEL_RAMP[i + 1]
	let out = 0
	for (const shift of [16, 8, 0]) {
		const ca = (a >> shift) & 0xff
		const cb = (b >> shift) & 0xff
		out |= Math.round(ca + (cb - ca) * f) << shift
	}
	return out
}

/** What a mode needs besides the spawn: the faction reactions, the side and the level range. */
export interface SpawnColorContext {
	reactions: ReadonlyMap<number, FactionReaction> | null
	side: Side
	levels: readonly [number, number]
}

/** A spawn's colour (0xRRGGBB) in `mode`. */
export function spawnColor(s: vmangos.WorldSpawn, mode: SpawnColorMode, ctx: SpawnColorContext): number {
	if (mode === 'kind') return KIND_COLORS[s.kind as keyof typeof KIND_COLORS] ?? NO_COLOR
	if (s.kind === 'object') return NO_COLOR
	if (mode === 'reaction') {
		const how = reactionOf(s, ctx.reactions, ctx.side)
		return how ? REACTION_COLORS[how] : NO_COLOR
	}
	if (mode === 'rank') return RANK_COLORS[s.rank] ?? NO_COLOR
	const l = spawnLevel(s)
	if (l <= 0) return NO_COLOR
	const [lo, hi] = ctx.levels
	return rampColor(hi > lo ? (l - lo) / (hi - lo) : 0.5)
}

/** One row of the legend: a swatch and what it stands for. */
export interface LegendRow {
	color: number
	label: string
}

/** The legend of a mode other than kind: its colours and what they mean (the level ramp in a few steps). */
export function spawnLegend(mode: SpawnColorMode, levels: readonly [number, number], side: Side): LegendRow[] {
	if (mode === 'reaction') {
		const who = side === 'horde' ? 'the Horde' : 'the Alliance'
		return [
			{ color: REACTION_COLORS.hostile, label: `Hostile to ${who}` },
			{ color: REACTION_COLORS.neutral, label: 'Neutral' },
			{ color: REACTION_COLORS.friendly, label: `Friendly to ${who}` },
			{ color: NO_COLOR, label: 'Game objects, or a faction not read' },
		]
	}
	if (mode === 'rank') return [...RANKS.map((label, i) => ({ color: RANK_COLORS[i], label })), { color: NO_COLOR, label: 'Game objects' }]
	if (mode === 'level') {
		const [lo, hi] = levels
		if (hi <= 0) return [{ color: NO_COLOR, label: 'No creature with a level' }]
		const steps = hi > lo ? 5 : 1
		const rows: LegendRow[] = []
		const shown: number[] = []
		for (let i = 0; i < steps; i++) {
			const t = steps > 1 ? i / (steps - 1) : 0.5
			const lv = Math.round(lo + (hi - lo) * t)
			// A narrow spread rounds two steps to one level: it is listed once (the last end wins).
			if (shown.at(-1) === lv && i < steps - 1) continue
			if (shown.at(-1) === lv) {
				rows.pop()
				shown.pop()
			}
			shown.push(lv)
			rows.push({ color: rampColor(t), label: `Level ${lv}` })
		}
		if (rows.length > 1) {
			rows[0].label += ' and below'
			rows[rows.length - 1].label += ' and above'
		}
		rows.push({ color: NO_COLOR, label: 'Game objects' })
		return rows
	}
	return []
}
