// The Node Editor's graphs (#30): visual scripts over the map's terrain, chunks, textures and models, a
// second way to script, as Noggit Red's node editor is (View › Node Editor, `ui/tools/NodeEditor/`). A
// graph is nodes and the links between their pins, in two kinds: flow pins (white) say what runs after
// what, from the Begin node, and data pins carry values. It runs by compiling to a Lua script over the
// script API (prelude.ts), so a graph and a Lua script share one API, one engine, its time limit and its
// one undo step a run. Noggit Red is GPL: this follows the idea (its LogicBeginNode, LogicIfNode,
// LogicForLoopNode... and its data nodes for maths, the world and noise), none of its code.
//
// Compiling: the flow is walked from Begin and each flow node writes its statements, a loop's body
// nested in it; a data input becomes a Lua expression built from the nodes it is linked to, inlined
// where it is used, so a Random number node gives a new number each time it is read. A few data nodes
// (a selection, a seeded random, a noise map) are worked out once at the top instead (`hoist`), when what
// they read allows. A value a flow node makes (a loop's vertex, an added model) is a Lua local, so it can
// only be read where that node has run: inside its loop, or after it on the same path.
import { NOISE_NAMES } from './scriptNoise'

/** What a pin carries. `exec` is the flow; `any` links to every data type. */
export type PinType = 'exec' | 'number' | 'bool' | 'text' | 'vec' | 'sel' | 'vert' | 'model' | 'chunk' | 'random' | 'noise' | 'any'

export type Value = number | string | boolean

export interface PinSpec {
	id: string
	label: string
	type: PinType
	/** The value an unlinked input takes, edited on the node; an input without one must be linked (unless `optional`). */
	def?: Value
	/** A choice of these, edited on the node: a setting, never linked. */
	options?: readonly string[]
	/** A setting edited on the node, never linked (a variable's name). */
	field?: boolean
	/** An input that may stay unlinked, read as nil (a model's rotation). */
	optional?: boolean
}

export type Category = 'Flow' | 'Variables' | 'Terrain' | 'Chunks' | 'Models' | 'Selection' | 'World' | 'Vectors' | 'Maths' | 'Logic' | 'Text' | 'Random' | 'Noise'

export const CATEGORIES: readonly Category[] = ['Flow', 'Variables', 'Terrain', 'Chunks', 'Models', 'Selection', 'World', 'Vectors', 'Maths', 'Logic', 'Text', 'Random', 'Noise']

export interface NodeSpec {
	type: string
	title: string
	category: Category
	help: string
	inputs: PinSpec[]
	outputs: PinSpec[]
	/** The node's width on the canvas, when it needs more than NODE_W for a text field. */
	width?: number
	/** A data node: the Lua expression of output `out`. */
	expr?: (c: ExprCtx, out: string) => string
	/** A flow node: writes its statements; the flow on its `next` pin follows them. */
	emit?: (c: EmitCtx) => void
	/** Worked out once at the top of the script rather than where it is read, when its inputs allow. */
	hoist?: boolean
	/** The helper functions (HELPERS) its Lua calls. */
	helpers?: string[]
}

/** A node placed in a graph: its type, where it sits on the canvas, and its fields' values. */
export interface GraphNode {
	id: number
	type: string
	x: number
	y: number
	values: Record<string, Value>
}

/** A link from output `out` of node `from` to input `in` of node `to`. */
export interface GraphLink {
	from: number
	out: string
	to: number
	in: string
}

export interface Graph {
	nodes: GraphNode[]
	links: GraphLink[]
}

/** The canvas layout of a node, shared by the editor's drawing and its wires. */
export const NODE_W = 200
export const NODE_HEAD = 24
export const NODE_ROW = 22

export interface ExprCtx {
	/** The Lua expression of input `pin`: what it is linked to, or its value on the node. */
	in(pin: string): string
	/** The raw value of a field (`field` or `options`). */
	field(pin: string): Value
}

export interface EmitCtx extends ExprCtx {
	/** Writes a line at the current depth. */
	line(text: string): void
	/** Declares output `pin` as a local set to `expr` (or, with no expr, names it for a `for` to declare) and gives its name. */
	local(pin: string, expr?: string): string
	/** Input `pin` as a name a method can be called on: a local made for it when it is not one already. */
	subject(pin: string): string
	/**
	 * Writes the flow linked to exec output `pin`, one level deeper; `loop` for a loop's body, whose own
	 * values (its index, its vertex) are read only inside it. `start` writes the body's first lines.
	 */
	block(pin: string, loop?: boolean, start?: () => void): void
	/** Writes the flow linked to exec output `pin` at the node's own depth (Sequence). */
	run(pin: string): void
	/** Whether exec output `pin` leads anywhere. */
	linked(pin: string): boolean
	/** Throws a compile error at this node. */
	fail(message: string): never
	/** Whether the node sits inside a loop (for Break). */
	inLoop(): boolean
}

/** Lua helpers a node's code may call, written once at the top of a script that needs them. */
const HELPERS: Record<string, string> = {
	clamp: 'local function __clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi end return v end',
	falloff: 'local function __falloff(d, r) if r <= 0 then return d <= 0 and 1 or 0 end local f = 1 - d / r if f <= 0 then return 0 elseif f >= 1 then return 1 end return f * f * (3 - 2 * f) end',
	vscale: 'local function __vscale(v, f) return vec(v.x * f, v.y * f, v.z * f) end',
	area: "local function __area() return selected_area() or error('no area is selected: select one with the Select tool first', 0) end",
}

// Pin builders.
const flowIn: PinSpec = { id: 'in', label: '', type: 'exec' }
const next = (label = ''): PinSpec => ({ id: 'next', label, type: 'exec' })
const exec = (id: string, label: string): PinSpec => ({ id, label, type: 'exec' })
const num = (id: string, label: string, def?: number): PinSpec => ({ id, label, type: 'number', def })
const pin = (id: string, label: string, type: PinType): PinSpec => ({ id, label, type })
const text = (id: string, label: string, def = ''): PinSpec => ({ id, label, type: 'text', def })
const bool = (id: string, label: string, def = true): PinSpec => ({ id, label, type: 'bool', def })
const choice = (id: string, label: string, options: readonly string[]): PinSpec => ({ id, label, type: 'text', def: options[0], options })

