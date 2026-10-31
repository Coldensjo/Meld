<script lang="ts">
	import { RowList } from '../lib/ui/rowList.svelte'
	import { ReadCharacterSkills, SaveCharacterSkills } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { SKILL_CATEGORIES, fixSkill, newSkill, skillCategoryName } from '../lib/wow/characterSheet'

	// The character editor's Skills tab (#875): its character_skills rows by the skill frame's groups,
	// each with its value and most, and the skill lines its race and class may have to add. The
	// server fixes a language at 300 of 300, armour at 1 of 1 and a weapon or other levelled skill's
	// most at 5 a level when it loads the character, so those are set here as it will; a profession's
	// most is its rank's (75, 150, 225, 300). Saved with its own Save; Go checks the list again
	// (internal/vmangos/charsheet.go SaveCharacterSkills).

	let { guid, dirty = $bindable(false) }: { guid: number; dirty?: boolean } = $props()

	let choices = $state<vmangos.SkillChoice[]>([])
	let level = $state(1)
	const rows = new RowList<vmangos.CharacterSkill[]>({
		empty: [],
		read: async () => {
			const s = await ReadCharacterSkills(guid)
			choices = s.choices ?? []
			level = s.level
			return (s.skills ?? []).map((k) => ({ ...k }))
		},
		key: (list) => JSON.stringify(list.map((s) => [s.skill, s.value, s.max]).sort((a, b) => a[0] - b[0])),
	})
	rows.follow(() => guid)
	$effect(() => {
		dirty = rows.dirty
	})

	/** Drops the unsaved edits (the editor's Revert and Discard). */
	export function revert() {
		refused = ''
		void rows.revert()
	}

	/** The skill Go refused, outlined until the next save. */
	let refused = $state('')
	const byId = $derived(new Map(choices.map((c) => [c.id, c])))
	const had = $derived(new Set(rows.rows.map((s) => s.skill)))
	const groups = $derived(
		[...SKILL_CATEGORIES.map(([c]) => c), -1]
			.map((cat) => ({
				cat,
				skills: rows.rows
					.filter((s) => {
						const c = byId.get(s.skill)
						return cat === -1 ? !c || !SKILL_CATEGORIES.some(([k]) => k === c.category) : c?.category === cat
					})
					.sort((a, b) => (byId.get(a.skill)?.name ?? '').localeCompare(byId.get(b.skill)?.name ?? '')),
			}))
			.filter((g) => g.skills.length),
	)
	/** The skill lines to add, by group, but for the client's leftovers ("GENERIC (DND)"). */
	const addable = $derived(SKILL_CATEGORIES.map(([cat, name]) => ({ name, list: choices.filter((c) => c.category === cat && !had.has(c.id) && !c.name.includes('DND')) })).filter((g) => g.list.length))

	function change(skill: number, field: 'value' | 'max', v: number) {
		rows.rows = rows.rows.map((s) => (s.skill === skill ? fixSkill({ ...s, [field]: Math.floor(Number.isFinite(v) ? v : 1) }, byId.get(skill), level) : s))
	}

	let pick = $state('')
	function add() {
		const c = byId.get(Number(pick))
		if (!c) return
		rows.rows = [...rows.rows, newSkill(c, level)]
		pick = ''
	}

	function save() {
		refused = ''
		void rows.save('Saving the skills', async (skills) => {
			const r = await SaveCharacterSkills(guid, skills)
			if (r.refused) {
				refused = r.refused.column
				throw new Error(r.refused.message)
			}
			await rows.load()
			setStatus(`Saved ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}. The character has them at its next login.`, 10000)
		})
	}
</script>

<div class="sheet">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Skills{rows.rows.length ? ` (${rows.rows.length})` : ''}</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save skills' : 'Saved'}</button>
	</div>
	<p class="dim">
		The server sets a language to 300 of 300, armor to 1 of 1 and a weapon skill's most to 5 a level (here {level * 5}) when the character logs in. A skill the race and class can't have is skipped. Spells that teach a skill bring it
		back at the next login if it is taken out.
	</p>
	{#if rows.loading && !rows.rows.length}
		<p class="dim">Reading the skills…</p>
	{:else}
		<div class="groups">
			<div class="flow">
				{#each groups as g (g.cat)}
					<section class="group">
						<h4>{g.cat === -1 ? 'Not for this race and class' : skillCategoryName(g.cat)}</h4>
						<ul class="list" aria-label={g.cat === -1 ? 'Other skills' : skillCategoryName(g.cat)}>
							{#each g.skills as s (s.skill)}
								{@const c = byId.get(s.skill)}
								<li class:refused={refused === String(s.skill)} data-skill={s.skill}>
									<span class="name" title="Skill line {s.skill}">{c?.name ?? `Skill ${s.skill}`}</span>
									{#if c && (c.range === 'language' || c.range === 'mono')}
										<span class="dim">{s.value} of {s.max}</span>
									{:else}
										<input type="number" min="1" max={s.max} value={s.value} aria-label="Value" onchange={(e) => change(s.skill, 'value', Number(e.currentTarget.value))} />
										<span class="dim">of</span>
										{#if c?.range === 'rank'}
											<select value={s.max} aria-label="Most" onchange={(e) => change(s.skill, 'max', Number(e.currentTarget.value))}>
												{#each [75, 150, 225, 300].filter((m) => m <= (c.top || 300)) as m (m)}<option value={m}>{m}</option>{/each}
												{#if ![75, 150, 225, 300].includes(s.max)}<option value={s.max}>{s.max}</option>{/if}
											</select>
										{:else}
											<span class="dim">{s.max}</span>
										{/if}
									{/if}
									<button class="x" title="Take this skill out" onclick={() => (rows.rows = rows.rows.filter((k) => k.skill !== s.skill))}>×</button>
								</li>
							{/each}
						</ul>
					</section>
				{:else}
					<p class="dim">No skills.</p>
				{/each}
			</div>
		</div>
		<div class="row">
			<select bind:value={pick} aria-label="Skill to add">
				<option value="">Add a skill…</option>
				{#each addable as g (g.name)}
					<optgroup label={g.name}>
						{#each g.list as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
					</optgroup>
				{/each}
			</select>
			<button disabled={!pick} onclick={add}>Add</button>
		</div>
	{/if}
</div>

<style>
	/* The sheet fills the character page's height; its long lists scroll in place (#931). */
	.sheet {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	.groups {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.flow {
		columns: 300px;
		column-gap: 24px;
	}
	.group {
		break-inside: avoid;
	}
	h3 {
		margin: 0;
		flex: 1;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	h4 {
		margin: 6px 0 0;
		font-size: 12px;
		font-weight: 600;
	}
	.head,
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border-radius: 3px;
	}
	.list li:hover {
		background: var(--panel-2);
	}
	.name {
		flex: 1;
	}
	input[type='number'] {
		width: 64px;
	}
	.x {
		padding: 0 6px;
	}
	.refused {
		outline: 1px solid var(--danger-text);
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
</style>
