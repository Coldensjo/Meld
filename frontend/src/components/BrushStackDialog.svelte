<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor, prefs } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { activeBrushStack } from '../lib/tools/StampTool'
	import { STACK_SCULPT_MODES, freeStackName, newStackItem, type BrushStack, type StackItem } from '../lib/tools/brushStack'

	// The Stamp tool's brush stack editor (Noggit Red's brush stack): the stack's brushes in the order a
	// stroke applies them, each a sculpt mode or a paint texture with its own size, strength, falloff and
	// turn, or the stack's where it inherits them. Stacks are preferences, kept for every map.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	// A dialog opened with no stack makes one, so there is always one to edit.
	if (!activeBrushStack()) {
		prefs.brushStacks = [...prefs.brushStacks, { name: freeStackName(prefs.brushStacks), items: [newStackItem('sculpt')] }]
		prefs.brushStack = prefs.brushStacks[prefs.brushStacks.length - 1].name
	}
	const stack = $derived(activeBrushStack())

	const texName = (p: string) => (!p ? 'none' : p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))
	const MODE_NAMES: Record<string, string> = { raise: 'Raise', lower: 'Lower', smooth: 'Smooth', blur: 'Blur', flatten: 'Flatten', noise: 'Noise', mountain: 'Mountain', crevice: 'Crevice', terrace: 'Terrace' }

	/** Changes the stack in place and hands prefs a new list, so the change is saved. */
	function change(fn: (s: BrushStack) => void) {
		const s = activeBrushStack()
		if (!s) return
		fn(s)
		prefs.brushStacks = [...prefs.brushStacks]
	}

	function setItem(i: number, patch: Partial<StackItem>) {
		change((s) => (s.items[i] = { ...s.items[i], ...patch }))
	}

	function move(i: number, by: number) {
		change((s) => {
			const j = i + by
			if (j < 0 || j >= s.items.length) return
			;[s.items[i], s.items[j]] = [s.items[j], s.items[i]]
		})
	}

	function rename(name: string) {
		const n = name.trim()
		if (!n || prefs.brushStacks.some((s) => s.name === n && s !== activeBrushStack())) return
		change((s) => (s.name = n))
		prefs.brushStack = n
	}

	function newStack() {
		const name = freeStackName(prefs.brushStacks)
		prefs.brushStacks = [...prefs.brushStacks, { name, items: [newStackItem('sculpt')] }]
		prefs.brushStack = name
	}

	async function deleteStack() {
		const s = activeBrushStack()
		if (!s || !(await askConfirm(`Delete the stack "${s.name}"?`, { title: 'Delete stack', ok: 'Delete' }))) return
		prefs.brushStacks = prefs.brushStacks.filter((x) => x !== s)
		prefs.brushStack = prefs.brushStacks[0]?.name ?? ''
		if (!prefs.brushStacks.length) onclose()
	}

	const paintTexture = $derived(editor.palette[editor.paintLayer] ?? '')
	const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0
</script>

