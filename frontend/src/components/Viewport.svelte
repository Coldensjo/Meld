<script lang="ts">
  import { onMount } from 'svelte'
  import { Engine } from '../lib/engine/Engine'
  import { engineRef } from '../lib/state/engineRef'
  import { editor, prefs, setStatus } from '../lib/state/editor.svelte'

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
  <div class="doctabs">
    <div class="doctab" title={editor.filePath || 'Not saved yet'}>
      {editor.mapName}{editor.filePath ? '.wmap' : ''} @ {editor.mapSize}²{editor.dirty ? ' *' : ''}
    </div>
  </div>
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
  .doctabs {
    display: flex;
    height: 26px;
    background: var(--header);
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .doctab {
    padding: 0 14px;
    line-height: 26px;
    font-size: 11px;
    background: var(--panel);
    border-right: 1px solid var(--border);
    color: var(--text);
    white-space: nowrap;
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
