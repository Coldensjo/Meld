<script lang="ts">
  import { editor, wow } from '../lib/state/editor.svelte'
  import { listAssets } from '../lib/wow/api'
  import { isWowType } from '../lib/models/assets'
  import AssetPreview from './AssetPreview.svelte'

  let { kind }: { kind: 'm2' | 'wmo' } = $props()

  const LIMIT = 250
  let all = $state<string[]>([])
  let query = $state('')
  let loading = $state(true)

  $effect(() => {
    void wow.revision
    const k = kind
    loading = true
    listAssets(k).then((l) => {
      if (k !== kind) return
      all = l
      loading = false
    })
  })

  // Every whitespace-separated term must appear somewhere in the path.
  const matches = $derived.by(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return all
    return all.filter((p) => {
      const l = p.toLowerCase()
      return terms.every((t) => l.includes(t))
    })
  })

  const split = (p: string) => {
    const i = p.lastIndexOf('\\')
    return { dir: p.slice(p.indexOf('\\') + 1, i), file: p.slice(i + 1).replace(/\.(m2|wmo)$/i, '') }
  }

  const selectedType = $derived(isWowType(editor.prefab) && editor.prefab.startsWith(kind + ':') ? editor.prefab : '')
</script>

{#if selectedType}
  <AssetPreview type={selectedType} />
{/if}

<input class="search" type="text" placeholder={kind === 'm2' ? 'Search doodads… e.g. elwynn tree' : 'Search buildings… e.g. goldshire inn'} bind:value={query} />

<div class="list">
  {#if loading}
    <p class="hint">Loading list…</p>
  {:else if !matches.length}
    <p class="hint">No matches.</p>
  {:else}
    {#each matches.slice(0, LIMIT) as p (p)}
      {@const s = split(p)}
      <button class="item" class:active={editor.prefab === `${kind}:${p}`} title={p} onclick={() => (editor.prefab = `${kind}:${p}`)}>
        <span class="file">{s.file}</span>
        <span class="dir">{s.dir}</span>
      </button>
    {/each}
    {#if matches.length > LIMIT}
      <p class="hint">{matches.length - LIMIT} more, refine your search…</p>
    {/if}
  {/if}
</div>

<style>
  .search {
    width: 100%;
    margin-bottom: 6px;
  }
  .list {
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 4px 8px;
    text-align: left;
  }
  .item:hover {
    background: var(--panel-2);
  }
  .item.active {
    background: var(--panel-3);
    color: var(--text);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .file {
    font-size: 12px;
  }
  .dir {
    font-size: 10px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .hint {
    color: var(--text-dim);
    font-size: 12px;
    padding: 6px 8px;
    margin: 0;
  }
</style>
