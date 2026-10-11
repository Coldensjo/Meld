<script lang="ts">
  import { editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { openMap, saveMap } from '../lib/io/mapio'

  const withEngine = (fn: (e: NonNullable<typeof engineRef.current>) => unknown) => () => {
    if (engineRef.current) fn(engineRef.current)
  }
</script>

<header class="menubar">
  <span class="brand">⛰ WorldEditor</span>
  <div class="group">
    <button onclick={() => (ui.showNewDialog = true)} title="New map (Ctrl+N)">New</button>
    <button onclick={withEngine(openMap)} disabled={ui.busy} title="Open map (Ctrl+O)">Open</button>
    <button onclick={withEngine((e) => saveMap(e))} disabled={ui.busy} title="Save (Ctrl+S)">Save</button>
    <button onclick={withEngine((e) => saveMap(e, true))} disabled={ui.busy} title="Save as (Ctrl+Shift+S)">Save As</button>
  </div>
  <div class="group">
    <button onclick={withEngine((e) => e.undo())} disabled={!ui.canUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
    <button onclick={withEngine((e) => e.redo())} disabled={!ui.canRedo} title="Redo (Ctrl+Y)">↷ Redo</button>
  </div>
  <div class="spacer"></div>
  <span class="title">{editor.mapName}{editor.dirty ? ' •' : ''}</span>
</header>

<style>
  .menubar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 40px;
    padding: 0 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 700;
    color: var(--accent-2);
    letter-spacing: 0.02em;
  }
  .group {
    display: flex;
    gap: 4px;
  }
  .group button {
    padding: 3px 10px;
  }
  .spacer {
    flex: 1;
  }
  .title {
    color: var(--text-dim);
  }
</style>
