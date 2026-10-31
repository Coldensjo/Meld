<script lang="ts">
	import { ReadQuestChain } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'
	import { ui } from '../lib/state/editor.svelte'
	import { refName, refTarget } from '../lib/wow/refNames'
	import { chainGraph, groupText, questLabel, type ChainEdge, type ChainGraph, type ChainNode } from '../lib/world/questGraph'
	import { QUEST_LINK_LABEL } from '../lib/world/questChain'
	import LayeredGraph from './LayeredGraph.svelte'

	// The quest editor's Chain tab (#948): the open quest and every quest linked to it, as saved in the
	// world database (one ReadQuestChain call), drawn from the first step to the last with each quest's
	// level, giver, ender and zone, and the problems the graph shows (lib/world/questGraph.ts). A box
	// opens its quest in the editor. Read only: the links are edited in the quest's fields.
	let { entry, onopen }: { entry: number; onopen: (entry: number) => void } = $props()

	let chain = $state<vmangos.QuestChain | null>(null)
	let error = $state('')
	let loading = $state(false)
	let zones = $state<Record<number, string>>({})

	$effect(() => {
		const e = entry
		void ui.questsVersion
		let live = true
		loading = true
		error = ''
		ReadQuestChain(e)
			.then((c) => {
				if (!live) return
				chain = c
				for (const q of c.quests ?? []) {
					const t = refTarget('zone or sort', q.zone)
					if (!t || q.zone in zones) continue
					void refName(t.kind, t.id).then((r) => (zones[q.zone] = r?.name ?? `${t.kind} ${t.id}`))
				}
			})
			.catch((err) => live && (error = String(err)))
			.finally(() => live && (loading = false))
		return () => (live = false)
	})

	const graph = $derived<ChainGraph | null>(chain && chain.root === entry ? chainGraph(chain) : null)
	const flagged = $derived(graph ? graph.nodes.filter((n) => n.problems.length) : [])
	const groupSize = (g: number) => graph?.groups.get(g)?.length ?? 0

	const holders = (hs: vmangos.ChainHolder[] | null) => {
		const list = hs ?? []
		if (!list.length) return ''
		const named = list.slice(0, 2).map((h) => h.name || `${h.kind} ${h.id}`)
		return named.join(', ') + (list.length > 2 ? ` +${list.length - 2}` : '')
	}
	const levelText = (q: vmangos.ChainQuest) => `${q.level > 0 ? `Level ${q.level}` : 'Scales'}${q.minLevel > 0 ? ` · min ${q.minLevel}` : ''}`
	const edgeTitle = (e: ChainEdge) => {
		const how = e.cols.map((c) => QUEST_LINK_LABEL[c]).join(', ')
		return `${e.from} → ${e.to}: ${how}${e.step ? '' : ' (held at once, not done first)'}${e.jump !== null ? `, ${e.jump} levels up` : ''}${e.loop ? ', closes a loop' : ''}`
	}
	const tone = (e: ChainEdge) => (e.missing || e.loop ? 'bad' : e.jump !== null ? 'warn' : 'plain')
</script>

<div class="chain">
	{#if error}
		<p class="err">{error}</p>
	{:else if !graph}
		<p class="dim">{loading ? 'Reading the chain…' : ''}</p>
	{:else}
		<p class="dim">
			{graph.nodes.length === 1 ? 'This quest links to no other quest.' : `The ${graph.nodes.length} quests of its chain, first to last, as saved in the world database.`}
			Solid arrows must be done first; dashed ones are held at once (a negative link, a breadcrumb).
			{chain?.capped ? `The walk stopped at ${graph.nodes.length} quests.` : ''}
		</p>
		{#if flagged.length}
			<ul class="problems" aria-label="Chain problems">
				{#each flagged as n (n.entry)}
					{#each n.problems as p, i (i)}
						<li>
							<button class="link" disabled={!n.quest || n.entry === entry} onclick={() => onopen(n.entry)}>{questLabel({ entry: n.entry, title: n.quest?.title })}</button>: {p}
						</li>
					{/each}
				{/each}
			</ul>
		{/if}
		<div class="canvas">
			<LayeredGraph nodes={graph.nodes} edges={graph.edges} key={(n: ChainNode) => n.entry} {edgeTitle} edgeTone={tone} edgeDashed={(e: ChainEdge) => !e.step}>
				{#snippet node(n: ChainNode)}
					{@const q = n.quest}
					<button
						class="quest"
						data-entry={n.entry}
						class:root={n.entry === entry}
						class:missing={!q}
						class:flagged={n.problems.length > 0}
						disabled={!q || n.entry === entry}
						title={n.problems.join('\n')}
						onclick={() => onopen(n.entry)}
					>
						{#if q}
							<span class="head"><strong>{q.title || '(no title)'}</strong><span class="dim">{q.entry}</span></span>
							<span>{levelText(q)}{q.zone ? ` · ${zones[q.zone] ?? '…'}` : ''}</span>
							<span class:bad={!(q.givers ?? []).length}>From: {holders(q.givers) || 'nothing'}</span>
							<span class:bad={!(q.enders ?? []).length}>To: {holders(q.enders) || 'nothing'}</span>
							{#if q.group && groupSize(q.group) > 1}<span class="group" title={groupText(q.group, groupSize(q.group))}>{q.group > 0 ? 'One of' : 'All of'} group {q.group}</span>{/if}
						{:else}
							<span class="head"><strong>Missing quest</strong><span class="dim">{n.entry}</span></span>
							<span>No quest_template row</span>
						{/if}
					</button>
				{/snippet}
			</LayeredGraph>
		</div>
	{/if}
</div>

<style>
	.chain {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
	}
	p {
		margin: 0;
	}
	.err {
		color: var(--danger-text);
	}
	.problems {
		margin: 0;
		padding-left: 18px;
		font-size: 12px;
		max-height: 140px;
		overflow-y: auto;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent-text);
		cursor: pointer;
	}
	.link:disabled {
		color: var(--text);
		cursor: default;
	}
	.canvas {
		overflow: auto;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		background: var(--bg);
	}
	.quest {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
		padding: 6px 8px;
		text-align: left;
		font-size: 12px;
		background: var(--panel);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.quest > span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.quest:not(:disabled):hover {
		border-color: var(--accent);
	}
	.quest:disabled {
		opacity: 1;
		cursor: default;
	}
	.quest.root {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.quest.flagged {
		border-color: var(--warn);
	}
	.quest.missing {
		border-style: dashed;
		border-color: var(--danger);
		background: transparent;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 6px;
	}
	.head strong {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bad {
		color: var(--bad);
	}
	.group {
		color: var(--accent-text);
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
</style>
