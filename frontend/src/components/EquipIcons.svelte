<script lang="ts">
	import { equipmentDisplays } from '../lib/wow/refNames'
	import ItemIcon from './ItemIcon.svelte'

	// The icons of the weapons an equipment template holds (#707), beside its name in the creature
	// editor's Equipment picker. Nothing for a template with no weapons.
	let { id }: { id: number } = $props()

	let displays = $state<number[]>([])
	$effect(() => {
		const want = id
		displays = []
		void equipmentDisplays(want).then((d) => {
			if (want === id) displays = d
		})
	})
</script>

{#each displays as d, i (i)}{#if d > 0}<ItemIcon displayId={d} />{/if}{/each}
