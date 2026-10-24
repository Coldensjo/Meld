<script lang="ts">
	// A model's picture in the palette's Props tab (3dgame #133): drawn once by propModels.ts
	// modelPicture (on a small renderer of its own) and kept, so scrolling the palette costs nothing.
	import { modelPicture } from '../lib/cubes/propModels'

	interface Props {
		model: string
		size: number
	}
	let { model, size }: Props = $props()
	let url = $state('')
	let failed = $state(false)

	$effect(() => {
		const name = model
		let live = true
		url = ''
		failed = false
		void modelPicture(name).then((u) => {
			if (!live) return
			url = u
			failed = !u
		})
		return () => {
			live = false
		}
	})
</script>

{#if url}
	<img src={url} alt={model} width={size} height={size} draggable="false" />
{:else}
	<span class="wait" style:width="{size}px" style:height="{size}px">{failed ? '?' : '…'}</span>
{/if}

<style>
	img {
		display: block;
		object-fit: contain;
	}
	.wait {
		display: grid;
		place-items: center;
		color: var(--text-dim);
		font-size: 18px;
	}
</style>
