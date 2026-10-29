import * as THREE from 'three'
import { ui } from '../state/editor.svelte'
import type { Terrain } from '../terrain/Terrain'
import type { MapDocument } from './MapDocument'
import type { ClientSky, Environment } from './Environment'
import { CloudDome } from './CloudDome'
import { fileFrameOffset } from './MapIdentity'
import { setLiquidLight } from '../water/liquidMaterial'
import { BAND, lightAt, newLightAt, sceneFog, type ClientLights } from '../wow/clientLight'
import { celestialSunDir, lightingSunDir, moonDir, skyWarp, starAlpha, sunDiscScale } from '../wow/dayNight'
import { stormBlend, WEATHER_GRADE } from '../wow/weather'
import { MapLights } from '../wails/App'

/** What ClientLighting needs of the Engine. */
export interface ClientLightingHost {
	/** The active tab, whose place on the map's grid puts the camera among the client's lights. */
	readonly doc: MapDocument
	/** The active tab's ground, whose shader takes the client's light. */
	readonly terrain: Terrain
	/** The sky, the lights and the lighting state the shaders read. */
	readonly env: Environment
	/** The scene, for its fog. */
	readonly scene: THREE.Scene
	/** The 3D view's camera, whose far plane the light's fog is fitted to. */
	readonly persp: THREE.PerspectiveCamera
	/** The camera in use, where the light is taken. */
	readonly camera: THREE.Camera
}

/** One of a map's Light.dbc lights as the minimap's light zones draw it (#26). */
export interface LightZone {
	id: number
	x: number
	z: number
	inner: number
	outer: number
	global: boolean
}

/**
 * Lighting › Client Lighting, out of Engine (#560): the open map's Light.dbc lights read once per map
 * ID, the light at the camera each frame (the sun's and the sky's colours, the fog, the water's colours,
 * the client's sky dome and its clouds), and the lights as zones for the minimap.
 */
export class ClientLighting {
	/** The client's moving cloud layer, drawn while the client's light is on. */
	readonly clouds = new CloudDome()
	/** The open map's lights, null until read (or when the read failed). */
	private clientLights: ClientLights | null = null
	/** The map ID the lights were read for, -1 for none. */
	private lightsMap = -1
	private loading = false
	/** The time the clouds last moved, to advance them by. */
	private cloudsAt = 0
	/** The minimap's light zones, read once per map ID. */
	private zoneLights: { id: number; lights: Promise<LightZone[]> } | null = null
	private lightOut = newLightAt()
	private fogOut = [0, 0]
	private sunDirOut = [0, 1, 0]
	private celestialOut = [0, 1, 0]
	private moonOut = [0, 1, 0]
	private offset = { x: 0, y: 0 }
	private sky: ClientSky = {
		colors: this.lightOut.colors,
		skyAt: BAND.skyTop * 3,
		fogAt: BAND.fog * 3,
		sunAt: BAND.sun * 3,
		warp: 0,
		sunDir: this.celestialOut,
		moonDir: this.moonOut,
		sunScale: 1,
		starAlpha: 0,
	}

	constructor(private host: ClientLightingHost) {}

	/** The open map's lights once read, for the probes. */
	get lights(): ClientLights | null {
		return this.clientLights
	}

	/** Reads the map's lights again (after the light editor saved them). */
	reload() {
		this.lightsMap = -1
		this.clientLights = null
	}

	/** Where the camera is in the tiles' placement frame (yards), which the client's lights are placed in. */
	cameraInFileFrame(): { x: number; y: number; z: number } {
		const cam = this.host.camera.position
		const o = fileFrameOffset(this.host.doc.meta, { x: 0, y: 0 })
		return { x: cam.x + o.x, y: cam.y, z: cam.z + o.y }
	}

