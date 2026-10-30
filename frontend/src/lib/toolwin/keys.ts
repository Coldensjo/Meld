// What the main page does with a key a tool window forwarded (#919, channel.ts keyCommand): the editing
// shortcuts, Undo and Redo, under whichever keys the user bound them to. The Inspector's window has more
// (Esc and its own key close it, components/Inspector.svelte); the other windows only undo and redo.
import { commandFor } from '../ui/commands'
import { readKeyCommand, type ToolCommand } from './channel'

/** The editing command a forwarded key stands for, or null when `cmd` is not a key or not an editing one. */
export function forwardedEditCommand(cmd: ToolCommand): 'undo' | 'redo' | null {
	const key = readKeyCommand(cmd)
	if (!key) return null
	const id = commandFor(key, true) ?? commandFor(key, false)
	return id === 'undo' || id === 'redo' ? id : null
}