<Modal title="Brush stack" width={760} {onclose}>
	{#if stack}
		<div class="top">
			<select value={stack.name} onchange={(e) => (prefs.brushStack = (e.target as HTMLSelectElement).value)} aria-label="Stack">
				{#each prefs.brushStacks as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
			</select>
			<input value={stack.name} onchange={(e) => rename((e.target as HTMLInputElement).value)} aria-label="Stack name" title="Rename the stack" />
			<button onclick={newStack}>New stack</button>
			<button onclick={deleteStack}>Delete stack</button>
		</div>
		<p class="dim">A stroke of the Stamp tool applies these brushes top to bottom. "Stack" means the brush takes the Stamp tool's own size, strength or turn (the options bar); untick it to give the brush its own.</p>
		<div class="rows">
			<span class="h"></span><span class="h">Brush</span><span class="h">Size</span><span class="h">Strength</span><span class="h">Falloff</span><span class="h">Turn</span><span class="h"></span>
			{#each stack.items as item, i (i)}
				<input type="checkbox" checked={item.on} onchange={(e) => setItem(i, { on: (e.target as HTMLInputElement).checked })} title="Off, a stroke skips this brush" aria-label="On" />
				<span class="brush">
					<select value={item.tool} onchange={(e) => setItem(i, { tool: (e.target as HTMLSelectElement).value as StackItem['tool'] })} aria-label="Kind">
						<option value="sculpt">Sculpt</option>
						<option value="paint">Paint</option>
					</select>
					{#if item.tool === 'sculpt'}
						<select value={item.mode} onchange={(e) => setItem(i, { mode: (e.target as HTMLSelectElement).value as StackItem['mode'] })} aria-label="Sculpt mode">
							{#each STACK_SCULPT_MODES as m (m)}<option value={m}>{MODE_NAMES[m]}</option>{/each}
						</select>
					{:else}
						<span class="tex" title={item.texture}>{texName(item.texture)}</span>
						<button onclick={() => setItem(i, { texture: paintTexture })} disabled={!paintTexture} title="Use the texture picked to paint with ({texName(paintTexture)})">Use paint texture</button>
					{/if}
				</span>
				<span class="val">
					<label class="check"><input type="checkbox" checked={item.inheritRadius} onchange={(e) => setItem(i, { inheritRadius: (e.target as HTMLInputElement).checked })} /> Stack</label>
					<input type="number" min="1" step="1" value={item.radius} disabled={item.inheritRadius} oninput={(e) => setItem(i, { radius: Math.max(1, num(e)) })} aria-label="Size" />
				</span>
				<span class="val">
					<label class="check"><input type="checkbox" checked={item.inheritStrength} onchange={(e) => setItem(i, { inheritStrength: (e.target as HTMLInputElement).checked })} /> Stack</label>
					<input type="number" min="0" max="10" step="0.05" value={item.strength} disabled={item.inheritStrength} oninput={(e) => setItem(i, { strength: num(e) })} aria-label="Strength" />
				</span>
				<span class="val"><input type="number" min="0" max="1" step="0.05" value={item.falloff} oninput={(e) => setItem(i, { falloff: Math.min(1, Math.max(0, num(e))) })} aria-label="Falloff" /></span>
				<span class="val">
					<label class="check"><input type="checkbox" checked={item.inheritRotation} onchange={(e) => setItem(i, { inheritRotation: (e.target as HTMLInputElement).checked })} /> Stack</label>
					<input type="number" min="0" max="360" step="1" value={item.rotation} disabled={item.inheritRotation} oninput={(e) => setItem(i, { rotation: num(e) })} aria-label="Turn" />
				</span>
				<span class="ops">
					<button onclick={() => move(i, -1)} disabled={i === 0} title="Apply earlier" aria-label="Up">↑</button>
					<button onclick={() => move(i, 1)} disabled={i === stack.items.length - 1} title="Apply later" aria-label="Down">↓</button>
					<button onclick={() => change((s) => s.items.splice(i, 1))} title="Remove this brush" aria-label="Remove">✕</button>
				</span>
			{/each}
		</div>
		<div class="add">
			<button onclick={() => change((s) => s.items.push(newStackItem('sculpt')))}>Add sculpt brush</button>
			<button onclick={() => change((s) => s.items.push(newStackItem('paint', paintTexture)))}>Add paint brush</button>
		</div>
	{/if}
	{#snippet actions()}
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.top {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.rows {
		display: grid;
		grid-template-columns: auto minmax(220px, 2fr) repeat(4, minmax(80px, 1fr)) auto;
		gap: 6px 8px;
		align-items: center;
		max-height: 380px;
		overflow-y: auto;
	}
	.h {
		font-size: 11px;
		color: var(--text-dim);
	}
	.brush,
	.val,
	.ops {
		display: flex;
		gap: 4px;
		align-items: center;
		min-width: 0;
	}
	.val input[type='number'] {
		width: 56px;
	}
	.tex {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 110px;
	}
	.add {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}
</style>
