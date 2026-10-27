<script lang="ts">
	import OptSlider from './OptSlider.svelte'
	import ScriptBrushBar from './ScriptBrushBar.svelte'
	import { TOOLS } from './Toolbar.svelte'
	import { MAX_BRUSH_RADIUS, editor, prefs, setStatus, stats, ui, wow, type SculptMode } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { displayName } from '../lib/models/assets'
	import { FALLOFF_CURVES } from '../lib/tools/brush'
	import { LIQUID_TYPES } from '../lib/water/liquids'
	import { activeDoodadBrush, addDoodadBrush } from '../lib/tools/DoodadBrushTool'
	import { rulesEmpty } from '../lib/tools/doodadBrush'
	import { areaName, loadAreas } from '../lib/wow/areas'
	import { activeBrushStack } from '../lib/tools/StampTool'
	import { chooseBrushImageFolder, listBrushImages, useBrushImage } from '../lib/io/brushImages'
	import type { vmangos } from '../../wailsjs/go/models'
	import { NARROW_WIDTH, PATH_KINDS, type MapPath, type PathKind } from '../lib/terrain/paths'
	import type { PathField } from '../lib/tools/PathTool'

	// The modes are icon buttons, named by their tooltips, so the Sculpt bar fits one row (#715).
	const SCULPT_MODES: Array<{ id: SculptMode; name: string; tip: string; icon: string; dots?: boolean }> = [
		{ id: 'raise', name: 'Raise', tip: 'Lift the ground under the brush', icon: 'M3 20h18M12 17V5M7 10l5-5 5 5' },
		{ id: 'lower', name: 'Lower', tip: 'Sink the ground under the brush', icon: 'M3 4h18M12 7v12M7 14l5 5 5-5' },
		{ id: 'smooth', name: 'Smooth', tip: 'Even out bumps toward the ground around them', icon: 'M2 14c3-5 7-5 10 0s7 5 10 0' },
		{ id: 'blur', name: 'Blur', tip: 'Blur the heights under the brush, softening every edge', icon: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6' },
		{ id: 'flatten', name: 'Flatten', tip: 'Level the ground to one height (Alt+click locks the height)', icon: 'M2 17h20M5 17l3-6h8l3 6' },
		{ id: 'noise', name: 'Noise', tip: 'Roughen the ground with random bumps', icon: 'M2 15l3-5 3 7 3-9 3 8 3-5 3 4 2-2' },
		{ id: 'mountain', name: 'Mountain', tip: 'Build up a peak', icon: 'M2 20L12 4l10 16zM12 4l-2 7 3 3' },
		{ id: 'crevice', name: 'Crevice', tip: 'Dig a trench and pile the ground onto its sides', icon: 'M2 9h3l2-3 5 13 5-13 2 3h3' },
		{
			id: 'terrace',
			name: 'Terrace',
			tip: 'Step the ground into levels, for mesas, farmland and cliff levels (Shift+drag levels to the step under the first click)',
			icon: 'M2 20h6v-5h5v-5h5V5h4',
		},
		{
			id: 'erode',
			name: 'Erode',
			tip: 'Wear the ground down as water and loose rock do: water carves gullies and leaves fans of sediment below them; thermal lets ground slide off slopes steeper than the talus angle',
			icon: 'M12 3c3 5 6 8 6 11a6 6 0 0 1-12 0c0-3 3-6 6-11z',
		},
		{
			id: 'vertex',
			name: 'Vertex',
			tip: 'Pick points of the ground with the brush, then raise or lower them together (Shift+drag), level them (Flatten) or tilt them onto a slope (Slope, Direction)',
			icon: 'M5 6h.01M12 6h.01M19 6h.01M5 12h.01M12 12h.01M19 12h.01M5 18h.01M12 18h.01M19 18h.01',
			dots: true,
		},
		{ id: 'hole', name: 'Hole', tip: 'Cut holes in the ground, or fill them', icon: 'M4 4h16v16H4zM9 9h6v6H9z' },
	]

	const tool = $derived(TOOLS.find((t) => t.id === editor.tool)!)
	/** The client's liquids, re-read when the client's table arrives (LIQUID_TYPES is a plain array). */
	const liquidList = $derived.by(() => {
		void wow.liquidsRevision
		return [...LIQUID_TYPES]
	})
	const slotTex = $derived(editor.palette[editor.paintLayer])
	const sculptTex = $derived(editor.palette[editor.sculptPaintLayer])
	const texName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))
	const usesBrush = $derived(
		editor.tool === 'sculpt' ||
			(editor.tool === 'paint' && !(editor.paintMode === 'mask' && editor.maskSelect.by !== 'brush')) ||
			editor.tool === 'road' ||
			editor.tool === 'water' ||
			editor.tool === 'clear' ||
			editor.tool === 'doodad' ||
			editor.tool === 'mapdata' ||
			editor.tool === 'stamp' ||
			(editor.tool === 'place' && editor.placeScatter),
	)
	// The water brush paints whole cells in a circle, so only its size applies; Vertex mode moves the
	// selection at the brush strength and uses nothing else of the brush.
	const paintingWater = $derived(editor.tool === 'water' && editor.waterMode === 'paint')
	const vertexMode = $derived(editor.tool === 'sculpt' && editor.sculptMode === 'vertex')
	const holeMode = $derived(editor.tool === 'sculpt' && editor.sculptMode === 'hole')
	// The Map data tool marks whole chunks or cells under the brush, so only its size applies.
	const mapData = $derived(editor.tool === 'mapdata')
	// The spawn brush (#171) takes only the brush's size.
	const spawnBrushing = $derived(editor.tool === 'doodad' && editor.doodadMode === 'creatures')
	// Tools with modes show the brush's size, strength and falloff right after them (sizeStrength).
	// Their sliders are narrower, so the row fits (#715, #734).
	const sizeAfterModes = $derived(editor.tool === 'sculpt' || editor.tool === 'paint' || editor.tool === 'water' || editor.tool === 'doodad')
	const sliderW = $derived(sizeAfterModes ? 70 : 90)
	const falloffOnBar = $derived(sizeAfterModes && !vertexMode && !paintingWater && !spawnBrushing && !(editor.tool === 'paint' && !usesBrush))
	// The settings panel under the bar (settingsPanel) holds what these tools set once and leave alone,
	// so the controls used while working fit on one row (#715, #734). Its button names what it holds.
	const hasPanel = $derived(sizeAfterModes && !vertexMode)
	const sculptPainting = $derived(editor.tool === 'sculpt' && !holeMode && editor.sculptPaint !== 'off')
	const spraying = $derived(editor.tool === 'paint' && editor.paintMode === 'texture' && editor.paintSpray)
	const panelLabel = $derived(
		editor.tool === 'doodad' ? (spawnBrushing ? 'Spawns' : 'Placement') : paintingWater ? 'Water' : editor.tool === 'paint' && editor.paintMode === 'mask' ? 'Mask' : `Brush${sculptPainting ? ' · Paint' : spraying ? ' · Spray' : ''}`,
	)
	const panelTitle = $derived.by(() => {
		if (editor.tool === 'sculpt')
			return `The brush's other settings: edit limit, image, shape and falloff curve${holeMode ? '' : ', and painting while sculpting'}${
				editor.sculptMode === 'flatten' ? ", and Flatten's target, direction and angled plane" : editor.sculptMode === 'terrace' ? ", and Terrace's offset" : ''
			}`
		if (editor.tool === 'water')
			return paintingWater ? "The water brush's other settings: angled surface, overrides, opacity, which layers are drawn, and Crop water and Regen opacity" : "The brush's other settings: edit limit, shape and falloff curve"
		if (editor.tool === 'doodad')
			return spawnBrushing ? "The spawn brush's other settings: movement, facing, respawn time, levels, slope, water and rules" : 'Where the brush places models: falloff curve, ground rotation, slope, the sea and props'
		if (editor.paintMode === 'mask') return "The mask's other settings: Modify mask and its step, and the brush's shape and falloff curve while painting the mask"
		return `The brush's other settings: shape and falloff curve${editor.paintMode === 'texture' ? ', image, spray, and the unpaintable chunks' : ''}`
	})

	/** The client's zones for the Map data tool's picker, read when the tool is first opened. */
	let areas = $state<vmangos.Area[]>([])
	$effect(() => {
		if (mapData && !areas.length) void loadAreas().then((a) => (areas = a))
	})
	/** The picker's text: the picked zone's name and ID. */
	let areaText = $state('')
	$effect(() => {
		const id = editor.mapDataArea
		areaText = id ? `${areaName(id)} (${id})` : ''
	})
	/** Takes the zone from what was typed or chosen in the picker: its "(id)", or a name that matches one. */
	function pickArea(text: string) {
		const m = /\((\d+)\)\s*$/.exec(text)
		const id = m ? Number(m[1]) : (areas.find((a) => a.name.toLowerCase() === text.trim().toLowerCase())?.id ?? 0)
		if (id) {
			editor.mapDataArea = id
			editor.mapDataClear = false
		}
		areaText = editor.mapDataArea ? `${areaName(editor.mapDataArea)} (${editor.mapDataArea})` : ''
	}

	/** The brush image folder's images, read when the picker opens; and the picker's folder entry. */
	let brushImages = $state<string[]>([])
	const FOLDER = '<folder>'
	async function refreshImages() {
		brushImages = await listBrushImages()
	}
	async function pickImage(value: string) {
		if (value === FOLDER) {
			if (await chooseBrushImageFolder()) {
				await refreshImages()
				setStatus(brushImages.length ? `${brushImages.length} brush images in ${prefs.brushImageDir}.` : `No PNG or JPEG images in ${prefs.brushImageDir}.`, 5000)
			}
			// The select shows the image in use again.
			brushImages = [...brushImages]
			return
		}
		await useBrushImage(value)
	}

	/** The Path tool's picked path (#167), and a setter for its fields that records undo. */
	const pickedPath = $derived(editor.paths.find((p) => p.id === editor.pathId))
	function setPath<K extends PathField>(key: K, value: MapPath[K]) {
		engineRef.current?.path((t, c) => t.setField(c, key, value))
	}
	/** The kind of the next new path, and of the picked one. */
	function pickKind(kind: PathKind) {
		editor.pathKind = kind
		if (pickedPath) setPath('kind', kind)
	}

	/** Opens the brush editor window, making a brush first when there is none. */
	function editBrush() {
		if (!activeDoodadBrush()) addDoodadBrush()
		ui.brushEditor = true
	}

	/** The Modify mask drop-down: runs the picked change and shows the prompt again. */
	function modifyMask(e: Event) {
		const sel = e.target as HTMLSelectElement
		const how = sel.value
		sel.value = ''
		const engine = engineRef.current
		if (!engine) return
		if (how === 'grow' || how === 'shrink' || how === 'feather') engine.modifyMask(how)
		else if (how === 'invert') engine.invertMask()
		else if (how === 'clear') engine.clearMask()
	}

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
	// The panel button (brushbtn) opens the settings panel under the bar; it sits outside the clipped bar.
	let brushOpen = $state(false)
	let brushBtn = $state<HTMLButtonElement>()
	let brushPanel = $state<HTMLDivElement>()
	let brushLeft = $state(0)
	function toggleBrush(e: MouseEvent) {
		brushOpen = !brushOpen
		if (!brushOpen || !brushBtn || !root) return
		brushLeft = brushBtn.offsetLeft
		// A keyboard press (no pointer, detail 0) takes focus into the panel, so Tab walks its controls.
		const keyboard = e.detail === 0
		requestAnimationFrame(() => {
			if (!brushPanel || !root) return
			brushLeft = Math.max(0, Math.min(brushLeft, root.clientWidth - brushPanel.offsetWidth - 4))
			if (keyboard) brushPanel.querySelector<HTMLElement>('button, input, select')?.focus()
		})
	}
	// A new tool, or a new mode of a tool whose panel holds other settings per mode, starts with the bar
	// and the panel closed.
	$effect(() => {
		void editor.tool
		void editor.waterMode
		void editor.doodadMode
		void editor.paintMode
		open = false
		brushOpen = false
	})
	$effect(() => {
		if (!open && !brushOpen) return
		const away = (e: PointerEvent) => {
			if (!root?.contains(e.target as Node)) {
				open = false
				brushOpen = false
			}
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
		if (e.key === 'Escape' && brushOpen) {
			brushOpen = false
			brushBtn?.focus()
			e.stopPropagation()
		} else if (e.key === 'Escape' && open) {
			open = false
			e.stopPropagation()
		}
	}
</script>

{#snippet imageBrush()}
	<select
		class="curve"
		value={editor.brushImage.name}
		onfocus={refreshImages}
		onchange={(e) => pickImage(e.currentTarget.value)}
		title="Shape the brush with a greyscale image from your brush image folder: the stroke takes the image's light parts"
		aria-label="Brush image"
	>
		<option value="">Image: none</option>
		{#each brushImages as name (name)}
			<option value={name}>Image: {name}</option>
		{/each}
		<option value={FOLDER}>Image folder…</option>
	</select>
	{#if editor.brushImage.name}
		<OptSlider label="Turn" bind:value={editor.brushImage.rotation} min={0} max={360} step={1} digits={0} width={60} title="The image's rotation, in degrees" />
		<label class="check" title="Turn the image to a new random rotation after each stroke"><input type="checkbox" bind:checked={editor.brushImage.random} /> Random turn</label>
	{/if}
{/snippet}

<!-- The brush's size and strength, the controls used most: right after the tool's modes where it has
		 them, so they stay on the bar's first row when the rest wraps under More. -->
{#snippet sizeStrength()}
	{#if usesBrush}
		{#if !vertexMode}
			<OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={MAX_BRUSH_RADIUS} step={0.5} digits={1} width={sliderW} title="Brush radius ( [ / ] )" />
		{/if}
		{#if !paintingWater && !mapData && !spawnBrushing}
			<OptSlider
				label="Strength"
				width={sliderW}
				bind:value={editor.brush.strength}
				min={0.02}
				max={editor.tool === 'sculpt' ? 10 : 1}
				step={0.01}
				digits={2}
				title={vertexMode ? 'How fast Shift+drag moves the selected vertices' : editor.tool === 'sculpt' ? 'How fast the ground moves: up to ten times the normal speed, for big mountains' : undefined}
			/>
		{/if}
		{#if falloffOnBar}
			<OptSlider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} digits={2} width={sliderW} />
		{/if}
	{/if}
{/snippet}

{#snippet falloffCurve()}
	<select class="curve" bind:value={editor.brush.curve} title="How the brush weight falls off across the falloff band" aria-label="Falloff curve">
		{#each FALLOFF_CURVES as c (c.id)}
			<option value={c.id}>{c.name}</option>
		{/each}
	</select>
{/snippet}

{#snippet brushShape()}
	<div class="seg" title="Brush shape">
		<button class:active={editor.brush.shape === 'circle'} onclick={() => (editor.brush.shape = 'circle')} aria-label="Round brush">●</button>
		<button class:active={editor.brush.shape === 'square'} onclick={() => (editor.brush.shape = 'square')} aria-label="Square brush">■</button>
	</div>
	{#if editor.brush.shape === 'square'}
		<label class="check" title="Align square brushes to the terrain grid"><input type="checkbox" bind:checked={editor.brush.snap} /> Snap to grid</label>
	{/if}
{/snippet}

{#snippet editLimit()}
	<select class="curve" bind:value={editor.sculptLimit} title="Only change ground above or below the height under the cursor" aria-label="Edit limit">
		<option value="none">Any height</option>
		<option value="above">Only above cursor</option>
		<option value="below">Only below cursor</option>
	</select>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="optbar" bind:this={root} onkeydown={onKeyDown}>
	<div class="options" class:open class:withMore={hidden > 0 || open} bind:this={bar} onfocusin={onFocusIn}>
		<div class="tool" title="{tool.name}: {tool.desc}">
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
				<path d={tool.icon} />
			</svg>
		</div>
		<div class="divider"></div>

		{#if editor.tool === 'sculpt'}
			<div class="seg icons" role="group" aria-label="Sculpt mode">
				{#each SCULPT_MODES as m (m.id)}
					<button class:active={editor.sculptMode === m.id} onclick={() => (editor.sculptMode = m.id)} title="{m.name}: {m.tip}" aria-label={m.name} aria-pressed={editor.sculptMode === m.id}>
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width={m.dots ? 3.2 : 1.8} stroke-linejoin="round" stroke-linecap="round">
							<path d={m.icon} />
						</svg>
					</button>
				{/each}
			</div>
			{@render sizeStrength()}
			{#if editor.sculptMode === 'flatten'}
				<label class="check" title="Level every stroke to the locked height instead of the height where it starts; Alt+click locks the point under the cursor"
					><input type="checkbox" bind:checked={editor.flattenLock.on} /> Lock</label
				>
				{#if editor.flattenLock.on}
					<label class="check" title="The locked height, in yards">H <input class="num" type="number" step="0.1" bind:value={editor.flattenLock.y} /></label>
				{/if}
			{/if}
			{#if editor.sculptMode === 'mountain'}
				<OptSlider
					label="Ridges"
					bind:value={editor.mountain.ridges}
					min={0}
					max={1}
					step={0.01}
					digits={2}
					width={60}
					title="How much the ridges carve the peak: 0 a smooth hill, 1 all ridges. The whole brush is slope (the falloff curve shapes it) and the ridges scale with the brush."
				/>
			{/if}
			{#if editor.sculptMode === 'crevice'}
				<OptSlider
					label="Ridge"
					bind:value={editor.crevice.ridge}
					min={0}
					max={2}
					step={0.05}
					digits={2}
					width={60}
					title="How much of the dug ground is piled onto the sides: 1 keeps the volume, 0 only digs. Falloff sets how wide the ridges are."
				/>
			{/if}
			{#if editor.sculptMode === 'erode'}
				<div class="seg">
					<button
						class:active={editor.erode.kind === 'hydraulic'}
						onclick={() => (editor.erode.kind = 'hydraulic')}
						title="Water drops run downhill from under the brush, carving gullies and leaving their load where they slow down. Strength sets how many drops a second.">Water</button
					>
					<button
						class:active={editor.erode.kind === 'thermal'}
						onclick={() => (editor.erode.kind = 'thermal')}
						title="Ground slides off wherever it is steeper than the talus angle, as scree does, which also takes the spikes off noise. Strength sets how fast.">Thermal</button
					>
				</div>
				{#if editor.erode.kind === 'thermal'}
					<OptSlider label="Talus" bind:value={editor.erode.talus} min={5} max={80} step={1} digits={0} width={60} title="The steepest slope, in degrees, that loose ground holds; steeper ground slides down" />
				{/if}
				<button onclick={() => (ui.dialog = 'erode')} title="Erode the selected area, or the whole map, at once (Terrain › Erode)">Area…</button>
			{/if}
			{#if editor.sculptMode === 'terrace'}
				<OptSlider label="Step" bind:value={editor.terrace.step} min={0.5} max={50} step={0.5} digits={1} width={50} title="Yards between the levels" />
				<OptSlider label="Sharpness" bind:value={editor.terrace.sharpness} min={0} max={1} step={0.05} digits={2} width={50} title="How much of each step is flat: 1 flat levels with cliffs between them, 0 smooth stairs" />
			{/if}
			{#if editor.sculptMode === 'hole'}
				<div class="seg">
					<button class:active={!editor.holeFill} onclick={() => (editor.holeFill = false)} title="Click or drag over the ground to cut it out, a 2×2-cell block at a time (the client keeps holes in such blocks)">Cut</button>
					<button class:active={editor.holeFill} onclick={() => (editor.holeFill = true)} title="Click or drag over a hole to put the ground back, a 2×2-cell block at a time">Fill</button>
				</div>
			{:else if editor.sculptMode === 'vertex'}
				<span class="chip" style:flex-shrink="0" title="Drag to select vertices, Ctrl or Alt+drag to deselect, Shift+drag to move them up and down"><span class="dim">Selected:</span> {ui.vertexCount}</span>
				<!-- Nothing picked yet: the controls act on the picked points only, so they wait; the status bar explains the mode (ToolHint). -->
				{#if ui.vertexCount}
					<button onclick={() => engineRef.current?.vertexAction('flatten')} title="Level the selected vertices at their mean height">Flatten</button>
					<button onclick={() => engineRef.current?.vertexAction('clear')} title="Drop every picked point (the ground stays as it is)">Clear</button>
					<select class="curve" bind:value={editor.vertexRef} title="Point the slope plane passes through" aria-label="Slope reference">
						<option value="center">Through centre</option>
						<option value="cursor">Through cursor</option>
					</select>
					<OptSlider label="Slope" bind:value={editor.vertexAngle} min={-89} max={89} step={1} digits={0} width={60} title="Angle of the plane the selection is laid on, in degrees" />
					<OptSlider label="Direction" bind:value={editor.vertexDir} min={0} max={360} step={1} digits={0} width={60} title="Direction the slope rises toward, in degrees (Space: from the cursor toward the selection centre)" />
				{/if}
			{/if}
		{:else if editor.tool === 'paint' || editor.tool === 'road'}
			{#if editor.tool === 'paint'}
				<div class="seg">
					<button class:active={editor.paintMode === 'texture'} onclick={() => (editor.paintMode = 'texture')}>Paint</button>
					<button class:active={editor.paintMode === 'swap'} onclick={() => (editor.paintMode = 'swap')} title="Replace the texture under the start of each stroke with the active layer">Swap</button>
					<button class:active={editor.paintMode === 'mask'} onclick={() => (editor.paintMode = 'mask')} title="Paint the mask that Fill mask uses to place the active texture">Mask</button>
				</div>
				{@render sizeStrength()}
			{/if}
			{#if editor.tool === 'paint' && editor.paintMode === 'swap'}
				<select class="curve" bind:value={editor.swap.scope} title="Swap by the brush's weight, or the whole layer in every chunk the brush touches, or in the tile under it" aria-label="Swap scope">
					<option value="brush">Under the brush</option>
					<option value="chunk">Entire chunks</option>
					<option value="tile">Entire tile</option>
				</select>
				<label class="check" title="Keep swapping the texture the first stroke swapped, instead of the one under each stroke's start">
					<input type="checkbox" bind:checked={editor.swap.keep} onchange={() => (editor.swap.from = '')} /> Keep
				</label>
			{/if}
			{#if editor.tool === 'paint' && editor.paintMode === 'mask'}
				{@const ms = editor.maskSelect}
				<select class="curve" bind:value={ms.by} title="Paint the mask with the brush, or click a spot to select by what is there (Shift+click adds, Alt+click takes away)" aria-label="Select by">
					<option value="brush">Brush</option>
					<option value="texture">Select by texture</option>
					<option value="height">Select by height</option>
					<option value="slope">Select by slope</option>
					<option value="water">Select by water</option>
				</select>
				{#if ms.by === 'texture'}
					<OptSlider label="Min weight" bind:value={ms.minWeight} min={0} max={1} step={0.05} digits={2} width={60} title="Take the texels where the texture under the click weighs at least this much (0 to 1)" />
				{:else if ms.by === 'height'}
					<OptSlider label="± yd" bind:value={ms.height} min={0} max={100} step={0.5} digits={1} width={60} title="Take the ground within this many yards above or below the click" />
				{:else if ms.by === 'slope'}
					<OptSlider label="Slope from" bind:value={ms.slopeMin} min={0} max={90} step={1} digits={0} width={60} title="Take the ground at least this steep, in degrees" />
					<OptSlider label="to" bind:value={ms.slopeMax} min={0} max={90} step={1} digits={0} width={60} title="and at most this steep, in degrees" />
				{/if}
				{#if ms.by !== 'brush'}
					<label class="check" title="Only what is joined to the click; off, everything on the map that matches"><input type="checkbox" bind:checked={ms.contiguous} /> Contiguous</label>
					<OptSlider label="Feather" bind:value={ms.feather} min={0} max={20} step={0.5} digits={1} width={60} title="Soften the selection's edge over this many yards" />
				{/if}
			{/if}
			<button
				class="chip"
				onclick={() => {
					ui.palette = 'textures'
					prefs.browserCollapsed = false
				}}
				title="Active texture layer (pick textures in the asset browser below)"
			>
				<span class="dim">Layer {editor.paintLayer + 1}:</span>
				{slotTex ? texName(slotTex) : 'empty'}
			</button>
			{#if editor.tool === 'road'}
				<label class="check"><input type="checkbox" bind:checked={editor.roadFlatten} /> Level terrain</label>
				{@render editLimit()}
			{/if}
			<div class="divider"></div>
		{:else if editor.tool === 'path'}
			<select
				class="curve"
				value={editor.pathId}
				onchange={(e) => engineRef.current?.path((t) => t.pick(Number(e.currentTarget.value)))}
				title="The path the clicks add points to and Apply bakes; New path makes the next click start one"
				aria-label="Path"
			>
				<option value={-1}>New path</option>
				{#each editor.paths as p (p.id)}
					<option value={p.id}>{p.name} ({p.points.length} points)</option>
				{/each}
			</select>
			<div class="seg" title="What the path does when applied">
				{#each PATH_KINDS as k (k.id)}
					<button class:active={(pickedPath?.kind ?? editor.pathKind) === k.id} onclick={() => pickKind(k.id)} title={k.tip}>{k.name}</button>
				{/each}
			</div>
			{#if pickedPath?.kind === 'fence'}
				{@const pp = pickedPath}
				<button
					class="chip"
					onclick={() => {
						ui.palette = 'models'
						prefs.browserCollapsed = false
					}}
					title="The model stood along the path: click one in the asset browser below while the path is picked"
				>
					<span class="dim">Model:</span>
					{pp.model ? displayName(pp.model) : 'pick one below'}
				</button>
				<OptSlider
					label="Spacing"
					bind:value={() => pp.spacing, (v) => setPath('spacing', v)}
					min={0}
					max={60}
					step={0.25}
					digits={2}
					width={60}
					title="Yards from one model to the next; 0 lays them end to end at the model's own length"
				/>
				<OptSlider
					label="Turn"
					bind:value={() => pp.turn, (v) => setPath('turn', v)}
					min={0}
					max={360}
					step={15}
					digits={0}
					width={60}
					title="Degrees each model is turned past following the curve (its long side is laid along it)"
				/>
			{:else if pickedPath}
				{@const pp = pickedPath}
				<OptSlider label="Width" bind:value={() => pp.width, (v) => setPath('width', v)} min={1} max={60} step={0.5} digits={1} width={70} title="The full width that is levelled and painted, in yards" />
				<OptSlider
					label="Falloff"
					bind:value={() => pp.falloff, (v) => setPath('falloff', v)}
					min={0}
					max={40}
					step={0.5}
					digits={1}
					width={60}
					title="The yards beyond each side over which the ground blends back into what was there"
				/>
				{#if pp.kind === 'river'}
					<OptSlider
						label="Depth"
						bind:value={() => pp.depth, (v) => setPath('depth', v)}
						min={0}
						max={30}
						step={0.25}
						digits={2}
						width={60}
						title="How deep the bed is carved below the surface in the middle, in yards; the surface runs downhill from the higher end"
					/>
					<select class="curve" value={pp.liquid} onchange={(e) => setPath('liquid', Number(e.currentTarget.value))} title="The liquid that fills the river (the client's LiquidType)" aria-label="River liquid">
						{#each liquidList as l (l.id)}
							<option value={l.id}>{l.name}</option>
						{/each}
					</select>
				{:else}
					<OptSlider
						label="Max grade %"
						bind:value={() => pp.grade, (v) => setPath('grade', v)}
						min={0}
						max={100}
						step={1}
						digits={0}
						width={60}
						title="The steepest the road may climb along its length, in percent (10 rises 10 yd over 100); 0 follows the points' heights"
					/>
				{/if}
				<select
					class="curve"
					value={pp.texture}
					onchange={(e) => setPath('texture', e.currentTarget.value)}
					title="The texture painted along the path (a road's surface, a river's bed): one of the map's textures (pick more in the asset browser)"
					aria-label="Path texture"
				>
					<option value="">Paint: none</option>
					{#each editor.palette as tex (tex)}
						<option value={tex}>Paint: {texName(tex)}</option>
					{/each}
					{#if pp.texture && !editor.palette.includes(pp.texture)}
						<option value={pp.texture}>Paint: {texName(pp.texture)} (not in the map)</option>
					{/if}
				</select>
				<OptSlider label="Edge" bind:value={() => pp.edge, (v) => setPath('edge', v)} min={0} max={8} step={0.25} digits={2} width={50} title="The yards over which the paint fades at each side; 0 is a hard edge" />
				{#if pp.width < NARROW_WIDTH}
					<span class="warn" title="The ground has a vertex every 2 yards, so a road narrower than two cells comes out jagged">Narrower than {NARROW_WIDTH} yd: jagged</span>
				{/if}
			{/if}
			{#if pickedPath}
				<button onclick={() => engineRef.current?.path((t, c) => t.apply(c))} title="Bake the path into the map as one undo step; applying it again first takes back its last apply (Enter)">Apply</button>
				<button onclick={() => engineRef.current?.path((t, c) => t.deletePoint(c))} disabled={editor.pathPoint < 0} title="Delete the picked point (Delete)">Delete point</button>
				<button onclick={() => engineRef.current?.path((t, c) => t.deletePath(c))} title="Delete the path; what it applied stays in the map">Delete path</button>
			{/if}
			<div class="divider"></div>
		{:else if editor.tool === 'water'}
			<div class="seg">
				<button class:active={editor.waterMode === 'paint'} onclick={() => (editor.waterMode = 'paint')} title="Paint liquid: click adds it, Ctrl+click removes it">Paint water</button>
				<button class:active={editor.waterMode === 'dig'} onclick={() => (editor.waterMode = 'dig')} title="Lower the ground to below the sea level">Dig lake</button>
				<button class:active={editor.waterMode === 'shore'} onclick={() => (editor.waterMode = 'shore')} title="Raise the ground to just above the sea level">Raise shore</button>
			</div>
			{@render sizeStrength()}
			{#if editor.waterMode === 'paint'}
				<select class="curve" bind:value={editor.water.liquid} title="The liquid to paint (the client's LiquidType)" aria-label="Liquid">
					{#each liquidList as l (l.id)}
						<option value={l.id}>{l.name}</option>
					{/each}
				</select>
				<label class="check" title="Paint the surface at the locked height (Alt+click sets it from the cursor); off, at the cursor's height"><input type="checkbox" bind:checked={editor.water.lock} /> Lock</label>
				{#if editor.water.lock}
					<OptSlider label="Height" bind:value={editor.water.lockPos.y} min={-200} max={400} step={0.1} digits={1} width={80} title="The locked surface height (Alt+click picks it)" />
				{/if}
				<label class="check" title="The brush stops on liquid surfaces (and the sea), not just the ground"><input type="checkbox" bind:checked={editor.water.onLiquids} /> On liquids</label>
			{:else}
				<span class="chip" title="The map's sea level, set in File > Map Properties"><span class="dim">Sea level:</span> {editor.waterEnabled ? editor.waterLevel.toFixed(1) : 'off'}</span>
			{/if}
		{:else if editor.tool === 'place'}
			<span class="chip" title={editor.prefab}>
				<span class="dim">Model:</span>
				{editor.prefab ? displayName(editor.prefab) : 'pick one in the browser below'}
			</span>
			<label class="check"><input type="checkbox" bind:checked={editor.placeRandomRot} /> Random rotation</label>
			<label class="check"><input type="checkbox" bind:checked={editor.placeRandomScale} /> Random scale</label>
			<label class="check" title="Tilt each placed model a little, up to 8 degrees each way"><input type="checkbox" bind:checked={editor.placeRandomTilt} /> Random tilt</label>
			<label class="check" title="Tilt new models on open ground to the slope under them, as the Select tool's drag does"><input type="checkbox" bind:checked={editor.followGround} /> Follow ground rotation</label>
			{#if editor.followGround}
				<label class="check" title="Use the slope averaged over the neighbouring cells, not the slope right under the model"><input type="checkbox" bind:checked={editor.followGroundSmooth} /> Smooth</label>
			{/if}
			<label class="check" title="Fit the ground under each model placed on open ground to its floor, with the settings of Models › Fit Ground to Selected Models, in the same undo step"
				><input type="checkbox" bind:checked={prefs.placeFitGround} /> Fit ground</label
			>
			{#if prefs.placeFitGround}
				<button title="The fit's settings: margin under the floor, blend ring, raise or lower, holes" onclick={() => (ui.dialog = 'fitGround')}>Settings…</button>
			{/if}
			<label class="check"><input type="checkbox" bind:checked={editor.placeScatter} /> Scatter</label>
			{#if ui.placeCreature || ui.placeObject}
				<span class="chip" title="The creature or object from the browser's spawn tabs that a click places (Esc stops)">
					<span class="dim">Placing:</span>
					{ui.placeCreature?.name ?? ui.placeObject?.name}
					<button class="x" onclick={() => (ui.placeCreature = ui.placeObject = null)} title="Stop placing it" aria-label="Stop placing">×</button>
				</span>
			{/if}
			<span class="chip" title="Height above the surface for new placements (PgUp / PgDn)">
				<span class="dim">Height:</span>
				{editor.placeHeight >= 0 ? '+' : ''}{editor.placeHeight.toFixed(2)}
			</span>
			{#if editor.placeHeight !== 0}
				<button onclick={() => (editor.placeHeight = 0)}>Reset</button>
			{/if}
			{#if editor.placeOffset.x !== 0 || editor.placeOffset.z !== 0}
				<span class="chip" title="New placements sit this far from the cursor (arrow keys)">
					<span class="dim">Offset:</span>
					{Math.hypot(editor.placeOffset.x, editor.placeOffset.z).toFixed(2)}
				</span>
				<button onclick={() => (editor.placeOffset = { x: 0, z: 0 })}>Reset</button>
			{/if}
			<div class="divider"></div>
		{:else if editor.tool === 'stamp'}
			<select
				class="curve"
				value={activeBrushStack()?.name ?? ''}
				onchange={(e) => (prefs.brushStack = (e.target as HTMLSelectElement).value)}
				disabled={!prefs.brushStacks.length}
				title="The brush stack a stroke applies"
				aria-label="Brush stack"
			>
				{#if !prefs.brushStacks.length}<option value="">No stacks yet</option>{/if}
				{#each prefs.brushStacks as s (s.name)}
					<option value={s.name}>{s.name} ({s.items.length})</option>
				{/each}
			</select>
			<button onclick={() => (ui.dialog = 'stack')} title="Edit the stack's brushes: their order, modes, textures and what they take from the stack">{activeBrushStack() ? 'Edit stack…' : 'New stack…'}</button>
			<OptSlider label="Turn" bind:value={editor.brushImage.rotation} min={0} max={360} step={1} digits={0} width={60} title="The stack's turn for the image brush, which its brushes take unless they have their own" />
			<div class="divider"></div>
		{:else if editor.tool === 'script'}
			<ScriptBrushBar />
			<div class="divider"></div>
		{:else if editor.tool === 'doodad'}
			<div class="seg" title="Paint models with a doodad brush, or creatures with the spawn brush">
				<button class:active={editor.doodadMode === 'models'} onclick={() => (editor.doodadMode = 'models')}>Models</button>
				<button class:active={editor.doodadMode === 'creatures'} onclick={() => (editor.doodadMode = 'creatures')}>Creatures</button>
			</div>
			{@render sizeStrength()}
		{/if}
		{#if editor.tool === 'doodad' && editor.doodadMode === 'creatures'}
			{@const sb = prefs.spawnBrush}
			<span class="chip" title={sb.entries.length ? sb.entries.map((e) => `${e.name} (${e.weight})`).join(', ') : 'No creatures in the brush yet; the Spawns panel lists them'}
				>{sb.entries.length} {sb.entries.length === 1 ? 'creature' : 'creatures'}</span
			>
			<OptSlider label="Per 100×100 yd" bind:value={sb.density} min={1} max={60} step={1} digits={0} width={60} title="How many creatures the brush fills 100 by 100 yards of ground with" />
			<OptSlider label="Spacing" bind:value={sb.spacing} min={0} max={40} step={0.5} digits={1} width={60} title="No two creatures closer than this many yards (social aggro)" />
		{:else if editor.tool === 'doodad'}
			<select
				class="curve"
				value={activeDoodadBrush()?.name ?? ''}
				onchange={(e) => (prefs.doodadBrush = (e.target as HTMLSelectElement).value)}
				disabled={!prefs.doodadBrushes.length}
				title="The brush to paint with"
				aria-label="Doodad brush"
			>
				{#if !prefs.doodadBrushes.length}<option value="">No brushes yet</option>{/if}
				{#each prefs.doodadBrushes as b (b.name)}
					<option value={b.name}>{b.name} ({b.entries.length})</option>
				{/each}
			</select>
			<button onclick={editBrush} title="Open the brush editor: the brush's models, weights, scale, sink and tilt">
				{activeDoodadBrush() ? 'Edit brush…' : 'New brush…'}
			</button>
			<label class="check"><input type="checkbox" bind:checked={editor.doodad.randomRot} /> Random rotation</label>
		{:else if editor.tool === 'select'}
			{#if ui.pasting}
				{#if engineRef.current?.pastingModels()}
					<span class="chip"><span class="dim">Pasting models</span></span>
				{:else}
					<span class="chip"><span class="dim">Pasting</span></span>
					<label class="check"><input type="checkbox" bind:checked={editor.paste.terrain} /> Terrain</label>
					<label class="check"><input type="checkbox" bind:checked={editor.paste.textures} /> Textures</label>
					<label class="check"><input type="checkbox" bind:checked={editor.paste.objects} /> Objects</label>
					<OptSlider label="Blend edges" bind:value={editor.paste.blend} min={0} max={8} step={1} digits={0} width={60} title="Cells over which the paste fades into the map" />
					<OptSlider label="Height" bind:value={editor.paste.heightOffset} min={-60} max={60} step={0.5} digits={1} width={70} title="Raise/lower the pasted terrain (PgUp/PgDn)" />
					<select bind:value={editor.paste.heightMode} title="How the pasted heights meet the map's" aria-label="Paste heights">
						<option value="set">Heights: replace</option>
						<option value="max">Heights: raise only</option>
						<option value="min">Heights: lower only</option>
						<option value="add">Heights: add the bumps</option>
						<option value="subtract">Heights: subtract the bumps</option>
					</select>
					<button onclick={() => engineRef.current?.rotateClip()} title="Turn the paste a quarter turn: ground, textures, holes, liquids and models together">Turn 90° <kbd>R</kbd></button>
					<button onclick={() => engineRef.current?.mirrorClip('x')} title="Mirror the paste east to west">Mirror ↔</button>
					<button onclick={() => engineRef.current?.mirrorClip('z')} title="Mirror the paste north to south">Mirror ↕</button>
				{/if}
				<button onclick={() => engineRef.current?.commitPaste()}>Place <kbd>Enter</kbd></button>
				<button onclick={() => engineRef.current?.cancelPaste()}>Cancel <kbd>Esc</kbd></button>
			{:else}
				{@const count = editor.selectedIds.length}
				<div class="seg" title="What a drag on the ground selects">
					<button
						class:active={!editor.selectBrush && editor.selectShape === 'rect'}
						onclick={() => {
							editor.selectBrush = false
							editor.selectShape = 'rect'
						}}
						title="Drag a rectangle: the area and the models in it (L cycles the shapes)">Area</button
					>
					<button
						class:active={!editor.selectBrush && editor.selectShape === 'lasso'}
						onclick={() => {
							editor.selectBrush = false
							editor.selectShape = 'lasso'
						}}
						title="Draw the area freehand; Shift adds to it, Ctrl takes from it (L cycles the shapes)">Lasso</button
					>
					<button
						class:active={!editor.selectBrush && editor.selectShape === 'polygon'}
						onclick={() => {
							editor.selectBrush = false
							editor.selectShape = 'polygon'
						}}
						title="Click the area's corners; Enter or a click on the first corner closes it. Shift adds, Ctrl takes away (L cycles the shapes)">Polygon</button
					>
					<button class:active={editor.selectBrush} onclick={() => (editor.selectBrush = true)} title="Brush over the models to select them: Shift adds to the selection, Ctrl takes models out">Brush</button>
				</div>
				{#if editor.selectBrush}
					<OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={MAX_BRUSH_RADIUS} step={0.5} digits={1} title="Selection brush radius ( [ / ] )" />
				{/if}
				{#if editor.selected && count <= 1}
					<span class="chip"><span class="dim">Selected:</span> {displayName(editor.selected.type)}</span>
					<label class="check" title="Dragging the model moves it along the ground (and onto buildings) under the cursor; off, it slides across a level plane at its own height"
						><input type="checkbox" bind:checked={editor.moveFollowCursor} /> Follow cursor on the ground</label
					>
				{:else if count > 1}
					<span class="chip"><span class="dim">Selected:</span> {count} objects</span>
					<label class="check" title="Dragging the group sets each model on the ground where it lands (its height above it kept); off, every model keeps its height"
						><input type="checkbox" bind:checked={editor.moveSnapGroup} /> Snap models to the ground</label
					>
					<label class="check" title="R, Alt+arrows and the gizmo ring turn the group about the mean of its positions, so it keeps its shape; off, each model turns about its own origin"
						><input type="checkbox" bind:checked={editor.rotatePivot} /> Rotate around pivot point</label
					>
				{/if}
				{#if editor.selection}
					{@const s = editor.selection}
					{@const holes = engineRef.current?.holesInSelection() ?? 0}
					<span class="chip" title="The selected area of the ground"><span class="dim">Area:</span> {s.x1 - s.x0} × {s.z1 - s.z0} cells{holes ? ` (${holes} hole)` : ''}</span>
					<button onclick={() => engineRef.current?.setHoleInSelection(true)} title="Cut the ground away in the selected area, so a cave or cellar can go below">Cut hole</button>
					<button disabled={!holes} onclick={() => engineRef.current?.setHoleInSelection(false)} title="Put the ground back in the selected area">Fill hole</button>
				{/if}
				{#if count || editor.selection}
					<button onclick={() => engineRef.current?.copySelection()} title={count ? 'Copy the selected models' : 'Copy the selected area'}>Copy <kbd>Ctrl+C</kbd></button>
				{/if}
				{#if ui.hasClip}
					<button onclick={() => engineRef.current?.startPaste()}>Paste <kbd>Ctrl+V</kbd></button>
				{/if}
				{#if count}
					<button onclick={() => engineRef.current?.duplicateSelected()} title="Put a copy of the selected models down next to them">Duplicate <kbd>Ctrl+Shift+D</kbd></button>
					<button onclick={() => engineRef.current?.focusSelected()}>Focus <kbd>F</kbd></button>
					<button onclick={() => engineRef.current?.deleteSelected()}>Delete <kbd>Del</kbd></button>
				{/if}
				{#if count || editor.selection}
					<button onclick={() => engineRef.current?.deselect()}>Deselect <kbd>Esc</kbd></button>
				{/if}
				<div class="divider"></div>
				<label class="check" title="Tilt a model to the ground's slope while dragging it along the ground"><input type="checkbox" bind:checked={editor.followGround} /> Follow ground rotation</label>
				{#if editor.followGround}
					<label class="check" title="Use the slope averaged over the neighbouring cells, not the slope right under the model"><input type="checkbox" bind:checked={editor.followGroundSmooth} /> Smooth</label>
				{/if}
			{/if}
		{/if}

		<!-- The tools with modes keep their shape and falloff curve in the settings panel (#715, #734). -->
		{#if usesBrush && !sizeAfterModes}
			{#if editor.tool !== 'place' && !mapData}
				{@render brushShape()}
			{/if}
			{@render sizeStrength()}
			{#if editor.tool !== 'road' && editor.tool !== 'place' && !mapData}
				<OptSlider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} digits={2} />
				{@render falloffCurve()}
			{/if}
		{/if}
		{#if editor.tool === 'clear'}
			<select class="curve" bind:value={editor.clearMode} title="What the brush erases" aria-label="What to clear">
				<option value="models">Models</option>
				<option value="textures">Textures (to base)</option>
				<option value="faint">Faint layers (below threshold)</option>
				<option value="heights">Height (to zero)</option>
				<option value="liquids">Liquids (painted water)</option>
				<option value="holes">Holes (fill)</option>
			</select>
			{#if editor.clearMode === 'faint'}
				<OptSlider label="Threshold %" bind:value={editor.clearThreshold} min={1} max={50} step={1} digits={0} title="A painted layer goes from a chunk the brush touches when it is weaker than this everywhere in the chunk" />
			{/if}
		{/if}
		{#if mapData}
			<select class="curve" bind:value={editor.mapDataMode} title="What the brush paints into the chunks" aria-label="Map data">
				<option value="area">Zone</option>
				<option value="impassable">Impassable</option>
				<option value="noTufts">No tufts</option>
				<option value="shadow">Shadow</option>
			</select>
			<div
				class="seg"
				title={editor.mapDataMode === 'area'
					? 'Set the zone under the brush, or clear it'
					: editor.mapDataMode === 'impassable'
						? 'Mark the chunks under the brush impassable, or make them passable again'
						: editor.mapDataMode === 'shadow'
							? 'Paint baked shadow under the brush, or light it again'
							: 'Mark the cells under the brush as growing no tufts, or let them grow again'}
			>
				<button class:active={!editor.mapDataClear} onclick={() => (editor.mapDataClear = false)}>Set</button>
				<button class:active={editor.mapDataClear} onclick={() => (editor.mapDataClear = true)}>Clear</button>
			</div>
			{#if editor.mapDataMode === 'area'}
				<input
					class="area"
					list="meld-areas"
					placeholder={areas.length ? 'Zone: type a name' : 'Zones need the client'}
					title="The zone (AreaTable.dbc) the brush paints into the chunks; Alt+click a chunk to take its zone"
					aria-label="Zone"
					value={areaText}
					onchange={(e) => pickArea(e.currentTarget.value)}
				/>
				<datalist id="meld-areas">
					{#each areas as a (a.id)}
						<option value="{areaName(a.id)} ({a.id})"></option>
					{/each}
				</datalist>
			{/if}
		{/if}
		{#if editor.tool === 'paint' && editor.paintMode === 'texture'}
			<label class="check" title="Spray random dabs over the brush instead of painting it solid (T); its dab size and pressure are in the Brush panel"><input type="checkbox" bind:checked={editor.paintSpray} /> Spray</label>
		{/if}
		{#if hasPanel}
			<div class="divider"></div>
			<button class="brushbtn" class:active={brushOpen} class:painting={sculptPainting || spraying} bind:this={brushBtn} onclick={toggleBrush} aria-expanded={brushOpen} title={panelTitle}>{panelLabel} {brushOpen ? '▴' : '▾'}</button>
		{/if}
	</div>
	{#if hidden > 0 || open}
		<button class="more" class:active={open} onclick={() => (open = !open)} aria-expanded={open} title="Show the {hidden} controls that don't fit on the bar (Tab reaches them too; Esc or a click elsewhere closes it)"
			>More ({hidden}) {open ? '▴' : '▾'}</button
		>
	{/if}
	{#if brushOpen && hasPanel && editor.tool !== 'sculpt'}
		<div class="brushpanel" bind:this={brushPanel} style:left="{brushLeft}px" role="group" aria-label="{panelLabel} settings">
			{#if editor.tool === 'water' && paintingWater}
				<div class="row">
					<span class="dim head">Surface</span>
					<label class="check" title="Tilt the surface for flowing rivers"><input type="checkbox" bind:checked={editor.water.angled} /> Angled</label>
					{#if editor.water.angled}
						<OptSlider label="Angle" bind:value={editor.water.angle} min={0} max={89} step={0.5} digits={1} width={60} title="How steeply the surface rises, in degrees" />
						<OptSlider
							label="Direction"
							bind:value={editor.water.orientation}
							min={0}
							max={360}
							step={1}
							digits={0}
							width={60}
							title="Direction the surface rises toward, in degrees (0 is east, 90 south). It pivots on the locked point."
						/>
					{/if}
				</div>
				<div class="row">
					<span class="dim head">Override</span>
					<label class="check" title="Water already there takes the brush's height too"><input type="checkbox" bind:checked={editor.water.overrideHeight} /> Height</label>
					<label class="check" title="Painting replaces other liquids under the brush; off, it adds to whichever is there"><input type="checkbox" bind:checked={editor.water.overrideId} /> Type</label>
				</div>
				<div class="row">
					<span class="dim head">Opacity</span>
					<select class="curve" bind:value={editor.water.opacity} title="How quickly the water turns opaque with depth" aria-label="Opacity">
						<option value="auto">Auto</option>
						<option value="river">River</option>
						<option value="ocean">Ocean</option>
						<option value="custom">Custom</option>
					</select>
					{#if editor.water.opacity === 'custom'}
						<OptSlider label="Factor" bind:value={editor.water.customOpacity} min={0} max={1} step={0.001} digits={3} width={60} title="Depth factor: (depth + 1) × factor is the opacity" />
					{/if}
					<button onclick={() => engineRef.current?.regenWaterOpacity()} title="Recompute the water's opacity from the ground, in the selected area or the whole map">Regen opacity</button>
				</div>
				<div class="row">
					<span class="dim head">Layers</span>
					<label class="check" title="Draw every liquid layer of each chunk; off, only the current layer, so one under another can be seen"><input type="checkbox" bind:checked={editor.water.allLayers} /> All layers</label>
					{#if !editor.water.allLayers}
						<label class="check" title="The layer drawn in each chunk, counted from 0 in the chunk's own order (a chunk holds a layer per liquid)"
							>Layer <input class="num" type="number" min="0" max="7" step="1" bind:value={editor.water.layer} /></label
						>
					{/if}
					<button onclick={() => engineRef.current?.cropWater()} title="Remove the liquid that lies under the ground, in the selected area or the whole map">Crop water</button>
				</div>
			{:else if editor.tool === 'water'}
				<div class="row">
					<span class="dim head">Brush</span>
					{@render editLimit()}
					{@render falloffCurve()}
					{@render brushShape()}
				</div>
			{:else if spawnBrushing}
				{@const sb = prefs.spawnBrush}
				<div class="row">
					<span class="dim head">Creatures</span>
					{#each sb.entries as e, i (e.entry)}
						<span class="chip" title="{e.name} (entry {e.entry}): its weight among the brush's creatures">
							{e.name}
							<input class="weight" type="number" min="0" max="100" step="1" bind:value={e.weight} aria-label="Weight of {e.name}" />
							<button class="x" onclick={() => (sb.entries = sb.entries.filter((_, j) => j !== i))} title="Take {e.name} out of the brush" aria-label="Remove {e.name}">×</button>
						</span>
					{/each}
				</div>
				<div class="row">
					<span class="dim head">Spawn</span>
					<select class="curve" bind:value={sb.movement} title="How the creatures move" aria-label="Movement">
						<option value="random">Wander</option>
						<option value="stay">Stay</option>
					</select>
					{#if sb.movement === 'random'}
						<OptSlider label="Radius" bind:value={sb.wander} min={0} max={40} step={0.5} digits={1} width={50} title="How far each creature wanders from its spawn point, in yards" />
					{/if}
					<select class="curve" bind:value={sb.facing} title="Which way each creature faces" aria-label="Facing">
						<option value="random">Face anywhere</option>
						<option value="centre">Face the centre</option>
					</select>
					<OptSlider label="Respawn s" bind:value={sb.respawnSecs} min={10} max={3600} step={10} digits={0} width={60} title="Respawn time in seconds" />
				</div>
				<div class="row">
					<span class="dim head">Level</span>
					<OptSlider label="From" bind:value={sb.levelMin} min={0} max={63} step={1} digits={0} width={40} title="Lowest level, or 0 for the template's own range" />
					<OptSlider label="to" bind:value={sb.levelMax} min={0} max={63} step={1} digits={0} width={40} title="Highest level, or 0 for the template's own range" />
				</div>
				<div class="row">
					<span class="dim head">Ground</span>
					<OptSlider label="Max slope" bind:value={sb.maxSlope} min={0} max={90} step={1} digits={0} width={50} title="No creature on ground steeper than this many degrees (90 allows any)" />
					<label class="check" title="No creature in the sea or a painted liquid"><input type="checkbox" bind:checked={sb.avoidWater} /> Keep out of water</label>
					<button class:active={!rulesEmpty(sb.rules)} onclick={() => (ui.dialog = 'spawnRules')} title="Only on or never on some textures, within a height range, off holes">Rules…</button>
				</div>
			{:else if editor.tool === 'doodad'}
				<div class="row">
					<span class="dim head">Brush</span>
					{@render falloffCurve()}
				</div>
				<div class="row">
					<span class="dim head">Ground</span>
					<label class="check" title="Tilt placed models to the slope under them (instead of each model's random tilt)"><input type="checkbox" bind:checked={editor.followGround} /> Follow ground rotation</label>
					{#if editor.followGround}
						<label class="check" title="Use the slope averaged over the neighbouring cells, not the slope right under the model"><input type="checkbox" bind:checked={editor.followGroundSmooth} /> Smooth</label>
					{/if}
					<OptSlider label="Max slope" bind:value={editor.doodad.maxSlope} min={0} max={90} step={1} digits={0} width={60} title="Put nothing on ground steeper than this many degrees (90 allows any slope)" />
				</div>
				<div class="row">
					<span class="dim head"></span>
					<label class="check" title="Put nothing on ground under the sea level"><input type="checkbox" bind:checked={editor.doodad.avoidWater} /> Keep out of the sea</label>
					<label class="check" title="Let placements land on props under the brush, attached to them as the Place tool attaches (a model on a prop keeps its random tilt)"
						><input type="checkbox" bind:checked={editor.doodad.onProps} /> On props</label
					>
				</div>
			{:else if editor.tool === 'paint'}
				{#if usesBrush}
					<div class="row">
						<span class="dim head">Brush</span>
						{#if editor.paintMode === 'texture' && !editor.paintSpray}
							{@render imageBrush()}
						{/if}
						{@render falloffCurve()}
						{@render brushShape()}
					</div>
				{/if}
				{#if spraying}
					<div class="row">
						<span class="dim head">Spray</span>
						<OptSlider label="Dab size" bind:value={editor.spray.size} min={1} max={40} step={0.5} digits={1} width={60} title="Size of each spray dab" />
						<OptSlider label="Pressure" bind:value={editor.spray.pressure} min={0} max={10} step={0.1} digits={1} width={60} title="How densely the dabs land" />
						<label class="check" title="Also paint the brush's solid centre (inside the falloff)"><input type="checkbox" bind:checked={editor.spray.inner} /> Inner radius</label>
					</div>
				{/if}
				{#if editor.paintMode === 'texture'}
					<div class="row">
						<span class="dim head">Show</span>
						<label class="check" title="Tint red the chunks that already hold four other textures, where this texture can't be painted"><input type="checkbox" bind:checked={prefs.showUnpaintable} /> Unpaintable chunks</label>
					</div>
				{:else if editor.paintMode === 'mask'}
					{@const ms = editor.maskSelect}
					<div class="row">
						<span class="dim head">Mask</span>
						<select class="curve" value="" onchange={modifyMask} title="Change the whole mask (also in the Terrain menu)" aria-label="Modify mask">
							<option value="" disabled>Modify mask…</option>
							<option value="grow" disabled={!ui.maskActive}>Grow by {ms.step} yd</option>
							<option value="shrink" disabled={!ui.maskActive}>Shrink by {ms.step} yd</option>
							<option value="feather" disabled={!ui.maskActive}>Feather over {ms.step} yd</option>
							<option value="invert">Invert</option>
							<option value="clear" disabled={!ui.maskActive}>Clear</option>
						</select>
						<OptSlider label="By" bind:value={ms.step} min={0.5} max={32} step={0.5} digits={1} width={50} title="How many yards Grow, Shrink and Feather change the mask by" />
					</div>
				{/if}
			{/if}
		</div>
	{/if}
	{#if brushOpen && editor.tool === 'sculpt' && !vertexMode}
		<div class="brushpanel" bind:this={brushPanel} style:left="{brushLeft}px" role="group" aria-label="Brush settings">
			<div class="row">
				<span class="dim head">Brush</span>
				{#if !holeMode}
					{@render editLimit()}
					{@render imageBrush()}
				{/if}
				{@render falloffCurve()}
				{#if !holeMode}
					{@render brushShape()}
				{/if}
			</div>
			{#if editor.sculptMode === 'flatten'}
				<div class="row">
					<span class="dim head">Flatten</span>
					<select class="curve" bind:value={editor.flattenTarget} disabled={editor.flattenLock.on} title="Height to flatten to (the lock sets it while on)" aria-label="Flatten target">
						<option value="origin">To clicked height</option>
						<option value="average">To average height</option>
					</select>
					<select class="curve" bind:value={editor.flattenDir} title="Which way ground moves toward the target" aria-label="Flatten direction">
						<option value="both">Raise and lower</option>
						<option value="raise">Raise only</option>
						<option value="lower">Lower only</option>
					</select>
					<label class="check" title="Level to a plane through the stroke's start (or the locked point) instead of one height"><input type="checkbox" bind:checked={editor.flattenAngled.on} /> Angled</label>
					{#if editor.flattenAngled.on}
						<OptSlider label="Angle" bind:value={editor.flattenAngled.angle} min={-89} max={89} step={0.5} digits={1} width={70} title="How steeply the plane rises, in degrees" />
						<OptSlider label="Direction" bind:value={editor.flattenAngled.orientation} min={0} max={360} step={1} digits={0} width={70} title="Direction the plane rises toward, in degrees (0 is east, 90 south)" />
					{/if}
				</div>
			{/if}
			{#if editor.sculptMode === 'terrace'}
				<div class="row">
					<span class="dim head">Terrace</span>
					<OptSlider label="Offset" bind:value={editor.terrace.offset} min={-50} max={50} step={0.1} digits={1} width={70} title="The height a level sits at, so the steps line up with the sea or a chosen height" />
				</div>
			{/if}
			{#if !holeMode}
				<div class="row">
					<span class="dim head">Paint</span>
					<select
						class="curve"
						bind:value={editor.sculptPaint}
						title="Also paint the ground the brush shapes: one texture, or the map's rock on the steep ground and its dirt on the slopes below it, as a raised hill was painted while it was raised"
						aria-label="Paint while sculpting"
					>
						<option value="off">Off</option>
						<option value="slope">Rock and dirt by slope</option>
						<option value="texture">One texture</option>
					</select>
					{#if editor.sculptPaint === 'texture'}
						<button
							class="chip"
							onclick={() => {
								ui.palette = 'textures'
								prefs.browserCollapsed = false
							}}
							title="The texture sculpting paints (pick one in the asset browser below)"
						>
							<span class="dim">Texture:</span>
							{sculptTex ? texName(sculptTex) : 'pick one below'}
						</button>
					{:else if editor.sculptPaint === 'slope'}
						<button class="chip" onclick={() => (ui.dialog = 'mapProps')} title="The map's rock and dirt textures (File › Map Properties)">
							<span class="dim">Rock:</span>
							{editor.roles.rock >= 0 ? texName(editor.palette[editor.roles.rock] ?? '') : 'none'}
							<span class="dim">· Dirt:</span>
							{editor.roles.dirt >= 0 ? texName(editor.palette[editor.roles.dirt] ?? '') : 'none'}
						</button>
					{/if}
				</div>
				{#if editor.sculptPaint === 'slope'}
					<div class="row">
						<span class="dim head"></span>
						<OptSlider label="Rock from" bind:value={editor.slopePaint.rockDeg} min={10} max={80} step={1} digits={0} width={60} title="Ground steeper than this many degrees is painted rock" />
						<OptSlider
							label="Dirt from"
							bind:value={editor.slopePaint.dirtDeg}
							min={0}
							max={70}
							step={1}
							digits={0}
							width={60}
							title="Ground steeper than this many degrees, up to the rock, is painted dirt: the rim at a mountain's foot"
						/>
						<label
							class="check"
							title="Ground gentler than the dirt gets each chunk's base (first) texture back, so lowering a hill takes its rock away too. Off by default, since it also paints over roads and details under the brush."
						>
							<input type="checkbox" bind:checked={editor.slopePaint.restoreBase} /> Restore base
						</label>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
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
	/* The settings panel (Sculpt's Brush, Water, Placement, Spawns): rows of controls under its button, over the viewport. */
	.brushpanel {
		position: absolute;
		top: 34px;
		z-index: 47;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 10px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 0 0 var(--radius) var(--radius);
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.45);
		white-space: nowrap;
	}
	.brushpanel .row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.brushpanel .head {
		width: 56px;
	}
	.brushbtn.painting {
		color: var(--accent-text);
	}
	.seg.icons button {
		display: grid;
		place-items: center;
		padding: 2px 4px;
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
	.warn {
		color: var(--danger-text);
		white-space: nowrap;
	}
	.weight {
		width: 38px;
		padding: 0 3px;
		font: 11px var(--mono);
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
	.area {
		width: 240px;
		flex: none;
	}
	.num {
		width: 70px;
	}
</style>
