<script lang="ts">
	import { ExportSounds, ExportSoundsDialog, ImportSound, OpenSoundFileDialog, ReplaceSound, SoundEntry, SoundFiles } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { leaveField, takeEscape } from '../lib/state/escape'
	import { copyToClipboard } from '../lib/ui/clipboard'
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import { playSound, soundPlayer, stopSound } from '../lib/ui/soundPlayer.svelte'
	import SoundPicker, { forgetSoundEntries } from './SoundPicker.svelte'

	// The Sound tool (#684, Tools › Sounds…): the client's sounds, as the SoundEntries.dbc rows the game
	// plays (the shared SoundPicker of #674) or as the files under Sound\, each with Play. A picked
	// sound shows its fields, its files and what plays it (zone music, intros, ambience, game object
	// displays). Export saves files as they are stored (WAV or MP3); Import sound… adds a WAV or MP3 as
	// a new sound (the file under Sound\Meld and a SoundEntries row, with a ZoneMusic or SoundAmbience
	// row for music or ambience, so the object editor's and the Zones dialog's pickers list it); Replace…
	// puts a file over a client sound's own, which every sound naming it then plays. The owner's
	// decision on #684: import as new and replace, and one shared sound list.

	const target = $derived(ui.soundsTool)

	let tab = $state<'sounds' | 'files'>('sounds')
	let picked = $state(0)
	let info = $state<vmangos.SoundEntryInfo | null>(null)
	let note = $state('')
	let error = $state('')
	let busy = $state(false)
	let root = $state<HTMLElement | null>(null)
	/** Bumped after an import, so the sound list is read again, starting at the search `start`. */
	let version = $state(0)
	let start = $state('')

	$effect(() => {
		if (target?.id) picked = target.id
	})

	$effect(() => {
		const id = picked
		void version
		info = null
		if (!id) return
		void SoundEntry(id).then(
			(s) => id === picked && (info = s),
			(e) => id === picked && (error = String(e)),
		)
	})

	// The files under Sound\, read when the Files tab first shows.
	let files = $state<string[] | null>(null)
	let fileQuery = $state('')
	let pickedFile = $state('')
	$effect(() => {
		if (!target || tab !== 'files' || files) return
		void SoundFiles().then(
			(f) => (files = f),
			(e) => ((files = []), (error = String(e))),
		)
	})
	const FILE_LIMIT = 200
	const fileMatches = $derived.by(() => {
		const words = fileQuery.toLowerCase().split(/\s+/).filter(Boolean)
		const all = files ?? []
		return words.length ? all.filter((f) => words.every((w) => f.toLowerCase().includes(w))) : all
	})

	const baseName = (f: string) => f.slice(f.lastIndexOf('\\') + 1)
	const play = (file: string) => playSound(file, (m) => (error = m))
	const playIcon = (file: string) => (soundPlayer.playing && soundPlayer.playing === file ? '■' : '▶')
	/** What a write into the patch says: at once, or once the game has closed. */
	const when = (waiting: boolean) => (waiting ? 'It waits for the game to close; the game plays it from its next start.' : 'The game plays it from its next start.')

	function tell(text: string) {
		note = text
		error = ''
		setStatus(text, 8000)
	}

	async function copy(text: string, what: string) {
		try {
			await copyToClipboard(text)
			tell(`Copied ${what} ${text}.`)
		} catch (e) {
			error = String(e)
		}
	}

	async function exportFiles(paths: string[]) {
		if (!paths.length) return
		const dir = await ExportSoundsDialog().catch((e) => ((error = String(e)), ''))
		if (!dir) return
		try {
			const r = await ExportSounds(paths, dir)
			const failed = r.failed ?? []
			tell(`Saved ${r.written === 1 ? baseName(paths[0]) : `${r.written} files`} in ${dir}.${failed.length ? ` Could not read ${failed.join(', ')}.` : ''}`)
		} catch (e) {
			error = String(e)
		}
	}

	/** Asks for a file to put over the client's file, then confirms, naming the picked sound when it plays the file. */
	async function replaceFile(file: string) {
		const path = await OpenSoundFileDialog(`Replace ${baseName(file)}`).catch((e) => ((error = String(e)), ''))
		if (!path) return
		const users = info && info.files.includes(file) ? ` ${info.name} (${info.id}) and any other sound that names it` : ' Every sound that names it'
		const text = `Put ${baseName(path)} over the client's ${file}?${users} will play the new file. It goes into Meld's patch and stays there; export the client's file first to be able to put it back.`
		if (!(await askConfirm(text, { title: 'Replace a client sound', ok: 'Replace' }))) return
		busy = true
		try {
			const waiting = await ReplaceSound(file, path)
			stopSound()
			tell(`Replaced ${file} with ${baseName(path)}. ${when(waiting)}`)
		} catch (e) {
			error = String(e)
		} finally {
			busy = false
		}
	}

	// Import: the file picked, then its name, kind and volume, then Import.
	const KINDS: Array<[string, string, string]> = [
		['sound', 'Sound', 'A sound played once: an object opening or closing, a click (SoundEntries type 25)'],
		['loop', 'Loop', "A sound that loops near an object: a fire's crackle, a lamp's hum (type 25, looping)"],
		['music', 'Zone music', "Music for a zone: adds a ZoneMusic row the Zones dialog's Zone music lists (type 28)"],
		['ambience', 'Zone ambience', "A zone's background sound: adds a SoundAmbience row the Zones dialog's Ambience lists (type 50)"],
	]
	let importing = $state<{ path: string; name: string; kind: string; volume: number } | null>(null)

	async function pickImport() {
		const path = await OpenSoundFileDialog('Import Sound').catch((e) => ((error = String(e)), ''))
		if (!path) return
		const file = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
		const stem = file
			.replace(/\.[^.]*$/, '')
			.trim()
			.replace(/\s+/g, '_')
		importing = { path, name: stem, kind: /\.mp3$/i.test(file) ? 'music' : 'sound', volume: 0.7 }
		error = note = ''
	}

	async function runImport() {
		const imp = importing
		if (!imp) return
		busy = true
		try {
			const r = await ImportSound(imp.path, { name: imp.name.trim(), kind: imp.kind, volume: imp.volume })
			forgetSoundEntries()
			importing = null
			tab = 'sounds'
			start = imp.name.trim()
			version++
			picked = r.id
			files = null
			const zone = r.zone ? (imp.kind === 'music' ? ` and ZoneMusic ${r.zone}` : ` and SoundAmbience ${r.zone}`) : ''
			tell(`${r.updated ? 'Updated' : 'Imported'} ${imp.name.trim()} as sound ${r.id}${zone}, ${r.file}. ${when(r.waiting)}`)
		} catch (e) {
			error = String(e)
		} finally {
			busy = false
		}
	}

	function close() {
		stopSound()
		ui.soundsTool = null
		importing = null
		note = error = ''
	}

	function onKey(e: KeyboardEvent) {
		if (!target || e.key !== 'Escape' || ui.contextMenu) return
		if (!takeEscape(e, root)) return
		if (leaveField(e)) return
		e.preventDefault()
		if (importing) importing = null
		else close()
	}

	const list = (rows: vmangos.SoundOption[] | null | undefined) => (rows ?? []).map((r) => `${r.name || r.id} (${r.id})`).join(', ')
