<script lang="ts">
  import { requestThumb } from '../lib/wow/thumbs'

  interface Props {
    thumbKey: string
    label: string
    title: string
    active?: boolean
    badge?: string
    onclick: () => void
  }
  let { thumbKey, label, title, active = false, badge, onclick }: Props = $props()

  let url = $state('')
  let failed = $state(false)

  // Request the thumbnail only while the tile is on screen.
  function lazy(node: HTMLElement, key: string) {
    let cancel: (() => void) | null = null
    let current = key
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (visible && !cancel && !url) {
          cancel = requestThumb(
            current,
            (u) => (url = u),
            () => (failed = true),
          )
        } else if (!visible && cancel && !url) {
          cancel()
          cancel = null
        }
      },
      { rootMargin: '120px' },
    )
    io.observe(node)
    return {
      update(k: string) {
        if (k === current) return
        current = k
        cancel?.()
        cancel = null
        url = ''
        failed = false
        io.unobserve(node)
        io.observe(node)
      },
      destroy() {
        io.disconnect()
        cancel?.()
      },
    }
  }
</script>

<button class="tile" class:active class:failed {title} {onclick} use:lazy={thumbKey}>
  <div class="img">
    {#if url}
      <img src={url} alt="" draggable="false" />
    {:else if failed}
      <span class="x">✕</span>
    {:else}
      <span class="spin"></span>
    {/if}
    {#if badge}<span class="badge">{badge}</span>{/if}
  </div>
  <span class="label">{label}</span>
</button>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 4px;
    min-width: 0;
    background: var(--bg);
  }
  .tile.active {
    border-color: var(--accent);
    background: var(--panel-3);
    color: var(--text);
  }
  /* Models with nothing renderable (pure particle effects) */
  .tile.failed {
    opacity: 0.45;
  }
  .img {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border-radius: 4px;
    background: radial-gradient(circle at 50% 35%, #4a5366, #262b35 75%);
    overflow: hidden;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .label {
    width: 100%;
    font-size: 10px;
    line-height: 1.2;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    position: absolute;
    top: 3px;
    left: 3px;
    font: 10px var(--mono);
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 3px;
    padding: 0 4px;
  }
  .x {
    color: var(--text-dim);
  }
  .spin {
    width: 14px;
    height: 14px;
    border: 2px solid var(--panel-3);
    border-top-color: var(--text-dim);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
