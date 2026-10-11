<script lang="ts">
  import { onMount } from 'svelte'
  import { Engine } from '../lib/engine/Engine'
  import { engineRef } from '../lib/state/engineRef'
  import DocTabs from './DocTabs.svelte'
  import { prefs, setStatus } from '../lib/state/editor.svelte'

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let error = $state('')

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
    {#if error}<div class="error">{error}</div>{/if}
  </div>
</div>

<style>
  .doc {
    display: flex;
    flex-direction: column;
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
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
    touch-action: none;
  }
  .error {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--danger);
    padding: 24px;
    text-align: center;
  }
</style>