const MATH_OPS: Record<string, string> = { '+': '+', '−': '-', '×': '*', '÷': '/', '^': '^', mod: '%' }
const MATH_FNS = ['abs', 'sqrt', 'floor', 'ceil', 'round', 'sin', 'cos', 'tan', 'exp', 'log', 'negate'] as const
const COMPARE_OPS: Record<string, string> = { '<': '<', '≤': '<=', '=': '==', '≠': '~=', '>': '>', '≥': '>=' }

/** Every node the editor offers, by type. */
export const NODE_SPECS: NodeSpec[] = [
	// Flow.
	{
		type: 'begin',
		title: 'Begin',
		category: 'Flow',
		help: 'Where the graph starts running. A graph has one.',
		inputs: [],
		outputs: [next()],
		emit: () => {},
	},
	{
		type: 'sequence',
		title: 'Sequence',
		category: 'Flow',
		help: 'Runs its three outputs one after the other.',
		inputs: [flowIn],
		outputs: [exec('first', 'first'), exec('second', 'second'), exec('third', 'third')],
		emit: (c) => {
			for (const p of ['first', 'second', 'third']) c.run(p)
		},
	},
	{
		type: 'if',
		title: 'If',
		category: 'Flow',
		help: 'Runs "true" when the condition holds, "false" when not, then goes on with "after".',
		inputs: [flowIn, bool('cond', 'condition')],
		outputs: [exec('then', 'true'), exec('else', 'false'), next('after')],
		emit: (c) => {
			c.line(`if ${c.in('cond')} then`)
			c.block('then')
			if (c.linked('else')) {
				c.line('else')
				c.block('else')
			}
			c.line('end')
		},
	},
	{
		type: 'forRange',
		title: 'For Range',
		category: 'Flow',
		help: 'Runs "body" for each number from "from" to "to", a step apart, then goes on with "done".',
		inputs: [flowIn, num('from', 'from', 1), num('to', 'to', 10), num('step', 'step', 1)],
		outputs: [exec('body', 'body'), pin('index', 'number', 'number'), next('done')],
		emit: (c) => {
			const i = c.local('index')
			c.line(`for ${i} = ${c.in('from')}, ${c.in('to')}, ${c.in('step')} do`)
			c.block('body', true)
			c.line('end')
		},
	},
	{
		type: 'while',
		title: 'While',
		category: 'Flow',
		help: 'Runs "body" again and again while the condition holds (a run stops after 10 seconds).',
		inputs: [flowIn, bool('cond', 'condition', false)],
		outputs: [exec('body', 'body'), next('done')],
		emit: (c) => {
			c.line(`while ${c.in('cond')} do`)
			c.block('body', true)
			c.line('end')
		},
	},
	{
		type: 'break',
		title: 'Break',
		category: 'Flow',
		help: 'Leaves the loop it is in, going on with the loop’s "done".',
		inputs: [flowIn],
		outputs: [],
		emit: (c) => {
			if (!c.inLoop()) c.fail('Break is not inside a loop')
			c.line('do break end')
		},
	},
	{
		type: 'print',
		title: 'Print',
		category: 'Flow',
		help: 'Writes a value to the output below the graph.',
		inputs: [flowIn, { id: 'value', label: 'value', type: 'any', def: 'Hello' }],
		outputs: [next()],
		emit: (c) => c.line(`print(${c.in('value')})`),
	},
	// Variables: one table of them for the run, by name.
	{
		type: 'setVar',
		title: 'Set Variable',
		category: 'Variables',
		help: 'Keeps a value under a name, for Get Variable to read anywhere after it.',
		inputs: [flowIn, { id: 'name', label: 'name', type: 'text', def: 'count', field: true }, { id: 'value', label: 'value', type: 'any', def: 0 }],
		outputs: [next()],
		emit: (c) => c.line(`V[${lit(c.field('name'), 'text')}] = ${c.in('value')}`),
	},
	{
		type: 'addVar',
		title: 'Add to Variable',
		category: 'Variables',
		help: 'Adds an amount to a number variable (nothing set counts as 0).',
		inputs: [flowIn, { id: 'name', label: 'name', type: 'text', def: 'count', field: true }, num('amount', 'amount', 1)],
		outputs: [next()],
		emit: (c) => {
			const k = lit(c.field('name'), 'text')
			c.line(`V[${k}] = (V[${k}] or 0) + ${c.in('amount')}`)
		},
	},
	{
		type: 'getVar',
		title: 'Get Variable',
		category: 'Variables',
		help: 'The value Set Variable last kept under the name (nil when none).',
		inputs: [{ id: 'name', label: 'name', type: 'text', def: 'count', field: true }],
		outputs: [pin('value', 'value', 'any')],
		expr: (c) => `V[${lit(c.field('name'), 'text')}]`,
	},
	// Terrain.
	{
		type: 'forEachVertex',
		title: 'For Each Vertex',
		category: 'Terrain',
		help: 'Runs "body" for each terrain vertex in the selection, then writes the heights back.',
		inputs: [flowIn, pin('sel', 'selection', 'sel')],
		outputs: [exec('body', 'body'), pin('vertex', 'vertex', 'vert'), pin('position', 'position', 'vec'), next('done')],
		emit: (c) => {
			const s = c.subject('sel')
			const v = c.local('vertex')
			c.line(`for _, ${v} in ipairs(${s}:verts()) do`)
			c.block('body', true, () => c.local('position', `${v}:get_pos()`))
			c.line('end')
			c.line(`${s}:apply()`)
		},
	},
	{
		type: 'setHeight',
		title: 'Set Height',
		category: 'Terrain',
		help: 'Sets a vertex’s height, in yards.',
		inputs: [flowIn, pin('vertex', 'vertex', 'vert'), num('height', 'height', 0)],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('vertex')}:set_height(${c.in('height')})`),
	},
	{
		type: 'addHeight',
		title: 'Add Height',
		category: 'Terrain',
		help: 'Raises a vertex by an amount (lowers it for a negative one), in yards.',
		inputs: [flowIn, pin('vertex', 'vertex', 'vert'), num('amount', 'amount', 1)],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('vertex')}:add_height(${c.in('amount')})`),
	},
	{
		type: 'setAlpha',
		title: 'Set Texture Alpha',
		category: 'Terrain',
		help: 'Sets how much of a texture layer (1 to 3 above the base) covers the ground at a vertex, 0 to 1.',
		inputs: [flowIn, pin('vertex', 'vertex', 'vert'), num('layer', 'layer', 1), num('alpha', 'alpha', 1)],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('vertex')}:set_alpha(${c.in('layer')}, ${c.in('alpha')})`),
	},
	{
		type: 'setVertexHole',
		title: 'Set Hole',
		category: 'Terrain',
		help: 'Cuts (or fills) the hole at a vertex: the 2 by 2 cells a 1.12 tile cuts at once.',
		inputs: [flowIn, pin('vertex', 'vertex', 'vert'), bool('hole', 'hole')],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('vertex')}:set_hole(${c.in('hole')})`),
	},
	{
		type: 'setWater',
		title: 'Set Water',
		category: 'Terrain',
		help: 'Puts a liquid (a LiquidType ID; 0 removes it) at a vertex, its surface at a height.',
		inputs: [flowIn, pin('vertex', 'vertex', 'vert'), num('kind', 'liquid', 1), num('height', 'height', 0)],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('vertex')}:set_water(${c.in('kind')}, ${c.in('height')})`),
	},
	{
		type: 'vertexPos',
		title: 'Vertex Position',
		category: 'Terrain',
		help: 'Where a vertex is, its height as y.',
		inputs: [pin('vertex', 'vertex', 'vert')],
		outputs: [pin('position', 'position', 'vec')],
		expr: (c) => `${c.in('vertex')}:get_pos()`,
	},
	// Chunks.
	{
		type: 'forEachChunk',
		title: 'For Each Chunk',
		category: 'Chunks',
		help: 'Runs "body" for each chunk (8 by 8 cells) the selection reaches.',
		inputs: [flowIn, pin('sel', 'selection', 'sel')],
		outputs: [exec('body', 'body'), pin('chunk', 'chunk', 'chunk'), next('done')],
		emit: (c) => {
			const s = c.subject('sel')
			const ch = c.local('chunk')
			c.line(`for _, ${ch} in ipairs(${s}:chunks()) do`)
			c.block('body', true)
			c.line('end')
		},
	},
	{
		type: 'chunkAt',
		title: 'Chunk At',
		category: 'Chunks',
		help: 'The chunk under a position.',
		inputs: [pin('position', 'position', 'vec')],
		outputs: [pin('chunk', 'chunk', 'chunk')],
		expr: (c) => `get_chunk(${c.in('position')})`,
	},
	{
		type: 'chunkAddTexture',
		title: 'Add Texture',
		category: 'Chunks',
		help: 'Puts a texture on a chunk as its top layer; "layer" is the layer it got (-1 when the chunk has four).',
		width: 260,
		inputs: [flowIn, pin('chunk', 'chunk', 'chunk'), text('file', 'texture', 'Tileset\\Elwynn\\ElwynnGrassBase.blp')],
		outputs: [next(), pin('layer', 'layer', 'number')],
		emit: (c) => {
			const ch = c.subject('chunk')
			c.local('layer', `${ch}:add_texture(${c.in('file')})`)
		},
	},
	{
		type: 'chunkClearTextures',
		title: 'Clear Textures',
		category: 'Chunks',
		help: 'Takes every texture off a chunk.',
		inputs: [flowIn, pin('chunk', 'chunk', 'chunk')],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('chunk')}:clear_textures()`),
	},
	{
		type: 'chunkSetArea',
		title: 'Set Area ID',
		category: 'Chunks',
		help: 'Sets the zone (AreaTable ID) a chunk belongs to.',
		inputs: [flowIn, pin('chunk', 'chunk', 'chunk'), num('area', 'area ID', 0)],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('chunk')}:set_area_id(${c.in('area')})`),
	},
	{
		type: 'chunkSetHole',
		title: 'Set Chunk Hole',
		category: 'Chunks',
		help: 'Cuts (or fills) every cell of a chunk.',
		inputs: [flowIn, pin('chunk', 'chunk', 'chunk'), bool('hole', 'hole')],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('chunk')}:set_hole(${c.in('hole')})`),
	},
	{
		type: 'chunkArea',
		title: 'Chunk Area ID',
		category: 'Chunks',
		help: 'The zone (AreaTable ID) a chunk belongs to.',
		inputs: [pin('chunk', 'chunk', 'chunk')],
		outputs: [pin('area', 'area ID', 'number')],
		expr: (c) => `${c.in('chunk')}:get_area_id()`,
	},
	// Models.
	{
		type: 'addM2',
		title: 'Add M2',
		category: 'Models',
		help: 'Places a doodad (an .m2 of the client) at a position; rotation is in degrees, y the turn.',
		width: 260,
		inputs: [flowIn, text('file', 'model', 'World\\Generic\\Tree.m2'), pin('position', 'position', 'vec'), num('scale', 'scale', 1), { id: 'rot', label: 'rotation', type: 'vec', optional: true }],
		outputs: [next(), pin('model', 'model', 'model')],
		emit: (c) => {
			c.local('model', `add_m2(${c.in('file')}, ${c.in('position')}, ${c.in('scale')}, ${c.in('rot')})`)
		},
	},
	{
		type: 'addWmo',
		title: 'Add WMO',
		category: 'Models',
		help: 'Places a building (a .wmo of the client) at a position; rotation is in degrees, y the turn.',
		width: 260,
		inputs: [flowIn, text('file', 'model', ''), pin('position', 'position', 'vec'), { id: 'rot', label: 'rotation', type: 'vec', optional: true }],
		outputs: [next(), pin('model', 'model', 'model')],
		emit: (c) => {
			c.local('model', `add_wmo(${c.in('file')}, ${c.in('position')}, ${c.in('rot')})`)
		},
	},
	{
		type: 'forEachModel',
		title: 'For Each Model',
		category: 'Models',
		help: 'Runs "body" for each model whose position lies in the selection.',
		inputs: [flowIn, pin('sel', 'selection', 'sel')],
		outputs: [exec('body', 'body'), pin('model', 'model', 'model'), next('done')],
		emit: (c) => {
			const s = c.subject('sel')
			const m = c.local('model')
			c.line(`for _, ${m} in ipairs(${s}:models()) do`)
			c.block('body', true)
			c.line('end')
		},
	},
	{
		type: 'modelSetPos',
		title: 'Move Model',
		category: 'Models',
		help: 'Moves a model to a position.',
		inputs: [flowIn, pin('model', 'model', 'model'), pin('position', 'position', 'vec')],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('model')}:set_pos(${c.in('position')})`),
	},
	{
		type: 'modelSetRot',
		title: 'Rotate Model',
		category: 'Models',
		help: 'Sets a model’s rotation, in degrees (y the turn).',
		inputs: [flowIn, pin('model', 'model', 'model'), pin('rot', 'rotation', 'vec')],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('model')}:set_rot(${c.in('rot')})`),
	},
	{
		type: 'modelSetScale',
		title: 'Scale Model',
		category: 'Models',
		help: 'Sets a model’s scale (1 its own size).',
		inputs: [flowIn, pin('model', 'model', 'model'), num('scale', 'scale', 1)],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('model')}:set_scale(${c.in('scale')})`),
	},
	{
		type: 'modelRemove',
		title: 'Remove Model',
		category: 'Models',
		help: 'Takes a model off the map.',
		inputs: [flowIn, pin('model', 'model', 'model')],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('model')}:remove()`),
	},
	{
		type: 'modelReplace',
		title: 'Replace Model',
		category: 'Models',
		help: 'Puts another model of the same kind in a model’s place.',
		width: 260,
		inputs: [flowIn, pin('model', 'model', 'model'), text('file', 'with', 'World\\Generic\\Tree.m2')],
		outputs: [next()],
		emit: (c) => c.line(`${c.subject('model')}:replace(${c.in('file')})`),
	},
	{
		type: 'modelInfo',
		title: 'Model Info',
		category: 'Models',
		help: 'A model’s position, rotation (degrees), scale and file.',
		inputs: [pin('model', 'model', 'model')],
		outputs: [pin('position', 'position', 'vec'), pin('rot', 'rotation', 'vec'), pin('scale', 'scale', 'number'), pin('file', 'file', 'text')],
		expr: (c, out) => `${c.in('model')}:${{ position: 'get_pos', rot: 'get_rot', scale: 'get_scale', file: 'get_filename' }[out]}()`,
	},
	// Selections.
	{
		type: 'selectAround',
		title: 'Select Around',
		category: 'Selection',
		help: 'The square of ground a radius around a position.',
		inputs: [pin('center', 'center', 'vec'), num('radius', 'radius', 20)],
		outputs: [pin('sel', 'selection', 'sel')],
		hoist: true,
		expr: (c) => `select_origin(${c.in('center')}, ${c.in('radius')})`,
	},
	{
		type: 'selectBetween',
		title: 'Select Between',
		category: 'Selection',
		help: 'The box of ground between two corners.',
		inputs: [pin('a', 'corner', 'vec'), pin('b', 'corner', 'vec')],
		outputs: [pin('sel', 'selection', 'sel')],
		hoist: true,
		expr: (c) => `select_between(${c.in('a')}, ${c.in('b')})`,
	},
	{
		type: 'selectedArea',
		title: 'Selected Area',
		category: 'Selection',
		help: 'The area the Select tool selected; the run stops with an error when none is.',
		inputs: [],
		outputs: [pin('sel', 'selection', 'sel')],
		hoist: true,
		helpers: ['area'],
		expr: () => '__area()',
	},
	{
		type: 'selectionInfo',
		title: 'Selection Info',
		category: 'Selection',
		help: 'A selection’s middle, corners and size.',
		inputs: [pin('sel', 'selection', 'sel')],
		outputs: [pin('center', 'center', 'vec'), pin('min', 'min', 'vec'), pin('max', 'max', 'vec'), pin('size', 'size', 'vec')],
		expr: (c, out) => `${c.in('sel')}:${out}()`,
	},
	// The world.
	{
		type: 'targetPos',
		title: 'Camera Target',
		category: 'World',
		help: 'The ground the camera looks at.',
		inputs: [],
		outputs: [pin('position', 'position', 'vec')],
		hoist: true,
		expr: () => 'target_pos()',
	},
	{
		type: 'cameraPos',
		title: 'Camera Position',
		category: 'World',
		help: 'Where the camera is.',
		inputs: [],
		outputs: [pin('position', 'position', 'vec')],
		hoist: true,
		expr: () => 'camera_pos()',
	},
	{
		type: 'mapId',
		title: 'Map ID',
		category: 'World',
		help: 'The open map’s ID in the client’s Map.dbc (-1 for a map not in it).',
		inputs: [],
		outputs: [pin('id', 'map ID', 'number')],
		expr: () => 'get_map_id()',
	},
	{
		type: 'areaAt',
		title: 'Area ID At',
		category: 'World',
		help: 'The zone (AreaTable ID) at a position.',
		inputs: [pin('position', 'position', 'vec')],
		outputs: [pin('area', 'area ID', 'number')],
		expr: (c) => `get_area_id(${c.in('position')})`,
	},
	// Vectors: x and z across the ground, y up, in yards.
	{
		type: 'vector',
		title: 'Vector',
		category: 'Vectors',
		help: 'A position or rotation from its parts: x and z across the ground, y up.',
		inputs: [num('x', 'x', 0), num('y', 'y', 0), num('z', 'z', 0)],
		outputs: [pin('vec', 'vector', 'vec')],
		expr: (c) => `vec(${c.in('x')}, ${c.in('y')}, ${c.in('z')})`,
	},
	{
		type: 'splitVector',
		title: 'Split Vector',
		category: 'Vectors',
		help: 'A vector’s parts.',
		inputs: [pin('vec', 'vector', 'vec')],
		outputs: [pin('x', 'x', 'number'), pin('y', 'y', 'number'), pin('z', 'z', 'number')],
		expr: (c, out) => `${c.in('vec')}.${out}`,
	},
	{
		type: 'vectorMath',
		title: 'Vector Add',
		category: 'Vectors',
		help: 'Adds or takes one vector from another.',
		inputs: [pin('a', 'a', 'vec'), choice('op', 'op', ['+', '−']), pin('b', 'b', 'vec')],
		outputs: [pin('vec', 'vector', 'vec')],
		expr: (c) => `(${c.in('a')} ${c.field('op') === '−' ? '-' : '+'} ${c.in('b')})`,
	},
	{
		type: 'vectorScale',
		title: 'Vector Scale',
		category: 'Vectors',
		help: 'A vector times a number.',
		inputs: [pin('vec', 'vector', 'vec'), num('f', 'factor', 2)],
		outputs: [pin('vec', 'vector', 'vec')],
		helpers: ['vscale'],
		expr: (c) => `__vscale(${c.in('vec')}, ${c.in('f')})`,
	},
	{
		type: 'distance',
		title: 'Distance 2D',
		category: 'Vectors',
		help: 'How far apart two positions are across the ground, heights left out.',
		inputs: [pin('a', 'a', 'vec'), pin('b', 'b', 'vec')],
		outputs: [pin('d', 'distance', 'number')],
		expr: (c) => `dist_2d(${c.in('a')}, ${c.in('b')})`,
	},
	{
		type: 'rotate2d',
		title: 'Rotate 2D',
		category: 'Vectors',
		help: 'Turns a position about an origin across the ground, by degrees.',
		inputs: [pin('p', 'position', 'vec'), pin('o', 'origin', 'vec'), num('angle', 'degrees', 90)],
		outputs: [pin('vec', 'position', 'vec')],
		expr: (c) => `rotate_2d(${c.in('p')}, ${c.in('o')}, ${c.in('angle')})`,
	},
	// Maths.
	{
		type: 'number',
		title: 'Number',
		category: 'Maths',
		help: 'A number.',
		inputs: [num('value', '', 0)],
		outputs: [pin('value', 'number', 'number')],
		expr: (c) => c.in('value'),
	},
	{
		type: 'math',
		title: 'Math',
		category: 'Maths',
		help: 'Two numbers added, taken away, multiplied, divided, raised or the remainder.',
		inputs: [num('a', 'a', 0), choice('op', 'op', Object.keys(MATH_OPS)), num('b', 'b', 1)],
		outputs: [pin('value', 'result', 'number')],
		expr: (c) => `(${c.in('a')} ${MATH_OPS[String(c.field('op'))] ?? '+'} ${c.in('b')})`,
	},
	{
		type: 'mathFn',
		title: 'Function',
		category: 'Maths',
		help: 'A function of a number: sin, cos and tan take radians.',
		inputs: [num('x', 'x', 0), choice('fn', 'function', MATH_FNS)],
		outputs: [pin('value', 'result', 'number')],
		expr: (c) => {
			const fn = String(c.field('fn'))
			if (fn === 'negate') return `(-${c.in('x')})`
			return `${(MATH_FNS as readonly string[]).includes(fn) ? fn : 'abs'}(${c.in('x')})`
		},
	},
	{
		type: 'minMax',
		title: 'Min / Max',
		category: 'Maths',
		help: 'The smaller or the larger of two numbers.',
		inputs: [num('a', 'a', 0), choice('op', 'which', ['min', 'max']), num('b', 'b', 0)],
		outputs: [pin('value', 'result', 'number')],
		expr: (c) => `math.${c.field('op') === 'max' ? 'max' : 'min'}(${c.in('a')}, ${c.in('b')})`,
	},
	{
		type: 'clamp',
		title: 'Clamp',
		category: 'Maths',
		help: 'A number kept between a low and a high.',
		inputs: [num('value', 'value', 0), num('lo', 'low', 0), num('hi', 'high', 1)],
		outputs: [pin('value', 'result', 'number')],
		helpers: ['clamp'],
		expr: (c) => `__clamp(${c.in('value')}, ${c.in('lo')}, ${c.in('hi')})`,
	},
	{
		type: 'lerp',
		title: 'Lerp',
		category: 'Maths',
		help: 'The number a ratio of the way from one to another (0 the first, 1 the second).',
		inputs: [num('from', 'from', 0), num('to', 'to', 1), num('t', 'ratio', 0.5)],
		outputs: [pin('value', 'result', 'number')],
		expr: (c) => `lerp(${c.in('from')}, ${c.in('to')}, ${c.in('t')})`,
	},
	{
		type: 'falloff',
		title: 'Falloff',
		category: 'Maths',
		help: 'A smooth 1 at distance 0 down to 0 at the radius and past it: a brush’s shape.',
		inputs: [num('d', 'distance', 0), num('r', 'radius', 20)],
		outputs: [pin('value', 'weight', 'number')],
		helpers: ['falloff'],
		expr: (c) => `__falloff(${c.in('d')}, ${c.in('r')})`,
	},
	// Logic.
	{
		type: 'compare',
		title: 'Compare',
		category: 'Logic',
		help: 'Whether a number is less than, equal to or more than another.',
		inputs: [num('a', 'a', 0), choice('op', 'op', Object.keys(COMPARE_OPS)), num('b', 'b', 0)],
		outputs: [pin('value', 'result', 'bool')],
		expr: (c) => `(${c.in('a')} ${COMPARE_OPS[String(c.field('op'))] ?? '<'} ${c.in('b')})`,
	},
	{
		type: 'andOr',
		title: 'And / Or',
		category: 'Logic',
		help: 'Whether both conditions hold (and) or either does (or).',
		inputs: [bool('a', 'a'), choice('op', 'op', ['and', 'or']), bool('b', 'b')],
		outputs: [pin('value', 'result', 'bool')],
		expr: (c) => `(${c.in('a')} ${c.field('op') === 'or' ? 'or' : 'and'} ${c.in('b')})`,
	},
	{
		type: 'not',
		title: 'Not',
		category: 'Logic',
		help: 'True when the condition does not hold.',
		inputs: [bool('a', 'condition', false)],
		outputs: [pin('value', 'result', 'bool')],
		expr: (c) => `(not ${c.in('a')})`,
	},
	// Text.
	{
		type: 'text',
		title: 'Text',
		category: 'Text',
		help: 'A piece of text (a path, a name).',
		width: 240,
		inputs: [text('value', '', '')],
		outputs: [pin('value', 'text', 'text')],
		expr: (c) => c.in('value'),
	},
	{
		type: 'join',
		title: 'Join',
		category: 'Text',
		help: 'Two values written one after the other as text.',
		inputs: [
			{ id: 'a', label: 'a', type: 'any', def: '' },
			{ id: 'b', label: 'b', type: 'any', def: '' },
		],
		outputs: [pin('value', 'text', 'text')],
		expr: (c) => `(tostring(${c.in('a')}) .. tostring(${c.in('b')}))`,
	},
	// Random numbers.
	{
		type: 'randomSeed',
		title: 'Random Generator',
		category: 'Random',
		help: 'A random generator: the same seed gives the same numbers each run.',
		inputs: [text('seed', 'seed', 'meld')],
		outputs: [pin('random', 'random', 'random')],
		hoist: true,
		expr: (c) => `random_from_seed(${c.in('seed')})`,
	},
	{
		type: 'randomNumber',
		title: 'Random Number',
		category: 'Random',
		help: 'A new number from a generator each time it is read, from low up to high.',
		inputs: [pin('random', 'random', 'random'), num('lo', 'low', 0), num('hi', 'high', 1)],
		outputs: [pin('value', 'number', 'number')],
		expr: (c) => `${c.in('random')}:real(${c.in('lo')}, ${c.in('hi')})`,
	},
	{
		type: 'randomInteger',
		title: 'Random Integer',
		category: 'Random',
		help: 'A new whole number from a generator each time it is read, from low up to (not with) high.',
		inputs: [pin('random', 'random', 'random'), num('lo', 'low', 0), num('hi', 'high', 10)],
		outputs: [pin('value', 'number', 'number')],
		expr: (c) => `${c.in('random')}:integer(${c.in('lo')}, ${c.in('hi')})`,
	},
	// Noise.
	{
		type: 'noiseMap',
		title: 'Noise Map',
		category: 'Noise',
		help: 'Noise over a selection, about -1 to 1: the frequency sets its grain (smaller is broader).',
		inputs: [pin('sel', 'selection', 'sel'), num('freq', 'frequency', 0.02), choice('algo', 'kind', NOISE_NAMES), text('seed', 'seed', 'meld')],
		outputs: [pin('noise', 'noise', 'noise')],
		hoist: true,
		expr: (c) => `${c.in('sel')}:make_noise(${c.in('freq')}, ${lit(c.field('algo'), 'text')}, ${c.in('seed')})`,
	},
	{
		type: 'noiseValue',
		title: 'Noise Value',
		category: 'Noise',
		help: 'A noise map’s value at a position inside it.',
		inputs: [pin('noise', 'noise', 'noise'), pin('position', 'position', 'vec')],
		outputs: [pin('value', 'value', 'number')],
		expr: (c) => `${c.in('noise')}:get(${c.in('position')})`,
	},
]

