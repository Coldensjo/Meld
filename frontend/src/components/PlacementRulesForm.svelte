<script lang="ts">
	import { editor } from '../lib/state/editor.svelte'
	import { newRules, type PlacementRules } from '../lib/tools/doodadBrush'

	// A brush's placement rules (#169): slope and height ranges, on and not-on textures, water and
	// holes. Shared by the doodad brush editor and the spawn brush's rules (#196). A brush without
	// rules shows the defaults, and `make` gives it its own on the first edit.

	interface Props {
		/** The brush's rules, or undefined for a brush that places anywhere. */
		value: PlacementRules | undefined
		/** The brush's own rules, made on the first edit. */
		make: () => PlacementRules
	}
	let { value, make }: Props = $props()

	const r = $derived(value ?? newRules())
	const rules = () => make()
	function setTextures(which: string, list: string[]) {
		if (which === 'on') rules().onTextures = list
		else rules().offTextures = list
	}
	const texName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
	const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value)
	const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)
</script>

<div class="rules">
	<div class="row tight">
		<label class="field" title="Only on ground at least this steep and at most this steep, in degrees">
			<span>Slope</span>
			<input class="num" type="number" min="0" max="90" step="1" value={r.slope[0]} onchange={(ev) => (rules().slope = [Math.min(r.slope[1], clamp(num(ev), 0, 90)), r.slope[1]])} />
			<span>–</span>
			<input class="num" type="number" min="0" max="90" step="1" value={r.slope[1]} onchange={(ev) => (rules().slope = [r.slope[0], Math.max(r.slope[0], clamp(num(ev), 0, 90))])} />°
		</label>
	</div>
	<div class="row tight">
		<label class="check" title="Only between these heights">
			<input type="checkbox" checked={!!r.height} onchange={(ev) => (rules().height = (ev.target as HTMLInputElement).checked ? [0, 100] : null)} />
			<span>Height</span>
		</label>
		{#if r.height}
			{@const h = r.height}
			<label class="field">
				<input class="num" type="number" step="1" value={h[0]} onchange={(ev) => (rules().height = [Math.min(h[1], clamp(num(ev), -5000, 5000)), h[1]])} />
				<span>–</span>
				<input class="num" type="number" step="1" value={h[1]} onchange={(ev) => (rules().height = [h[0], Math.max(h[0], clamp(num(ev), -5000, 5000))])} />
				<span>yd</span>
			</label>
			<label class="check" title="Measure the height from the sea level instead of from 0">
				<input type="checkbox" checked={r.aboveSea} onchange={(ev) => (rules().aboveSea = (ev.target as HTMLInputElement).checked)} />
				<span>above the sea</span>
			</label>
		{/if}
	</div>
	{#each [['on', 'Only on', 'Only where one of these textures is painted'], ['off', 'Never on', 'Never where one of these textures is painted (a road)']] as [which, label, tip] (which)}
		{@const list = which === 'on' ? r.onTextures : r.offTextures}
		<div class="row tight textures" title={tip}>
			<span class="tlabel">{label}</span>
			{#each list as path (path)}
				<span class="chip" title={path}
					>{texName(path)}<button
						class="x"
						onclick={() =>
							setTextures(
								which,
								list.filter((p) => p !== path),
							)}
						aria-label="Remove texture">✕</button
					></span
				>
			{/each}
			<select
				value=""
				onchange={(ev) => {
					const v = (ev.target as HTMLSelectElement).value
					if (v && !list.includes(v)) setTextures(which, [...list, v])
					;(ev.target as HTMLSelectElement).value = ''
				}}
			>
				<option value="">{list.length ? 'Add…' : 'any texture'}</option>
				{#each editor.palette.filter((p) => !p.startsWith('#') && !list.includes(p)) as p (p)}
					<option value={p}>{texName(p)}</option>
				{/each}
			</select>
		</div>
	{/each}
	{#if r.onTextures.length || r.offTextures.length}
		<label class="field" title="How strongly a texture must be painted to count as there">
			<span>Texture counts from</span>
			<input class="num" type="number" min="0" max="100" step="5" value={Math.round(r.textureMin * 100)} onchange={(ev) => (rules().textureMin = clamp(num(ev), 0, 100) / 100)} />%
		</label>
	{/if}
	<div class="row tight">
		<label class="check" title="Not in a painted lake or river, nor under the sea">
			<input type="checkbox" checked={r.avoidWater} onchange={(ev) => (rules().avoidWater = (ev.target as HTMLInputElement).checked)} />
			<span>Avoid water</span>
		</label>
		<label class="check" title="Not over a hole in the ground">
			<input type="checkbox" checked={r.avoidHoles} onchange={(ev) => (rules().avoidHoles = (ev.target as HTMLInputElement).checked)} />
			<span>Avoid holes</span>
		</label>
	</div>
</div>

<style>
	.rules {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		font-size: 11px;
		color: var(--text-dim);
	}
	.num {
		width: 52px;
		padding: 1px 4px;
		font: 11px var(--mono);
		text-align: right;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-dim);
	}
	.textures {
		flex-wrap: wrap;
		gap: 4px;
	}
	.tlabel {
		font-size: 11px;
		color: var(--text-dim);
		width: 56px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		padding: 1px 2px 1px 6px;
		font-size: 11px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.x {
		border: none;
		background: transparent;
		padding: 0 4px;
		color: var(--text-dim);
	}
	.x:hover {
		color: var(--text);
	}
	.textures select {
		font-size: 11px;
		max-width: 160px;
	}
</style>
