export interface LayerDef {
	id: number
	name: string
	/** CSS colour used for the UI swatch. */
	swatch: string
}

/**
 * The default palette: eight ground textures, in the roles auto-paint uses (0 grass, 1 lush grass,
 * 2 dirt, 3 rock, 4 sand, 5 snow, 6 cobblestone, 7 dirt path). A map's palette starts as these
 * colours and becomes WoW tilesets once a client is loaded (see wow/defaults.ts).
 */
export const LAYERS: LayerDef[] = [
	{ id: 0, name: 'Grass', swatch: '#5d8a2f' },
	{ id: 1, name: 'Lush Grass', swatch: '#3f6b25' },
	{ id: 2, name: 'Dirt', swatch: '#7a5a3a' },
	{ id: 3, name: 'Rock', swatch: '#7d7a76' },
	{ id: 4, name: 'Sand', swatch: '#d2bb84' },
	{ id: 5, name: 'Snow', swatch: '#e8eef5' },
	{ id: 6, name: 'Cobblestone', swatch: '#8b857c' },
	{ id: 7, name: 'Dirt Path', swatch: '#a07a50' },
]

export const LAYER_COUNT = LAYERS.length
