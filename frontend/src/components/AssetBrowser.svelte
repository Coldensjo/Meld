<script lang="ts">
  import { onMount } from 'svelte'
  import { PREFABS, type PrefabCategory } from '../lib/models/prefabs'
  import { prefabThumbnails } from '../lib/models/thumbnails'
  import { editor } from '../lib/state/editor.svelte'

  const CATEGORIES: Array<{ id: PrefabCategory; name: string }> = [
    { id: 'building', name: 'Buildings' },
    { id: 'nature', name: 'Nature' },
    { id: 'doodad', name: 'Doodads' },
  ]

  let category = $state<PrefabCategory>('nature')
  let thumbs = $state<Record<string, string>>({})
  const visible = $derived(PREFABS.filter((p) => p.category === category))

  onMount(() => {
    // Defer so the main viewport gets its first frame out first.
    const id = setTimeout(() => (thumbs = prefabThumbnails()), 50)
    return () => clearTimeout(id)
  })
</script>

<div class="tabs">
  {#each CATEGORIES as c (c.id)}
    <button class:active={category === c.id} onclick={() => (category = c.id)}>{c.name}</button>
  {/each}
</div>

<div class="grid">
  {#each visible as p (p.id)}
    <button class="asset" class:active={editor.prefab === p.id} title={p.name} onclick={() => (editor.prefab = p.id)}>
      {#if thumbs[p.id]}
        <img src={thumbs[p.id]} alt={p.name} draggable="false" />
      {:else}
        <div class="ph"></div>
      {/if}
      <span>{p.name}</span>
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .tabs button {
    flex: 1;
    padding: 3px 4px;
    font-size: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .asset {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px;
    gap: 2px;
    background: var(--bg);
  }
  .asset.active {
    background: var(--panel-3);
    border-color: var(--accent);
    color: var(--text);
  }
  img,
  .ph {
    width: 64px;
    height: 64px;
  }
  span {
    font-size: 11px;
    text-align: center;
    line-height: 1.2;
  }
</style>
