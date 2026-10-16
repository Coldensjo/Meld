<script lang="ts" module>
  import { ListDisplays } from '../../wailsjs/go/main/App'
  import type { vmangos } from '../../wailsjs/go/models'

  // The client's creature displays, read once for the whole session (the Go side caches them too).
  let displaysPromise: Promise<vmangos.DisplayEntry[]> | null = null
  function loadDisplays(): Promise<vmangos.DisplayEntry[]> {
    if (!displaysPromise) {
      displaysPromise = ListDisplays().then((d) => d ?? [])
      displaysPromise.catch(() => (displaysPromise = null))
    }
    return displaysPromise
  }
</script>

<script lang="ts">
  import PaletteTile from './PaletteTile.svelte'
  import { creatureTypeName } from '../lib/world/spawnInfo'
  import { spawnType } from '../lib/world/spawnInfo'

  // A visual picker of creature displays: rendered tiles in a virtualised grid, narrowed by the
  // creature type the world database's creatures using a display have, by model family, and by a
  // search over the creatures' names, the model and skin names and the display ID.

  interface Props {
    /** The display picked now, drawn highlighted. */
    selected: number
    onpick: (d: vmangos.DisplayEntry) => void
    /** The display under the pointer, or null when it leaves the grid. */
    onhover?: (d: vmangos.DisplayEntry | null) => void
  }
  let { selected, onpick, onhover }: Props = $props()

  let all = $state<vmangos.DisplayEntry[]>([])
  let error = $state('')
  let loading = $state(true)
  loadDisplays()
    .then((d) => (all = d))
    .catch((err) => (error = String(err)))
    .finally(() => (loading = false))

  /** A display's category: the creature type of the creatures using it, or Unused. */
  const categoryOf = (d: vmangos.DisplayEntry) => (d.type > 0 ? creatureTypeName(d.type) : d.uses > 0 ? 'Not specified' : 'Unused')
  /** A display's family: its model's file name, such as Wolf or HumanMale. */
  const familyOf = (d: vmangos.DisplayEntry) => d.model.slice(d.model.lastIndexOf('\\') + 1).replace(/\.(mdx|m2)$/i, '')

  let category = $state('')
  let family = $state('')
  let query = $state('')

  const categories = $derived.by(() => {
    const n = new Map<string, number>()
    for (const d of all) n.set(categoryOf(d), (n.get(categoryOf(d)) ?? 0) + 1)
    // The used types by size, Unused last.
    return [...n].sort((a, b) => (a[0] === 'Unused' ? 1 : b[0] === 'Unused' ? -1 : b[1] - a[1]))
  })

  const inCategory = $derived(category ? all.filter((d) => categoryOf(d) === category) : all)

  const families = $derived.by(() => {
    const n = new Map<string, number>()
    for (const d of inCategory) n.set(familyOf(d), (n.get(familyOf(d)) ?? 0) + 1)
    return [...n].sort((a, b) => a[0].localeCompare(b[0]))
  })

  // Search: every word must appear in the display's names, model, skin or ID. Used displays first.
  const items = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const list = inCategory.filter((d) => {
      if (family && familyOf(d) !== family) return false
      if (!words.length) return true
      const text = `${d.id} ${d.names?.join(' ') ?? ''} ${d.model} ${d.skin}`.toLowerCase()
      return words.every((w) => text.includes(w))
    })
    return list.sort((a, b) => (b.uses > 0 ? 1 : 0) - (a.uses > 0 ? 1 : 0) || familyOf(a).localeCompare(familyOf(b)) || a.id - b.id)
  })

  // Pick a family in another category: the family filter only holds within its category.
  function pickCategory(e: Event) {
    category = (e.target as HTMLSelectElement).value
    family = ''
  }

  // The grid renders only the rows in view.
  const TILE = 104
  const GAP = 6
  const rowH = TILE + 22 + GAP
  let width = $state(0)
  let height = $state(0)
  let scrollTop = $state(0)
  let scroller: HTMLDivElement | undefined = $state()
  const cols = $derived(Math.max(1, Math.floor((width - GAP) / (TILE + GAP))))
  const rows = $derived(Math.ceil(items.length / cols))
  const first = $derived(Math.max(0, Math.floor(scrollTop / rowH) - 1))
  const last = $derived(Math.min(rows, Math.ceil((scrollTop + height) / rowH) + 1))
  const visible = $derived(items.slice(first * cols, last * cols))
  $effect(() => {
    void items
    scroller?.scrollTo(0, 0)
    scrollTop = 0
  })

  // Open on the creature's own display (#206): its type and model family picked and its tile in
  // view, once the displays are read and again when another display slot is shown, but not after a
  // pick here, which must leave the filters where the author put them.
  let shown = -1
  let picked = -1
  $effect(() => {
    const id = selected
    if (!all.length || id === shown) return
    shown = id
    if (id === picked) return
    const d = all.find((x) => x.id === id)
    if (!d) return
    category = categoryOf(d)
    family = familyOf(d)
    query = ''
    // After the grid has laid out the narrowed list (and the scroll-to-top above has run).
    requestAnimationFrame(() => {
      const i = items.indexOf(d)
      if (i < 0 || !scroller) return
      const top = Math.max(0, Math.floor(i / cols) * rowH - (height - rowH) / 2)
      scroller.scrollTo(0, top)
      scrollTop = top
    })
  })
  function pick(d: vmangos.DisplayEntry) {
    picked = d.id
    onpick(d)
  }

  const label = (d: vmangos.DisplayEntry) => d.names?.[0] ?? familyOf(d)
  const title = (d: vmangos.DisplayEntry) =>
    `Display ${d.id}: ${familyOf(d)}${d.skin ? ` (${d.skin})` : ''}${d.uses ? `\nUsed by ${d.names.join(', ')}${d.uses > d.names.length ? ` and ${d.uses - d.names.length} more` : ''}` : '\nNo creature uses it'}`
