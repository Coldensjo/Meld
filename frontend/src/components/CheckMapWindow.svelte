<script lang="ts">
	import { untrack } from 'svelte'
	import { ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import type { Finding, Severity } from '../lib/check/findings'

	// File › Check Map (#176), after Hammer's Check for Problems: a floating list of what may show
	// wrong in the game, by check. A click takes the camera there and selects the model or spawn; a
	// finding with a safe fix has a button for it, one undo step. Check again re-runs the checks.

	let findings = $state<Finding[]>([])
	let unchecked = $state(0)
	let running = $state(false)
	let ran = $state(false)
	let fixed = $state(new Set<Finding>())

	async function run() {
		const e = engineRef.current
		if (!e || running) return
		running = true
		try {
			const r = await e.checkMap()
			findings = r.findings
			unchecked = r.unchecked
			fixed = new Set()
			ran = true
		} finally {
			running = false
		}
	}

	// Runs once each time the window opens.
	$effect(() => {
		if (ui.checkMap && !ran) untrack(() => void run())
		if (!ui.checkMap) ran = false
	})

	const groups = $derived.by(() => {
		const out = new Map<string, Finding[]>()
		for (const f of findings) {
			let list = out.get(f.check)
			if (!list) out.set(f.check, (list = []))
			list.push(f)
		}
		return [...out]
	})
	const count = (s: Severity) => findings.filter((f) => f.severity === s).length
	const GLYPH = { error: '✖', warning: '▲', info: '●' }
	const WORD = { error: 'Error', warning: 'Warning', info: 'Info' }
	const FIX_LABEL = { deleteModels: 'Delete copies', groundModels: 'Put on ground', cropWater: 'Crop water' }

	function fix(f: Finding) {
		engineRef.current?.fixFinding(f)
		fixed = new Set([...fixed, f])
	}

	function fixAll(list: Finding[]) {
		for (const f of list) if (f.fix && !fixed.has(f)) engineRef.current?.fixFinding(f)
		fixed = new Set([...fixed, ...list])
	}
</script>

{#if ui.checkMap}
	<aside class="check" aria-label="Check map">
		<header>
			<span>Check Map</span>
			<span class="right">
				{#if ran}
					<span class="counts">
						<span class="sev error" title="Errors: wrong in the game"><span aria-hidden="true">{GLYPH.error}</span> {count('error')}<span class="vh"> errors</span></span>
						<span class="sev warning" title="Warnings: probably wrong in the game"><span aria-hidden="true">{GLYPH.warning}</span> {count('warning')}<span class="vh"> warnings</span></span>
						<span class="sev info" title="Tidying"><span aria-hidden="true">{GLYPH.info}</span> {count('info')}<span class="vh"> notes</span></span>
					</span>
				{/if}
				<button class="again" disabled={running} onclick={run} title="Run the checks again">{running ? 'Checking…' : 'Check again'}</button>
			</span>
			<button class="close" onclick={() => (ui.checkMap = false)} title="Close" aria-label="Close the map check">✕</button>
		</header>
		<div class="list">
			{#if ran && !findings.length}
				<p class="empty">Nothing found: no floating, buried or doubled models, no spawns or paths under the ground or through walls, no chunks without a zone, no missing textures and no hidden water.</p>
			{/if}
			{#each groups as [check, list] (check)}
				{@const fixable = list.filter((f) => f.fix && !fixed.has(f))}
				<section>
					<h4>
						<span>{check}</span>
						<span class="n">{list.length}</span>
						{#if fixable.length > 1}
							<button onclick={() => fixAll(fixable)} title="Apply the fix to every finding of this check">{FIX_LABEL[fixable[0].fix!]} (all)</button>
						{/if}
					</h4>
					<ul>
						{#each list as f, i (i)}
							<li class:done={fixed.has(f)}>
								<button class="go {f.severity}" disabled={Number.isNaN(f.x) && f.target.kind === 'none'} onclick={() => engineRef.current?.focusFinding(f)} title="Go there">
									<span class="glyph" aria-hidden="true">{GLYPH[f.severity]}</span><span class="vh">{WORD[f.severity]}: </span>{f.message}
								</button>
								{#if f.fix && !fixed.has(f)}
									<button class="fix" onclick={() => fix(f)}>{FIX_LABEL[f.fix]}</button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/each}
			{#if unchecked}
				<p class="empty">{unchecked} models were still loading, so their heights weren't checked. Check again once they show.</p>
			{/if}
		</div>
	</aside>
{/if}

<style>
	.check {
		position: fixed;
		top: 96px;
		right: 300px;
		width: 380px;
		max-height: calc(100 * var(--vh) - 160px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: var(--z-window);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 28px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
	}
	.right {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}
	.counts {
		display: flex;
		gap: 4px;
	}
	.sev {
		font-family: var(--mono);
		font-weight: 400;
		padding: 0 5px;
		border-radius: 3px;
	}
	.sev.error {
		background: rgba(230, 80, 80, 0.25);
	}
	.sev.warning {
		background: rgba(230, 180, 60, 0.22);
	}
	.sev.info {
		background: rgba(120, 160, 230, 0.2);
	}
	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.glyph {
		display: inline-block;
		width: 1.3em;
		font-size: 9px;
	}
	.go.error .glyph {
		color: rgb(230, 80, 80);
	}
	.go.warning .glyph {
		color: rgb(230, 180, 60);
	}
	.go.info .glyph {
		color: rgb(120, 160, 230);
	}
	.again {
		font-size: 11px;
		padding: 1px 8px;
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
	.list {
		overflow-y: auto;
		min-height: 0;
		padding: 4px 0 8px;
	}
	section + section {
		border-top: 1px solid var(--border-soft);
	}
	h4 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 6px 12px 2px;
		font-size: 11px;
		color: var(--text);
	}
	h4 .n {
		font-family: var(--mono);
		font-weight: 400;
		color: var(--text-dim);
	}
	h4 button {
		margin-left: auto;
		font-size: 10px;
		padding: 0 6px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px 0 12px;
	}
	li.done {
		opacity: 0.45;
	}
	.go {
		flex: 1;
		min-width: 0;
		text-align: left;
		border: none;
		background: transparent;
		padding: 3px 0 3px 10px;
		font-size: 11px;
		color: var(--text);
		border-left: 3px solid transparent;
		white-space: normal;
	}
	.go:hover:not(:disabled) {
		background: var(--hover, rgba(255, 255, 255, 0.05));
	}
	.go.error {
		border-left-color: rgb(230, 80, 80);
	}
	.go.warning {
		border-left-color: rgb(230, 180, 60);
	}
	.go.info {
		border-left-color: rgb(120, 160, 230);
	}
	.go:disabled {
		cursor: default;
	}
	.fix {
		flex: none;
		font-size: 10px;
		padding: 1px 6px;
	}
	.empty {
		margin: 8px 12px;
		font-size: 11px;
		color: var(--text-dim);
	}
</style>
