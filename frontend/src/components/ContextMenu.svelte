<script lang="ts">
  import { ui } from '../lib/state/editor.svelte'

  // The viewport's right-click menu: a plain right-click (no orbit drag) on a creature, an object
  // of the region or a placed model opens it with what can be done to that thing. It closes on a
  // pick, a click elsewhere or Escape.

  const close = () => (ui.contextMenu = null)
  let el = $state<HTMLDivElement | undefined>()

  // Keep the menu on screen when opened near the right or bottom edge.
  const style = $derived.by(() => {
    const m = ui.contextMenu
    if (!m) return ''
    const w = el?.offsetWidth ?? 220
    const h = el?.offsetHeight ?? 120
    const x = Math.min(m.x, window.innerWidth - w - 8)
    const y = Math.min(m.y, window.innerHeight - h - 8)
    return `left:${Math.max(0, x)}px;top:${Math.max(0, y)}px`
  })

  function onWindowDown(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) close()
  }
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={(e) => ui.contextMenu && e.key === 'Escape' && close()} onblur={close} />

{#if ui.contextMenu}
  <div class="menu" role="menu" tabindex="-1" bind:this={el} {style} oncontextmenu={(e) => e.preventDefault()}>
    {#if ui.contextMenu.title}<div class="title">{ui.contextMenu.title}</div>{/if}
    {#each ui.contextMenu.items as it, i (i)}
      {#if it.separator}
        <div class="sep"></div>
      {:else}
        <button class="item" class:danger={it.danger} role="menuitem" disabled={it.disabled} onclick={() => { close(); it.run?.() }}>
          <span class="label">{it.label}</span>
          {#if it.shortcut}<span class="sc">{it.shortcut}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 180;
    min-width: 200px;
    padding: 4px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    font-size: 12px;
  }
  .title {
    padding: 4px 8px 6px;
    color: var(--text-dim);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 12px;
    border: none;
    background: transparent;
    padding: 5px 8px;
    border-radius: 4px;
    text-align: left;
  }
  .item .label {
    flex: 1;
  }
  .item .sc {
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
  }
  .item:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .item:hover:not(:disabled) .sc {
    color: var(--accent-ink);
  }
  .item.danger:hover:not(:disabled) {
    background: var(--danger);
    color: #fff;
  }
  .item:disabled {
    opacity: 0.45;
  }
</style>
