export interface LayerDef {
  id: number
  name: string
  /** CSS colour used for the UI swatch. */
  swatch: string
}

/**
 * Ground texture layers. Layers 0-3 live in splatA (RGBA), 4-7 in splatB.
 * Weights across all 8 channels are kept normalised to sum to 255.
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

export const LAYER_COBBLE = 6
export const LAYER_PATH = 7
export const LAYER_COUNT = LAYERS.length