const SPECS = new Map(NODE_SPECS.map((s) => [s.type, s]))

/** The spec of a node type, or undefined for one this Meld doesn't know. */
export function nodeSpec(type: string): NodeSpec | undefined {
	return SPECS.get(type)
}

/** Whether an output of type `from` may feed an input of type `to`. */
export function canLink(from: PinType, to: PinType): boolean {
	if (from === 'exec' || to === 'exec') return from === to
	return from === to || from === 'any' || to === 'any' || (from === 'number' && to === 'text')
}

/** Whether an input is a pin a link can reach (not a setting edited on the node). */
export const linkable = (p: PinSpec) => !p.options && !p.field

/** How many rows a node of this spec takes below its title. */
export function nodeRows(spec: NodeSpec): number {
	return Math.max(spec.inputs.length, spec.outputs.length, 1)
}

/** Where on the canvas a node's pin sits: inputs down its left edge, outputs down its right. */
export function pinPos(node: GraphNode, spec: NodeSpec, side: 'in' | 'out', id: string): { x: number; y: number } | null {
	const list = side === 'in' ? spec.inputs : spec.outputs
	const i = list.findIndex((p) => p.id === id)
	if (i < 0) return null
	return { x: node.x + (side === 'in' ? 0 : (spec.width ?? NODE_W)), y: node.y + NODE_HEAD + i * NODE_ROW + NODE_ROW / 2 }
}

