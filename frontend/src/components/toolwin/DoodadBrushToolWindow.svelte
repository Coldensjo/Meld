<script lang="ts">
	import { onMount } from 'svelte'
	import { prefs, wow } from '../../lib/state/editor.svelte'
	import type { BrushStore } from '../../lib/tools/doodadBrush'
	import { throttle } from '../../lib/toolwin/channel'
	import { applyLook, onToolReply, onToolState, sendToolCommand } from '../../lib/toolwin/client'
	import { BRUSHES_KIND, BrushSync, readThumbReply, type BrushesCommand, type BrushesView } from '../../lib/toolwin/doodadBrushes'
	import { WindowClose } from '../../lib/wails/runtime'
	import { renderThumbsElsewhere } from '../../lib/wow/thumbs'
	import DoodadBrushEditor from '../DoodadBrushEditor.svelte'

	// The doodad brush editor in its own OS window (#911): the same editor as in the page, on a copy of the
	// brushes the main page publishes (DoodadBrushWindow.svelte). Each edit sends the whole copy back as a
	// `set` (at most every 50 ms), which the main page takes into its prefs, so its Doodad Brush tool paints
	// with it at once and it is saved there. This page has no Engine: a thumbnail missing from the disk cache
	// is rendered by the main page (a `thumb` command) and then read from the cache. Files go through the main
	// page's dialogs, and the status line is the main window's.

	const store = $state<BrushStore>({ doodadBrushes: [], doodadBrush: '' })
	const sync = new BrushSync()
	/** The first view came: before it, the empty copy must not be sent over the user's brushes. */
	let ready = $state(false)
	let wowLoaded = $state(false)
	let wowRevision = $state(0)

	const send = (cmd: BrushesCommand) => sendToolCommand(BRUSHES_KIND, cmd)

	let unsent = false
	const sendNow = () => {
		sendSet.cancel()
		if (!unsent) return
		unsent = false
		send({ type: 'set', seq: sync.sent, brushes: $state.snapshot(store.doodadBrushes), active: store.doodadBrush })
	}
	const sendSet = throttle(sendNow, 50)

	$effect(() => {
		if (!ready) return
		if (sync.edit(store) === null) return
		unsent = true
		sendSet()
	})

	/** Thumbnails asked of the main page, by key: each waiter gets whether it is in the cache now. */
	const waiting = new Map<string, ((ok: boolean) => void)[]>()
	renderThumbsElsewhere(
		(key) =>
			new Promise((resolve) => {
				const list = waiting.get(key)
				if (list) list.push(resolve)
				else {
					waiting.set(key, [resolve])
					send({ type: 'thumb', key })
				}
				// A main page that reloaded meanwhile never answers: the tile shows it failed rather than wait for good.
				setTimeout(() => resolve(false), 60_000)
			}),
	)

	onMount(() => {
		const offState = onToolState<BrushesView>(BRUSHES_KIND, (msg) => {
			applyLook(msg.look)
			const v = msg.state
			wowLoaded = wow.loaded = v.wowLoaded
			wowRevision = wow.revision = v.wowRevision
			prefs.browserNames = v.browserNames
			prefs.fpsLimit = v.fpsLimit
			if (!sync.take(v)) return
			store.doodadBrushes = v.brushes
			store.doodadBrush = v.active
			ready = true
		})
		const offReply = onToolReply(BRUSHES_KIND, (r) => {
			const t = readThumbReply(r)
			if (!t) return
			for (const resolve of waiting.get(t.key) ?? []) resolve(t.ok)
			waiting.delete(t.key)
		})
		// The title bar's ✕ closes the page too: an edit still waiting on the throttle goes first.
		const onHide = () => sendNow()
		window.addEventListener('pagehide', onHide)
		sendToolCommand(BRUSHES_KIND, { type: 'hello' })
		return () => {
			offState()
			offReply()
			window.removeEventListener('pagehide', onHide)
			sendSet.cancel()
		}
	})

	function close() {
		sendNow()
		void WindowClose()
	}
</script>

<DoodadBrushEditor
	{store}
	{wowLoaded}
	{wowRevision}
	files={true}
	onclose={close}
	onpaint={() => {
		sendNow()
		send({ type: 'paint' })
	}}
	onimport={() => send({ type: 'import' })}
	onexport={() => {
		sendNow()
		send({ type: 'export' })
	}}
	onstatus={(text) => send({ type: 'status', text })}
/>