	/**
	 * Lights the frame with the client's own light at the camera (wow/clientLight.ts), for map `id` (null
	 * with Client Lighting off or no client): the map's global light with the local lights it is in
	 * blended over it gives the sun's and the sky's light, the fog's colour and distances and the water's
	 * colours, and the client's DayNight tables (wow/dayNight.ts) the sun's direction, which never sets.
	 * The sky dome is the client's too: its five colour stops, warped toward the sun at dawn and dusk where
	 * the light says so. Off, or until the lights are read, the editor's own lighting and sky stay. Returns
	 * whether the client's light is on this frame. `clouds`: whether its cloud layer shows.
	 */
	update(id: number | null, hour: number, time: number, clouds: boolean): boolean {
		const { env, camera } = this.host
		const tu = this.host.terrain.material.uniforms
		tu.clientLit.value = 0
		if (id === null) return this.off(time)
		if (id !== this.lightsMap) {
			this.clientLights = null
			if (!this.loading) {
				this.loading = true
				const want = id
				MapLights(want)
					.then((l) => {
						this.clientLights = l as ClientLights
						this.lightsMap = want
					})
					.catch((err) => {
						console.warn('client lights not read', err)
						this.lightsMap = want
					})
					.finally(() => (this.loading = false))
			}
		}
		const lights = this.clientLights
		const cam = camera.position
		const o = fileFrameOffset(this.host.doc.meta, this.offset)
		const storm = stormBlend(ui.weather, WEATHER_GRADE[ui.weatherGrade])
		const light = this.lightOut
		if (!lights || !lightAt(lights, cam.x + o.x, cam.y, cam.z + o.y, hour, light, storm)) return this.off(time)
		const c = light.colors
		const s = env.state
		const minute = hour * 60
		const sun = lightingSunDir(minute, this.sunDirOut)
		s.keyDir.set(sun[0], sun[1], sun[2])
		const fog = this.host.scene.fog as THREE.Fog | null
		if (fog) {
			const [near, far] = sceneFog(light, this.host.persp.far, this.fogOut)
			// A light with no fog end (two of the client's) fogs everything, as the client does.
			fog.far = Math.max(far, 0.001)
			fog.near = Math.min(near, fog.far - 0.001)
		}
		const sky = this.sky
		celestialSunDir(minute, this.celestialOut)
		moonDir(minute, this.moonOut)
		sky.warp = skyWarp(minute, light.highlightSky)
		sky.sunScale = sunDiscScale(minute)
		sky.starAlpha = starAlpha(minute)
		env.setClientSky(sky, time)
		const dt = Math.min(0.1, Math.max(0, time - this.cloudsAt))
		this.cloudsAt = time
		this.clouds.update(dt, light, minute, this.celestialOut, this.moonOut, cam, clouds, storm)
		s.keyColor.setRGB(c[BAND.diffuse * 3], c[BAND.diffuse * 3 + 1], c[BAND.diffuse * 3 + 2], THREE.SRGBColorSpace)
		s.skyAmbient.setRGB(c[BAND.ambient * 3], c[BAND.ambient * 3 + 1], c[BAND.ambient * 3 + 2], THREE.SRGBColorSpace)
		s.groundAmbient.copy(s.skyAmbient).multiplyScalar(0.5)
		s.horizon.setRGB(c[BAND.fog * 3], c[BAND.fog * 3 + 1], c[BAND.fog * 3 + 2], THREE.SRGBColorSpace)
		env.hemi.color.copy(s.skyAmbient)
		env.hemi.groundColor.copy(s.groundAmbient)
		env.key.color.copy(s.keyColor)
		setLiquidLight(light)
		// The ground takes the rows as the client stores them (gamma), lit per vertex with the sheen.
		tu.clientLit.value = 1
		;(tu.clientAmbient.value as THREE.Vector3).fromArray(c, BAND.ambient * 3)
		;(tu.clientDiffuse.value as THREE.Vector3).fromArray(c, BAND.diffuse * 3)
		;(tu.clientSpecular.value as THREE.Vector3).fromArray(c, BAND.sun * 3)
		return true
	}

	/** The editor's own light and sky this frame, no client clouds. */
	private off(time: number): false {
		setLiquidLight(null)
		this.host.env.setClientSky(null, time)
		this.clouds.hide()
		return false
	}

	/**
	 * Map `id`'s lights as circles in the open block's editor coordinates (a region's lights are in the
	 * whole map's frame, so `offset`, the block's fileFrameOffset, is taken off), read once per map ID.
	 */
	async zones(id: number, offset: { x: number; y: number }): Promise<LightZone[]> {
		if (this.zoneLights?.id !== id) {
			this.zoneLights = {
				id,
				lights: MapLights(id)
					.then((l) => (l?.lights ?? []).map((x) => ({ id: x.id, x: x.x, z: x.z, inner: x.inner, outer: x.outer, global: x.global })))
					.catch((err) => {
						console.warn('map lights not read', err)
						return []
					}),
			}
		}
		const dx = offset.x,
			dz = offset.y
		return (await this.zoneLights.lights).map((l) => ({ ...l, x: l.x - dx, z: l.z - dz }))
	}

	dispose() {
		this.clouds.dispose()
	}
}
