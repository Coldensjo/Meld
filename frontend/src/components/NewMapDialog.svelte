<script lang="ts">
  import type { GenerateKind } from '../lib/terrain/Terrain'
  import { editor, ui, wow } from '../lib/state/editor.svelte'
  import { defaultLayerTextures } from '../lib/wow/defaults'
  import { LAYERS } from '../lib/terrain/layers'
  import { engineRef } from '../lib/state/engineRef'

  let name = $state('Untitled')
  let size = $state(256)
  let kind = $state<GenerateKind>('ocean')
  let seed = $state(Math.floor(Math.random() * 100000))

  const KINDS: Array<{ id: GenerateKind; name: string }> = [
    { id: 'ocean', name: 'Empty (water only)' },
    { id: 'flat', name: 'Flat land' },
    { id: 'hills', name: 'Rolling Hills' },
    { id: 'mountains', name: 'Mountains' },
    { id: 'island', name: 'Island' },
  ]

  async function create() {
    const palette = wow.loaded ? await defaultLayerTextures() : LAYERS.map((l) => l.swatch)
    engineRef.current?.newDocument(size, kind, seed, name.trim() || 'Untitled')
    editor.palette = palette
    editor.dirty = false
    engineRef.current?.refreshTabs()
    ui.showNewDialog = false
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (ui.showNewDialog = false)}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="nm-title">
    <h2 id="nm-title">New Map</h2>
    <label>Name <input type="text" bind:value={name} /></label>
    <label>
      Size
      <select bind:value={size}>
        <option value={128}>Small — 1×1 tile (128²)</option>
        <option value={256}>Medium — 2×2 tiles (256²)</option>
        <option value={512}>Large — 4×4 tiles (512²)</option>
      </select>
    </label>
    <div class="kinds">
      {#each KINDS as k (k.id)}
        <button class:active={kind === k.id} onclick={() => (kind = k.id)}>{k.name}</button>
      {/each}
    </div>
    <label>
      Seed
      <span class="seed">
        <input type="number" bind:value={seed} />
        <button onclick={() => (seed = Math.floor(Math.random() * 100000))} title="Randomise">🎲</button>
      </span>
    </label>
    <p class="warn">Unsaved changes to the current map will be lost.</p>
    <div class="actions">
      <button onclick={() => (ui.showNewDialog = false)}>Cancel</button>
      <button class="active" onclick={create}>Create</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 100;
  }
  .dialog {
    width: 380px;
    max-width: calc(100vw - 32px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  h2 {
    margin: 0 0 14px;
    font-size: 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .kinds {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 10px;
  }
  .seed {
    display: flex;
    gap: 6px;
  }
  .seed input {
    flex: 1;
  }
  .warn {
    color: var(--text-dim);
    font-size: 12px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
