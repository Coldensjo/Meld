<script lang="ts">
	import { CreateAccount, DeleteAccount, ListAccounts, ListCharacters, MapEntries, ReadCharacter, SaveCharacter, SetAccount } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { TemplateEditor, checkRefused } from '../lib/ui/templateEditor.svelte'
	import { CLASSES } from '../lib/wow/classes'
	import { RACES } from '../lib/world/creatureFields'
	import EditorFrame from './EditorFrame.svelte'
	import ClassIcon from './ClassIcon.svelte'
	import MoneyField from './MoneyField.svelte'

	// Tools › Characters and Accounts (#855): the realm's accounts (the login database) and their
	// characters (the character database). Make, change and delete accounts; open a character and
	// change its name, race, class, gender, level, money and where it stands. The world server writes a
	// character in the world over its row when it logs out, so Go refuses to change one that is in the
	// world while the world server runs, and a rename while it runs at all.

	const target = $derived(ui.characterEditor)

	/** The GM levels (Common.h AccountTypes). */
	const GM_LEVELS: Array<[number, string]> = [
		[0, 'Player'],
		[1, 'Moderator'],
		[2, 'Ticket master'],
		[3, 'Game master'],
		[4, 'Basic admin'],
		[5, 'Developer'],
		[6, 'Administrator'],
	]
	const gmName = (n: number) => GM_LEVELS.find(([l]) => l === n)?.[1] ?? `Level ${n}`
	const raceName = (n: number) => RACES.find(([r]) => r === n)?.[1] ?? `Race ${n}`
	const className = (n: number) => CLASSES.find(([c]) => c === n)?.[1] ?? `Class ${n}`

	const ed = new TemplateEditor<{ account: number; guid: number }, vmangos.CharacterRecord>({
		id: (t) => `${t.account}:${t.guid}`,
		entry: (t) => t.guid,
		read: ReadCharacter,
		clear: () => (ui.characterEditor = null),
		onopen: () => {
			confirmDelete = false
			focusCol = ''
		},
	})
	ed.follow(() => target)
	const record = $derived(ed.record)
	const values = $derived(ed.values)
	const saved = $derived(ed.saved)
	const changes = $derived(ed.changes)
	const changeCount = $derived(ed.changeCount)
	const unsaved = $derived(ed.unsaved)

	// The accounts, read when the tool opens and after a change to one.
	let accounts = $state<vmangos.Account[]>([])
	let loadingAccounts = $state(false)
	let filter = $state('')
	const shown = $derived(filter.trim() ? accounts.filter((a) => a.name.toLowerCase().includes(filter.trim().toLowerCase())) : accounts)
	const account = $derived(accounts.find((a) => a.id === target?.account) ?? null)

	async function readAccounts() {
		loadingAccounts = true
		try {
			accounts = (await ListAccounts()) ?? []
		} catch (err) {
			ed.error = String(err)
		} finally {
			loadingAccounts = false
		}
	}
	let wasOpen = false
	$effect(() => {
		const open = !!target
		if (open && !wasOpen) void readAccounts()
		wasOpen = open
	})

	// The open account's characters.
	let characters = $state<vmangos.AccountCharacter[]>([])
	let charactersOf = $state(0)
	async function readCharacters(id: number) {
		try {
			const list = (await ListCharacters(id)) ?? []
			if (target?.account === id) {
				characters = list
				charactersOf = id
			}
		} catch (err) {
			ed.error = String(err)
		}
	}
	$effect(() => {
		const id = target?.account ?? 0
		if (id > 0 && id !== charactersOf) void readCharacters(id)
		if (id <= 0) charactersOf = 0
	})

	function openAccount(id: number) {
		if (target?.account === id && target.guid === 0) return
		ed.leave(() => {
			ed.note = ''
			ui.characterEditor = { account: id, guid: 0 }
		})
	}

	function openCharacter(guid: number) {
		if (!target || target.guid === guid) return
		ed.leave(() => {
			ed.note = ''
			ui.characterEditor = { account: target.account, guid }
		})
	}

	// A new account.
	let newName = $state('')
	let newPassword = $state('')
	let newGM = $state(0)
	let creating = $state(false)
	async function create() {
		if (!newName.trim() || !newPassword) return
		creating = true
		ed.error = ''
		try {
			const id = await CreateAccount(newName, newPassword, newGM)
			const name = newName.trim().toUpperCase()
			newName = ''
			newPassword = ''
			newGM = 0
			await readAccounts()
			ui.characterEditor = { account: id, guid: 0 }
			ed.note = `Made account ${name}. Log in with it in the game; it has no characters yet.`
			setStatus(ed.note, 8000)
		} catch (err) {
			ed.error = String(err)
		} finally {
			creating = false
		}
	}

	// The open account's GM level and password.
	let gm = $state(0)
	let password = $state('')
	let busy = $state(false)
	let confirmDelete = $state(false)
	$effect(() => {
		gm = account?.gmLevel ?? 0
		password = ''
	})
	const accountDirty = $derived(!!account && (gm !== account.gmLevel || password !== ''))

	async function saveAccount() {
		if (!account || !accountDirty) return
		busy = true
		ed.error = ''
		try {
			await SetAccount(account.id, gm, password)
			const what = [gm !== account.gmLevel ? `GM level ${gmName(gm)}` : '', password ? 'a new password' : ''].filter(Boolean).join(' and ')
			ed.note = `Gave ${account.name} ${what}.`
			setStatus(ed.note, 8000)
			await readAccounts()
		} catch (err) {
			ed.error = String(err)
		} finally {
			busy = false
		}
	}

	async function deleteAccount() {
		if (!account) return
		busy = true
		ed.error = ''
		try {
			await DeleteAccount(account.id)
			ed.note = `Deleted account ${account.name}.`
			setStatus(ed.note, 8000)
			confirmDelete = false
			ui.characterEditor = { account: 0, guid: 0 }
			await readAccounts()
		} catch (err) {
			ed.error = String(err)
		} finally {
			busy = false
		}
	}

	// The character's map, by name.
	let maps = $state<vmangos.MapEntry[]>([])
	$effect(() => {
		if (target && !maps.length)
			void MapEntries()
				.then((m) => (maps = (m ?? []).slice().sort((a, b) => a.ID - b.ID)))
				.catch(() => {})
	})
	const mapId = $derived(Number(values.map ?? 0))
	const mapKnown = $derived(maps.some((m) => m.ID === mapId))

	function set(col: string, v: string | number) {
		values[col] = String(v)
	}

	/** Puts the character where the editor's camera is, as Launch would. */
	async function toCamera() {
		const s = await engineRef.current?.playerSpot()
		if (!s) {
			ed.error = 'This map has no client map ID: open a part of Azeroth or a map made for the client.'
			return
		}
		const r = (n: number) => String(Math.round(n * 1000) / 1000)
		set('map', s.map)
		set('position_x', r(s.x))
		set('position_y', r(s.y))
		set('position_z', r(s.z))
		set('orientation', r(s.o))
	}

	function save() {
		const r = record
		if (!r || !changeCount) return
		focusCol = ''
		void ed.save(
			'Saving the character',
			async () => {
				const n = changeCount
				checkRefused(await SaveCharacter(r.guid, changes))
				// Read it back: Go writes what a change takes along (experience, looks, transport).
				ed.markSaved()
				await ed.load(r.guid)
				await readCharacters(r.account)
				ed.note = `Saved ${n} ${n === 1 ? 'value' : 'values'} of ${ed.saved.name} to the character database. It enters the world with them at its next login.`
				setStatus(ed.note, 10000)
			},
			(col) => (focusCol = col),
		)
	}
	/** The field of a refused value, outlined until it changes. */
	let focusCol = $state('')

	const played = (s: number) => {
		const h = Math.floor(s / 3600)
		return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`
	}
</script>

{#if target}
	<EditorFrame {ed} label="Characters and accounts" z="editor" unsavedText="Unsaved changes to the character.">
		{#snippet title()}
			{#if record}
				<h2>{values.name || saved.name}</h2>
				<span class="dim">character {record.guid} · {account?.name ?? `account ${record.account}`}</span>
			{:else if account}
				<h2>{account.name}</h2>
				<span class="dim">account {account.id} · {gmName(account.gmLevel)}</span>
			{:else if target.account === -1}
				<h2>New account</h2>
			{:else}
				<h2>Characters and accounts</h2>
				<span class="dim">The realm's accounts and their characters, in the server's databases.</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if record}
				<button disabled={!unsaved || ed.saving} onclick={() => ed.revert()}>Revert</button>
				<button class="active" disabled={!unsaved || ed.saving} onclick={save}>{ed.saving ? 'Saving…' : unsaved ? `Save character (${changeCount})` : 'Saved'}</button>
			{/if}
		{/snippet}
		{#snippet bars()}
			{#if confirmDelete && account}
				<div class="bar warn">
					<span>Delete the account {account.name} from the login database? This cannot be undone.</span>
					<button onclick={() => (confirmDelete = false)}>Keep it</button>
					<button class="danger" disabled={busy} onclick={deleteAccount}>Delete account</button>
				</div>
			{/if}
			{#if record?.online}
				<div class="bar warn">
					<span>The database says {saved.name} is in the world. If the world server runs, log out of the game before saving: the server writes the character over its row when it logs out.</span>
				</div>
			{/if}
		{/snippet}

		<div class="body">
			<aside>
				<button class="new" class:active={target.account === -1} onclick={() => ed.leave(() => (ui.characterEditor = { account: -1, guid: 0 }))}>New account…</button>
				<input type="search" placeholder="Account name" bind:value={filter} aria-label="Find an account" />
				<ul class="found" aria-label="Accounts">
					{#each shown as a (a.id)}
						<li>
							<button class:on={a.id === target.account} onclick={() => openAccount(a.id)}>
								<span>{a.name}{a.gmLevel ? ` · ${gmName(a.gmLevel)}` : ''}</span>
								<span class="dim">{a.characters} {a.characters === 1 ? 'character' : 'characters'}</span>
							</button>
						</li>
					{:else}
						<li class="dim">{loadingAccounts ? 'Reading the accounts…' : filter.trim() ? 'No account matches.' : 'The realm has no accounts.'}</li>
					{/each}
				</ul>
			</aside>

			<section class="main">
				{#if target.account === -1}
					<div class="form">
						<p>Make an account to log in to the game with. Names and passwords are kept in upper case, as the game's login screen sends them; the password is stored only as the server stores it (its SRP6 verifier).</p>
						<label>Name <input type="text" maxlength="16" placeholder="Account name" bind:value={newName} /></label>
						<label>Password <input type="password" maxlength="16" placeholder="Password" bind:value={newPassword} onkeydown={(e) => e.key === 'Enter' && create()} /></label>
						<label
							>GM level
							<select bind:value={newGM}>
								{#each GM_LEVELS as [l, n] (l)}<option value={l}>{l} · {n}</option>{/each}
							</select>
						</label>
						<button class="active" disabled={!newName.trim() || !newPassword || creating} onclick={create}>{creating ? 'Making…' : 'Make account'}</button>
					</div>
				{:else if target.guid > 0}
					<div class="scroll">
						{#if !record}
							<p class="dim">{ed.loading ? 'Reading the character…' : ''}</p>
						{:else}
							<button class="back" onclick={() => openAccount(record.account)}>‹ {account?.name ?? 'The account'}</button>
							<h3>Character</h3>
							<div class="grid">
								<label class:changed={changes.name !== undefined} class:refused={focusCol === 'name'}>Name <input type="text" maxlength="12" value={values.name} oninput={(e) => set('name', e.currentTarget.value)} /></label>
								<label class:changed={changes.level !== undefined} class:refused={focusCol === 'level'}
									>Level <input type="number" min="1" max="255" value={values.level} oninput={(e) => set('level', e.currentTarget.value)} /></label
								>
								<label class:changed={changes.race !== undefined} class:refused={focusCol === 'race'}
									>Race
									<select value={values.race} onchange={(e) => set('race', e.currentTarget.value)}>
										{#each RACES as [r, n] (r)}<option value={String(r)}>{n}</option>{/each}
									</select>
								</label>
								<label class:changed={changes.class !== undefined} class:refused={focusCol === 'class'}
									>Class
									<select value={values.class} onchange={(e) => set('class', e.currentTarget.value)}>
										{#each CLASSES as [c, n] (c)}<option value={String(c)}>{n}</option>{/each}
									</select>
								</label>
								<label class:changed={changes.gender !== undefined}
									>Gender
									<select value={values.gender} onchange={(e) => set('gender', e.currentTarget.value)}>
										<option value="0">Male</option>
										<option value="1">Female</option>
									</select>
								</label>
								<div class="field" class:changed={changes.money !== undefined} class:refused={focusCol === 'money'}>
									<span>Money</span>
									<MoneyField value={Number(values.money ?? 0)} onset={(c) => set('money', c)} />
								</div>
							</div>
							<p class="dim">A new level starts with no experience, and a new race or gender the first skin, face and hair. A new race or class keeps the spells and skills the old one had.</p>
							<h3>Where it stands</h3>
							<div class="grid">
								<label class="wide" class:changed={changes.map !== undefined}
									>Map
									<select value={values.map} onchange={(e) => set('map', e.currentTarget.value)}>
										{#if !mapKnown}<option value={values.map}>Map {values.map}</option>{/if}
										{#each maps as m (m.ID)}<option value={String(m.ID)}>{m.ID} · {m.Name || m.Dir}</option>{/each}
									</select>
								</label>
								{#each [['position_x', 'X'], ['position_y', 'Y'], ['position_z', 'Z'], ['orientation', 'Facing']] as [col, label] (col)}
									<label class:changed={changes[col] !== undefined} class:refused={focusCol === col}>{label} <input type="number" step="any" value={values[col]} oninput={(e) => set(col, e.currentTarget.value)} /></label>
								{/each}
							</div>
							<div class="row">
								<button onclick={toCamera} title="Where the editor's camera is, on the ground or model below it, as Launch puts the Game Login's character">Put at the camera</button>
								<span class="dim">The server's coordinates. Moving it takes it off any boat, flight or instance.</span>
							</div>
							<h3>Read only</h3>
							<p class="dim">
								{raceName(Number(saved.race))}
								{className(Number(saved.class))} · {record.xp} experience · zone {record.zone} · played {played(record.playedTime)}{record.online ? ' · in the world' : ''}
							</p>
						{/if}
					</div>
				{:else if account}
					<div class="scroll">
						<h3>Account</h3>
						<p class="dim">
							Made {account.joinDate}{account.lastLogin && !account.lastLogin.startsWith('0000') ? ` · last login ${account.lastLogin}` : ''}{account.online ? ' · logged in' : ''}{account.locked ? ' · locked to its IP' : ''}
						</p>
						<div class="grid">
							<label
								>GM level
								<select bind:value={gm}>
									{#each GM_LEVELS as [l, n] (l)}<option value={l}>{l} · {n}</option>{/each}
								</select>
							</label>
							<label>New password <input type="password" maxlength="16" placeholder="Unchanged" bind:value={password} /></label>
						</div>
						<div class="row">
							<button class="active" disabled={!accountDirty || busy} onclick={saveAccount}>Save account</button>
							<button
								class="danger"
								disabled={busy || account.characters > 0}
								onclick={() => (confirmDelete = true)}
								title={account.characters > 0 ? 'Delete its characters in the game first: deleting one takes its items, mail and pets with it, which the server does' : 'Remove this account from the login database'}
								>Delete account…</button
							>
						</div>
						<h3>Characters</h3>
						<ul class="chars" aria-label="Characters">
							{#each charactersOf === account.id ? characters : [] as c (c.guid)}
								<li>
									<button onclick={() => openCharacter(c.guid)}>
										<ClassIcon id={c.class} size={28} />
										<span class="who"
											><strong>{c.name}</strong>
											<span class="dim">Level {c.level} {raceName(c.race)} {className(c.class)}{c.online ? ' · in the world' : ''}</span></span
										>
									</button>
								</li>
							{:else}
								<li class="dim">{charactersOf === account.id ? 'No characters. Make one in the game.' : 'Reading the characters…'}</li>
							{/each}
						</ul>
					</div>
				{:else}
					<div class="empty dim">Pick an account on the left, or make a new one.</div>
				{/if}
			</section>
		</div>
	</EditorFrame>
{/if}

<style>
	aside {
		width: 280px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		border-right: 1px solid var(--border);
		background: var(--panel);
	}
	.found,
	.chars {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 12px;
	}
	.found {
		overflow-y: auto;
		flex: 1;
	}
	.found button {
		width: 100%;
		display: flex;
		justify-content: space-between;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 4px 6px;
		text-align: left;
	}
	.found button:hover,
	.chars button:hover {
		background: var(--panel-2);
	}
	.found button.on {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.chars {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 480px;
	}
	.chars button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		text-align: left;
	}
	.who {
		display: flex;
		flex-direction: column;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 760px;
	}
	.back {
		align-self: flex-start;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 8px 12px;
		font-size: 12px;
	}
	.grid label,
	.grid .field {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 2px 4px;
		border-radius: 3px;
	}
	.grid .wide {
		grid-column: 1 / -1;
	}
	.changed {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.refused {
		outline: 1px solid var(--danger-text);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		max-width: 520px;
		font-size: 13px;
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.form p {
		margin: 0;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
</style>