</script>

<div class="picker">
  <input type="search" placeholder="Search: a creature (Hogger), a model (wolf, kobold) or a display ID" bind:value={query} />
  <div class="row">
    <select value={category} onchange={pickCategory} aria-label="Creature type">
      <option value="">All types ({all.length})</option>
      {#each categories as [name, n] (name)}<option value={name}>{name} ({n})</option>{/each}
    </select>
    <select bind:value={family} aria-label="Model">
      <option value="">All models ({families.length})</option>
      {#each families as [name, n] (name)}<option value={name}>{name} ({n})</option>{/each}
    </select>
    <span class="dim">{items.length.toLocaleString()} displays</span>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  <div
    class="grid-wrap"
    role="listbox"
    aria-label="Creature displays"
    tabindex="-1"
    bind:this={scroller}
    bind:clientWidth={width}
    bind:clientHeight={height}
    onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
    onpointerleave={() => onhover?.(null)}
  >
    {#if loading}
      <p class="dim">Reading the client's creature displays…</p>
    {:else if !items.length}
      <p class="dim">No display matches.</p>
    {:else}
      <div class="virtual" style:height="{rows * rowH}px">
        <div class="grid" style:grid-template-columns="repeat({cols}, {TILE}px)" style:gap="{GAP}px" style:transform="translateY({first * rowH}px)">
          {#each visible as d (d.id)}
            <PaletteTile
              thumbKey={spawnType({ model: d.model, look: d.look })}
              label={label(d)}
              title={title(d)}
              size={TILE}
              active={d.id === selected}
              badge={String(d.id)}
              onclick={() => pick(d)}
              onhover={(on) => onhover?.(on ? d : null)}
            />
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    flex: 1;
  }
  input[type='search'] {
    width: 100%;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row select {
    flex: 1;
    min-width: 0;
  }
  .grid-wrap {
    height: min(58vh, 640px);
    flex: none;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px;
  }
  .virtual {
    position: relative;
  }
  .grid {
    display: grid;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
    margin: 0;
  }
  .error {
    color: var(--danger);
    font-size: 12px;
    margin: 0;
  }
</style>
