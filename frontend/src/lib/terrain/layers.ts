export interface LayerDef {
  id: number
  name: string
  /** CSS colour used for the UI swatch. */
  swatch: string
}

/**
 * The 8 paint slots. Layers 0-3 live in splatA (RGBA), 4-7 in splatB, and
 * weights across all 8 channels are kept normalised to sum to 255. Each slot
 * is bound to a WoW tileset texture (editor.layerTextures); the names/colours
 * here describe the slot's default role (auto-paint uses 0-5) and fallback.
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
