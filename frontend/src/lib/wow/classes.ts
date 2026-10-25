// The playable classes of 1.12 and their icons (#682). The icons are cells of the character create
// screen's class atlas, the only class icons the 1.12 client has (UI-Classes-Circles came with 2.x),
// cut where the game's own GlueXML cuts them (CharacterCreate.lua, CLASS_ICON_TCOORDS).

/** The class atlas in the client: 256 px square, four cells to a row. */
export const CLASS_ATLAS = 'Interface\\Glues\\CharacterCreate\\UI-CharacterCreate-Classes.blp'

/** The playable classes by ChrClasses.dbc ID; a class's ClassMask bit is 1 << (id - 1). */
export const CLASSES: Array<[number, string]> = [
	[1, 'Warrior'],
	[2, 'Paladin'],
	[3, 'Hunter'],
	[4, 'Rogue'],
	[5, 'Priest'],
	[7, 'Shaman'],
	[8, 'Mage'],
	[9, 'Warlock'],
	[11, 'Druid'],
]

/** Each class's cell in the atlas as [left, right, top, bottom], 0 to 1 (CLASS_ICON_TCOORDS). */
const CELLS: Record<number, [number, number, number, number]> = {
	1: [0, 0.25, 0, 0.25],
	8: [0.25, 0.49609375, 0, 0.25],
	4: [0.49609375, 0.7421875, 0, 0.25],
	11: [0.7421875, 0.98828125, 0, 0.25],
	3: [0, 0.25, 0.25, 0.5],
	7: [0.25, 0.49609375, 0.25, 0.5],
	5: [0.49609375, 0.7421875, 0.25, 0.5],
	9: [0.7421875, 0.98828125, 0.25, 0.5],
	2: [0, 0.25, 0.5, 0.75],
}

/** A class's cell in the atlas, or null for an ID that is no playable class. */
export function classCell(id: number): [number, number, number, number] | null {
	return CELLS[id] ?? null
}

/** The class ID of a ClassMask bit (1 → Warrior 1, 1024 → Druid 11), or 0 when it is no single bit. */
export function classOfBit(bit: number): number {
	if (bit <= 0 || (bit & (bit - 1)) !== 0) return 0
	return Math.round(Math.log2(bit)) + 1
}
