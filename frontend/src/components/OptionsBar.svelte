<script lang="ts">
	import OptSlider from './OptSlider.svelte'
	import { TOOLS } from './Toolbar.svelte'
	import { editor, ui, type CubeMode } from '../lib/state/editor.svelte'
	import { FIRE_COLOURS, KINDS as CUBE_KINDS, OBJECT_KINDS, SHAPES as CUBE_SHAPES, TEXTURES as CUBE_TEXTURES } from '../lib/cubes/world'
	import { textureUrl } from '../lib/cubes/textures'
	import { MONSTER_KINDS } from '../lib/cubes/monsterKinds'
	import { NPC_LOOKS } from '../lib/cubes/npcNames'
	import { MODEL_NAMES, modelFolder } from '../lib/cubes/propModels'
	import { degrees, wrapTurn } from '../lib/cubes/props'
	import { MOODS, moodNames } from '../lib/engine/moods'
	import { engineRef } from '../lib/state/engineRef'

	/** The name of a texture of the open world's own (#227): its hint's, a Tibia item's. */
	const worldTextureName = (id: number) => engineRef.current?.activeDocument().world.textureName(id) ?? `texture ${id}`
	/** The swatch of the texture painted: the game's image, or the open world's picture for one of its own. */
	function paintSwatch(id: number): string {
		if (id < CUBE_TEXTURES.length) return textureUrl(id)
		const png = engineRef.current?.activeDocument().world.images.get(id)
		return png ? `data:image/png;base64,${png}` : ''
	}

	const CUBE_MODES: Array<{ id: CubeMode; name: string; tip: string }> = [
		{ id: 'place', name: 'Place', tip: 'Put the cube against the face clicked (Ctrl+click removes the cube)' },
		{ id: 'remove', name: 'Remove', tip: 'Remove the cubes clicked or dragged over, on the layer the drag began on' },
		{ id: 'replace', name: 'Replace', tip: 'Make the cubes clicked or dragged over the picked cube, on the layer the drag began on' },
		{ id: 'box', name: 'Box', tip: 'Drag from corner to corner to fill a box with the cube (Ctrl+drag empties a box)' },
		{ id: 'object', name: 'Object', tip: 'Attach the picked object to the face clicked (Ctrl+click removes the object there, Shift+click selects it)' },
		{ id: 'link', name: 'Link', tip: 'Click an object to select it, then the objects it acts on: a lever or button its door, a teleporter the pad it leads to' },
		{ id: 'paint', name: 'Paint', tip: 'Paint the faces clicked or dragged over with the texture (Shift: the whole cube, Ctrl: clear the paint, Alt+click picks a texture)' },
		{ id: 'monster', name: 'Monster', tip: 'Put a spawn point of the monster in the cell beside the face clicked (drag one to move it, Ctrl+click removes one, Shift+click adds another to the same cube, Alt+click picks its kind)' },
		{ id: 'npc', name: 'NPC', tip: 'Put the NPC in the cell beside the face clicked, then Shift+click cubes to give the selected NPC a route (drag an NPC or a route cube to move it, Ctrl+click removes one, Alt+click picks its name, Del removes the selected NPC)' },
		{ id: 'prop', name: 'Prop', tip: 'Put the model where the cursor meets the cubes (pick it in the palette\'s Props tab); drag a prop to move it, R turns it, Ctrl+click removes one, Alt+click picks its model, Del removes the selected prop' },
		{ id: 'mood', name: 'Mood', tip: 'Drag a box to give the place the mood: the game wears it there instead of its layer\'s (Shift+click selects a region, Ctrl+click removes one, Alt+click picks its mood, Del removes the selected one)' },
	]
	/** The moods a region may name: every mood of crates/gameplay/moods.toml, surface moods first. */
	const MOOD_NAMES = moodNames(MOODS)
	/** The moods made for regions: neither a surface mood nor a layer theme's. */
	const PLACE_MOODS = MOOD_NAMES.filter((n) => !MOODS.surfaceNames.includes(n) && !Object.values(MOODS.themes).includes(n))
	/** The moods named by a layer theme, which a region under the ground may want. */
	const THEME_MOODS = MOOD_NAMES.filter((n) => !MOODS.surfaceNames.includes(n) && !PLACE_MOODS.includes(n))
	/** The models by folder, for the Prop mode's list. */
	const MODEL_FOLDERS = [...new Set(MODEL_NAMES.map(modelFolder))]
	const SNAPS: Array<[number, string]> = [
		[0, 'Free'],
		[0.25, '0.25 m'],
		[0.5, '0.5 m'],
		[1.5, 'Half cube'],
		[3, 'Cube'],
	]
	function setPropTurn(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value)
		if (Number.isFinite(v)) editor.propTurn = wrapTurn((v * Math.PI) / 180)
	}

	const tool = $derived(TOOLS.find((t) => t.id === editor.tool)!)

	// The bar is one row: what doesn't fit wraps onto rows below it, which the bar clips, and the More
	// button opens the bar over the viewport to show them (#254). `hidden` counts the wrapped controls.
	let root = $state<HTMLDivElement>()
	let bar = $state<HTMLDivElement>()
	let hidden = $state(0)
	let open = $state(false)
	/** Whether a control sits below the bar's first row. */
	const wrapped = (el: Element) => {
		const r = el.getBoundingClientRect()
		return r.width > 0 && r.top - bar!.getBoundingClientRect().top > 20
	}
	/** Counts the wrapped controls; the observers call it once for each batch of changes. */
	function measure() {
		if (bar) hidden = [...bar.children].filter(wrapped).length
	}
	$effect(() => {
		if (!bar) return
		const resize = new ResizeObserver(measure)
		resize.observe(bar)
		// Controls come and go with the tool, its mode and its switches; a label's text can widen one.
		const changes = new MutationObserver(measure)
		changes.observe(bar, { childList: true, subtree: true, characterData: true })
		measure()
		return () => {
			resize.disconnect()
			changes.disconnect()
		}
	})
	// A new tool starts with the bar closed.
	$effect(() => {
		void editor.tool
		open = false
	})
	$effect(() => {
		if (!open) return
		const away = (e: PointerEvent) => {
			if (!root?.contains(e.target as Node)) open = false
		}
		window.addEventListener('pointerdown', away, true)
		return () => window.removeEventListener('pointerdown', away, true)
	})
	/** Tab onto a control the bar clips opens it, so every control stays reachable from the keyboard. */
	function onFocusIn(e: FocusEvent) {
		// Focus scrolls the clipped bar to bring the control into view; the bar shows its first row.
		bar!.scrollTop = 0
		if (!open && e.target instanceof Element && wrapped(e.target)) open = true
	}
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			open = false
			e.stopPropagation()
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="optbar" bind:this={root} onkeydown={onKeyDown}>
<div class="options" class:open class:withMore={hidden > 0 || open} bind:this={bar} onfocusin={onFocusIn}>
	<div class="tool" title="{tool.name}: {tool.desc}">
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
			<path d={tool.icon} />
		</svg>
	</div>
	<div class="divider"></div>

	{#if editor.tool === 'cube'}
		<div class="seg">
			{#each CUBE_MODES as m (m.id)}
				<button class:active={editor.cubeMode === m.id} onclick={() => (editor.cubeMode = m.id)} title={m.tip}>{m.name}</button>
			{/each}
		</div>
		{#if editor.cubeMode === 'object'}
			<select bind:value={editor.cubeObject} title="The object to attach: a door or window shuts an opening, a lever or button opens what it is linked to, a teleporter (on the top of a cube) leads to the pad it is linked to, a torch burns and lights what is around it" aria-label="Object kind">
				{#each OBJECT_KINDS as k, i (k)}
					<option value={i}>{k}</option>
				{/each}
			</select>
			{#if OBJECT_KINDS[editor.cubeObject] === 'torch'}
				<select bind:value={editor.cubeFire} title="The colour the torch's fire burns, its flame and its light (and the selected torch's): orange, green witch-fire, blue spirit-fire or purple" aria-label="Fire colour">
					{#each FIRE_COLOURS as c, i (c)}
						<option value={i}>{c} fire</option>
					{/each}
				</select>
			{/if}
		{:else if editor.cubeMode === 'paint'}
			<img class="cube-texture" src={paintSwatch(editor.cubeTexture)} alt="" />
			<select bind:value={editor.cubeTexture} title="The texture to paint faces with (Alt+click a face picks the one it shows)" aria-label="Texture">
				{#each CUBE_TEXTURES as t, i (t)}
					{#if i > 0}<option value={i}>{t}</option>{/if}
				{/each}
				<!-- A texture of the world's own picked in Textures in This World or by the pipette (a Tibia texture, 3dgame #227). -->
				{#if editor.cubeTexture >= CUBE_TEXTURES.length}<option value={editor.cubeTexture}>{worldTextureName(editor.cubeTexture)}</option>{/if}
			</select>
			<label class="check" title="Instead of painting, choose which edges of a face fade into the texture of the face beside them (#84): a click switches the edge nearest it, Shift blends all four, Ctrl none"><input type="checkbox" bind:checked={editor.cubeBlend} /> Blend edges</label>
		{:else if editor.cubeMode === 'monster'}
			<select bind:value={editor.cubeMonster} title="The kind of monster to spawn: the game's kinds (crates/gameplay/monsters.toml)" aria-label="Monster kind">
				{#each MONSTER_KINDS as k (k.name)}
					<option value={k.name}>{k.name}</option>
				{/each}
				{#if !MONSTER_KINDS.some((k) => k.name === editor.cubeMonster)}<option value={editor.cubeMonster}>{editor.cubeMonster} (not in the game)</option>{/if}
			</select>
		{:else if editor.cubeMode === 'npc'}
			<select bind:value={editor.cubeNpc} title="The NPC to place: the game's NPCs (crates/gameplay/npcs.toml), whose looks and lines are there" aria-label="NPC">
				{#each NPC_LOOKS as n (n.name)}
					<option value={n.name}>{n.name}</option>
				{/each}
				{#if !NPC_LOOKS.some((n) => n.name === editor.cubeNpc)}<option value={editor.cubeNpc}>{editor.cubeNpc} (not in the game)</option>{/if}
			</select>
		{:else if editor.cubeMode === 'prop'}
			<select bind:value={editor.cubeProp} title="The model to place: the game's models (assets/models), drawn as the game draws them (crates/gameplay/models.toml); the palette's Props tab shows them" aria-label="Model">
				{#each MODEL_FOLDERS as f (f)}
					<optgroup label={f || 'models'}>
						{#each MODEL_NAMES.filter((n) => modelFolder(n) === f) as n (n)}
							<option value={n}>{n.slice(f ? f.length + 1 : 0)}</option>
						{/each}
					</optgroup>
				{/each}
				{#if !MODEL_NAMES.includes(editor.cubeProp)}<option value={editor.cubeProp}>{editor.cubeProp} (not in the game)</option>{/if}
			</select>
			<label class="check" title="The turn about the vertical, degrees counter-clockwise seen from above: of the selected prop, and the next one placed (R turns 15°, Shift+R back)">Turn <input class="num" type="number" step="15" value={degrees(editor.propTurn)} onchange={setPropTurn} aria-label="Turn in degrees" />°</label>
			<OptSlider label="Scale" bind:value={editor.propScale} min={0.1} max={4} step={0.05} digits={2} width={70} title="The size against the model's own: of the selected prop, and the next one placed" />
			<select bind:value={editor.propSnap} title="The grid a prop's place is put on across, as it is placed or dragged" aria-label="Snap">
				{#each SNAPS as [v, name] (v)}
					<option value={v}>{name}</option>
				{/each}
			</select>
		{:else if editor.cubeMode === 'mood'}
			<select bind:value={editor.cubeMood} title="The mood to give a region (and the selected region): the game's moods (crates/gameplay/moods.toml). A place mood takes its sky from the hour; a surface mood shows whole, whatever the hour" aria-label="Mood">
				<optgroup label="Places">
					{#each PLACE_MOODS as n (n)}<option value={n}>{n}</option>{/each}
				</optgroup>
				<optgroup label="Surface">
					{#each MOODS.surfaceNames as n (n)}<option value={n}>{n}</option>{/each}
				</optgroup>
				<optgroup label="Under the ground">
					{#each THEME_MOODS as n (n)}<option value={n}>{n}</option>{/each}
				</optgroup>
				{#if !MOOD_NAMES.includes(editor.cubeMood)}<option value={editor.cubeMood}>{editor.cubeMood} (not in the game)</option>{/if}
			</select>
		{:else if editor.cubeMode !== 'link'}
			<select bind:value={editor.cubeKind} title="The cube's material or liquid" aria-label="Cube kind">
				{#each CUBE_KINDS as k, i (k)}
					{#if i > 0}<option value={i}>{k}</option>{/if}
				{/each}
			</select>
			<select bind:value={editor.cubeShape} title="The cube's shape" aria-label="Cube shape">
				{#each CUBE_SHAPES as sh, i (sh.name)}
					<option value={i}>{sh.name}</option>
				{/each}
			</select>
			{#if CUBE_SHAPES[editor.cubeShape]?.turns}
				<button onclick={() => (editor.cubeRotation = (editor.cubeRotation & 4) | ((editor.cubeRotation + 1) & 3))} title="Turn the cube a quarter clockwise, seen from above (R)">Turn {(editor.cubeRotation & 3) * 90}° <kbd>R</kbd></button>
			{/if}
			{#if CUBE_SHAPES[editor.cubeShape]?.flips}
				<label class="check" title="Turn the cube upside down (Shift+R)"><input type="checkbox" checked={(editor.cubeRotation & 4) !== 0} onchange={(e) => (editor.cubeRotation = (editor.cubeRotation & 3) | (e.currentTarget.checked ? 4 : 0))} /> Upside down</label>
			{/if}
		{/if}
		{#if editor.cubeMode === 'box'}
			<OptSlider label="Higher" bind:value={editor.cubeBoxExtra} min={0} max={9} step={1} digits={0} width={60} title="Layers the box reaches above its higher corner, for walls" />
		{:else if editor.cubeMode === 'mood'}
			<OptSlider label="Higher" bind:value={editor.cubeBoxExtra} min={0} max={10} step={1} digits={0} width={60} title="Layers the region reaches above its higher corner: a region over the ground should take in the layers the camera walks and looks through" />
		{/if}
		<div class="divider"></div>
	{:else if editor.tool === 'select'}
		<!-- The Select tool (#70, CubeSelectTool): a box of cubes, copied, pasted, moved and deleted. -->
		{#if ui.cubePasting}
			<span class="chip"><span class="dim">Pasting cubes</span></span>
			<button onclick={() => engineRef.current?.cubePaste('turn')} title="Turn the cubes a quarter clockwise, seen from above">Turn 90° <kbd>R</kbd></button>
			<button onclick={() => engineRef.current?.cubePaste('mirrorX')} title="Mirror the cubes east to west">Mirror ↔ <kbd>M</kbd></button>
			<button onclick={() => engineRef.current?.cubePaste('mirrorZ')} title="Mirror the cubes north to south">Mirror ↕ <kbd>Shift+M</kbd></button>
			<button onclick={() => engineRef.current?.cubePaste('place')}>Place <kbd>Enter</kbd></button>
			<button onclick={() => engineRef.current?.cubePaste('cancel')}>Cancel <kbd>Esc</kbd></button>
		{:else}
			<OptSlider label="Higher" bind:value={editor.cubeBoxExtra} min={0} max={9} step={1} digits={0} width={60} title="Layers the selected box reaches above its higher corner, to take in what stands on the cubes dragged over" />
			{#if ui.cubeSelection}
				{@const b = ui.cubeSelection}
				<span class="chip" title="The selected box: columns across and deep, and layers high (layers {b.top} to {b.bottom})"><span class="dim">Box:</span> {b.x1 - b.x0 + 1} × {b.z1 - b.z0 + 1} × {b.bottom - b.top + 1}</span>
				<button onclick={() => engineRef.current?.copySelection()} title="Copy the selected cubes">Copy <kbd>Ctrl+C</kbd></button>
				<button onclick={() => engineRef.current?.cutSelection()} title="Copy the selected cubes and empty the box">Cut <kbd>Ctrl+X</kbd></button>
				<button onclick={() => engineRef.current?.joinCubes()} title="Join the selected cubes into one object, such as a wall (taking them out of other groups)">Join <kbd>J</kbd></button>
				<button onclick={() => engineRef.current?.splitCubes()} title="Split the groups of joined cubes in the selected box">Split <kbd>Shift+J</kbd></button>
			{/if}
			{#if ui.hasCubeClip}
				<button onclick={() => engineRef.current?.startPaste()} title="Put the copied cubes down under the cursor, in this world or another">Paste <kbd>Ctrl+V</kbd></button>
			{/if}
			{#if ui.cubeSelection}
				<button onclick={() => engineRef.current?.moveCubes(0, 0, -1)} title="Move the selected cubes a layer up (the arrows move them a column the way the camera faces)">Up <kbd>PgUp</kbd></button>
				<button onclick={() => engineRef.current?.moveCubes(0, 0, 1)} title="Move the selected cubes a layer down">Down <kbd>PgDn</kbd></button>
				<button onclick={() => engineRef.current?.deleteCubes()} title="Empty the selected box">Delete <kbd>Del</kbd></button>
				<button onclick={() => engineRef.current?.deselect()}>Deselect <kbd>Esc</kbd></button>
			{/if}
		{/if}
		<div class="divider"></div>
	{/if}
</div>
{#if hidden > 0 || open}
	<button class="more" class:active={open} onclick={() => (open = !open)} aria-expanded={open} title="Show the {hidden} controls that don't fit on the bar (Tab reaches them too; Esc or a click elsewhere closes it)">More ({hidden}) {open ? '▴' : '▾'}</button>
{/if}
</div>

<style>
	.cube-texture {
		width: 20px;
		height: 20px;
		/* An animated texture's image is its frames one under the other: show the first. */
		object-fit: cover;
		object-position: top;
		image-rendering: pixelated;
		border: 1px solid var(--border-soft);
		border-radius: 2px;
	}
	.optbar {
		position: relative;
		height: 34px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
	}
	/* One row of controls; the rest wrap below it and are clipped until More opens the bar. */
	.options {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		align-content: flex-start;
		column-gap: 12px;
		row-gap: 8px;
		height: 34px;
		box-sizing: border-box;
		padding: 4px 10px;
		overflow: hidden;
		white-space: nowrap;
	}
	.options.withMore {
		padding-right: 100px;
	}
	.options.open {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: auto;
		padding-bottom: 8px;
		z-index: 45;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.45);
	}
	.more {
		position: absolute;
		top: 4px;
		right: 10px;
		height: 26px;
		z-index: 46;
	}
	.tool {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius);
		background: var(--panel-2);
		flex: none;
	}
	.divider {
		width: 1px;
		height: 20px;
		background: var(--border-soft);
		flex: none;
	}
	.seg {
		display: flex;
		flex: none;
	}
	.seg button {
		border-radius: 0;
		margin-left: -1px;
		padding: 2px 9px;
	}
	.seg button:first-child {
		border-radius: var(--radius) 0 0 var(--radius);
		margin-left: 0;
	}
	.seg button:last-child {
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.chip {
		display: inline-flex;
		gap: 4px;
		align-items: center;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 2px 8px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.dim {
		color: var(--text-dim);
	}
	.num {
		width: 56px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 5px;
		cursor: pointer;
	}
	button {
		padding: 2px 8px;
		flex: none;
	}
</style>
