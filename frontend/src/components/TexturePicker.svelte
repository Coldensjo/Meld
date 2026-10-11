<script lang="ts" module>
  // Shared preview cache + small concurrency limit so scrolling stays smooth.
  const previews = new Map<string, Promise<string>>()
  let active = 0
  const queue: Array<() => void> = []
  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            queue.shift()?.()
          })
      }
      if (active < 6) run()
      else queue.push(run)
    })
  }
  export function tilesetPreview(path: string): Promise<string> {
    let p = previews.get(path)
    if (!p) {
      p = schedule(() => texturePreview(path, 72))
      previews.set(path, p)
    }
    return p
  }
</script>

<script lang="ts">
  import { editor, ui } from '../lib/state/editor.svelte'
  import { LAYERS } from '../lib/terrain/layers'
  import { listAssets, texturePreview } from '../lib/wow/api'
  import { engineRef } from '../lib/state/engineRef'

  let { layer }: { layer: number } = $props()

  let all = $state<string[]>([])
  let folder = $state('')
  let query = $state('')
  let thumbs = $state<Record<string, string>>({})

  const dirOf = (p: string) => p.slice(0, p.lastIndexOf('\\'))
  const nameOf = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
  const folderLabel = (d: string) => d.replace(/^tileset\\/i, '')

  listAssets('tileset').then((l) => {
    all = l
    const current = editor.layerTextures[layer]
    const folders = [...new Set(l.map(dirOf))]
    folder = current ? dirOf(current) : (folders.find((f) => /elwynn/i.test(f)) ?? folders[0] ?? '')
  })

  const folders = $derived([...new Set(all.map(dirOf))].sort((a, b) => a.localeCompare(b)))
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (q) return all.filter((p) => p.toLowerCase().includes(q)).slice(0, 300)
    return all.filter((p) => dirOf(p) === folder)
  })

  // Load previews lazily as tiles scroll into view.
  function lazy(node: HTMLElement, path: string) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        tilesetPreview(path)
          .then((url) => (thumbs[path] = url))
          .catch(() => {})
      }
    })
    io.observe(node)
    return { destroy: () => io.disconnect() }
  }

  function pick(path: string) {
    const before = editor.layerTextures[layer]
    const i = layer
    if (before !== path) {
      editor.layerTextures[i] = path
      engineRef.current?.history.push({
        label: 'Layer texture',
        undo: () => (editor.layerTextures[i] = before),
        redo: () => (editor.layerTextures[i] = path),
      })
    }
    close()
  }
  const close = () => (ui.texturePickerLayer = null)
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Choose texture">
    <header>
      <h2>Texture for “{LAYERS[layer].name}”</h2>
      <button onclick={close} aria-label="Close">✕</button>
    </header>
    <div class="controls">
      <select bind:value={folder} disabled={!!query}>
        {#each folders as f (f)}<option value={f}>{folderLabel(f)}</option>{/each}
      </select>
      <input type="text" placeholder="Search all tilesets…" bind:value={query} />
      <button onclick={() => pick('')}>Use built-in</button>
    </div>
    <div class="grid">
      {#each shown as p (p)}
        <button class="tile" class:active={editor.layerTextures[layer] === p} title={p} onclick={() => pick(p)} use:lazy={p}>
          {#if thumbs[p]}<img src={thumbs[p]} alt="" draggable="false" />{:else}<div class="ph"></div>{/if}
          <span>{nameOf(p)}</span>
        </button>
      {/each}
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
    width: 720px;
    max-width: calc(100vw - 32px);
    height: min(640px, calc(100vh - 64px));
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .controls {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
  }
  .controls select {
    width: 200px;
  }
  .controls input {
    flex: 1;
  }
  .grid {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 6px;
    align-content: start;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 4px;
    background: var(--bg);
  }
  .tile.active {
    border-color: var(--accent);
    background: var(--panel-3);
    color: var(--text);
  }
  img,
  .ph {
    width: 72px;
    height: 72px;
    border-radius: 3px;
    background: var(--panel-2);
  }
  span {
    font-size: 10px;
    text-align: center;
    word-break: break-all;
    line-height: 1.2;
  }
</style>
