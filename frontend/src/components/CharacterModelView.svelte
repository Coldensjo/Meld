<script lang="ts">
	import { CharacterModelLook } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import CreaturePreview from './CreaturePreview.svelte'

	// The Characters tool's picture of a character (#880): its own model in its look (race, gender,
	// skin, face, hair) wearing what its equipment slots hold, drawn as the Items editor draws an item
	// on its stand-in (vmangos.CharacterModelLook in internal/vmangos/charmodel.go). Both follow the
	// unsaved values, so a change of look or gear shows before Save.

	let { look, items }: { look: vmangos.CharacterAppearance; items: vmangos.WornItem[] } = $props()

	let model = $state<vmangos.CharacterModel | null>(null)
	let error = $state('')
	const key = $derived(JSON.stringify([look, items]))
	$effect(() => {
		const k = key
		const [l, w] = JSON.parse(k) as [vmangos.CharacterAppearance, vmangos.WornItem[]]
		CharacterModelLook(l, w)
			.then((m) => {
				if (k !== key) return
				model = m
				error = ''
			})
			.catch((err) => k === key && (error = String(err)))
	})
</script>

<div class="model" aria-label="The character">
	{#if model?.model}
		<CreaturePreview model={model.model} look={model.look} scale={model.scale || 1} />
	{:else}
		<div class="empty dim">{error || (model ? 'The client has no model of this race and gender.' : 'Loading…')}</div>
	{/if}
</div>

<style>
	.model {
		width: 100%;
		height: 100%;
		min-height: 200px;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: 4px;
		overflow: hidden;
	}
	.empty {
		margin: auto;
		padding: 8px;
		text-align: center;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
