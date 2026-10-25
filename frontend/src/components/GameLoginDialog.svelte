<script lang="ts">
	import { onMount } from 'svelte'
	import Modal from './Modal.svelte'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { GameLogin, SetGameLogin } from '../../wailsjs/go/main/App'

	const close = () => (ui.dialog = null)

	// The account a region export logs the game back in with. The saved password is never sent here, so
	// an empty password field keeps it when the account stays the same.
	let account = $state('')
	let password = $state('')
	let hasPassword = $state(false)
	let character = $state('')

	onMount(async () => {
		try {
			const info = await GameLogin()
			account = info.account
			hasPassword = info.hasPassword
			character = info.character
		} catch {
			// No desktop app behind the page: start with an empty login.
		}
	})

	async function save(next: string, nextPassword: string, nextCharacter: string) {
		close()
		try {
			await SetGameLogin(next, nextPassword, nextCharacter)
			setStatus(next ? `Saved the login for ${next}.` : 'Cleared the saved login.')
		} catch (e) {
			setStatus(`Could not save the login: ${e}`)
		}
	}
</script>

<Modal title="Game login" width={400} onclose={close}>
	<p>Launch opens the game and logs in with this account.</p>
	<p>With a character, the game enters the world as it, and Launch puts it where the camera is.</p>
	<p class="warn">The password is saved in plain text in your Meld config file. Use this on a development machine only.</p>
	<div class="fields">
		<label for="login-account">Account</label>
		<input id="login-account" type="text" autocomplete="off" bind:value={account} />
		<label for="login-password">Password</label>
		<input id="login-password" type="password" autocomplete="off" bind:value={password} placeholder={hasPassword ? 'Saved (leave blank to keep it)' : ''} />
		<label for="login-character">Character</label>
		<input id="login-character" type="text" autocomplete="off" placeholder="None (character select)" bind:value={character} />
	</div>
	{#snippet actions()}
		<button onclick={() => save('', '', '')}>Clear login</button>
		<button onclick={close}>Cancel</button>
		<button class="active" disabled={account.trim() === ''} onclick={() => save(account.trim(), password, character.trim())}>Save</button>
	{/snippet}
</Modal>

<style>
	.fields {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 8px;
		align-items: center;
		margin-top: 10px;
	}
	.fields input {
		width: 100%;
	}
	.warn {
		color: var(--warn, #d9a441);
	}
</style>
