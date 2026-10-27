<script lang="ts">
	import { onMount } from 'svelte'
	import { Engine } from '../lib/engine/Engine'
	import { engineRef } from '../lib/state/engineRef'
	import DocTabs from './DocTabs.svelte'
	import PathEditBar from './PathEditBar.svelte'
	import SpawnPickBar from './SpawnPickBar.svelte'
	import PoolLegend from './PoolLegend.svelte'
	import PerfOverlay from './PerfOverlay.svelte'
	import LoadingBar from './LoadingBar.svelte'
	import { editor, prefs, setStatus, stats, ui } from '../lib/state/editor.svelte'
	import { loadAreas } from '../lib/wow/areas'

	let container: HTMLDivElement
	let canvas: HTMLCanvasElement
	let error = $state('')

	// Detail info names a chunk's zone (#755), which needs the client's area table; a world view has no
	// Map data tool to have read it. The readout refreshes at 2 Hz, so the names show once it is read.
	$effect(() => {
		if (prefs.detailInfo) void loadAreas()
	})

	onMount(() => {
		let engine: Engine
		try {
			engine = new Engine(canvas, container)
		} catch (e) {
			error = `Failed to start WebGL renderer: ${e}`
			return
		}
		engineRef.current = engine
		engine.applyPrefs(prefs)
		engine.start()
		setStatus('Welcome! RMB orbit · MMB pan · Wheel zoom · WASD move')
		return () => {
			engine.dispose()
			engineRef.current = null
		}
	})
</script>

<div class="doc">
	<DocTabs />
	<div class="viewport" bind:this={container}>
		<canvas bind:this={canvas} tabindex="-1"></canvas>
		{#if ui.topDown && editor.reference?.mode === 'screen' && editor.reference.shown && ui.referenceUrl}
			<!-- The reference image over the top-down view, fixed to the screen like tracing paper (#184). -->
			<img class="reference" src={ui.referenceUrl} alt="" style:opacity={editor.reference.opacity} data-ui="ReferenceOverlay" />
		{/if}
		{#if error}<div class="error">{error}</div>{/if}
		<PathEditBar />
		<SpawnPickBar />
		<PoolLegend />
		<LoadingBar />
		{#if prefs.perfOverlay}<PerfOverlay />{/if}
		{#if ui.viewportHint}{#key ui.viewportHintSeq}<div class="hint">{ui.viewportHint}</div>{/key}{/if}
		{#if prefs.detailInfo && stats.detail}
			{@const d = stats.detail}
			<div class="detail" data-ui="DetailInfo">
				<div><span>Tile</span>{d.tile} <span>Chunk</span>{d.chunk} <span>Cell</span>{d.cell}</div>
				{#if d.area}
					<div><span>Zone</span>{d.area}</div>
				{/if}
				<div>
					<span>Height</span>{d.height.toFixed(2)} <span>Slope</span>{d.slope.toFixed(0)}°{#if d.hole}
						· hole{/if}{#if d.impassable}
						· impassable{/if}{#if d.noTufts}
						· no tufts{/if}
				</div>
				{#each d.textures as tx, i (i)}
					<div>
						<span>Layer {i}</span>{tx.name}
						{tx.weight}%{#if tx.effect}
							· effect {tx.effect}{/if}
					</div>
				{/each}
				{#each d.liquids as l (l)}
					<div><span>Liquid</span>{l}</div>
				{/each}
				<div><span>Models</span>{d.models} in the chunk</div>
				{#if d.room}
					<div><span>Camera in</span>{d.room}</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.doc {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
		background: var(--bg);
	}
	.viewport {
		flex: 1;
		min-height: 0;
		position: relative;
		width: 100%;
		overflow: hidden;
		background: #0b0d10;
	}
	/* Out of flow, so the canvas's pixel size never becomes the viewport's minimum height. */
	canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
		touch-action: none;
	}
	/* The reference image over the top-down view: fitted whole, the pointer goes through it. */
	.reference {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
		user-select: none;
	}
	/* A short-lived notice near the top of the view (e.g. the placement scale). The pointer goes through it. */
	.hint {
		position: absolute;
		top: 12%;
		left: 50%;
		transform: translateX(-50%);
		padding: 6px 14px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 18px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		user-select: none;
		animation: hint-fade 1.5s ease-in forwards;
	}
	@keyframes hint-fade {
		0%,
		60% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	/* The Detail info readout (View › Detail info): the ground under the cursor, in the top right corner. */
	.detail {
		position: absolute;
		top: 8px;
		right: 8px;
		padding: 6px 10px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.6);
		color: #eee;
		font-size: 12px;
		line-height: 1.5;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		user-select: none;
		max-width: 320px;
	}
	.detail span {
		color: var(--text-dim);
		margin-right: 4px;
	}
	.detail span:not(:first-child) {
		margin-left: 8px;
	}
	.error {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--danger-text);
		padding: 24px;
		text-align: center;
	}
</style>
