<script lang="ts">
	import { tick } from 'svelte'
	import { DeleteScript, ListScripts, SaveScript, ScriptsFolder } from '../../wailsjs/go/main/App'
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { clearScriptLog, scriptLog, scriptSay } from '../lib/script/scriptBrush.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { askConfirm } from '../lib/state/confirm'
	import { hasBackend } from '../lib/io/backend'

	// The floating Scripts window (#28, Tools › Scripts): Lua scripts kept as .lua files in the scripts
	// folder (internal/scripts), written here and run once on the active map (Engine.runScript) with
	// Noggit Red's script API (lib/script/prelude.ts). What a script prints shows below it (scriptLog, which a
	// brush's strokes print into too). Running a script that makes brushes (#29) loads it into the Script
	// Brush tool instead. It stays mounted while closed, so an unsaved script survives closing the window.

	const STARTER = `-- Raises a round hill where the camera looks, 30 yards across and 10 high.
-- Every edit a run makes is one undo step. Ctrl+Enter runs, Ctrl+S saves.
local center = target_pos()
local radius = 15
local sel = select_origin(center, radius)
for _, v in pairs(sel:verts()) do
	local d = dist_2d(v:get_pos(), center)
	if d < radius then
		local f = 1 - d / radius
		v:add_height(10 * f * f * (3 - 2 * f))
	end
end
sel:apply()
print("Raised a hill at", center)
`

	let files = $state<{ name: string; text: string }[]>([])
	/** The file the editor holds, or null for a script not saved yet. */
	let current = $state<string | null>(null)
	let name = $state('hill')
	let code = $state(STARTER)
	/** The text as last loaded or saved, to tell unsaved changes. */
	let saved = $state(STARTER)
	let running = $state(false)
	let folder = $state('')
	let outEl = $state<HTMLDivElement>()
	let area = $state<HTMLTextAreaElement>()

	const dirty = $derived(code !== saved)

	async function refresh() {
		if (!hasBackend()) return
		try {
			folder = await ScriptsFolder()
			files = (await ListScripts()) ?? []
		} catch (e) {
			setStatus(`The scripts folder could not be read: ${e}`, 8000)
		}
	}

	// Reads the folder each time the window opens, so files dropped in meanwhile show.
	$effect(() => {
		if (ui.scripts) void refresh()
	})

	const baseName = (file: string) => file.replace(/\.lua$/i, '')

	async function leave(): Promise<boolean> {
		return !dirty || (await askConfirm(`Drop the unsaved changes to ${name}?`, { title: 'Unsaved script', ok: 'Drop' }))
	}

	async function open(file: string) {
		if (file === current || !(await leave())) return
		const f = files.find((x) => x.name === file)
		if (!f) return
		current = f.name
		name = baseName(f.name)
		code = saved = f.text
		clearScriptLog()
	}

	async function newScript() {
		if (!(await leave())) return
		current = null
		name = 'untitled'
		code = saved = STARTER
		clearScriptLog()
		await tick()
		area?.focus()
	}

	async function save() {
		if (!hasBackend()) {
			setStatus('Saving scripts needs the desktop app.')
			return
		}
		try {
			const file = await SaveScript(name, code)
			// A rename saves under the new name and leaves the old file.
			current = file
			name = baseName(file)
			saved = code
			await refresh()
			setStatus(`Saved ${file} in the scripts folder.`, 3000)
		} catch (e) {
			setStatus(`The script could not be saved: ${e}`, 8000)
		}
	}

	async function remove() {
		if (!current || !(await askConfirm(`Delete ${current} from the scripts folder?`, { title: 'Delete script', ok: 'Delete' }))) return
		try {
			await DeleteScript(current)
			current = null
			saved = ''
			await refresh()
		} catch (e) {
			setStatus(`The script could not be deleted: ${e}`, 8000)
		}
	}

	// The newest line stays in view.
	$effect(() => {
		void scriptLog.lines.length
		void tick().then(() => outEl?.scrollTo({ top: outEl.scrollHeight }))
	})

	async function run() {
		const e = engineRef.current
		if (!e || running) return
		running = true
		clearScriptLog()
		let printed = 0
		try {
			// A saved script loads as a brush under its file, so the options bar can reload it and keep its settings.
			const r = await e.runScript(
				code,
				name || 'script',
				(s) => {
					printed++
					scriptSay(s, 'out')
				},
				current && !dirty ? current : '',
			)
			if (!r) return
			if (!r.ok) scriptSay(r.error ?? 'The script failed.', 'err')
			else if (r.brushes.length) {
				editor.tool = 'script'
				scriptSay(`Loaded ${r.brushes.join(', ')} into the Script Brush tool (Y): paint with ${r.brushes.length > 1 ? 'them' : 'it'} on the map.`, 'info')
			} else scriptSay(`Ran in ${r.ms.toFixed(0)} ms.`, 'info')
			setStatus(!r.ok ? `${name} failed: see the Scripts window.` : r.brushes.length ? `Loaded the brush script ${name}.` : `Ran ${name}${printed ? '' : ' (no output)'}.`, 4000)
		} finally {
			running = false
		}
	}

	function onKey(ev: KeyboardEvent) {
		const k = ev.key.toLowerCase()
		if ((ev.ctrlKey || ev.metaKey) && k === 'enter') {
			ev.preventDefault()
			void run()
		} else if ((ev.ctrlKey || ev.metaKey) && k === 's') {
			ev.preventDefault()
			void save()
		} else if (k === 'tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
			// A tab indents, as in a code editor, instead of leaving the field.
			ev.preventDefault()
			const t = ev.currentTarget as HTMLTextAreaElement
			t.setRangeText('\t', t.selectionStart, t.selectionEnd, 'end')
			code = t.value
		}
	}
