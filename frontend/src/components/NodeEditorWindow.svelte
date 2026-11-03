<script lang="ts">
	import { tick } from 'svelte'
	import { DeleteGraph, ListGraphs, SaveGraph } from '../lib/wails/App'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { askConfirm } from '../lib/state/confirm'
	import { hasBackend } from '../lib/io/backend'
	import { toCss } from '../lib/ui/uiScale'
	import {
		addNode,
		canLink,
		CATEGORIES,
		compileGraph,
		connect,
		errorNode,
		GraphError,
		linkable,
		NODE_HEAD,
		NODE_ROW,
		NODE_SPECS,
		NODE_W,
		nodeRows,
		nodeSpec,
		parseGraph,
		pinPos,
		removeNode,
		serializeGraph,
		starterGraph,
		type Graph,
		type GraphNode,
		type NodeSpec,
		type PinSpec,
		type PinType,
		type Value,
	} from '../lib/script/nodeGraph'

	// The floating Node Editor (#30, Tools › Node Editor): visual scripts as graphs of nodes over the map's
	// terrain, chunks, textures and models (lib/script/nodeGraph.ts), kept as .mgraph files in the scripts
	// folder beside the Lua scripts. Run compiles the graph to Lua and runs it as the Scripts window runs a
	// script (Engine.runScript): one undo step, the same API and time limit. The canvas pans with a drag on
	// its background, zooms with the wheel; a right-click (or Add Node) offers the nodes, a drag from a
	// pin links it, Delete removes the selected node or link. It stays mounted while closed, as the
	// Scripts window does, so an unsaved graph survives closing it.

	const fresh = () => starterGraph()

	let files = $state<{ name: string; text: string }[]>([])
	/** The file the editor holds, or null for a graph not saved yet. */
	let current = $state<string | null>(null)
	let name = $state('hill')
	let graph = $state<Graph>(fresh())
	/** The graph's file text as last loaded or saved, to tell unsaved changes. */
	let saved = $state(serializeGraph(starterGraph()))
	const dirty = $derived(serializeGraph(graph) !== saved)
	let running = $state(false)

	// The view: world (graph) position = (canvas position - pan) / zoom.
	let panX = $state(20)
	let panY = $state(20)
	let zoom = $state(1)
	let canvasEl = $state<HTMLDivElement>()

	let selectedNode = $state<number | null>(null)
	let selectedLink = $state<number | null>(null)
	/** The node the last compile or run failed at. */
	let badNode = $state<number | null>(null)
	let showLua = $state(false)

	let lines = $state<{ text: string; kind: 'out' | 'err' | 'info' }[]>([])
	let outEl = $state<HTMLDivElement>()
	const say = (text: string, kind: 'out' | 'err' | 'info') => {
		lines.push({ text, kind })
		if (lines.length > 500) lines.splice(0, lines.length - 500)
	}

	/** The wire being dragged from a pin, in world coordinates; `side` is the end it started from. */
	let wire = $state<{ node: number; side: 'in' | 'out'; pin: string; type: PinType; x1: number; y1: number; x2: number; y2: number } | null>(null)

	/** The Add Node menu: where it shows on the canvas, where the node goes, and a wire waiting for it. */
	let menu = $state<{ x: number; y: number; wx: number; wy: number; filter: string; pending: { node: number; side: 'in' | 'out'; pin: string; type: PinType } | null } | null>(null)
	let menuInput = $state<HTMLInputElement>()

	const specOf = (n: GraphNode) => nodeSpec(n.type) as NodeSpec
	const widthOf = (spec: NodeSpec) => spec.width ?? NODE_W

	const lua = $derived.by(() => {
		if (!showLua) return ''
		try {
			return compileGraph($state.snapshot(graph) as Graph, name || 'graph').lua
		} catch (e) {
			return `-- ${e instanceof Error ? e.message : String(e)}`
		}
	})

	async function refresh() {
		if (!hasBackend()) return
		try {
			files = (await ListGraphs()) ?? []
		} catch (e) {
			setStatus(`The graphs could not be read: ${e}`, 8000)
		}
	}

	$effect(() => {
		if (ui.nodeEditor) void refresh()
	})

	const baseName = (file: string) => file.replace(/\.mgraph$/i, '')

	async function leave(): Promise<boolean> {
		return !dirty || (await askConfirm(`Drop the unsaved changes to ${name}?`, { title: 'Unsaved graph', ok: 'Drop' }))
	}

	/** Puts the graph's top-left node near the canvas's top-left, at zoom 1. */
	/** Fits the whole graph in the canvas, at most at zoom 1. */
	function frame() {
		if (!graph.nodes.length) {
			zoom = 1
			panX = panY = 20
			return
		}
		const x0 = Math.min(...graph.nodes.map((n) => n.x))
		const y0 = Math.min(...graph.nodes.map((n) => n.y))
		const x1 = Math.max(...graph.nodes.map((n) => n.x + widthOf(specOf(n))))
		const y1 = Math.max(...graph.nodes.map((n) => n.y + NODE_HEAD + nodeRows(specOf(n)) * NODE_ROW))
		// clientWidth is in the page's CSS px, as the graph is.
		const w = canvasEl?.clientWidth || 900
		const h = canvasEl?.clientHeight || 500
		zoom = Math.max(0.3, Math.min(1, (w - 40) / (x1 - x0), (h - 50) / (y1 - y0)))
		panX = 20 - x0 * zoom
		panY = 20 - y0 * zoom
	}

	// The first time the window opens, the starter graph is fitted to it.
	let framed = false
	$effect(() => {
		if (ui.nodeEditor && canvasEl && !framed) {
			framed = true
			frame()
		}
	})

	// The canvas's own undo: snapshots (serializeGraph) of the graph before each change, kept apart from the map's History (a graph is not part of the map).
	const UNDO_CAP = 100
	let undoStack: string[] = []
	let redoStack: string[] = []

	/** Remember `before` (the graph taken ahead of a change) as an undo step, if the graph is no longer that. */
	function commit(before: string) {
		if (serializeGraph(graph) === before) return
		undoStack.push(before)
		if (undoStack.length > UNDO_CAP) undoStack.shift()
		redoStack = []
	}

	function restore(text: string) {
		graph = parseGraph(text).graph
		selectedNode = selectedLink = badNode = null
		menu = null
		frame()
	}

	function undo() {
		const t = undoStack.pop()
		if (t === undefined) return
		redoStack.push(serializeGraph(graph))
		restore(t)
	}

	function redo() {
		const t = redoStack.pop()
		if (t === undefined) return
		undoStack.push(serializeGraph(graph))
		restore(t)
	}

	function load(g: Graph, text: string) {
		undoStack = []
		redoStack = []
		graph = g
		saved = text
		selectedNode = selectedLink = badNode = null
		lines = []
		frame()
	}

	async function open(file: string) {
		if (file === current || !(await leave())) return
		const f = files.find((x) => x.name === file)
		if (!f) return
		try {
			const { graph: g, dropped } = parseGraph(f.text)
			current = f.name
			name = baseName(f.name)
			load(g, serializeGraph(g))
			if (dropped.length) say(`Left out nodes this Meld doesn’t have: ${[...new Set(dropped)].join(', ')}.`, 'err')
		} catch (e) {
			setStatus(`${f.name} could not be read: ${e instanceof Error ? e.message : e}`, 8000)
		}
	}

	async function newGraph() {
		if (!(await leave())) return
		current = null
		name = 'untitled'
		const g = fresh()
		load(g, serializeGraph(g))
	}

	async function save() {
		if (!hasBackend()) {
			setStatus('Saving graphs needs the desktop app.')
			return
		}
		try {
			const text = serializeGraph(graph)
			const file = await SaveGraph(name, text)
			current = file
			name = baseName(file)
			saved = text
			await refresh()
			setStatus(`Saved ${file} in the scripts folder.`, 3000)
		} catch (e) {
			setStatus(`The graph could not be saved: ${e}`, 8000)
		}
	}

	async function remove() {
		if (!current || !(await askConfirm(`Delete ${current} from the scripts folder?`, { title: 'Delete graph', ok: 'Delete' }))) return
		try {
			await DeleteGraph(current)
			current = null
			saved = ''
			await refresh()
		} catch (e) {
			setStatus(`The graph could not be deleted: ${e}`, 8000)
		}
	}

	$effect(() => {
		void lines.length
		void tick().then(() => outEl?.scrollTo({ top: outEl.scrollHeight }))
	})

	async function run() {
		const e = engineRef.current
		if (!e || running) return
		lines = []
		badNode = null
		const label = name || 'graph'
		let compiled
		try {
			compiled = compileGraph($state.snapshot(graph) as Graph, label)
		} catch (err) {
			if (err instanceof GraphError) {
				badNode = err.node
				say(err.message, 'err')
				setStatus(`${label} can’t run: see the Node Editor.`, 4000)
			} else throw err
			return
		}
		running = true
		let printed = 0
		try {
			const r = await e.runScript(compiled.lua, label, (s) => {
				printed++
				say(s, 'out')
			})
			if (!r) return
			if (!r.ok) {
				say(r.error ?? 'The graph failed.', 'err')
				badNode = errorNode(compiled, label, r.error ?? '')
			} else say(`Ran in ${r.ms.toFixed(0)} ms.`, 'info')
			setStatus(!r.ok ? `${label} failed: see the Node Editor.` : `Ran ${label}${printed ? '' : ' (no output)'}.`, 4000)
		} finally {
			running = false
		}
	}

	// Canvas coordinates.
	function local(ev: { clientX: number; clientY: number }) {
		const r = (canvasEl as HTMLDivElement).getBoundingClientRect()
		return { x: toCss(ev.clientX - r.left), y: toCss(ev.clientY - r.top) }
	}
	function world(ev: { clientX: number; clientY: number }) {
		const p = local(ev)
		return { x: (p.x - panX) / zoom, y: (p.y - panY) / zoom }
	}

	/** A drag: calls `move` with the pointer's travel in CSS px until the button is let go, then `up`. */
	function drag(ev: PointerEvent, move: (dx: number, dy: number, e: PointerEvent) => void, up?: (e: PointerEvent) => void) {
		const el = ev.currentTarget as HTMLElement
		try {
			el.setPointerCapture(ev.pointerId)
		} catch {
			// A pointer that is not down (a probe's made-up event) can't be captured; the drag still follows it.
		}
		const x0 = ev.clientX
		const y0 = ev.clientY
		const onMove = (e: PointerEvent) => move(toCss(e.clientX - x0), toCss(e.clientY - y0), e)
		const onUp = (e: PointerEvent) => {
			el.removeEventListener('pointermove', onMove)
			el.removeEventListener('pointerup', onUp)
			el.removeEventListener('pointercancel', onUp)
			up?.(e)
		}
		el.addEventListener('pointermove', onMove)
		el.addEventListener('pointerup', onUp)
		el.addEventListener('pointercancel', onUp)
	}

	/** Keys go to the canvas once it is clicked, so Delete removes a node rather than the map's selection. */
	const focusCanvas = () => canvasEl?.focus({ preventScroll: true })

	function onCanvasDown(ev: PointerEvent) {
		focusCanvas()
		if (ev.button === 2) return
		if (ev.target !== ev.currentTarget && !(ev.target as Element).closest('.grid')) return
		menu = null
		selectedNode = selectedLink = null
		const px = panX
		const py = panY
		drag(ev, (dx, dy) => {
			panX = px + dx
			panY = py + dy
		})
	}

	function onWheel(ev: WheelEvent) {
		if ((ev.target as Element).closest('.menu')) return
		ev.preventDefault()
		const p = local(ev)
		const z = Math.min(2, Math.max(0.3, zoom * Math.exp(-ev.deltaY * 0.0015)))
		// The point under the pointer stays put.
		panX = p.x - ((p.x - panX) * z) / zoom
		panY = p.y - ((p.y - panY) * z) / zoom
		zoom = z
	}

	function onContext(ev: MouseEvent) {
		ev.preventDefault()
		openMenu(ev, null)
	}

	function openMenu(ev: { clientX: number; clientY: number }, pending: NonNullable<typeof menu>['pending']) {
		const p = local(ev)
		const w = world(ev)
		const r = (canvasEl as HTMLDivElement).getBoundingClientRect()
		// Kept inside the canvas.
		const x = Math.max(0, Math.min(p.x, toCss(r.width) - 230))
		const y = Math.max(0, Math.min(p.y, toCss(r.height) - 300))
		menu = { x, y, wx: w.x, wy: w.y, filter: '', pending }
		void tick().then(() => menuInput?.focus())
	}

	function openMenuMiddle() {
		const r = (canvasEl as HTMLDivElement).getBoundingClientRect()
		openMenu({ clientX: r.left + r.width / 3, clientY: r.top + r.height / 4 }, null)
	}

	const menuSpecs = $derived.by(() => {
		if (!menu) return []
		const f = menu.filter.trim().toLowerCase()
		const pend = menu.pending
		return NODE_SPECS.filter((s) => {
			if (f && !s.title.toLowerCase().includes(f) && !s.category.toLowerCase().includes(f)) return false
			if (!pend) return true
			// Only nodes the waiting wire can link to.
			return pend.side === 'out' ? s.inputs.some((p) => linkable(p) && canLink(pend.type, p.type)) : s.outputs.some((p) => canLink(p.type, pend.type))
		})
	})

	function pick(spec: NodeSpec) {
		if (!menu) return
		const before = serializeGraph(graph)
		const n = addNode(graph, spec.type, menu.wx, menu.wy)
		const pend = menu.pending
		if (pend) {
			if (pend.side === 'out') {
				const p = spec.inputs.find((q) => linkable(q) && canLink(pend.type, q.type))
				if (p) connect(graph, pend.node, pend.pin, n.id, p.id)
			} else {
				const p = spec.outputs.find((q) => canLink(q.type, pend.type))
				if (p) connect(graph, n.id, p.id, pend.node, pend.pin)
			}
		}
		selectedNode = n.id
		menu = null
		commit(before)
	}

	function onMenuKey(ev: KeyboardEvent) {
		if (ev.key === 'Escape') {
			ev.stopPropagation()
			menu = null
		} else if (ev.key === 'Enter' && menuSpecs.length) {
			ev.preventDefault()
			pick(menuSpecs[0])
		}
	}

	function onNodeDown(ev: PointerEvent, n: GraphNode) {
		if (ev.button !== 0) return
		ev.stopPropagation()
		focusCanvas()
		menu = null
		selectedNode = n.id
		selectedLink = null
		const x0 = n.x
		const y0 = n.y
		const before = serializeGraph(graph)
		drag(
			ev,
			(dx, dy) => {
				n.x = Math.round(x0 + dx / zoom)
				n.y = Math.round(y0 + dy / zoom)
			},
			() => commit(before),
		)
	}

	function onPinDown(ev: PointerEvent, n: GraphNode, side: 'in' | 'out', p: PinSpec) {
		if (ev.button !== 0) return
		ev.stopPropagation()
		focusCanvas()
		menu = null
		let start = { node: n.id, side, pin: p.id, type: p.type }
		let pickedUp = false
		const before = serializeGraph(graph)
		// Taking hold of a linked input picks up its wire, from the output it came from.
		if (side === 'in') {
			const l = graph.links.find((x) => x.to === n.id && x.in === p.id)
			if (l) {
				graph.links = graph.links.filter((x) => x !== l)
				const src = graph.nodes.find((x) => x.id === l.from)
				const sp = src && specOf(src).outputs.find((q) => q.id === l.out)
				if (src && sp) {
					start = { node: src.id, side: 'out', pin: sp.id, type: sp.type }
					pickedUp = true
				}
			}
		}
		const sn = graph.nodes.find((x) => x.id === start.node) as GraphNode
		const at = pinPos(sn, specOf(sn), start.side, start.pin) ?? { x: 0, y: 0 }
		const w = world(ev)
		wire = { ...start, x1: at.x, y1: at.y, x2: w.x, y2: w.y }
		drag(
			ev,
			(_dx, _dy, e) => {
				if (!wire) return
				const m = world(e)
				wire.x2 = m.x
				wire.y2 = m.y
			},
			(e) => {
				try {
					const w0 = wire
					wire = null
					if (!w0) return
					const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-pin]')
					if (!el) {
						// A wire picked up and let go in the open is unlinked; a new one asks what to link it to.
						if (!pickedUp && canvasEl?.contains(document.elementFromPoint(e.clientX, e.clientY))) openMenu(e, { node: w0.node, side: w0.side, pin: w0.pin, type: w0.type })
						return
					}
					const to = Number(el.dataset.node)
					const toSide = el.dataset.side as 'in' | 'out'
					const toPin = el.dataset.pin as string
					if (toSide === w0.side) return
					const err = w0.side === 'out' ? connect(graph, w0.node, w0.pin, to, toPin) : connect(graph, to, toPin, w0.node, w0.pin)
					if (err) setStatus(err, 4000)
				} finally {
					commit(before)
				}
			},
		)
	}

	function deleteSelected() {
		const before = serializeGraph(graph)
		if (selectedNode !== null) {
			removeNode(graph, selectedNode)
			if (badNode === selectedNode) badNode = null
			selectedNode = null
		} else if (selectedLink !== null) {
			graph.links.splice(selectedLink, 1)
			selectedLink = null
		}
		commit(before)
	}

	function duplicateSelected() {
		const n = graph.nodes.find((x) => x.id === selectedNode)
		if (!n) return
		const before = serializeGraph(graph)
		const c = addNode(graph, n.type, n.x + 24, n.y + 24)
		c.values = { ...$state.snapshot(n.values) }
		selectedNode = c.id
		commit(before)
	}

	function onKey(ev: KeyboardEvent) {
		const k = ev.key.toLowerCase()
		const typing = (ev.target as Element).closest('input, textarea, select')
		const mod = ev.ctrlKey || ev.metaKey
		if (mod && k === 'enter') void run()
		else if (mod && k === 's') void save()
		else if (typing) return
		else if (mod && k === 'z') (ev.shiftKey ? redo : undo)()
		else if (mod && k === 'y') redo()
		else if (k === 'delete' || k === 'backspace') deleteSelected()
		else if (mod && k === 'd') duplicateSelected()
		else return
		// Kept from the map's own keys (App.svelte): Delete there removes the selected models.
		ev.preventDefault()
		ev.stopPropagation()
	}

	/** The value an input field shows: its node's, or the default. */
	const valueOf = (n: GraphNode, p: PinSpec): Value => n.values[p.id] ?? p.def ?? ''

	function setValue(n: GraphNode, p: PinSpec, raw: string | boolean) {
		const before = serializeGraph(graph)
		assignValue(n, p, raw)
		commit(before)
	}

	function assignValue(n: GraphNode, p: PinSpec, raw: string | boolean) {
		if (typeof raw === 'boolean') n.values[p.id] = raw
		else if (p.type === 'number') {
			const v = Number(raw)
			n.values[p.id] = Number.isFinite(v) ? v : 0
		} else if (p.type === 'any' && /^-?\d+(\.\d+)?$/.test(raw.trim())) n.values[p.id] = Number(raw)
		else n.values[p.id] = raw
	}

	const isLinked = (n: GraphNode, p: PinSpec) => graph.links.some((l) => l.to === n.id && l.in === p.id)

	/** A wire's path: a curve leaving the output rightwards and reaching the input from the left. */
	function curve(x1: number, y1: number, x2: number, y2: number): string {
		const d = Math.max(40, Math.abs(x2 - x1) / 2)
		return `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`
	}

	const wires = $derived.by(() =>
		graph.links.map((l, i) => {
			const a = graph.nodes.find((n) => n.id === l.from)
			const b = graph.nodes.find((n) => n.id === l.to)
			const pa = a && pinPos(a, specOf(a), 'out', l.out)
			const pb = b && pinPos(b, specOf(b), 'in', l.in)
			const type = (a && specOf(a).outputs.find((p) => p.id === l.out)?.type) ?? 'any'
			return pa && pb ? { i, d: curve(pa.x, pa.y, pb.x, pb.y), type } : null
		}),
	)

	const byCategory = $derived(CATEGORIES.map((c) => ({ c, specs: menuSpecs.filter((s) => s.category === c) })).filter((g) => g.specs.length))
