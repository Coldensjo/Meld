<script lang="ts">
	import { CPU_SECTIONS, GPU_PASSES } from '../lib/engine/perfMeter'
	import { stats } from '../lib/state/editor.svelte'

	// View › Performance overlay (#179): where the frame's time goes, averaged over the last second
	// (`stats.perf`, written once a second by `Engine.publishPerf`). The pointer goes through it.

	const r = $derived(stats.perf)
	/** The CPU sections worth a line: those over 0.01 ms, biggest first. */
	const cpu = $derived(
		r
			? CPU_SECTIONS.map((name, i) => ({ name, ms: r.sections[i] }))
					.filter((s) => s.ms >= 0.01)
					.sort((a, b) => b.ms - a.ms)
			: [],
	)
	const gpuMs = $derived(r?.gpu ? r.gpu.reduce((a, b) => a + b, 0) : 0)
	const fmt = (v: number) => v.toFixed(2)
	const count = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : `${v}`)
	/** A model's file name, without its folder or look query. */
	const modelName = (type: string) =>
		type
			.split('?')[0]
			.split(/[\\/:]/)
			.pop() ?? type
</script>

<div class="perf">
	{#if !r}
		<div class="dim">Measuring…</div>
	{:else}
		<div class="head">{r.fps.toFixed(0)} FPS · {fmt(r.frameMs)} ms <span class="dim">(worst {fmt(r.worstMs)})</span></div>
		<div class="sub">CPU {fmt(r.cpuMs)} ms</div>
		{#each cpu as s (s.name)}
			<div class="row"><span>{s.name}</span><b>{fmt(s.ms)}</b></div>
		{/each}
		{#if r.gpu}
			<div class="sub">GPU {fmt(gpuMs)} ms</div>
			{#each GPU_PASSES as name, i (name)}
				<div class="row"><span>{name}</span><b>{fmt(r.gpu[i])}</b></div>
			{/each}
		{:else}
			<div class="sub">GPU <span class="dim">n/a</span></div>
		{/if}
		<div class="sub">Drawn</div>
		<div class="row"><span>Draw calls</span><b>{r.calls}</b></div>
		<div class="row"><span>Triangles</span><b>{count(r.triangles)}</b></div>
		<div class="row"><span>Instanced meshes</span><b>{r.instancedMeshes}</b></div>
		<div class="row"><span>Geometries · textures</span><b>{r.geometries} · {r.textures}</b></div>
		<div class="row"><span>Shader programs</span><b>{r.programs}</b></div>
		{#if r.heapMB !== null}<div class="row"><span>JS heap</span><b>{r.heapMB.toFixed(0)} MB</b></div>{/if}
		{#if r.models.length}
			<div class="sub">Most triangles</div>
			{#each r.models as mdl (mdl.type)}
				<div class="row" title={mdl.type}><span>{modelName(mdl.type)} ×{mdl.instances}</span><b>{count(mdl.triangles)}</b></div>
			{/each}
		{/if}
	{/if}
</div>

<style>
	/* Top left of the view, opposite Detail info. */
	.perf {
		position: absolute;
		top: 8px;
		left: 8px;
		width: 240px;
		padding: 6px 10px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.6);
		color: #eee;
		font-size: 11px;
		line-height: 1.45;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		user-select: none;
	}
	.head {
		font-size: 13px;
		font-weight: 600;
	}
	.sub {
		margin-top: 4px;
		color: var(--accent-text);
		font-weight: 600;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.row span {
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row b {
		font-weight: 500;
	}
	.dim {
		color: var(--text-dim);
		font-weight: 400;
	}
</style>