/** A value as a Lua literal of its pin's type. */
export function lit(v: Value | undefined, type: PinType): string {
	if (type === 'number') {
		const n = Number(v)
		if (!Number.isFinite(n)) return n === Infinity ? 'math.huge' : n === -Infinity ? '(-math.huge)' : '0'
		return n < 0 ? `(${n})` : String(n)
	}
	if (type === 'bool') return v === true || v === 'true' ? 'true' : 'false'
	if (typeof v === 'number') return String(v)
	if (typeof v === 'boolean') return String(v)
	return luaString(v ?? '')
}

/** A Lua string literal. */
export function luaString(s: string): string {
	let out = '"'
	for (const ch of s) {
		const c = ch.codePointAt(0) ?? 0
		if (ch === '\\') out += '\\\\'
		else if (ch === '"') out += '\\"'
		else if (ch === '\n') out += '\\n'
		else if (ch === '\r') out += '\\r'
		else if (ch === '\t') out += '\\t'
		else if (c < 32 || c === 127) out += `\\${String(c).padStart(3, '0')}`
		else out += ch
	}
	return out + '"'
}

/** A failure to compile, at a node (or the graph as a whole, null). */
export class GraphError extends Error {
	constructor(
		message: string,
		readonly node: number | null,
	) {
		super(message)
	}
}

