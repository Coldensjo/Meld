// Money as the game shows it (#679): gold, silver and copper, each with its coin from the client's
// money atlas. The databases keep one copper count; the editors split it into the three amounts and
// join them back. The coins' images are cut in coinIcons.ts.

/** The three coins, the atlas's order. */
export type Coin = 'gold' | 'silver' | 'copper'

/**
 * The money frame's atlas (64 x 16): MoneyFrame.xml cuts gold at 0 to 0.25 of its width, silver at
 * 0.25 to 0.5 and copper at 0.5 to 0.75, its whole height each.
 */
export const COIN_ATLAS = 'Interface\\MoneyFrame\\UI-MoneyIcons.blp'
export const COIN_CELL: Record<Coin, number> = { gold: 0, silver: 0.25, copper: 0.5 }

/** A copper count as its sign and its gold, silver and copper (silver and copper 0 to 99). */
export interface Coins {
	negative: boolean
	gold: number
	silver: number
	copper: number
}

/** Splits a copper count (a fraction is dropped, a non-number is 0). */
export function splitMoney(total: number): Coins {
	const n = Number.isFinite(total) ? Math.trunc(total) : 0
	const a = Math.abs(n)
	return { negative: n < 0, gold: Math.floor(a / 10000), silver: Math.floor(a / 100) % 100, copper: a % 100 }
}

/**
 * Joins the amounts into one copper count. Each may be over its coin's 99 (150 copper is 1s 50c),
 * a negative amount counts as its size (the sign is `negative`'s alone), and an empty or bad one is 0.
 */
export function joinMoney(c: Coins): number {
	const part = (v: number) => (Number.isFinite(v) ? Math.abs(Math.trunc(v)) : 0)
	const total = part(c.gold) * 10000 + part(c.silver) * 100 + part(c.copper)
	return c.negative && total ? -total : total
}

/** The amounts to show for a copper count: the coins from the largest one that isn't 0 down (0 shows 0c). */
export function shownCoins(total: number): Array<[Coin, number]> {
	const c = splitMoney(total)
	const all: Array<[Coin, number]> = [
		['gold', c.gold],
		['silver', c.silver],
		['copper', c.copper],
	]
	const out = all.filter(([, v]) => v > 0)
	return out.length ? out : [['copper', 0]]
}
