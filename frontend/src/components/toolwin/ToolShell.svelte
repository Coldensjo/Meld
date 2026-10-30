<script lang="ts">
	import HistoryToolWindow from './HistoryToolWindow.svelte'
	import InspectorToolWindow from './InspectorToolWindow.svelte'
	import { EDITOR_WINDOWS, type EditorKind } from '../../lib/toolwin/editors'

	// The page of a tool window open as its own OS window (#909, app_toolwindows.go): main.ts mounts this in
	// place of App.svelte for `?window=<kind>`. No Engine, no map, no prefs: the window shows what the main
	// page publishes over the channel (lib/toolwin) and sends its commands back.

	let { kind }: { kind: string } = $props()

	const isEditorKind = (k: string): k is EditorKind => k in EDITOR_WINDOWS

	// The brush editor brings three.js (its model preview) and the client's model list, so it is imported only
	// in its own window, and History's and the Inspector's stay light.
	const brushEditor = () => import('./DoodadBrushToolWindow.svelte')
	// A database editor (#912) brings its editor's modules, so it is imported only in its window too.
	const editorWindow = () => import('./EditorToolWindow.svelte')
</script>

{#if kind === 'history'}
	<HistoryToolWindow />
{:else if kind === 'inspector'}
	<InspectorToolWindow />
{:else if kind === 'doodad-brushes'}
	{#await brushEditor() then m}
		<m.default />
	{/await}
{:else if isEditorKind(kind)}
	{#await editorWindow() then m}
		<m.default {kind} />
	{/await}
{:else}
	<p class="unknown">No tool window called “{kind}”.</p>
{/if}

<style>
	.unknown {
		margin: 12px;
		color: var(--text-dim);
	}
</style>
