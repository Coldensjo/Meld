// Brush stacks for the Stamp tool, after Noggit Red's (`ui/tools/BrushStack/`, approved by the owner):
// a named, ordered list of sculpt and paint brushes that one stroke applies together, each brush with
// its own mode or texture, size, strength, falloff and turn, or taking the stack's (the Stamp tool's
// own brush settings) where it inherits them. Kept free of three.js so it can be tested on its own.
import type { SculptMode } from '../state/editor.svelte'

/** The sculpt modes a stack brush can have: the shaping ones (Vertex and Hole aren't brushes). */
export const STACK_SCULPT_MODES: SculptMode[] = ['raise', 'lower', 'smooth', 'blur', 'flatten', 'noise', 'mountain', 'crevice', 'terrace']

export interface StackItem {
	/** A sculpt brush (by `mode`) or a paint brush (with `texture`). */
	tool: 'sculpt' | 'paint'
	/** Off, the stroke skips it. */
	on: boolean
	mode: SculptMode
	/** The texture a paint brush lays down: a tileset path (or a '#rrggbb' colour). */
	texture: string
	radius: number
	strength: number
	falloff: number
	/** The image brush's turn, in degrees. */
	rotation: number
	/** Take the stack's radius, strength and turn instead of the brush's own. */
	inheritRadius: boolean
	inheritStrength: boolean
	inheritRotation: boolean
}

export interface BrushStack {
	name: string
	items: StackItem[]
}

/** A new brush of the stack, inheriting the stack's size, strength and turn. */
export function newStackItem(tool: 'sculpt' | 'paint', texture = ''): StackItem {
	return {
		tool,
		on: true,
		mode: 'raise',
		texture,
		radius: 16,
		strength: 0.5,
		falloff: 0.5,
		rotation: 0,
		inheritRadius: true,
		inheritStrength: true,
		inheritRotation: true,
	}
}

/** The stack's own settings, which an item takes where it inherits: the Stamp tool's brush. */
export interface StackBrush {
	radius: number
	strength: number
	rotation: number
}

/** The settings fields an item sets on a copy of the editor's state. */
export interface ItemSettingsTarget {
	sculptMode: SculptMode
	paintMode: string
	paintSpray: boolean
	paintLayer: number
	sculptPaint: string
	sculptLimit: string
	brush: { radius: number; strength: number; falloff: number }
	brushImage: { rotation: number; random: boolean }
}

/**
 * Sets on `s` (a copy of the editor's state, not the editor) what the brush tools read for `item`:
 * its sculpt mode or texture (`texIndex`, its palette slot), and its size, strength, falloff and turn,
 * or the stack's where it inherits. A stack brush shapes or paints only, so sculpting doesn't also paint,
 * painting is the plain texture brush, and the edit limit is off.
 */
export function applyItem<T extends ItemSettingsTarget>(s: T, item: StackItem, stack: StackBrush, texIndex: number): T {
	s.sculptMode = item.mode
	s.paintMode = 'texture'
	s.paintSpray = false
	s.paintLayer = texIndex
	s.sculptPaint = 'off'
	s.sculptLimit = 'none'
	s.brush.radius = item.inheritRadius ? stack.radius : item.radius
	s.brush.strength = item.inheritStrength ? stack.strength : item.strength
	s.brush.falloff = item.falloff
	s.brushImage.rotation = item.inheritRotation ? stack.rotation : item.rotation
	s.brushImage.random = false
	return s
}

/** A name not yet taken by the stacks, from `base`. */
export function freeStackName(stacks: readonly BrushStack[], base = 'Stack'): string {
	const taken = new Set(stacks.map((s) => s.name))
	if (!taken.has(base)) return base
	for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`
}
