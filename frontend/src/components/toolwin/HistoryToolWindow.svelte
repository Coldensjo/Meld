<script lang="ts">
	import { onMount } from 'svelte'
	import { applyLook, onToolState, sendToolCommand } from '../../lib/toolwin/client'
	import { HISTORY_KIND, historyView, type HistoryCommand, type HistoryView } from '../../lib/toolwin/history'
	import { WindowClose } from '../../lib/wails/runtime'
	import HistoryList from '../HistoryList.svelte'

	// History in its own OS window (#909): the view the main page publishes (HistoryWindow.svelte), and a
	// click sends the step to go to back to it, which runs it through Engine.goToHistory.

	let view = $state<HistoryView>(historyView(null))

	onMount(() => {
		const off = onToolState<HistoryView>(HISTORY_KIND, (msg) => {
			view = msg.state
			applyLook(msg.look)
		})
		sendToolCommand(HISTORY_KIND, { type: 'hello' })
		return off
	})

	function go(to: number) {
		if (to === view.position) return
		const cmd: HistoryCommand = { type: 'go', to }
		sendToolCommand(HISTORY_KIND, cmd)
	}
</script>

<main class="history" aria-label="History">
	<HistoryList {view} ongo={go} onclose={() => void WindowClose()} />
</main>

<style>
	.history {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		overflow: hidden;
	}
</style>
