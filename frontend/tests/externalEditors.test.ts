import './runes.ts'
import { afterEach, expect, test } from 'bun:test'
const { databaseEditorOpen } = await import('../src/lib/io/external.ts')
const { editorWindowTarget } = await import('../src/lib/toolwin/editorHost.svelte.ts')
const { ui } = await import('../src/lib/state/editor.svelte.ts')

afterEach(() => {
	for (const k of Object.keys(editorWindowTarget)) delete (editorWindowTarget as Record<string, unknown>)[k]
	ui.itemEditor = null
})

test('no editor open', () => {
	expect(databaseEditorOpen()).toBe(false)
})

test('an editor open in its own window counts, and not once it closed', () => {
	;(editorWindowTarget as Record<string, unknown>).creature = { key: 'x' }
	expect(databaseEditorOpen()).toBe(true)
	;(editorWindowTarget as Record<string, unknown>).creature = null
	expect(databaseEditorOpen()).toBe(false)
})
