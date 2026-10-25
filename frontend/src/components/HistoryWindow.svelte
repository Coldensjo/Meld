<script lang="ts">
	import { tick } from 'svelte'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { HISTORY_BYTES, HISTORY_LIMIT } from '../lib/state/history'

	// A floating History window (Noggit Red's action history navigator): the active map's undo stack,
	// oldest first, where a click undoes or redoes to that step. The steps past the current one are
	// the ones Redo would bring back, shown dimmed. It re-reads the stack when ui.historyVersion moves.

	const steps = $derived.by(() => {
		void ui.historyVersion
		return engineRef.current?.history.steps() ?? []
	})
	const position = $derived.by(() => {
		void ui.historyVersion
		return engineRef.current?.history.position ?? 0
	})

	// What the steps hold (#444) and whether older ones were dropped for the step or byte limit.
	const held = $derived.by(() => {
		void ui.historyVersion
		const h = engineRef.current?.history
		return { bytes: h?.bytes ?? 0, trimmed: h?.trimmed ?? false }
	})
	const mb = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)

	let list = $state<HTMLOListElement>()

	// Keeps the current step in view as steps are added or undone.
	$effect(() => {
		void position
		void steps
		tick().then(() => list?.querySelector('.current')?.scrollIntoView({ block: 'nearest' }))
	})

	const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

	function go(to: number) {
		const e = engineRef.current
		if (!e || to === position) return
		const from = position
		e.goToHistory(to)
		const n = Math.abs(to - from)
		setStatus(`${to < from ? 'Undid' : 'Redid'} ${n} step${n === 1 ? '' : 's'}.`, 2000)
	}
</script>

{#if ui.history}
	<aside class="history" aria-label="History">
		<header>
			<span>History</span>
			<span class="count" title="The most steps kept is {HISTORY_LIMIT}, holding at most {mb(HISTORY_BYTES)} of saved terrain together; past either the oldest go.">{steps.length} / {HISTORY_LIMIT} · {mb(held.bytes)}</span>
			<button class="close" onclick={() => (ui.history = false)} title="Close" aria-label="Close the history">✕</button>
		</header>
		<ol bind:this={list}>
			<li>
				<button class:current={position === 0} onclick={() => go(0)} title="Undo every step">
					<span class="label">{held.trimmed ? 'Oldest kept state' : 'Opened'}</span>
				</button>
			</li>
			{#each steps as step, i (i)}
				<li>
					<button class:current={position === i + 1} class:undone={i >= position} onclick={() => go(i + 1)}>
						<span class="label">{step.label}</span>
						<span class="time">{time(step.at)}</span>
					</button>
				</li>
			{/each}
		</ol>
		{#if !steps.length}
			<p class="empty">No edits yet. Each edit you make is a step here.</p>
		{/if}
	</aside>
{/if}

<style>
	.history {
		position: fixed;
		top: 96px;
		left: 52px;
		width: 260px;
		max-height: calc(100 * var(--vh) - 160px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: 40;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
	}
	.count {
		margin-left: auto;
		font-weight: 400;
		font-family: var(--mono);
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.close:hover {
		color: var(--text);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		overflow-y: auto;
		min-height: 0;
	}
	li button {
		display: flex;
		width: 100%;
		gap: 8px;
		align-items: baseline;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 3px 12px;
		text-align: left;
		font-size: 12px;
		color: var(--text);
	}
	li button:hover {
		background: var(--panel-2);
	}
	li button.current {
		background: var(--accent);
		color: var(--accent-ink);
	}
	li button.undone:not(.current) {
		color: var(--text-dim);
		font-style: italic;
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.time {
		flex: none;
		font-family: var(--mono);
		font-size: 10px;
		opacity: 0.7;
	}
	.empty {
		margin: 0;
		padding: 4px 12px 10px;
		font-size: 11px;
		color: var(--text-dim);
	}
</style>
