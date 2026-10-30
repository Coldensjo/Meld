<script lang="ts">
	import { onMount, type Component } from 'svelte'
	import { editor as editorState, prefs, ui } from '../../lib/state/editor.svelte'
	import { forwardStatus } from '../../lib/state/status.svelte'
	import { applyLook, onToolArgs, onToolCloseAsked, onToolState, sendToolCommand } from '../../lib/toolwin/client'
	import { EDITOR_PREF_KEYS, EDITOR_PREF_WRITES, EDITOR_SLOTS, EDITOR_WINDOWS, queryArgs, slotTarget, type EditorKind, type EditorPrefs, type EditorView, type SlotTarget } from '../../lib/toolwin/editors'
	import { sendEditorCommand, setEditorPage } from '../../lib/toolwin/editorPage'
	import { mapActions, windowSpawnFields, windowWeaponPick } from '../../lib/toolwin/spawnFieldsHost.svelte'
	import { spawnKey } from '../../lib/world/spawnKey'
	import { SetToolWindowUnsaved } from '../../lib/wails/App'
	import { WindowClose } from '../../lib/wails/runtime'
	import ContextMenu from '../ContextMenu.svelte'
	import Modal from '../Modal.svelte'
	import WeaponPicker, { equipChange, SLOTS } from '../WeaponPicker.svelte'
	import SavingBar from '../SavingBar.svelte'

	// A database editor in its own OS window (#912, lib/toolwin/editors.ts): the editor itself, whole, on
	// this page's own `ui` slot, opened on the target in the window's query. Its Close (and Esc) clears the
	// slot, which closes the window; the title bar's ✕ with unsaved changes is stopped by Go
	// (SetToolWindowUnsaved) and shows the Discard bar instead. Opening the window again while it is open
	// opens that target here, asking about unsaved changes first. An editor of another kind opened from
	// in here goes to the main page, as do the status lines, the preferences it changes and the caches a
	// save makes stale (components/EditorWindows.svelte). Its right-click menus and the Saving bar are this
	// page's, and so is the gear picker of the creature editor's spawn fields (#915), whose pick goes to the
	// main page as a spawn edit.

	let { kind }: { kind: EditorKind } = $props()

	/** What the window page needs of an editor: the target to open now, and its close that asks first. */
	interface EditorExports {
		openTarget(t: SlotTarget): void
		askClose(): void
	}
	type EditorComponent = Component<{ onunsaved?: (unsaved: boolean) => void }, EditorExports>

	/** Each editor, imported only in its own window. */
	const EDITORS: Record<EditorKind, () => Promise<{ default: EditorComponent }>> = {
		item: () => import('../ItemEditor.svelte'),
		spell: () => import('../SpellEditor.svelte'),
		quest: () => import('../QuestEditor.svelte'),
		creature: () => import('../CreatureEditor.svelte'),
		object: () => import('../ObjectEditor.svelte'),
	}

	// svelte-ignore state_referenced_locally
	const slot = EDITOR_WINDOWS[kind]
	// svelte-ignore state_referenced_locally
	setEditorPage(kind)
	// svelte-ignore state_referenced_locally
	Object.assign(ui, { [slot]: slotTarget(kind, queryArgs(location.search)) })

	let editor = $state<EditorExports>()
	let unsaved = false
	let opened = false
	let closing = false

	function setUnsaved(u: boolean) {
		unsaved = u
		void SetToolWindowUnsaved(kind, u)
	}

	async function closeWindow() {
		if (closing) return
		closing = true
		try {
			await SetToolWindowUnsaved(kind, false)
		} finally {
			void WindowClose()
		}
	}

	// The editor closed (Close, Esc, Discard them): so does its window. The main page is told what it has open.
	$effect(() => {
		const t = ui[slot]
		sendEditorCommand({ type: 'target', target: t ? ($state.snapshot(t) as SlotTarget) : null })
		if (t) opened = true
		else if (opened) void closeWindow()
	})

	// The gear picker of the spawn fields: the spawn is the main page's selected one, which the fields show.
	const weaponSpawn = $derived(windowWeaponPick.pick && editorState.selectedSpawn && spawnKey(editorState.selectedSpawn) === windowWeaponPick.pick.key ? editorState.selectedSpawn : null)
	const closeWeapons = () => (windowWeaponPick.pick = null)
	async function pickWeapon(entry: number) {
		const p = windowWeaponPick.pick
		const s = weaponSpawn
		closeWeapons()
		if (!p || !s) return
		try {
			const { vals, label } = await equipChange(s, p.slot, entry)
			mapActions().edit(p.key, vals, label)
		} catch (err) {
			sendEditorCommand({ type: 'status', text: `Equipping failed: ${err}`, timeout: 8000 })
		}
	}

	// An editor of another kind opened from in here (a link) opens from the main page.
	$effect(() => {
		for (const s of EDITOR_SLOTS) {
			if (s === slot) continue
			const t = ui[s]
			if (!t) continue
			sendEditorCommand({ type: 'open', slot: s, target: $state.snapshot(t) as Record<string, unknown> })
			ui[s] = null
		}
	})

	/** The preferences as the main page last sent them, so only the window's own changes go back. */
	let fromMain: Partial<EditorPrefs> = {}
	$effect(() => {
		const changed: Partial<EditorPrefs> = {}
		let any = false
		for (const k of EDITOR_PREF_WRITES) {
			const v = prefs[k]
			if (v !== fromMain[k]) {
				Object.assign(changed, { [k]: v })
				any = true
			}
		}
		if (!any || !('itemSort' in fromMain)) return
		Object.assign(fromMain, changed)
		sendEditorCommand({ type: 'prefs', prefs: changed })
	})

	onMount(() => {
		forwardStatus((text, timeout) => sendEditorCommand({ type: 'status', text, timeout }))
		const offState = onToolState<EditorView>(kind, (msg) => {
			applyLook(msg.look)
			const p = msg.state.prefs
			fromMain = { ...p }
			for (const k of EDITOR_PREF_KEYS) if (k in p) Object.assign(prefs, { [k]: p[k] })
			// The map's selected spawn, which the quest editor offers as a giver.
			editorState.selectedSpawn = msg.state.spawn ?? null
			// What the creature editor's spawn fields read of the map, and the Quests tabs' version (#915).
			if (msg.state.spawnFields) windowSpawnFields.view = msg.state.spawnFields
			if (typeof msg.state.questsVersion === 'number') ui.questsVersion = msg.state.questsVersion
		})
		const offArgs = onToolArgs(kind, (args) => editor?.openTarget(slotTarget(kind, args)))
		const offAsked = onToolCloseAsked(kind, () => {
			editor?.askClose()
			// The answer: Go lets the next close through only if it is still unsaved and unanswered for long.
			void SetToolWindowUnsaved(kind, unsaved)
		})
		sendToolCommand(kind, { type: 'hello' })
		return () => {
			forwardStatus(null)
			offState()
			offArgs()
			offAsked()
		}
	})
</script>

{#await EDITORS[kind]() then m}
	{@const Editor = m.default}
	<Editor bind:this={editor} onunsaved={setUnsaved} />
{/await}
{#if windowWeaponPick.pick && weaponSpawn}
	<Modal title="{SLOTS[windowWeaponPick.pick.slot]} of {weaponSpawn.name}" width={980} onclose={closeWeapons}>
		<WeaponPicker which={windowWeaponPick.pick.slot} selected={weaponSpawn.equipItems?.[windowWeaponPick.pick.slot] ?? 0} onpick={pickWeapon} />
	</Modal>
{/if}
<SavingBar />
<ContextMenu />
