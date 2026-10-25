<script lang="ts">
	import Modal from './Modal.svelte'
	import { prefs } from '../lib/state/editor.svelte'
	import {
		SHORTCUTS,
		assignBinding,
		bindingFromEvent,
		bindingLabel,
		bindingsOf,
		fixedClash,
		isBindable,
		isModifierKey,
		isRebound,
		keysOf,
		refusal,
		removeBinding,
		resetBindings,
		type ShortcutGroup,
		type ShortcutId,
	} from '../lib/ui/commands'

	// Preferences › Hotkey Manager (#396): every row of the shortcut table with its keys. A command's or
	// a camera movement's key is changed with a click and a press, cleared with its ×, or reset; a key
	// taken from another row leaves it there. The bindings are the `keymap` pref (only the changed
	// rows), which the key handler, the camera, the menus and the Shortcuts dialog all read.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const GROUP_NAMES: Record<ShortcutGroup, string> = { File: 'File and editing', Camera: 'Camera', Tools: 'Tools and models' }

	const km = $derived(prefs.keymap)
	let filter = $state('')
	/** The row (and which of its keys, or a new one) waiting for a key press. */
	let cap = $state<{ id: string; index?: number } | null>(null)
	let note = $state('')

	const sections = $derived.by(() => {
		void km
		const q = filter.trim().toLowerCase()
		const out = new Map<ShortcutGroup, typeof SHORTCUTS>()
		for (const s of SHORTCUTS) {
			if (
				q &&
				!s.desc.toLowerCase().includes(q) &&
				!keysOf(s.id as ShortcutId)
					.toLowerCase()
					.includes(q)
			)
				continue
			out.set(s.group, [...(out.get(s.group) ?? []), s])
		}
		return [...out]
	})

	const descOf = (id: string) => SHORTCUTS.find((s) => s.id === id)?.desc ?? id

	function start(id: string, index?: number) {
		cap = { id, index }
		note = 'Press the new key (Esc cancels).'
	}

	function take(e: KeyboardEvent) {
		if (!cap) return
		const r = bindingFromEvent(cap.id, e)
		if ('error' in r) {
			note = r.error
			return
		}
		const why = refusal(cap.id, r.binding)
		if (why) {
			note = why
			return
		}
		const { keymap, moved } = assignBinding(prefs.keymap, cap.id, r.binding, cap.index)
		prefs.keymap = keymap
		const label = bindingLabel(cap.id, r.binding)
		const fixed = fixedClash(cap.id, r.binding)
		note = [moved.length ? `${label} moved here from: ${moved.map(descOf).join('; ')}.` : `${label} set.`, fixed ? `“${fixed.desc}” reads ${label} first when it applies.` : ''].join(' ').trim()
		cap = null
	}

	/** The button waiting for a key: focused, and its key presses stop here, so neither the map, the camera nor the dialog's Esc sees them. */
	function capture(node: HTMLElement) {
		node.focus()
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault()
			e.stopPropagation()
			if (isModifierKey(e)) return
			if (e.key === 'Escape') {
				cap = null
				note = ''
				return
			}
			take(e)
		}
		const onBlur = () => (cap = null)
		node.addEventListener('keydown', onKey)
		node.addEventListener('blur', onBlur)
		return {
			destroy() {
				node.removeEventListener('keydown', onKey)
				node.removeEventListener('blur', onBlur)
			},
		}
	}

	function clear(id: string, index: number) {
		prefs.keymap = removeBinding(prefs.keymap, id, index)
		note = ''
	}

	function reset(id: string) {
		prefs.keymap = resetBindings(prefs.keymap, id)
		note = ''
	}
</script>

<Modal title="Hotkey Manager" width={680} {onclose}>
	<p class="dim">
		Click a key to change it, + to add one, × to clear it. A key given to one command leaves any other that had it. The keys the selection and the tools read themselves (Del, H, R, the arrows, Esc, PgUp/PgDn) and the mouse stay fixed.
		The changes are saved at once.
	</p>
	<input class="filter" type="search" placeholder="Filter by name or key" bind:value={filter} aria-label="Filter the shortcuts" />
	{#each sections as [group, rows] (group)}
		<h3>{GROUP_NAMES[group]}</h3>
		<table>
			<tbody>
				{#each rows as s (s.id)}
					<tr class:fixed={!isBindable(s.id)} data-row={s.id}>
						<td class="desc">{s.desc}</td>
						<td class="keys">
							{#if isBindable(s.id)}
								{#each bindingsOf(s.id, km) as b, i (b)}
									{#if cap?.id === s.id && cap.index === i}
										<button class="chip capture" use:capture>Press a key…</button>
									{:else}
										<span class="chip">
											<button class="key" title="Change this key" onclick={() => start(s.id, i)}>{bindingLabel(s.id, b)}</button>
											<button class="x" title="Clear this key" aria-label="Clear {bindingLabel(s.id, b)}" onclick={() => clear(s.id, i)}>×</button>
										</span>
									{/if}
								{/each}
								{#if cap?.id === s.id && cap.index === undefined}
									<button class="chip capture" use:capture>Press a key…</button>
								{:else}
									<button class="add" title="Add a key" aria-label="Add a key to {s.desc}" onclick={() => start(s.id)}>+</button>
								{/if}
								{#if isRebound(s.id, km)}
									<button
										class="reset"
										title="Back to the default keys ({bindingsOf(s.id)
											.map((b) => bindingLabel(s.id, b))
											.join(' / ') || 'none'})"
										onclick={() => reset(s.id)}>Reset</button
									>
								{/if}
							{:else}
								<kbd>{s.keys}</kbd> <span class="dim">fixed</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="dim">No shortcut matches.</p>
	{/each}
	{#snippet actions()}
		<span class="note" role="status">{note}</span>
		<button
			disabled={!Object.keys(km).length}
			onclick={() => {
				prefs.keymap = {}
				note = 'Every key is back on its default.'
			}}>Reset all</button
		>
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.filter {
		width: 100%;
		margin: 4px 0 8px;
	}
	h3 {
		margin: 12px 0 4px;
		font-size: 13px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	td {
		padding: 3px 4px;
		border-bottom: 1px solid var(--border-soft);
		vertical-align: middle;
	}
	.desc {
		width: 55%;
	}
	tr.fixed .desc {
		color: var(--text-dim);
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}
	.chip {
		display: inline-flex;
		align-items: stretch;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.chip button {
		border: none;
		background: transparent;
		padding: 1px 6px;
		font-family: var(--mono);
		font-size: 12px;
	}
	.chip .x {
		padding: 1px 4px;
		color: var(--text-dim);
	}
	.chip .x:hover {
		color: var(--danger-text);
	}
	button.capture {
		padding: 1px 8px;
		font-size: 12px;
		border: 1px solid var(--accent-2);
		color: var(--accent-text);
	}
	.add,
	.reset {
		padding: 1px 6px;
		font-size: 12px;
	}
	.dim {
		color: var(--text-dim);
	}
	.note {
		flex: 1;
		color: var(--text-dim);
		font-size: 12px;
		text-align: left;
	}
</style>