</script>

<svelte:window onkeydown={onKey} />

{#if target}
	<div class="editor" role="dialog" aria-modal="true" aria-label="Sounds" bind:this={root} use:dialogFocus>
		<header>
			<div class="title">
				<h2>Sounds</h2>
				<span class="dim">The client's sounds: play them, export their files, import WAV or MP3 files as new sounds or put one over a client sound.</span>
			</div>
			<div class="actions">
				<button disabled={busy} onclick={pickImport} title="Add a WAV or MP3 file to the client as a new sound, for objects or zones">Import sound…</button>
				<button onclick={close} title="Close (Esc)">Close</button>
			</div>
		</header>
		{#if error}<div class="bar error">{error}</div>{/if}
		{#if note}<div class="bar ok">{note}</div>{/if}
		<div class="body">
			<section class="list-area">
				<nav class="tabs" aria-label="List">
					<button class:active={tab === 'sounds'} onclick={() => (tab = 'sounds')} title="The SoundEntries.dbc rows: what zones, objects and the interface play">Sounds</button>
					<button class:active={tab === 'files'} onclick={() => (tab = 'files')} title="The sound files under Sound\">Files</button>
				</nav>
				{#if tab === 'sounds'}
					{#key version}
						<SoundPicker tall selected={picked} {start} onpick={(s) => ((picked = s.id), (importing = null))} />
					{/key}
				{:else}
					<div class="files">
						<input type="search" placeholder="Search files by path" bind:value={fileQuery} aria-label="Search sound files" />
						<ul class="file-list" aria-label="Sound files">
							{#each fileMatches.slice(0, FILE_LIMIT) as f (f)}
								<li class:active={f === pickedFile}>
									<button class="row" title={f} onclick={() => ((pickedFile = f), (importing = null))}>{f}</button>
									<button class="play" title="Play {f}" onclick={() => play(f)}>{playIcon(f)}</button>
								</li>
							{:else}
								<li class="dim">{files ? 'Nothing matches.' : 'Reading the files…'}</li>
							{/each}
						</ul>
						{#if fileMatches.length > FILE_LIMIT}<p class="dim">Showing {FILE_LIMIT} of {fileMatches.length.toLocaleString()}. Narrow the search to see the rest.</p>{/if}
					</div>
				{/if}
			</section>
			<aside aria-label="The sound">
				{#if importing}
					<h3>Import a sound</h3>
					<p class="dim path">{importing.path}</p>
					<label class="field">Name <input bind:value={importing.name} aria-label="Sound name" title="The SoundEntries name: the pickers show it, and the interface's PlaySound plays a sound by it" /></label>
					<fieldset class="kinds">
						<legend>What it is</legend>
						{#each KINDS as [k, label, hint] (k)}
							<label title={hint}><input type="radio" name="sound-kind" value={k} bind:group={importing.kind} /> {label}</label>
						{/each}
					</fieldset>
					<label class="field">Volume <input type="number" min="0.05" max="1" step="0.05" bind:value={importing.volume} aria-label="Volume" title="0 to 1; the client's own sounds are mostly 0.5 to 0.8" /></label>
					<p class="dim">
						The file goes into Meld's patch under Sound\Meld, with a SoundEntries row naming it{importing.kind === 'music' ? ' and a ZoneMusic row' : importing.kind === 'ambience' ? ' and a SoundAmbience row' : ''}. Importing
						the same file again updates that sound.
					</p>
					<div class="buttons">
						<button class="primary" disabled={busy || !importing.name.trim()} onclick={runImport}>Import</button>
						<button disabled={busy} onclick={() => (importing = null)}>Cancel</button>
					</div>
				{:else if tab === 'files'}
					{#if pickedFile}
						<h3 class="name" title={pickedFile}>{baseName(pickedFile)}</h3>
						<p class="dim path">{pickedFile}</p>
						<div class="buttons">
							<button onclick={() => play(pickedFile)}>{playIcon(pickedFile)} Play</button>
							<button onclick={() => copy(pickedFile, 'the path')}>Copy path</button>
							<button onclick={() => exportFiles([pickedFile])} title="Save this file as it is stored">Export…</button>
							<button disabled={busy} onclick={() => replaceFile(pickedFile)} title="Put a WAV or MP3 file of your own over this one">Replace…</button>
						</div>
					{:else}
						<p class="dim">Pick a file to play, export or replace it.</p>
					{/if}
				{:else if info}
					<h3 class="name" title={info.name}>{info.name || `Sound ${info.id}`}</h3>
					<p class="dim">SoundEntries {info.id} · type {info.type}{info.imported ? ' · imported' : ''}</p>
					<div class="buttons">
						<button onclick={() => info && copy(String(info.id), 'the sound ID')} title="Copy the SoundEntries ID, the number an object's sound slot or a zone's sound row holds">Copy ID</button>
						<button onclick={() => info && copy(info.name, 'the name')} title="Copy the name the interface's PlaySound takes">Copy name</button>
						<button disabled={!info.files.length} onclick={() => info && exportFiles(info.files)} title="Save the sound's files as they are stored"
							>Export {info.files.length === 1 ? 'file' : `${info.files.length} files`}…</button
						>
					</div>
					<dl class="facts">
						<dt>Folder</dt>
						<dd>{info.dir || '—'}</dd>
						<dt>Volume</dt>
						<dd>{info.volume}</dd>
						<dt>Distance</dt>
						<dd>full to {info.minDist} yd, heard to {info.cutoff} yd</dd>
					</dl>
					<h4>Files</h4>
					{#if info.files.length}
						<ul class="sound-files" aria-label="The sound's files">
							{#each info.files as f (f)}
								<li>
									<button class="play" title="Play {f}" onclick={() => play(f)}>{playIcon(f)}</button>
									<span class="file" title={f}>{baseName(f)}</span>
									<button onclick={() => exportFiles([f])} title="Save this file as it is stored">Export…</button>
									<button disabled={busy} onclick={() => replaceFile(f)} title="Put a WAV or MP3 file of your own over this one: every sound naming it plays yours">Replace…</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="dim">It names no file.</p>
					{/if}
					<h4>Played by</h4>
					<div class="uses">
						{#if info.music?.length}<p>Zone music: {list(info.music)}</p>{/if}
						{#if info.intro?.length}<p>Intro music: {list(info.intro)}</p>{/if}
						{#if info.ambience?.length}<p>Ambience: SoundAmbience {(info.ambience ?? []).map((a) => a.id).join(', ')}</p>{/if}
						{#if info.displays}<p>{info.displays.toLocaleString()} game object display{info.displays === 1 ? '' : 's'}</p>{/if}
						{#if !info.music?.length && !info.intro?.length && !info.ambience?.length && !info.displays}
							<p class="dim">No zone sound row or game object display names it (spells, creatures and the interface may).</p>
						{/if}
					</div>
				{:else if picked}
					<p class="dim">Reading…</p>
				{:else}
					<p class="dim">Pick a sound to see its files and what plays it, export them or put your own over them. Import sound… adds a new one.</p>
				{/if}
			</aside>
		</div>
	</div>
{/if}

<style>
	.editor {
		position: fixed;
		inset: 0;
		z-index: var(--z-editor-3);
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.bar {
		padding: 8px 16px;
		font-size: 12px;
		border-bottom: 1px solid var(--border);
		overflow-wrap: anywhere;
	}
	.bar.error {
		color: var(--danger-text);
	}
	.bar.ok {
		color: var(--ok);
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.list-area {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
	}
	.tabs {
		display: flex;
		gap: 4px;
	}
	.tabs button.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.files {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.file-list {
		flex: 1;
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
	}
	.file-list li {
		display: flex;
		align-items: center;
	}
	.file-list li.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.file-list .row {
		flex: 1;
		min-width: 0;
		text-align: left;
		background: none;
		border: none;
		border-radius: 0;
		padding: 4px 8px;
		font-size: 12px;
		color: inherit;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.play {
		flex: none;
		padding: 2px 8px;
		margin-right: 4px;
	}
	aside {
		width: 340px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-left: 1px solid var(--border);
		background: var(--panel);
		overflow-y: auto;
		font-size: 12px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		text-transform: none;
		letter-spacing: normal;
		overflow-wrap: anywhere;
		user-select: text;
	}
	h4 {
		margin: 8px 0 0;
		font-size: 12px;
	}
	.path {
		margin: 0;
		overflow-wrap: anywhere;
		user-select: text;
	}
	aside p {
		margin: 0;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.kinds {
		display: flex;
		flex-direction: column;
		gap: 4px;
		border: 1px solid var(--border);
		padding: 6px 8px;
		margin: 0;
	}
	.kinds label {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 8px;
		margin: 0;
	}
	.facts dt {
		color: var(--text-dim);
	}
	.facts dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.sound-files {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.sound-files li {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.sound-files .file {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.sound-files button:not(.play) {
		padding: 2px 6px;
	}
	.uses {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