</script>

{#if ui.scripts}
	<aside class="scripts" aria-label="Scripts">
		<header>
			<span>Scripts</span>
			<span class="folder">Lua 5.4 · Noggit Red’s script API</span>
			<button class="close" onclick={() => (ui.scripts = false)} title="Close" aria-label="Close the scripts">✕</button>
		</header>
		<div class="body">
			<nav>
				<button class="new" onclick={newScript} title="Start a new script">New script</button>
				<ul>
					{#each files as f (f.name)}
						<li><button class:current={f.name === current} onclick={() => open(f.name)} title={f.name}>{baseName(f.name)}</button></li>
					{/each}
				</ul>
				{#if hasBackend() && !files.length}
					<p class="empty">No scripts saved yet. Save one, or drop .lua files into the scripts folder.</p>
				{/if}
			</nav>
			<section>
				<div class="bar">
					<input class="name" bind:value={name} aria-label="Script name" spellcheck="false" />
					{#if dirty}<span class="dirty" title="Not saved">●</span>{/if}
					<button class="primary" onclick={run} disabled={running} title="Run the script on the open map (Ctrl+Enter)">{running ? 'Running…' : 'Run'}</button>
					<button onclick={save} disabled={!hasBackend()} title="Save it in the scripts folder (Ctrl+S)">Save</button>
					<button onclick={remove} disabled={!current} title="Delete it from the scripts folder">Delete</button>
				</div>
				<textarea bind:this={area} bind:value={code} onkeydown={onKey} spellcheck="false" aria-label="Script"></textarea>
				<div class="output" bind:this={outEl} aria-label="Script output">
					{#each scriptLog.lines as l, i (i)}<div class={l.kind}>{l.text}</div>{/each}
				</div>
				{#if folder}<p class="where" title={folder}>Kept in {folder}</p>{/if}
			</section>
		</div>
	</aside>
{/if}

<style>
	.scripts {
		position: fixed;
		top: 96px;
		left: 52px;
		width: min(760px, calc(100vw - 120px));
		height: min(560px, calc(100 * var(--vh) - 160px));
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: 40;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
	}
	.folder {
		margin-left: auto;
		font-weight: 400;
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.close:hover {
		color: var(--text);
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	nav {
		width: 170px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--border);
		min-height: 0;
	}
	.new {
		margin: 6px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 4px;
		overflow-y: auto;
		min-height: 0;
	}
	li button {
		display: block;
		width: 100%;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 3px 10px;
		text-align: left;
		font-size: 12px;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	li button:hover {
		background: var(--panel-2);
	}
	li button.current {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.empty,
	.where {
		margin: 0;
		padding: 4px 10px;
		font-size: 11px;
		color: var(--text-dim);
	}
	.where {
		padding: 2px 8px 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	section {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.dirty {
		color: var(--text-dim);
		font-size: 10px;
	}
	textarea {
		flex: 1;
		min-height: 0;
		margin: 0 8px;
		resize: none;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.45;
		tab-size: 4;
		white-space: pre;
		overflow: auto;
	}
	.output {
		flex: none;
		height: 110px;
		margin: 6px 8px 0;
		padding: 4px 6px;
		overflow: auto;
		background: var(--panel-2);
		border-radius: 4px;
		font-family: var(--mono);
		font-size: 11px;
	}
	.output div {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.output .err {
		color: var(--danger-text);
	}
	.output .info {
		color: var(--text-dim);
	}
</style>