</script>

{#if ui.nodeEditor}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside class="nodes" aria-label="Node Editor" onkeydown={onKey}>
		<header>
			<span>Node Editor</span>
			<span class="sub">graphs run as Lua · Noggit Red’s script API</span>
			<button class="close" onclick={() => (ui.nodeEditor = false)} title="Close" aria-label="Close the node editor">✕</button>
		</header>
		<div class="body">
			<nav>
				<button class="new" onclick={newGraph} title="Start a new graph">New graph</button>
				<ul>
					{#each files as f (f.name)}
						<li><button class:current={f.name === current} onclick={() => open(f.name)} title={f.name}>{baseName(f.name)}</button></li>
					{/each}
				</ul>
				{#if hasBackend() && !files.length}
					<p class="empty">No graphs saved yet. They are kept as .mgraph files in the scripts folder.</p>
				{/if}
			</nav>
			<section>
				<div class="bar">
					<input class="name" bind:value={name} aria-label="Graph name" spellcheck="false" />
					{#if dirty}<span class="dirty" title="Not saved">●</span>{/if}
					<button onclick={openMenuMiddle} title="Add a node (or right-click the canvas)">Add Node</button>
					<button class:on={showLua} onclick={() => (showLua = !showLua)} title="Show the Lua the graph compiles to">Lua</button>
					<button onclick={frame} title="Bring the graph back into view">Frame</button>
					<button class="primary" onclick={run} disabled={running} title="Run the graph on the open map (Ctrl+Enter)">{running ? 'Running…' : 'Run'}</button>
					<button onclick={save} disabled={!hasBackend()} title="Save it in the scripts folder (Ctrl+S)">Save</button>
					<button onclick={remove} disabled={!current} title="Delete it from the scripts folder">Delete</button>
				</div>
				<div class="work">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="canvas" bind:this={canvasEl} onpointerdown={onCanvasDown} onwheel={onWheel} oncontextmenu={onContext} role="application" aria-label="Graph" tabindex="-1">
						<div class="grid" style="background-position: {panX}px {panY}px; background-size: {24 * zoom}px {24 * zoom}px"></div>
						<div class="world" style="transform: translate({panX}px, {panY}px) scale({zoom})">
							<svg class="wires" width="1" height="1" aria-hidden="true">
								{#each wires as w (w?.i)}
									{#if w}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<path
											class="hit"
											d={w.d}
											onpointerdown={(e) => {
												e.stopPropagation()
												selectedLink = w.i
												selectedNode = null
											}}
										/>
										<path class="wire t-{w.type}" class:sel={selectedLink === w.i} d={w.d} />
									{/if}
								{/each}
								{#if wire}
									<path class="wire t-{wire.type} live" d={wire.side === 'out' ? curve(wire.x1, wire.y1, wire.x2, wire.y2) : curve(wire.x2, wire.y2, wire.x1, wire.y1)} />
								{/if}
							</svg>
							{#each graph.nodes as n (n.id)}
								{@const spec = specOf(n)}
								<div class="node" class:sel={selectedNode === n.id} class:bad={badNode === n.id} class:flow={!!spec.emit} style="left: {n.x}px; top: {n.y}px; width: {widthOf(spec)}px" data-node-id={n.id}>
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div class="head" style="height: {NODE_HEAD}px" onpointerdown={(e) => onNodeDown(e, n)} title={spec.help}>
										<span class="cat">{spec.category}</span>{spec.title}
									</div>
									{#each { length: nodeRows(spec) } as _, i (i)}
										{@const ip = spec.inputs[i]}
										{@const op = spec.outputs[i]}
										<div class="row" style="height: {NODE_ROW}px">
											<div class="in">
												{#if ip}
													{#if linkable(ip)}
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<span
															class="pin t-{ip.type}"
															class:linked={isLinked(n, ip)}
															data-pin={ip.id}
															data-node={n.id}
															data-side="in"
															onpointerdown={(e) => onPinDown(e, n, 'in', ip)}
															title={ip.label || ip.type}
														></span>
													{/if}
													{#if ip.label}<span class="label">{ip.label}</span>{/if}
													{#if !isLinked(n, ip) && (ip.def !== undefined || ip.options)}
														{#if ip.options}
															<select value={String(valueOf(n, ip))} onchange={(e) => setValue(n, ip, e.currentTarget.value)} onpointerdown={(e) => e.stopPropagation()} aria-label={ip.label}>
																{#each ip.options as o (o)}<option value={o}>{o}</option>{/each}
															</select>
														{:else if ip.type === 'bool'}
															<input
																type="checkbox"
																checked={valueOf(n, ip) === true}
																onchange={(e) => setValue(n, ip, e.currentTarget.checked)}
																onpointerdown={(e) => e.stopPropagation()}
																aria-label={ip.label}
															/>
														{:else if ip.type === 'number'}
															<input
																class="num"
																type="number"
																step="any"
																value={valueOf(n, ip)}
																onchange={(e) => setValue(n, ip, e.currentTarget.value)}
																onpointerdown={(e) => e.stopPropagation()}
																aria-label={ip.label || 'number'}
															/>
														{:else}
															<input
																class="txt"
																type="text"
																value={String(valueOf(n, ip))}
																onchange={(e) => setValue(n, ip, e.currentTarget.value)}
																onpointerdown={(e) => e.stopPropagation()}
																spellcheck="false"
																aria-label={ip.label || 'text'}
															/>
														{/if}
													{/if}
												{/if}
											</div>
											<div class="out">
												{#if op}
													{#if op.label}<span class="label">{op.label}</span>{/if}
													<!-- svelte-ignore a11y_no_static_element_interactions -->
													<span class="pin t-{op.type}" data-pin={op.id} data-node={n.id} data-side="out" onpointerdown={(e) => onPinDown(e, n, 'out', op)} title={op.label || op.type}></span>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/each}
						</div>
						{#if menu}
							<div class="menu" style="left: {menu.x}px; top: {menu.y}px" onpointerdown={(e) => e.stopPropagation()} role="dialog" aria-label="Add a node" tabindex="-1">
								<input bind:this={menuInput} bind:value={menu.filter} onkeydown={onMenuKey} placeholder="Find a node…" spellcheck="false" aria-label="Find a node" />
								<div class="list">
									{#each byCategory as g (g.c)}
										<div class="group">{g.c}</div>
										{#each g.specs as s (s.type)}
											<button onclick={() => pick(s)} title={s.help}>{s.title}</button>
										{/each}
									{/each}
									{#if !byCategory.length}<p class="none">No node fits.</p>{/if}
								</div>
							</div>
						{/if}
						<p class="hint">Right-click to add a node · drag from a pin to link · Delete removes · Ctrl+D copies · the wheel zooms</p>
					</div>
					{#if showLua}
						<pre class="lua" aria-label="The graph as Lua">{lua}</pre>
					{/if}
				</div>
				<div class="output" bind:this={outEl} aria-label="Graph output">
					{#each lines as l, i (i)}<div class={l.kind}>{l.text}</div>{/each}
				</div>
			</section>
		</div>
	</aside>
{/if}

<style>
	.nodes {
		position: fixed;
		top: 84px;
		left: 52px;
		width: min(1120px, calc(100 * var(--vw) - 120px));
		height: min(700px, calc(100 * var(--vh) - 140px));
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: var(--z-window);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
	}
	.sub {
		margin-left: auto;
		font-weight: 400;
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.close:hover {
		color: var(--text);
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	nav {
		width: 150px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--border);
		min-height: 0;
	}
	.new {
		margin: 6px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 4px;
		overflow-y: auto;
		min-height: 0;
	}
	li button {
		display: block;
		width: 100%;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 3px 10px;
		text-align: left;
		font-size: 12px;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	li button:hover {
		background: var(--panel-2);
	}
	li button.current {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.empty {
		margin: 0;
		padding: 4px 10px;
		font-size: 11px;
		color: var(--text-dim);
	}
	section {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.dirty {
		color: var(--text-dim);
		font-size: 10px;
	}
	.bar button.on {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.work {
		flex: 1;
		min-height: 0;
		display: flex;
		margin: 0 8px;
		gap: 6px;
	}
	.canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		background: var(--panel-2);
		border-radius: 4px;
		cursor: grab;
		touch-action: none;
	}
	.grid {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(circle, color-mix(in srgb, var(--text) 14%, transparent) 1px, transparent 1.2px);
	}
	.world {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
	}
	.wires {
		position: absolute;
		left: 0;
		top: 0;
		overflow: visible;
	}
	.wire {
		fill: none;
		stroke-width: 2;
		pointer-events: none;
	}
	.wire.sel {
		stroke-width: 4;
	}
	.wire.live {
		stroke-dasharray: 6 4;
	}
	.hit {
		fill: none;
		stroke: transparent;
		stroke-width: 10;
		cursor: pointer;
		pointer-events: stroke;
	}
	.node {
		position: absolute;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 6px;
		box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
		font-size: 11px;
		cursor: default;
	}
	.node.sel {
		border-color: var(--accent-2);
	}
	.node.bad {
		border-color: var(--danger-text);
		box-shadow: 0 0 0 2px var(--danger-text);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px;
		background: var(--header);
		border-radius: 6px 6px 0 0;
		font-weight: 600;
		cursor: move;
		white-space: nowrap;
		overflow: hidden;
	}
	.node.flow .head {
		background: color-mix(in srgb, var(--accent) 35%, var(--header));
	}
	.cat {
		font-weight: 400;
		font-size: 9px;
		color: var(--text-dim);
		text-transform: uppercase;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
	}
	.in,
	.out {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		position: relative;
	}
	.in {
		flex: 1;
		padding-left: 9px;
	}
	.out {
		justify-content: flex-end;
		padding-right: 9px;
	}
	.label {
		color: var(--text-dim);
		white-space: nowrap;
	}
	.pin {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 10px;
		margin-top: -5px;
		border-radius: 50%;
		border: 2px solid var(--pin);
		background: var(--panel);
		cursor: crosshair;
	}
	.in .pin {
		left: -6px;
	}
	.out .pin {
		right: -6px;
		background: var(--pin);
	}
	.pin.linked {
		background: var(--pin);
	}
	.pin.t-exec {
		border-radius: 2px;
		transform: rotate(45deg);
	}
	.row input,
	.row select {
		height: 18px;
		padding: 0 4px;
		font-size: 11px;
		min-width: 0;
	}
	.row .num {
		width: 64px;
	}
	.row .txt {
		flex: 1;
	}
	.row select {
		max-width: 96px;
	}
	/* Pin and wire colours by type. */
	.t-exec {
		--pin: var(--text-strong);
		stroke: var(--text-strong);
	}
	.t-number {
		--pin: var(--ok);
		stroke: var(--ok);
	}
	.t-bool {
		--pin: var(--danger);
		stroke: var(--danger);
	}
	.t-text {
		--pin: var(--accent-text);
		stroke: var(--accent-text);
	}
	.t-vec {
		--pin: var(--warn);
		stroke: var(--warn);
	}
	.t-sel {
		--pin: var(--accent-2);
		stroke: var(--accent-2);
	}
	.t-vert {
		--pin: var(--q5);
		stroke: var(--q5);
	}
	.t-model {
		--pin: var(--q4);
		stroke: var(--q4);
	}
	.t-chunk {
		--pin: var(--q2);
		stroke: var(--q2);
	}
	.t-random,
	.t-noise {
		--pin: var(--text-dim);
		stroke: var(--text-dim);
	}
	.t-any {
		--pin: var(--q0);
		stroke: var(--q0);
	}
	.menu {
		position: absolute;
		width: 220px;
		max-height: 300px;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		z-index: 2;
		cursor: default;
	}
	.menu input {
		margin: 6px;
	}
	.list {
		overflow-y: auto;
		min-height: 0;
		padding-bottom: 4px;
	}
	.group {
		padding: 4px 10px 2px;
		font-size: 10px;
		color: var(--text-dim);
		text-transform: uppercase;
	}
	.list button {
		display: block;
		width: 100%;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 2px 16px;
		text-align: left;
		font-size: 12px;
		color: var(--text);
	}
	.list button:hover {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.none {
		margin: 0;
		padding: 4px 10px;
		font-size: 11px;
		color: var(--text-dim);
	}
	.hint {
		position: absolute;
		left: 8px;
		bottom: 4px;
		margin: 0;
		font-size: 10px;
		color: var(--text-dim);
		pointer-events: none;
	}
	.lua {
		width: 340px;
		flex: none;
		margin: 0;
		padding: 6px 8px;
		overflow: auto;
		background: var(--panel-2);
		border-radius: 4px;
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.4;
		tab-size: 4;
		user-select: text;
	}
	.output {
		flex: none;
		height: 90px;
		margin: 6px 8px 8px;
		padding: 4px 6px;
		overflow: auto;
		background: var(--panel-2);
		border-radius: 4px;
		font-family: var(--mono);
		font-size: 11px;
	}
	.output div {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.output .err {
		color: var(--danger-text);
	}
	.output .info {
		color: var(--text-dim);
	}
</style>
