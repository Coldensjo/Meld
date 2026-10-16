<script lang="ts">
	import Modal from './Modal.svelte'
	import PlacementRulesForm from './PlacementRulesForm.svelte'
	import { prefs } from '../lib/state/editor.svelte'
	import { newRules, rulesEmpty, type PlacementRules } from '../lib/tools/doodadBrush'

	// The spawn brush's placement rules (#196): the doodad brush's textures, height, holes and slope
	// range, checked besides the options bar's Max slope and Keep out of water. A brush setting, not an
	// edit of the map, so it is no undo step.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	function make(): PlacementRules {
		if (!prefs.spawnBrush.rules) prefs.spawnBrush.rules = newRules()
		return prefs.spawnBrush.rules
	}
	function clear() {
		delete prefs.spawnBrush.rules
	}
</script>

<Modal title="Where the spawn brush places" width={460} {onclose}>
	<p class="dim">Besides the options bar's Max slope and Keep out of water. The textures are the map's palette.</p>
	<PlacementRulesForm value={prefs.spawnBrush.rules} {make} />
	<div class="buttons">
		<button onclick={clear} disabled={rulesEmpty(prefs.spawnBrush.rules)}>Place anywhere</button>
		<button class="primary" onclick={onclose}>Done</button>
	</div>
</Modal>

<style>
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0 0 8px;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
</style>
