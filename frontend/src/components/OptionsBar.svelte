<script lang="ts">
  import OptSlider from './OptSlider.svelte'
  import { TOOLS } from './Toolbar.svelte'
  import { MAX_BRUSH_RADIUS, editor, prefs, ui, wow, type SculptMode } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { displayName } from '../lib/models/assets'
  import { FALLOFF_CURVES } from '../lib/tools/brush'
  import { LIQUID_TYPES } from '../lib/water/liquids'
  import { activeDoodadBrush, addDoodadBrush } from '../lib/tools/DoodadBrushTool'

  const SCULPT_MODES: Array<{ id: SculptMode; name: string }> = [
    { id: 'raise', name: 'Raise' },
    { id: 'lower', name: 'Lower' },
    { id: 'smooth', name: 'Smooth' },
    { id: 'flatten', name: 'Flatten' },
    { id: 'noise', name: 'Noise' },
    { id: 'mountain', name: 'Mountain' },
    { id: 'crevice', name: 'Crevice' },
    { id: 'vertex', name: 'Vertex' },
    { id: 'hole', name: 'Hole' },
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
      editor.tool === 'paint' ||
      editor.tool === 'road' ||
      editor.tool === 'water' ||
      editor.tool === 'clear' ||
      editor.tool === 'doodad' ||
      (editor.tool === 'place' && editor.placeScatter),
  )
  // The water brush paints whole cells in a circle, so only its size applies; Vertex mode moves the
  // selection at the brush strength and uses nothing else of the brush.
  const paintingWater = $derived(editor.tool === 'water' && editor.waterMode === 'paint')
  const vertexMode = $derived(editor.tool === 'sculpt' && editor.sculptMode === 'vertex')
  const holeMode = $derived(editor.tool === 'sculpt' && editor.sculptMode === 'hole')

  /** Opens the brush editor window, making a brush first when there is none. */
  function editBrush() {
    if (!activeDoodadBrush()) addDoodadBrush()
    ui.brushEditor = true
  }

  /** The bar never shows a scrollbar; the wheel scrolls it sideways when it holds more than fits. */
  function scrollSideways(e: WheelEvent) {
    const el = e.currentTarget as HTMLElement
    if (el.scrollWidth <= el.clientWidth || e.deltaX !== 0) return
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
</script>

{#snippet editLimit()}
  <select class="curve" bind:value={editor.sculptLimit} title="Only change ground above or below the height under the cursor" aria-label="Edit limit">
    <option value="none">Any height</option>
    <option value="above">Only above cursor</option>
    <option value="below">Only below cursor</option>
  </select>
{/snippet}

<div class="options" onwheel={scrollSideways}>
  <div class="tool" title={tool.name}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
      <path d={tool.icon} />
    </svg>
  </div>
  <div class="divider"></div>

  {#if editor.tool === 'sculpt'}
    <div class="seg">
      {#each SCULPT_MODES as m (m.id)}
        <button class:active={editor.sculptMode === m.id} onclick={() => (editor.sculptMode = m.id)}>{m.name}</button>
      {/each}
    </div>
    {#if editor.sculptMode === 'flatten'}
      <select class="curve" bind:value={editor.flattenTarget} title="Height to flatten to" aria-label="Flatten target">
        <option value="origin">To clicked height</option>
        <option value="average">To average height</option>
      </select>
      <select class="curve" bind:value={editor.flattenDir} title="Which way ground moves toward the target" aria-label="Flatten direction">
        <option value="both">Raise and lower</option>
        <option value="raise">Raise only</option>
        <option value="lower">Lower only</option>
      </select>
      <label class="check" title="Level to a plane through the stroke's start instead of one height"><input type="checkbox" bind:checked={editor.flattenAngled.on} /> Angled</label>
      {#if editor.flattenAngled.on}
        <OptSlider label="Angle" bind:value={editor.flattenAngled.angle} min={-89} max={89} step={0.5} digits={1} width={60} title="How steeply the plane rises, in degrees" />
        <OptSlider label="Direction" bind:value={editor.flattenAngled.orientation} min={0} max={360} step={1} digits={0} width={60} title="Direction the plane rises toward, in degrees (0 is east, 90 south)" />
      {/if}
    {/if}
    {#if editor.sculptMode === 'mountain'}
      <OptSlider label="Ridges" bind:value={editor.mountain.ridges} min={0} max={1} step={0.01} digits={2} width={60} title="How much the ridges carve the peak: 0 a smooth hill, 1 all ridges. The whole brush is slope (the falloff curve shapes it) and the ridges scale with the brush." />
    {/if}
    {#if editor.sculptMode === 'crevice'}
      <OptSlider label="Ridge" bind:value={editor.crevice.ridge} min={0} max={2} step={0.05} digits={2} width={60} title="How much of the dug ground is piled onto the sides: 1 keeps the volume, 0 only digs. Falloff sets how wide the ridges are." />
    {/if}
    {#if editor.sculptMode === 'hole'}
      <div class="seg">
        <button class:active={!editor.holeFill} onclick={() => (editor.holeFill = false)} title="Click or drag over a triangle of the ground to cut it out">Cut</button>
        <button class:active={editor.holeFill} onclick={() => (editor.holeFill = true)} title="Click or drag over a cut triangle to put the ground back">Fill</button>
      </div>
      <span class="dim">one triangle at a time · <kbd>Shift</kbd> does the other · select an area for whole-area holes</span>
    {:else if editor.sculptMode === 'vertex'}
      <span class="chip" title="Drag to select vertices, Ctrl or Alt+drag to deselect, Shift+drag to move them up and down"><span class="dim">Selected:</span> {ui.vertexCount}</span>
      <button disabled={!ui.vertexCount} onclick={() => engineRef.current?.vertexAction('flatten')} title="Level the selected vertices at their mean height">Flatten</button>
      <button disabled={!ui.vertexCount} onclick={() => engineRef.current?.vertexAction('clear')}>Clear</button>
      <select class="curve" bind:value={editor.vertexRef} title="Point the slope plane passes through" aria-label="Slope reference">
        <option value="center">Through selection centre</option>
        <option value="cursor">Through cursor</option>
      </select>
      <OptSlider label="Slope" bind:value={editor.vertexAngle} min={-89} max={89} step={1} digits={0} width={70} title="Angle of the plane the selection is laid on, in degrees" />
      <OptSlider label="Direction" bind:value={editor.vertexDir} min={0} max={360} step={1} digits={0} width={70} title="Direction the slope rises toward, in degrees (Space: from the cursor toward the selection centre)" />
    {:else}
      {@render editLimit()}
      <select class="curve" bind:value={editor.sculptPaint} title="Also paint the ground the brush shapes: one texture, or the map's rock on the steep ground and its dirt on the slopes below it, as a raised hill was painted while it was raised" aria-label="Paint while sculpting">
        <option value="off">Paint: off</option>
        <option value="slope">Paint: rock and dirt by slope</option>
        <option value="texture">Paint: one texture</option>
      </select>
      {#if editor.sculptPaint === 'texture'}
        <button class="chip" onclick={() => { ui.palette = 'textures'; prefs.browserCollapsed = false }} title="The texture sculpting paints (pick one in the asset browser below)">
          <span class="dim">Texture:</span>
          {sculptTex ? texName(sculptTex) : 'pick one below'}
        </button>
      {:else if editor.sculptPaint === 'slope'}
        <button class="chip" onclick={() => (ui.dialog = 'mapProps')} title="The map's rock and dirt textures (File › Map Properties)">
          <span class="dim">Rock:</span> {editor.roles.rock >= 0 ? texName(editor.palette[editor.roles.rock] ?? '') : 'none'}
          <span class="dim">· Dirt:</span> {editor.roles.dirt >= 0 ? texName(editor.palette[editor.roles.dirt] ?? '') : 'none'}
        </button>
        <OptSlider label="Rock from" bind:value={editor.slopePaint.rockDeg} min={10} max={80} step={1} digits={0} width={60} title="Ground steeper than this many degrees is painted rock" />
        <OptSlider label="Dirt from" bind:value={editor.slopePaint.dirtDeg} min={0} max={70} step={1} digits={0} width={60} title="Ground steeper than this many degrees, up to the rock, is painted dirt: the rim at a mountain's foot" />
      {/if}
    {/if}
    <div class="divider"></div>
  {:else if editor.tool === 'paint' || editor.tool === 'road'}
    {#if editor.tool === 'paint'}
      <div class="seg">
        <button class:active={editor.paintMode === 'texture'} onclick={() => (editor.paintMode = 'texture')}>Paint</button>
        <button class:active={editor.paintMode === 'swap'} onclick={() => (editor.paintMode = 'swap')} title="Replace the texture under the start of each stroke with the active layer">Swap</button>
        <button class:active={editor.paintMode === 'mask'} onclick={() => (editor.paintMode = 'mask')} title="Paint the mask that Fill mask uses to place the active texture">Mask</button>
      </div>
    {/if}
    <button class="chip" onclick={() => { ui.palette = 'textures'; prefs.browserCollapsed = false }} title="Active texture layer (pick textures in the asset browser below)">
      <span class="dim">Layer {editor.paintLayer + 1}:</span>
      {slotTex ? texName(slotTex) : 'empty'}
    </button>
    {#if editor.tool === 'road'}
      <label class="check"><input type="checkbox" bind:checked={editor.roadFlatten} /> Level terrain</label>
      {@render editLimit()}
    {/if}
    <div class="divider"></div>
  {:else if editor.tool === 'water'}
    <div class="seg">
      <button class:active={editor.waterMode === 'paint'} onclick={() => (editor.waterMode = 'paint')} title="Paint liquid: click adds it, Ctrl+click removes it">Paint water</button>
      <button class:active={editor.waterMode === 'dig'} onclick={() => (editor.waterMode = 'dig')} title="Lower the ground to below the sea level">Dig lake</button>
      <button class:active={editor.waterMode === 'shore'} onclick={() => (editor.waterMode = 'shore')} title="Raise the ground to just above the sea level">Raise shore</button>
    </div>
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
      <label class="check" title="Tilt the surface for flowing rivers"><input type="checkbox" bind:checked={editor.water.angled} /> Angled</label>
      {#if editor.water.angled}
        <OptSlider label="Angle" bind:value={editor.water.angle} min={0} max={89} step={0.5} digits={1} width={60} title="How steeply the surface rises, in degrees" />
        <OptSlider label="Direction" bind:value={editor.water.orientation} min={0} max={360} step={1} digits={0} width={60} title="Direction the surface rises toward, in degrees (0 is east, 90 south). It pivots on the locked point." />
      {/if}
      <label class="check" title="Water already there takes the brush's height too"><input type="checkbox" bind:checked={editor.water.overrideHeight} /> Override height</label>
      <label class="check" title="Painting replaces other liquids under the brush; off, it adds to whichever is there"><input type="checkbox" bind:checked={editor.water.overrideId} /> Override type</label>
      <select class="curve" bind:value={editor.water.opacity} title="How quickly the water turns opaque with depth" aria-label="Opacity">
        <option value="auto">Opacity: auto</option>
        <option value="river">Opacity: river</option>
        <option value="ocean">Opacity: ocean</option>
        <option value="custom">Opacity: custom</option>
      </select>
      {#if editor.water.opacity === 'custom'}
        <OptSlider label="Factor" bind:value={editor.water.customOpacity} min={0} max={1} step={0.001} digits={3} width={60} title="Depth factor: (depth + 1) × factor is the opacity" />
      {/if}
      <label class="check" title="The brush stops on liquid surfaces (and the sea), not just the ground"><input type="checkbox" bind:checked={editor.water.onLiquids} /> On liquids</label>
      <button onclick={() => engineRef.current?.cropWater()} title="Remove the liquid that lies under the ground, in the selected area or the whole map">Crop water</button>
      <button onclick={() => engineRef.current?.regenWaterOpacity()} title="Recompute the water's opacity from the ground, in the selected area or the whole map">Regen opacity</button>
      <span class="dim" title="Ctrl+click removes water. Alt+click locks the height at the cursor."><kbd>Ctrl</kbd> remove · <kbd>Alt</kbd> lock</span>
    {:else}
      <span class="chip" title="The map's sea level, set in File > Map Properties"><span class="dim">Sea level:</span> {editor.waterEnabled ? editor.waterLevel.toFixed(1) : 'off'}</span>
      {@render editLimit()}
    {/if}
    <div class="divider"></div>
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
    <label class="check"><input type="checkbox" bind:checked={editor.placeScatter} /> Scatter</label>
    {#if ui.placeCreature || ui.placeObject}
      <span class="chip" title="The creature or object from the browser's spawn tabs that a click places (Esc stops)">
        <span class="dim">Placing:</span> {ui.placeCreature?.name ?? ui.placeObject?.name}
        <button class="x" onclick={() => (ui.placeCreature = ui.placeObject = null)} title="Stop placing it" aria-label="Stop placing">×</button>
      </span>
    {/if}
    <span class="chip" title="Height above the surface for new placements (PgUp / PgDn)">
      <span class="dim">Height:</span> {editor.placeHeight >= 0 ? '+' : ''}{editor.placeHeight.toFixed(2)}
    </span>
    {#if editor.placeHeight !== 0}
      <button onclick={() => (editor.placeHeight = 0)}>Reset</button>
    {/if}
    {#if editor.placeOffset.x !== 0 || editor.placeOffset.z !== 0}
      <span class="chip" title="New placements sit this far from the cursor (arrow keys)">
        <span class="dim">Offset:</span> {Math.hypot(editor.placeOffset.x, editor.placeOffset.z).toFixed(2)}
      </span>
      <button onclick={() => (editor.placeOffset = { x: 0, z: 0 })}>Reset</button>
    {/if}
    <span class="dim"><kbd>Ctrl</kbd>+scroll rotate · <kbd>Shift</kbd>+scroll scale · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> height · <kbd>←↑↓→</kbd> offset from the cursor · <kbd>R</kbd> spin · props attach to what they're placed on</span>
    {#if editor.selected}
      <span class="dim">Placed object selected: <kbd>←↑↓→</kbd> move · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> height · <kbd>R</kbd> spin · <kbd>Esc</kbd> deselect</span>
    {/if}
    <div class="divider"></div>
  {:else if editor.tool === 'doodad'}
    <select class="curve" value={activeDoodadBrush()?.name ?? ''} onchange={(e) => (prefs.doodadBrush = (e.target as HTMLSelectElement).value)} disabled={!prefs.doodadBrushes.length} title="The brush to paint with" aria-label="Doodad brush">
      {#if !prefs.doodadBrushes.length}<option value="">No brushes yet</option>{/if}
      {#each prefs.doodadBrushes as b (b.name)}
        <option value={b.name}>{b.name} ({b.entries.length})</option>
      {/each}
    </select>
    <button onclick={editBrush} title="Open the brush editor: the brush's models, weights, scale, sink and tilt">
      {activeDoodadBrush() ? 'Edit brush…' : 'New brush…'}
    </button>
    <label class="check"><input type="checkbox" bind:checked={editor.doodad.randomRot} /> Random rotation</label>
    <label class="check" title="Tilt placed models to the slope under them (instead of each model's random tilt)"><input type="checkbox" bind:checked={editor.followGround} /> Follow ground rotation</label>
    {#if editor.followGround}
      <label class="check" title="Use the slope averaged over the neighbouring cells, not the slope right under the model"><input type="checkbox" bind:checked={editor.followGroundSmooth} /> Smooth</label>
    {/if}
    <label class="check" title="Put nothing on ground under the sea level"><input type="checkbox" bind:checked={editor.doodad.avoidWater} /> Keep out of the sea</label>
    <OptSlider label="Max slope" bind:value={editor.doodad.maxSlope} min={0} max={90} step={1} digits={0} width={60} title="Put nothing on ground steeper than this many degrees (90 allows any slope)" />
    <label class="check" title="Let placements land on props under the brush, attached to them as the Place tool attaches (a model on a prop keeps its random tilt)"><input type="checkbox" bind:checked={editor.doodad.onProps} /> On props</label>
    <span class="dim">drag to scatter · <kbd>Ctrl</kbd>+scroll / <kbd>R</kbd> spin the preview · <kbd>Shift</kbd> ignores the spacing so models stack · <kbd>Ctrl</kbd>+drag erases the brush's models · a model picked in the browser below joins the brush</span>
    <div class="divider"></div>
  {:else if editor.tool === 'select'}
    {#if ui.pasting}
      {#if engineRef.current?.pastingModels()}
        <span class="chip"><span class="dim">Pasting models</span></span>
        <span class="dim">Click where the copies should stand.</span>
      {:else}
        <span class="chip"><span class="dim">Pasting</span></span>
        <label class="check"><input type="checkbox" bind:checked={editor.paste.terrain} /> Terrain</label>
        <label class="check"><input type="checkbox" bind:checked={editor.paste.textures} /> Textures</label>
        <label class="check"><input type="checkbox" bind:checked={editor.paste.objects} /> Objects</label>
        <OptSlider label="Blend edges" bind:value={editor.paste.blend} min={0} max={8} step={1} digits={0} width={60} title="Cells over which the paste fades into the map" />
        <OptSlider label="Height" bind:value={editor.paste.heightOffset} min={-60} max={60} step={0.5} digits={1} width={70} title="Raise/lower the pasted terrain (PgUp/PgDn)" />
      {/if}
      <button onclick={() => engineRef.current?.commitPaste()}>Place <kbd>Enter</kbd></button>
      <button onclick={() => engineRef.current?.cancelPaste()}>Cancel <kbd>Esc</kbd></button>
    {:else}
      {@const count = editor.selectedIds.length}
      {#if editor.selected && count <= 1}
        <span class="chip"><span class="dim">Selected:</span> {displayName(editor.selected.type)}</span>
        <label class="check" title="Dragging the model moves it along the ground (and onto buildings) under the cursor; off, it slides across a level plane at its own height"><input type="checkbox" bind:checked={editor.moveFollowCursor} /> Follow cursor on the ground</label>
      {:else if count > 1}
        <span class="chip"><span class="dim">Selected:</span> {count} objects</span>
        <label class="check" title="Dragging the group sets each model on the ground where it lands (its height above it kept); off, every model keeps its height"><input type="checkbox" bind:checked={editor.moveSnapGroup} /> Snap models to the ground</label>
        <label class="check" title="R, Alt+arrows and the gizmo ring turn the group about the mean of its positions, so it keeps its shape; off, each model turns about its own origin"><input type="checkbox" bind:checked={editor.rotatePivot} /> Rotate around pivot point</label>
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
      {#if count}
        <span class="dim"><kbd>←↑↓→</kbd> move · <kbd>Alt+↑↓</kbd> height · <kbd>Alt+←→</kbd>/<kbd>R</kbd> spin · <kbd>Shift</kbd> bigger steps · drag to move · handles: ring spins, arrow raises, knob resizes</span>
      {:else}
        <span class="dim">Click a model to select it (<kbd>Shift</kbd> adds). Drag on the ground to select an area and the models in it. <kbd>Alt</kbd>+click picks a model or texture.</span>
      {/if}
    {/if}
  {/if}

  {#if usesBrush && editor.tool !== 'place' && editor.tool !== 'doodad' && !paintingWater && !vertexMode && !holeMode}
    <div class="seg" title="Brush shape">
      <button class:active={editor.brush.shape === 'circle'} onclick={() => (editor.brush.shape = 'circle')} aria-label="Round brush">●</button>
      <button class:active={editor.brush.shape === 'square'} onclick={() => (editor.brush.shape = 'square')} aria-label="Square brush">■</button>
    </div>
    {#if editor.brush.shape === 'square'}
      <label class="check" title="Align square brushes to the terrain grid"><input type="checkbox" bind:checked={editor.brush.snap} /> Snap to grid</label>
    {/if}
  {/if}
  {#if usesBrush}
    {#if !vertexMode}
      <OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={MAX_BRUSH_RADIUS} step={0.5} digits={1} title="Brush radius ( [ / ] )" />
    {/if}
    {#if !paintingWater}
      <OptSlider label="Strength" bind:value={editor.brush.strength} min={0.02} max={editor.tool === 'sculpt' ? 10 : 1} step={0.01} digits={2} title={vertexMode ? 'How fast Shift+drag moves the selected vertices' : editor.tool === 'sculpt' ? 'How fast the ground moves: up to ten times the normal speed, for big mountains' : undefined} />
    {/if}
    {#if editor.tool !== 'road' && editor.tool !== 'place' && !paintingWater && !vertexMode}
      <OptSlider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} digits={2} />
      <select class="curve" bind:value={editor.brush.curve} title="How the brush weight falls off across the falloff band" aria-label="Falloff curve">
        {#each FALLOFF_CURVES as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    {/if}
  {/if}
  {#if editor.tool === 'clear'}
    <select class="curve" bind:value={editor.clearMode} title="What the brush erases" aria-label="What to clear">
      <option value="models">Models</option>
      <option value="textures">Textures (to base)</option>
    </select>
  {/if}
  {#if editor.tool === 'paint' && editor.paintMode === 'texture'}
    <label class="check" title="Spray random dabs over the brush instead of painting it solid (T)"><input type="checkbox" bind:checked={editor.paintSpray} /> Spray</label>
    {#if editor.paintSpray}
      <OptSlider label="Dab size" bind:value={editor.spray.size} min={1} max={40} step={0.5} digits={1} width={60} title="Size of each spray dab" />
      <OptSlider label="Pressure" bind:value={editor.spray.pressure} min={0} max={10} step={0.1} digits={1} width={60} title="How densely the dabs land" />
      <label class="check" title="Also paint the brush's solid centre (inside the falloff)"><input type="checkbox" bind:checked={editor.spray.inner} /> Inner radius</label>
    {/if}
  {/if}
  {#if editor.tool === 'paint'}
    <OptSlider label="Tex scale" bind:value={editor.texScale} min={2} max={24} step={0.5} digits={1} width={70} />
  {/if}
</div>

<style>
  .options {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 34px;
    padding: 0 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    /* A scrollbar would add a second row under the bar; the wheel scrolls it instead. */
    scrollbar-width: none;
  }
  .options::-webkit-scrollbar {
    display: none;
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
