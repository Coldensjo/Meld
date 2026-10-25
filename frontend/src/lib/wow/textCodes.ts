// The `$` codes the 1.12 client expands in quest, gossip and NPC text (Benilla's npc_text.rs ports the
// client's expander). Either case works; anything else stays as written. Spell descriptions use a
// different expander, so they are not listed here.

export interface TextCode {
	/** What is inserted. */
	code: string
	/** The button's label. */
	label: string
	/** What the client shows for it. */
	meaning: string
}

export const TEXT_CODES: TextCode[] = [
	{ code: '$N', label: '$N', meaning: "the player's name" },
	{ code: '$C', label: '$C', meaning: "the player's class ($c: in lower case)" },
	{ code: '$R', label: '$R', meaning: "the player's race ($r: in lower case)" },
	{ code: '$B', label: '$B', meaning: 'a line break' },
	{ code: '$Gman:woman;', label: '$Gman:woman;', meaning: 'the first word for a male player, the second for a female one ($gsir:madam; works the same)' },
]

/** Puts a code into text in place of the selection; returns the new text and where the caret goes. */
export function insertCode(text: string, start: number, end: number, code: string): { value: string; caret: number } {
	const a = Math.max(0, Math.min(start, end, text.length))
	const b = Math.min(text.length, Math.max(start, end))
	return { value: text.slice(0, a) + code + text.slice(b), caret: a + code.length }
}
