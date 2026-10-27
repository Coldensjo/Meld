<script lang="ts">
	import { onMount } from 'svelte'
	import OptSlider from './OptSlider.svelte'
	import { ListScripts } from '../../wailsjs/go/main/App'
	import { MAX_BRUSH_RADIUS, editor, prefs, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { scriptBrush, scriptSay } from '../lib/script/scriptBrush.svelte'
	import type { TagValue } from '../lib/script/scriptApi'

	// The Script Brush tool's options (#29): the brush script from the scripts folder (the .lua files that
	// call brush()), the brush when it makes several, the size and falloff (Noggit Red's outer and inner
	// radius), and the brush's tags as controls. A change goes to the loaded script at once
	// (Engine.scriptBrushes.setTag) and is kept in prefs.scriptBrushTags for the next time it loads.

	let files = $state<{ name: string; text: string }[]>([])
	let loading = $state(false)
	const brushFiles = $derived(files.filter((f) => /\bbrush\s*\(/.test(f.text)))
	const baseName = (file: string) => file.replace(/\.lua$/i, '')
	const brush = $derived(scriptBrush.brushes[scriptBrush.active])
	const rightOnly = $derived(!!brush && brush.handles.length > 0 && brush.handles.every((h) => h.startsWith('right_')))

	async function refresh() {
		if (!hasBackend()) return
		try {
			files = (await ListScripts()) ?? []
		} catch (e) {
			setStatus(`The scripts folder could not be read: ${e}`, 8000)
		}
	}

	/** Loads a script of the folder into the tool by running it (Engine.runScript keeps its brushes). */
	async function load(file: string) {
		const f = files.find((x) => x.name === file)
		const e = engineRef.current
		if (!f || !e || loading) return
		loading = true
		try {
			const r = await e.runScript(f.text, baseName(f.name), (s) => scriptSay(s, 'out'), f.name)
			if (!r) return
			if (!r.ok) {
				scriptSay(r.error ?? 'The script failed.', 'err')
				setStatus(`${baseName(f.name)} failed: see Tools › Scripts.`, 6000)
			} else if (!r.brushes.length) setStatus(`${baseName(f.name)} makes no brush: it ran once instead.`, 6000)
		} finally {
			loading = false
		}
	}

	async function reload() {
		await refresh()
		const file = scriptBrush.file || prefs.scriptBrush
		if (file) await load(file)
	}

	// The last script comes back when the tool is first picked.
	onMount(() => {
		void refresh().then(() => {
			if (!scriptBrush.name && prefs.scriptBrush && files.some((f) => f.name === prefs.scriptBrush)) void load(prefs.scriptBrush)
		})
	})

	const setTag = (k: number, v: TagValue) => engineRef.current?.scriptBrushes.setTag(scriptBrush.active, k, v)
	const numberOf = (k: number) => {
		const v = brush?.values[k]
		return typeof v === 'number' ? v : 0
	}
	function onNumber(k: number, low: number, high: number, int: boolean, e: Event) {
		const v = parseFloat((e.target as HTMLInputElement).value)
		if (Number.isFinite(v)) setTag(k, Math.min(high, Math.max(low, int ? Math.round(v) : v)))
	}
</script>

<select
	class="pick"
	value={scriptBrush.file}
	onfocus={refresh}
	onchange={(e) => void load((e.target as HTMLSelectElement).value)}
	disabled={loading}
	title="The brush script: a .lua file of the scripts folder that calls brush()"
	aria-label="Brush script"
>
	{#if !scriptBrush.name}<option value="">{brushFiles.length ? 'Pick a brush script' : 'No brush scripts'}</option>{/if}
	{#if scriptBrush.name && !scriptBrush.file}<option value="">{scriptBrush.name} (unsaved)</option>{/if}
	{#each brushFiles as f (f.name)}
		<option value={f.name}>{baseName(f.name)}</option>
	{/each}
</select>
{#if scriptBrush.brushes.length > 1}
	<select class="pick" bind:value={scriptBrush.active} title="The brush of the script to paint with" aria-label="Brush">
		{#each scriptBrush.brushes as b, i (i)}
			<option value={i}>{b.name}</option>
		{/each}
	</select>
{/if}
<button onclick={reload} disabled={loading || !hasBackend()} title="Read the script again from the scripts folder and load it">Reload</button>
<button onclick={() => (ui.scripts = true)} title="Write and run scripts (Tools › Scripts)">Scripts…</button>
<div class="divider"></div>
<OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={MAX_BRUSH_RADIUS} step={0.5} digits={1} title="The brush's outer radius ( [ / ] ), evt:outer_radius()" />
<OptSlider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} digits={2} title="The part of the radius that fades out: evt:inner_radius() is one minus it" />
{#if brush}
	<div class="divider"></div>
	{#each brush.tags as t, k (k)}
		{#if t.kind === 'int' || t.kind === 'real'}
			{#if t.high - t.low <= 100000}
				<OptSlider
					label={t.label}
					bind:value={() => numberOf(k), (v) => setTag(k, t.kind === 'int' ? Math.round(v) : v)}
					min={t.low}
					max={t.high}
					step={t.kind === 'int' ? 1 : Math.max(10 ** -t.digits, (t.high - t.low) / 1000)}
					digits={t.digits}
				/>
			{:else}
				<label class="field">
					<span>{t.label}</span>
					<input class="num" type="number" min={t.low} max={t.high} value={numberOf(k)} onchange={(e) => onNumber(k, t.low, t.high, t.kind === 'int', e)} />
				</label>
			{/if}
		{:else if t.kind === 'string'}
			<label class="field">
				<span>{t.label}</span>
				<input type="text" spellcheck="false" value={String(brush.values[k] ?? '')} onchange={(e) => setTag(k, (e.target as HTMLInputElement).value)} />
			</label>
		{:else if t.kind === 'bool'}
			<label class="field check"><input type="checkbox" checked={brush.values[k] === true} onchange={(e) => setTag(k, (e.target as HTMLInputElement).checked)} /> {t.label}</label>
		{:else if t.kind === 'list'}
			<label class="field">
				<span>{t.label}</span>
				<select value={brush.values[k]} onchange={(e) => setTag(k, (e.target as HTMLSelectElement).value)}>
					{#each t.values as v (v)}<option value={v}>{v}</option>{/each}
				</select>
			</label>
		{:else if t.kind === 'description'}
			<span class="dim">{t.label}</span>
		{:else}
			<div class="divider"></div>
		{/if}
	{/each}
	{#if rightOnly}
		<span class="warn" title="The right mouse button moves the camera in Meld, so on_right_click, on_right_hold and on_right_release never run">This brush only handles the right mouse button, which Meld keeps for the camera</span>
	{/if}
{/if}

<style>
	.pick {
		max-width: 180px;
	}
	.divider {
		width: 1px;
		height: 20px;
		background: var(--border-soft);
		flex: none;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		color: var(--text-dim);
	}
	.field input[type='text'] {
		width: 140px;
	}
	.num {
		width: 90px;
	}
	.check {
		gap: 5px;
		cursor: pointer;
		color: var(--text);
	}
	.dim {
		color: var(--text-dim);
	}
	.warn {
		color: var(--danger-text);
		white-space: nowrap;
	}
</style>
