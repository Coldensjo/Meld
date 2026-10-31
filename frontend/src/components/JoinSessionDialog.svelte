<script lang="ts">
	import Modal from './Modal.svelte'
	import { prefs } from '../lib/state/editor.svelte'
	import { joinSession } from '../lib/session/shared.svelte'

	// File › Join Session… (#1000): the host's address, the code it gave and the name to show. The host's
	// map opens as a new tab once it arrives.

	let { onclose }: { onclose: () => void } = $props()

	let addr = $state(prefs.shareAddr)
	let code = $state('')
	let name = $state(prefs.shareName)
	let busy = $state(false)
	let failure = $state('')

	const ready = $derived(!!addr.trim() && !!code.trim() && !!name.trim())

	async function join() {
		if (busy || !ready) return
		busy = true
		failure = ''
		try {
			prefs.shareAddr = addr.trim()
			prefs.shareName = name.trim()
			await joinSession(addr.trim(), code.trim().toUpperCase(), name.trim())
			onclose()
		} catch (err) {
			failure = String(err)
		} finally {
			busy = false
		}
	}

	const enter = (e: KeyboardEvent) => e.key === 'Enter' && join()
</script>

<Modal title="Join Session" width={420} {onclose}>
	<p class="dim">The host's map opens as a new tab. It refers to the client's models and textures by path, so use the same client as the host: an asset yours lacks is missing, as in any map.</p>
	<div class="grid">
		<label for="join-addr" title="The address the host gave, as host:port (the port is 34180 when left out)">Host address</label>
		<input id="join-addr" placeholder="192.168.1.20:34180" bind:value={addr} onkeydown={enter} />
		<label for="join-code">Code</label>
		<input id="join-code" maxlength="12" autocomplete="off" bind:value={code} onkeydown={enter} />
		<label for="join-name">Your name</label>
		<input id="join-name" maxlength="40" bind:value={name} onkeydown={enter} />
	</div>
	{#if failure}<p class="error">{failure}</p>{/if}
	{#snippet actions()}
		<button onclick={onclose}>Cancel</button>
		<button class="active" disabled={busy || !ready} onclick={join}>{busy ? 'Joining…' : 'Join'}</button>
	{/snippet}
</Modal>

<style>
	.grid {
		display: grid;
		grid-template-columns: 100px 1fr;
		gap: 8px;
		align-items: center;
		margin: 10px 0;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	.error {
		color: var(--danger-text);
		font-size: 12px;
	}
</style>