/** A value read outside where its flow node ran: the reader may fall back (a hoisted node is inlined). */
class ScopeError extends GraphError {}

export interface CompiledGraph {
	/** The Lua script. */
	lua: string
	/** The node that wrote each line of it (index 0 is line 1), for an error's line; null for the frame. */
	owners: (number | null)[]
}

/** Compiles a graph to a Lua script for the script API. Throws a GraphError naming the node at fault. */
export function compileGraph(graph: Graph, name = 'graph'): CompiledGraph {
	return new Compiler(graph, name).run()
}

class Compiler {
	private nodes = new Map<number, GraphNode>()
	private body: { text: string; owner: number | null }[] = []
	private top: { text: string; owner: number | null }[] = []
	private helpers = new Set<string>()
	private hoisted = new Map<string, string>()
	private scopes: Set<string>[] = [new Set()]
	private depth = 1
	private loops = 0
	private path = new Set<number>()
	private usesVars = false
	/** Set while a hoisted node is tried at the top, where no variable is set yet. */
	private hoisting = false

	constructor(
		private graph: Graph,
		private name: string,
	) {
		for (const n of graph.nodes) this.nodes.set(n.id, n)
	}

	run(): CompiledGraph {
		for (const n of this.graph.nodes) if (!SPECS.has(n.type)) throw new GraphError(`Meld has no node "${n.type}"`, n.id)
		const begins = this.graph.nodes.filter((n) => n.type === 'begin')
		if (!begins.length) throw new GraphError('The graph has no Begin node: add one (Flow › Begin) and link what should run to it.', null)
		if (begins.length > 1) throw new GraphError('The graph has more than one Begin node: keep one.', begins[1].id)
		this.chain(begins[0], 'next')
		const head: { text: string; owner: number | null }[] = [{ text: `-- ${this.name}: a node graph compiled by Meld's Node Editor.`, owner: null }]
		if (this.usesVars) head.push({ text: 'local V = {}', owner: null })
		for (const h of this.helpers) head.push({ text: HELPERS[h], owner: null })
		const all = [...head, ...this.top, ...this.body]
		if (!this.body.length) all.push({ text: "print('Nothing is linked to Begin.')", owner: begins[0].id })
		return { lua: all.map((l) => l.text).join('\n') + '\n', owners: all.map((l) => l.owner) }
	}

