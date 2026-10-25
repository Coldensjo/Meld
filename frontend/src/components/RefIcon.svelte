<script lang="ts">
	import { refName } from '../lib/wow/refNames'
	import ItemIcon from './ItemIcon.svelte'
	import SpellIcon from './SpellIcon.svelte'

	// The icon of an item or a spell known only by its number (#682): its name is looked up once
	// (refNames, cached for the session), then ItemIcon or SpellIcon draws it. An empty square while it
	// loads and for a number that names nothing.
	let { kind, id, size = 18 }: { kind: 'item' | 'spell'; id: number; size?: number } = $props()

	let displayId = $state(0)
	let icon = $state('')
	$effect(() => {
		const k = kind
		const n = id
		displayId = 0
		icon = ''
		if (n > 0)
			void refName(k, n).then((r) => {
				if (k !== kind || n !== id || !r) return
				displayId = r.displayId ?? 0
				icon = r.icon ?? ''
			})
	})
</script>

{#if kind === 'item'}<ItemIcon {displayId} {size} />{:else}<SpellIcon {icon} {size} />{/if}
