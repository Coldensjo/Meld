// The editor's tools, in the toolbar's order: each with its key (a digit, or a letter) and an optional
// second letter (V for Select, B for Paint, as in Photoshop). The key handler binds them through
// lib/ui/commands.ts, and the toolbar shows them.
import type { ToolId } from '../state/editor.svelte'

export const TOOLS: Array<{ id: ToolId; name: string; desc: string; key: string; letter?: string; icon: string }> = [
	{ id: 'select', name: 'Select', desc: 'Click a model, or drag on the ground to select an area and the models in it. Alt+click picks a model or texture.', key: '1', letter: 'V', icon: 'M5 3l14 8-6 2-2 6z' },
	{ id: 'sculpt', name: 'Sculpt Terrain', desc: 'Raise, lower, smooth, flatten or roughen the ground under the brush.', key: '2', icon: 'M2 20l6-10 4 6 3-4 7 8z' },
	{ id: 'paint', name: 'Paint Textures', desc: 'Paint the picked ground texture, or a mask to fill with one. Each chunk holds up to four textures.', key: '3', letter: 'B', icon: 'M4 20c3 0 4-2 4-4l9-11 3 3-11 9c-2 0-4 1-5 3zM14 6l3 3' },
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
	{ id: 'doodad', name: 'Doodad Brush', desc: 'Scatter a brush of weighted models over the ground (Ctrl erases them).', key: '8', icon: 'M3 21c0-3.5 1.2-6 3.5-6S10 16.5 10 18.5 7.5 22 3 21zM9 15l9-9M13 3h.01M19 3h.01M21 9h.01M16 7h.01' },
	{ id: 'stamp', name: 'Stamp', desc: 'One stroke applies a stack of sculpt and paint brushes together (Edit stack in the options bar).', key: '0', icon: 'M7 3h10v5l-3 3v3h5v3H5v-3h5v-3L7 8zM4 21h16' },
	{
		id: 'mapdata',
		name: 'Map Data',
		desc: 'Paint the zone each chunk belongs to (Alt+click picks the one under the cursor), mark chunks impassable, or cells that grow no grass tufts.',
		key: '9',
		icon: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
	},
]
