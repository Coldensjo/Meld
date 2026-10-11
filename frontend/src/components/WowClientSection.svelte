<script lang="ts">
  import { wow } from '../lib/state/editor.svelte'
  import { chooseWowFolder, clearWowFolder } from '../lib/wow/api'
  import { hasBackend } from '../lib/io/mapio'

  const folderName = $derived(wow.path ? wow.path.split(/[\\/]/).filter(Boolean).pop() : '')
</script>

<section>
  <h3>WoW Client Assets</h3>
  {#if !hasBackend()}
    <p class="hint">Available in the desktop app.</p>
  {:else if wow.loading}
    <p class="hint">Loading archives…</p>
  {:else if wow.loaded}
    <p class="ok" title={wow.path}>● {folderName} <span>{wow.files.toLocaleString()} files</span></p>
    <div class="row">
      <button onclick={chooseWowFolder}>Change…</button>
      <button onclick={clearWowFolder}>Disconnect</button>
    </div>
  {:else}
    <p class="hint">
      Point to a local WoW 1.12 client to use its models and tileset textures. Files are read directly from its MPQs, and
      nothing is copied into your project.
    </p>
    {#if wow.error}<p class="err">{wow.error}</p>{/if}
    <button class="full" onclick={chooseWowFolder}>Select WoW folder…</button>
  {/if}
</section>

<style>
  section {
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }
  .hint {
    color: var(--text-dim);
    font-size: 12px;
    margin: 0 0 8px;
  }
  .ok {
    margin: 0 0 8px;
    color: #7fc77f;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ok span {
    color: var(--text-dim);
    font-size: 12px;
  }
  .err {
    color: var(--danger);
    font-size: 12px;
    margin: 0 0 8px;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row button,
  .full {
    flex: 1;
    width: 100%;
  }
</style>