	private spec(n: GraphNode): NodeSpec {
		return SPECS.get(n.type) as NodeSpec
	}

	private linkInto(node: number, pin: string): GraphLink | undefined {
		return this.graph.links.find((l) => l.to === node && l.in === pin)
	}

	private linkFrom(node: number, pin: string): GraphLink | undefined {
		return this.graph.links.find((l) => l.from === node && l.out === pin)
	}

	private varName(node: number, pin: string): string {
		return `n${node}_${pin.replace(/\W/g, '')}`
	}

	private inScope(name: string): boolean {
		return this.scopes.some((s) => s.has(name))
	}

	/** Writes the flow from exec output `pin` of `from` at the current depth. */
	private chain(from: GraphNode, pin: string) {
		const l = this.linkFrom(from.id, pin)
		if (!l) return
		const n = this.nodes.get(l.to)
		if (!n) return
		this.emit(n)
	}

	private emit(n: GraphNode) {
		if (this.path.has(n.id)) throw new GraphError(`The flow comes back to ${this.spec(n).title}: use a loop node to run something again.`, n.id)
		this.path.add(n.id)
		const spec = this.spec(n)
		if (!spec.emit) throw new GraphError(`${spec.title} has no flow to run`, n.id)
		spec.emit(this.ctx(n, true) as EmitCtx)
		// Still on the path while what follows it is written, so a flow that leads back to it is caught.
		if (spec.outputs.some((p) => p.id === 'next' && p.type === 'exec')) this.chain(n, 'next')
		this.path.delete(n.id)
	}

