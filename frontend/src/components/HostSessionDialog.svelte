<script lang="ts">
	import Modal from './Modal.svelte'
	import { prefs } from '../lib/state/editor.svelte'
	import { hostSession, leaveSession, shared } from '../lib/session/shared.svelte'
	import { peersTitle } from '../lib/session/peers'
	import { copyToClipboard } from '../lib/ui/clipboard'
	import { clamp } from '../lib/ui/inputs'

	// File › Host Session… (#1000): the name to show and the port, then the code and the addresses to give
	// the others. Reopened while hosting (File › Session Code and Addresses…), it shows those at once.

	let { onclose }: { onclose: () => void } = $props()

	let name = $state(prefs.shareName)
	let port = $state(prefs.sharePort || 34180)
	let busy = $state(false)
	let failure = $state('')
	let copied = $state('')

	async function host() {
		if (busy || !name.trim()) return
		busy = true
		failure = ''
		try {
			prefs.shareName = name.trim()
			prefs.sharePort = port
			await hostSession(port, name.trim())
		} catch (err) {
			failure = String(err)
		} finally {
			busy = false
		}
	}

	async function copy(text: string) {
		await copyToClipboard(text)
		copied = text
	}

	const invite = $derived(`Meld session at ${shared.addrs.join(' or ') || `this machine's address, port ${shared.port}`}, code ${shared.code}`)
</script>

<Modal title={shared.role === 'host' ? 'Hosting a Session' : 'Host Session'} width={440} {onclose}>
	{#if shared.role === 'host'}
		<p class="dim">Give the others the code and one of the addresses: they join with File › Join Session…. Your map stays the session's map; only you compile it to the client and the server.</p>
		<div class="grid">
			<span>Code</span>
			<span class="row">
				<code data-session-code>{shared.code}</code>
				<button onclick={() => copy(shared.code)}>{copied === shared.code ? 'Copied' : 'Copy'}</button>
			</span>
			<span>Addresses</span>
			<span class="addrs">
				{#each shared.addrs as a (a)}
					<span class="row"><code>{a}</code><button onclick={() => copy(a)}>{copied === a ? 'Copied' : 'Copy'}</button></span>
				{:else}
					<span class="dim">No network address found: on this machine, join at 127.0.0.1:{shared.port}.</span>
				{/each}
			</span>
			<span>Members</span>
			<span class="members">{peersTitle(shared.peers, shared.you)}</span>
		</div>
		<p class="dim">Over the internet the others need a port forward of port {shared.port} to this machine, or a VPN between you.</p>
	{:else}
		<p class="dim">The others join this Meld with the code it gives, and start from the map open now. Windows may ask whether Meld may use the network the first time: allow it on private networks.</p>
		<div class="grid">
			<label for="host-name">Your name</label>
			<input id="host-name" maxlength="40" bind:value={name} onkeydown={(e) => e.key === 'Enter' && host()} />
			<label for="host-port" title="The port the others connect to (34180 by default)">Port</label>
			<input id="host-port" type="number" min="1024" max="65535" value={port} onchange={(e) => (port = Math.round(clamp(Number((e.target as HTMLInputElement).value) || 34180, 1024, 65535)))} />
		</div>
		{#if failure}<p class="error">{failure}</p>{/if}
	{/if}
	{#snippet actions()}
		{#if shared.role === 'host'}
			<button onclick={() => copy(invite)}>{copied === invite ? 'Copied' : 'Copy Invitation'}</button>
			<button
				onclick={async () => {
					await leaveSession()
					onclose()
				}}>End Session</button
			>
			<button class="active" onclick={onclose}>Close</button>
		{:else}
			<button onclick={onclose}>Cancel</button>
			<button class="active" disabled={busy || !name.trim()} onclick={host}>Host</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.grid {
		display: grid;
		grid-template-columns: 90px 1fr;
		gap: 8px;
		align-items: center;
		margin: 10px 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.addrs {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.members {
		white-space: pre-line;
	}
	code {
		font-family: var(--mono);
		font-size: 13px;
		user-select: all;
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
