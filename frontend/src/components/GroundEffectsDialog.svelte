<script lang="ts">
  import Modal from './Modal.svelte'
  import { editor, wow } from '../lib/state/editor.svelte'
  import { displayName } from '../lib/models/assets'
  import { groundEffectTables, loadGroundEffectTables } from '../lib/wow/groundEffectTables'
  import { effectFor, knownEffects, type GroundEffectTables } from '../lib/world/groundEffects'

  // Edit › Ground Effects: what the game grows on each of the map's textures (grass tufts, flowers,
  // pebbles). Each texture shows the effect the client's own tiles give it; the map may choose
  // another, or none, which is saved with the map and written into its tiles.

  interface Props {
    onclose: () => void
  }
  let { onclose }: Props = $props()

  const tables = $derived(groundEffectTables())
  const textures = $derived(editor.palette.map((p, i) => ({ i, path: p })).filter((t) => !t.path.startsWith('#')))
  const textureName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')

  /** What an effect grows, for a label: its models' names and its density. */
  function describe(t: GroundEffectTables, id: number): string {
    const e = t.effects[id]
    if (!e) return `effect ${id}`
    const names = [...new Set(e.doodads.map((d) => displayName('m2:' + d)))]
    return `${names.join(', ')} · ${e.density}`
  }

  /** The choices for a texture: the client's own (learned) one first, then every effect the client uses. */
  function choices(t: GroundEffectTables, path: string): Array<{ id: number; label: string }> {
    const learned = t.textures[path.toLowerCase()] ?? 0
    const out: Array<{ id: number; label: string }> = [{ id: 0, label: 'none' }]
    if (learned) out.push({ id: learned, label: `${describe(t, learned)} (the client's)` })
    for (const k of knownEffects(t)) if (k.id !== learned) out.push({ id: k.id, label: describe(t, k.id) })
    return out
  }

  function choose(path: string, id: number) {
    const learned = tables?.textures[path.toLowerCase()] ?? 0
    const own = { ...editor.textureEffects }
    if (id === learned) delete own[path]
    else own[path] = id
    editor.textureEffects = own
  }
</script>

<Modal title="Ground effects (grass tufts)" width={560} {onclose}>
  <p class="dim">
    The game grows small models on the ground by the texture on top of each cell: grass tufts, flowers, pebbles. Each texture here grows what the client's own tiles give it. Choose another effect, or none, for this map.
  </p>
  {#if !wow.loaded}
    <p class="dim">Select your WoW client folder first (Settings menu).</p>
  {:else if !tables}
    <p class="dim">Reading the client's ground effects… the first time for a client reads every tile and takes a minute or two.</p>
    <button onclick={() => void loadGroundEffectTables()}>Read now</button>
  {:else if !textures.length}
    <p class="dim">The map has no client textures yet. Textures picked in the asset browser appear here.</p>
  {:else}
    <div class="rows">
      {#each textures as t (t.i)}
        {@const current = effectFor(t.path, editor.textureEffects, tables)}
        {@const own = editor.textureEffects[t.path] !== undefined}
        <span class="name" title={t.path}>{textureName(t.path)}</span>
        <select value={current} class:own onchange={(e) => choose(t.path, Number((e.target as HTMLSelectElement).value))} aria-label="Effect of {textureName(t.path)}">
          {#each choices(tables, t.path) as c (c.id)}
            <option value={c.id}>{c.label}</option>
          {/each}
        </select>
      {/each}
    </div>
    <p class="dim">A choice marked in blue is this map's own and is saved with it. Tufts show in the editor (View › Ground effects) and in the client after an export.</p>
  {/if}
  {#snippet actions()}
    <button class="active" onclick={onclose}>Close</button>
  {/snippet}
</Modal>

<style>
  .dim {
    color: var(--text-dim);
    font-size: 12px;
    margin: 4px 0 8px;
  }
  .rows {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) 2fr;
    gap: 4px 10px;
    align-items: center;
    max-height: 50vh;
    overflow-y: auto;
  }
  .name {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  select {
    min-width: 0;
    width: 100%;
  }
  select.own {
    border-color: var(--accent);
  }
</style>
