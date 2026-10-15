<script lang="ts" module>
  import type { HeightmapMode } from '../lib/io/heightmapImport'

  /** The last choices, kept for the session so a second import starts from them. */
  const last = $state({ mode: 'set' as HeightmapMode, min: -1024, max: 1024 })
</script>

<script lang="ts">
  import Modal from './Modal.svelte'
  import { importHeightmap } from '../lib/io/mapio'
  import { engineRef } from '../lib/state/engineRef'

  // File › Import Heightmap (Noggit Red's heightmap importer): the image's black and white become the
  // Min and Max heights, which are set on the ground or added to, subtracted from or multiplied into it.

  interface Props {
    onclose: () => void
  }
  let { onclose }: Props = $props()

  const MODES: Array<[HeightmapMode, string, string]> = [
    ['set', 'Set', 'The ground takes the image\'s heights'],
    ['add', 'Add', 'The image\'s heights are added to the ground'],
    ['subtract', 'Subtract', 'The image\'s heights are taken off the ground'],
    ['multiply', 'Multiply', 'The ground is multiplied by the image\'s heights (use a Min and Max around 1)'],
  ]

  async function run() {
    const e = engineRef.current
    if (!e) return
    onclose()
    await importHeightmap(e, { ...last })
  }
</script>

<Modal title="Import heightmap" width={420} {onclose}>
  <p class="dim">A greyscale PNG: black becomes Min and white becomes Max. An image of another size is stretched over the whole map. Undo reverts the import.</p>
  <div class="form">
    <span class="k">Mode</span>
    <div class="seg">
      {#each MODES as [v, label, title] (v)}
        <button class:active={last.mode === v} onclick={() => (last.mode = v)} {title}>{label}</button>
      {/each}
    </div>
    <label class="k" for="hm-min">Min (black)</label>
    <input id="hm-min" type="number" step="any" bind:value={last.min} />
    <label class="k" for="hm-max">Max (white)</label>
    <input id="hm-max" type="number" step="any" bind:value={last.max} />
  </div>
  <p class="dim">Min −1024 and Max 1024 with Set read back a heightmap Meld exported exactly.</p>
  {#snippet actions()}
    <button onclick={onclose}>Cancel</button>
    <button class="active" onclick={() => void run()}>Choose image…</button>
  {/snippet}
</Modal>

<style>
  .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
  .form {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 8px;
    align-items: center;
    margin: 8px 0;
  }
  .k {
    color: var(--text-dim);
    font-size: 11px;
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg button {
    flex: 1;
  }
</style>
