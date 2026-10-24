<script lang="ts">
	// A picture of one cube in the cube palette (#63): its visible faces drawn on a 2D canvas
	// (cubes/palette.ts thumbFaces), redrawn when the cube, the layer's tint or the size changes. Given a
	// clip, it draws that box of cubes instead (a prefab of cubes, #73: clipThumbFaces).
	import { clipThumbFaces, objectColour, thumbFaces } from '../lib/cubes/palette'
	import type { CubeClip } from '../lib/cubes/clip'

	interface Props {
		kind?: number
		shape?: number
		rotation?: number
		layer: number
		/** The picture's side in CSS px. */
		size: number
		/** A box of cubes to draw instead of one cube. */
		clip?: CubeClip | null
		/** An object kind id: its colour is drawn as a mark on the cube's face (an object tile). */
		object?: number | null
	}
	let { kind = 0, shape = 0, rotation = 0, layer, size, clip = null, object = null }: Props = $props()

	let canvas: HTMLCanvasElement | undefined = $state()

	$effect(() => {
		if (!canvas) return
		const ratio = window.devicePixelRatio || 1
		const px = Math.max(1, Math.round(size * ratio))
		canvas.width = px
		canvas.height = px
		const g = canvas.getContext('2d')
		if (!g) return
		g.clearRect(0, 0, px, px)
		g.lineJoin = 'round'
		g.lineWidth = Math.max(1, ratio)
		g.strokeStyle = 'rgba(0,0,0,0.35)'
		for (const f of clip ? clipThumbFaces(clip, layer, px) : thumbFaces(kind, shape, rotation, layer, px)) {
			g.beginPath()
			f.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
			g.closePath()
			g.fillStyle = f.fill
			g.fill()
			g.stroke()
		}
		if (object !== null) {
			// A mark on the cube's +x face (the right one of the three seen), in the object's colour,
			// projected as thumbFaces does.
			const scale = px / 2.3
			const at = (y: number, z: number): [number, number] => [px / 2 + (0.5 - z) * 0.866 * scale, px / 2 + ((0.5 + z) * 0.5 - y) * scale]
			const corners = [at(-0.25, -0.25), at(0.25, -0.25), at(0.25, 0.25), at(-0.25, 0.25)]
			g.beginPath()
			corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
			g.closePath()
			g.fillStyle = objectColour(object)
			g.fill()
			g.stroke()
		}
	})
</script>

<canvas bind:this={canvas} style:width="{size}px" style:height="{size}px" aria-hidden="true"></canvas>

<style>
	canvas {
		display: block;
	}
</style>
