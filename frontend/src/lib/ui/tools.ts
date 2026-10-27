// The editor's tools, in the toolbar's order: each with its key (a digit, or a letter) and an optional
// second letter (V for Select, B for Paint, as in Photoshop). The key handler binds them through
// lib/ui/commands.ts, and the toolbar shows them.
import type { ToolId } from '../state/editor.svelte'

export const TOOLS: Array<{ id: ToolId; name: string; desc: string; key: string; letter?: string; icon: string }> = [
	{ id: 'select', name: 'Select', desc: 'Click a model, or drag on the ground to select an area and the models in it. Alt+click picks a model or texture.', key: '1', letter: 'V', icon: 'M5 3l14 8-6 2-2 6z' },
	{ id: 'sculpt', name: 'Sculpt Terrain', desc: 'Raise, lower, smooth, flatten or roughen the ground under the brush.', key: '2', icon: 'M2 20l6-10 4 6 3-4 7 8z' },
	{
		id: 'paint',
		name: 'Paint Textures',
		desc: 'Paint the picked ground texture, or a mask to fill with one. Each chunk holds up to four textures.',
		key: '3',
		letter: 'B',
		icon: 'M6.5 2.5h12A1.5 1.5 0 0 1 20 4v2a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 5 6V4a1.5 1.5 0 0 1 1.5-1.5zM20 5h2M5 5H4.5A2 2 0 0 0 2.5 7v2.5l9 2.3a1 1 0 0 1 .8 1V14M10.6 15.4a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v5.1a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1z',
	},
	{ id: 'road', name: 'Roads', desc: 'Paint a texture with a hard edge and level the ground across it.', key: '4', icon: 'M8 21L10 3M16 21L14 3M12 5v2M12 11v2M12 17v2' },
	{
		id: 'path',
		name: 'Paths',
		desc: 'Draw a road, river or fence along a curve: click the ground to drop points and drag them (Shift+drag for height), then Apply to level or carve the ground and paint along it, fill a river, or stand a fence model along it. Apply again after moving it.',
		key: 'K',
		icon: 'M4 20C9 20 7 12 12 12S15 4 20 4M4 20h.01M12 12h.01M20 4h.01',
	},
	{ id: 'water', name: 'Water', desc: 'Paint lakes and rivers of water, ocean, magma or slime, or dig lakes and raise shores around the sea.', key: '5', icon: 'M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z' },
	{ id: 'place', name: 'Place Objects', desc: 'Place the model picked in the asset browser on the ground or on another model.', key: '6', icon: 'M12 2l7 6v12H5V8zM9 20v-6h6v6' },
	{ id: 'clear', name: 'Clear', desc: 'Erase models, or paint out heights, liquids or holes in the brush.', key: '7', icon: 'M4 16l7-9 6 6-5 6H6zM14 20h7' },
	{ id: 'doodad', name: 'Doodad Brush', desc: 'Scatter a brush of weighted models over the ground (Ctrl erases them).', key: '8', icon: 'M7 3l4 7H3zM7 10v4M17 8l3.5 6h-7zM17 14v3M3 21l2-3h5l2 3zM15 21h6' },
	{ id: 'stamp', name: 'Stamp', desc: 'One stroke applies a stack of sculpt and paint brushes together (Edit stack in the options bar).', key: '0', icon: 'M7 3h10v5l-3 3v3h5v3H5v-3h5v-3L7 8zM4 21h16' },
	{
		id: 'script',
		name: 'Script Brush',
		desc: "Paint with a Lua brush script from the scripts folder, Noggit Red's script brushes: its settings show in the options bar, and each click, hold and release runs it. Tools › Scripts writes them.",
		key: 'Y',
		icon: 'M4 20c2.5 0 4-1.2 4-3.5L16 8.5 13.5 6l-8 8c-2 .3-1.5 3.5-1.5 6zM14.5 5l2-2L19 5.5l-2 2M15 14l-2.5 2.5L15 19M19 14l2.5 2.5L19 19',
	},
	{
		id: 'mapdata',
		name: 'Map Data',
		desc: 'Paint the zone each chunk belongs to (Alt+click picks the one under the cursor), mark chunks impassable, or cells that grow no grass tufts.',
		key: '9',
		icon: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
	},
]