	private write(text: string, owner: number | null) {
		this.body.push({ text: '\t'.repeat(this.depth - 1) + text, owner })
	}

	/** The Lua expression for input `pin` of node `n`. */
	private input(n: GraphNode, pin: string, seen: Set<number>): string {
		const spec = this.spec(n)
		const p = spec.inputs.find((x) => x.id === pin)
		if (!p) throw new GraphError(`${spec.title} has no input "${pin}"`, n.id)
		const l = linkable(p) ? this.linkInto(n.id, pin) : undefined
		if (l) {
			const src = this.nodes.get(l.from)
			if (src) return this.output(src, l.out, seen, n)
		}
		if (p.optional) return 'nil'
		if (p.def === undefined) throw new GraphError(`${spec.title}: link its ${p.label || pin}`, n.id)
		const v = n.values[pin] ?? p.def
		return lit(v, p.type === 'any' ? (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : 'text') : p.type)
	}

	/** The Lua expression for output `pin` of node `n`, read by `reader`. */
	private output(n: GraphNode, pin: string, seen: Set<number>, reader: GraphNode): string {
		const spec = this.spec(n)
		if (spec.emit) {
			const name = this.varName(n.id, pin)
			if (!this.inScope(name))
				throw new ScopeError(
					`${this.spec(reader).title} reads ${spec.title}’s ${spec.outputs.find((p) => p.id === pin)?.label ?? pin} where it hasn’t run: link it inside ${spec.title}’s body, or after it on the same flow.`,
					reader.id,
				)
			return name
		}
		if (seen.has(n.id)) throw new GraphError(`${spec.title} feeds its own input: data links can’t go round in a circle.`, n.id)
		const key = this.varName(n.id, pin)
		if (spec.hoist) {
			const done = this.hoisted.get(key)
			if (done) return done
			// Worked out at the top, where no flow node has run yet: when it reads one, it is inlined instead.
			const scopes = this.scopes
			const hoisting = this.hoisting
			this.scopes = [new Set()]
			this.hoisting = true
			try {
				const e = this.expr(n, pin, seen)
				this.top.push({ text: `local ${key} = ${e}`, owner: n.id })
				this.hoisted.set(key, key)
				return key
			} catch (err) {
				if (!(err instanceof ScopeError)) throw err
			} finally {
				this.scopes = scopes
				this.hoisting = hoisting
			}
		}
		return this.expr(n, pin, seen)
	}

	private expr(n: GraphNode, pin: string, seen: Set<number>): string {
		const spec = this.spec(n)
		if (!spec.expr) throw new GraphError(`${spec.title} gives no value`, n.id)
		if (n.type === 'getVar') {
			// A variable is set as the flow runs, so what reads one is never worked out at the top.
			if (this.hoisting) throw new ScopeError('', n.id)
			this.usesVars = true
		}
		for (const h of spec.helpers ?? []) this.helpers.add(h)
		const inner = new Set(seen)
		inner.add(n.id)
		return spec.expr(this.ctx(n, false, inner), pin)
	}

	private ctx(n: GraphNode, flow: boolean, seen = new Set<number>([n.id])): ExprCtx | EmitCtx {
		const spec = this.spec(n)
		for (const h of spec.helpers ?? []) this.helpers.add(h)
		const ctx: ExprCtx = {
			in: (pin) => this.input(n, pin, seen),
			field: (pin) => n.values[pin] ?? spec.inputs.find((p) => p.id === pin)?.def ?? '',
		}
		if (!flow) return ctx
		const emit: EmitCtx = {
			...ctx,
			line: (text) => this.write(text, n.id),
			local: (pin, expr) => {
				const name = this.varName(n.id, pin)
				if (expr !== undefined) this.write(`local ${name} = ${expr}`, n.id)
				this.scopes[this.scopes.length - 1].add(name)
				return name
			},
			subject: (pin) => {
				const e = this.input(n, pin, seen)
				if (/^[A-Za-z_]\w*$/.test(e)) return e
				const name = this.varName(n.id, pin)
				this.write(`local ${name} = ${e}`, n.id)
				return name
			},
			block: (pin, loop = false, start) => {
				// The loop's own locals (its index, vertex) were declared in the scope the node wrote them in; they
				// belong to the body, so move them into it.
				const outer = this.scopes[this.scopes.length - 1]
				const mine = spec.outputs.filter((p) => p.type !== 'exec').map((p) => this.varName(n.id, p.id))
				const inner = new Set<string>()
				for (const m of mine)
					if (loop && outer.has(m)) {
						outer.delete(m)
						inner.add(m)
					}
				this.scopes.push(inner)
				this.depth++
				if (loop) this.loops++
				start?.()
				const before = this.body.length
				this.chain(n, pin)
				if (this.body.length === before) this.write('-- (nothing linked)', n.id)
				if (loop) this.loops--
				this.depth--
				this.scopes.pop()
				// The loop's values are gone after it: a later read is an error, not a stale value.
				for (const m of mine) outer.delete(m)
			},
			run: (pin) => this.chain(n, pin),
			linked: (pin) => !!this.linkFrom(n.id, pin),
			fail: (message) => {
				throw new GraphError(message, n.id)
			},
			inLoop: () => this.loops > 0,
		}
		if (n.type === 'setVar' || n.type === 'addVar') this.usesVars = true
		return emit
	}
}

