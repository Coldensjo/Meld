<script lang="ts">
	import type { Snippet } from 'svelte'
	import { takeEscape, leaveField } from '../lib/state/escape'
	import { ui } from '../lib/state/editor.svelte'
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import type { EditorFlow } from '../lib/ui/templateEditor.svelte'

	// The frame of a database editor (#576), full screen over the editor: the header (the editor's
	// title and buttons, then Close), the bars under it (the editor's own, then the Discard bar, the
	// error and the note), and the editor's body. Esc leaves a field first, then closes what the editor
	// has open over its body (`back`), then the Discard bar, then the editor.

	interface Props {
		ed: EditorFlow
		/** The dialog's name, for screen readers and the probes. */
		label: string
		/** Its place in the stack of full-screen editors (the quest editor opens over the creature editor). */
		z: number
		/** What the Discard bar says is unsaved, as a sentence. */
		unsavedText: string
		/** Something over the editor takes its own Esc (another editor, a right-click menu). */
		blocked?: () => boolean
		/** Closes what the editor has open over its body on Esc, if anything; true when it did. */
		back?: () => boolean
		title: Snippet
		actions?: Snippet
		/** Bars of the editor's own (a confirmation), above the Discard bar. */
		bars?: Snippet
		children: Snippet
	}

	let { ed, label, z, unsavedText, blocked, back, title, actions, bars, children }: Props = $props()

	let root = $state<HTMLElement>()

	function onKey(e: KeyboardEvent) {
		// A right-click menu open over the editor (a row's Copy id, #681) takes the Esc.
		if (e.key !== 'Escape' || ui.contextMenu || blocked?.()) return
		if (!takeEscape(e, root)) return
		if (leaveField(e)) return
		e.preventDefault()
		if (back?.()) return
		if (ed.confirmClose && ed.unsaved) ed.confirmClose = false
		else ed.close()
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="editor" style:z-index={z} role="dialog" aria-modal="true" aria-label={label} bind:this={root} use:dialogFocus>
	<header>
		<div class="title">{@render title()}</div>
		<div class="actions">
			{@render actions?.()}
			<button onclick={() => ed.close()} title="Close (Esc)">Close</button>
		</div>
	</header>
	{@render bars?.()}
	{#if ed.confirmClose && ed.unsaved}
		<div class="bar warn">
			<span>{unsavedText}</span>
			<button onclick={() => (ed.confirmClose = false)}>Keep editing</button>
			<button class="danger" onclick={() => ed.discard()}>Discard them</button>
		</div>
	{/if}
	{#if ed.error}<div class="bar error">{ed.error}</div>{/if}
	{#if ed.note && !ed.error}<div class="bar ok">{ed.note}</div>{/if}
	{@render children()}
</div>

<style>
	.editor {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.title {
		flex: 1;
		min-width: 0;
	}
	.title :global(h2) {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	/* The editor's own bars (bars) are its children too, styled here; the child combinator keeps the rules off the components inside the body. */
	.editor > :global(.bar) {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		font-size: 12px;
		border-bottom: 1px solid var(--border);
	}
	.editor > :global(.bar.warn span) {
		flex: 1;
	}
	.editor > :global(.bar.error) {
		color: var(--danger-text);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.editor > :global(.bar.ok) {
		color: var(--ok);
	}
	.editor > :global(.body) {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	/* The tab bars: only the editors' own are nav.tabs. */
	.editor :global(nav.tabs) {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 8px 12px 0;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.editor :global(nav.tabs > button) {
		border-radius: 4px 4px 0 0;
		border-bottom: none;
	}
	.editor :global(nav.tabs > button.on) {
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