/** The node a runtime error's `name:line:` points at, or null. */
export function errorNode(compiled: CompiledGraph, name: string, error: string): number | null {
	const m = new RegExp(`(?:^|\\n|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):`).exec(error)
	if (!m) return null
	return compiled.owners[Number(m[1]) - 1] ?? null
}

// Files: a graph is kept as JSON (.mgraph in the scripts folder, internal/scripts).

const FORMAT = 'meld-node-graph'
const VERSION = 1

/** A graph as the text of its file. */
export function serializeGraph(graph: Graph): string {
	return JSON.stringify(
		{
			format: FORMAT,
			version: VERSION,
			nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y), values: n.values })),
			links: graph.links,
		},
		null,
		'\t',
	)
}

/**
 * A graph read from its file's text. A node of a type this Meld doesn't know is left out, with its links,
 * and named in `dropped`; a link to a pin the node lacks is left out too. Throws on text that is no graph.
 */
export function parseGraph(textIn: string): { graph: Graph; dropped: string[] } {
	const raw = JSON.parse(textIn) as unknown
	if (!raw || typeof raw !== 'object') throw new Error('not a node graph')
	const o = raw as { format?: unknown; version?: unknown; nodes?: unknown; links?: unknown }
	if (o.format !== FORMAT || !Array.isArray(o.nodes) || !Array.isArray(o.links)) throw new Error('not a node graph')
	if (typeof o.version === 'number' && o.version > VERSION) throw new Error(`the graph is of a newer Meld (version ${o.version})`)
	const dropped: string[] = []
	const nodes: GraphNode[] = []
	const ids = new Set<number>()
	for (const r of o.nodes as unknown[]) {
		const n = r as Partial<GraphNode>
		if (typeof n.id !== 'number' || typeof n.type !== 'string' || ids.has(n.id)) continue
		const spec = SPECS.get(n.type)
		if (!spec) {
			dropped.push(n.type)
			continue
		}
		const values: Record<string, Value> = {}
		if (n.values && typeof n.values === 'object') for (const [k, v] of Object.entries(n.values)) if ((typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') && spec.inputs.some((p) => p.id === k)) values[k] = v
		ids.add(n.id)
		nodes.push({ id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0, values })
	}
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const links: GraphLink[] = []
	for (const r of o.links as unknown[]) {
		const l = r as Partial<GraphLink>
		const a = byId.get(Number(l.from))
		const b = byId.get(Number(l.to))
		if (!a || !b || typeof l.out !== 'string' || typeof l.in !== 'string') continue
		const out = SPECS.get(a.type)?.outputs.find((p) => p.id === l.out)
		const inp = SPECS.get(b.type)?.inputs.find((p) => p.id === l.in)
		if (!out || !inp || !linkable(inp) || !canLink(out.type, inp.type)) continue
		links.push({ from: a.id, out: l.out, to: b.id, in: l.in })
	}
	return { graph: { nodes, links }, dropped }
}

/** Links output (from, out) to input (to, in), replacing what the input (a data input) or the output (a flow output) was linked to. */
export function connect(graph: Graph, from: number, out: string, to: number, inp: string): string | null {
	if (from === to) return 'A node can’t link to itself.'
	const a = graph.nodes.find((n) => n.id === from)
	const b = graph.nodes.find((n) => n.id === to)
	const po = a && SPECS.get(a.type)?.outputs.find((p) => p.id === out)
	const pi = b && SPECS.get(b.type)?.inputs.find((p) => p.id === inp)
	if (!po || !pi || !linkable(pi)) return 'Those pins can’t be linked.'
	if (!canLink(po.type, pi.type)) return `A ${typeName(po.type)} can’t go into a ${typeName(pi.type)} pin.`
	// A data input takes one value; a flow output leads to one node (a flow input can be reached from many).
	graph.links = graph.links.filter((l) => !(l.to === to && l.in === inp && pi.type !== 'exec') && !(l.from === from && l.out === out && po.type === 'exec'))
	graph.links.push({ from, out, to, in: inp })
	return null
}

/** A pin type's name in a message. */
export function typeName(t: PinType): string {
	return { exec: 'flow', number: 'number', bool: 'condition', text: 'text', vec: 'vector', sel: 'selection', vert: 'vertex', model: 'model', chunk: 'chunk', random: 'random generator', noise: 'noise map', any: 'value' }[t]
}

/** A new node of `type` at (x, y), its id one past the graph's highest. */
export function addNode(graph: Graph, type: string, x: number, y: number): GraphNode {
	const id = graph.nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1
	const node: GraphNode = { id, type, x: Math.round(x), y: Math.round(y), values: {} }
	graph.nodes.push(node)
	return node
}

/** Removes a node and its links. */
export function removeNode(graph: Graph, id: number) {
	graph.nodes = graph.nodes.filter((n) => n.id !== id)
	graph.links = graph.links.filter((l) => l.from !== id && l.to !== id)
}

/**
 * The graph a new one starts from: a hill raised where the camera looks, as the Scripts window's
 * starter raises one, each vertex lifted by a smooth falloff of its distance to the target.
 */
export function starterGraph(): Graph {
	const g: Graph = { nodes: [], links: [] }
	const at = (type: string, x: number, y: number, values: Record<string, Value> = {}) => {
		const n = addNode(g, type, x, y)
		n.values = values
		return n.id
	}
	const begin = at('begin', 0, 0)
	const say = at('print', 230, 0, { value: 'Raising a hill where the camera looks' })
	const target = at('targetPos', 0, 150)
	const sel = at('selectAround', 230, 130, { radius: 15 })
	const loop = at('forEachVertex', 460, 0)
	const dist = at('distance', 460, 150)
	const fall = at('falloff', 460, 240, { r: 15 })
	const amount = at('math', 690, 130, { op: '×', b: 10 })
	const raise = at('addHeight', 690, 0)
	const link = (from: number, out: string, to: number, inp: string) => connect(g, from, out, to, inp)
	link(begin, 'next', say, 'in')
	link(say, 'next', loop, 'in')
	link(target, 'position', sel, 'center')
	link(sel, 'sel', loop, 'sel')
	link(loop, 'body', raise, 'in')
	link(loop, 'vertex', raise, 'vertex')
	link(loop, 'position', dist, 'a')
	link(target, 'position', dist, 'b')
	link(dist, 'd', fall, 'd')
	link(fall, 'value', amount, 'a')
	link(amount, 'value', raise, 'amount')
	return g
}
