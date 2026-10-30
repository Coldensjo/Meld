// The walkable-ground worker (#508): runs Recast's tile builds (navBuild.ts, runTileJob) off the main
// thread, with its own WASM instance, and gathers each tile's triangles first from its copy of the
// ground, liquids and placed models (navScene.ts, #633). navJobs.ts starts it and posts it jobs and
// scene updates.
import { loadRecast, runTileJob, tileBuffers, type TileBuilder, type TileJob } from './navBuild'
import { NavScene, type GatherJob, type SceneUpdate } from './navScene'

type Request = { id: number; job: TileJob | GatherJob } | { scene: SceneUpdate[] }

// eslint-disable-next-line no-restricted-syntax -- the worker scope, typed without the webworker lib
const scope = self as unknown as {
	onmessage: ((e: MessageEvent<Request>) => void) | null
	postMessage(message: unknown, transfer: Transferable[]): void
}

const builders = new Map<boolean, TileBuilder>()
const scene = new NavScene()

scope.onmessage = (e) => {
	const msg = e.data
	if ('scene' in msg) {
		// Applied as they come, before any job posted after them.
		try {
			for (const u of msg.scene) scene.apply(u)
		} catch (err) {
			scope.postMessage({ id: 0, error: String(err) }, [])
		}
		return
	}
	const { id, job } = msg
	loadRecast()
		.then((r) => {
			const input = 'input' in job ? job.input : scene.gather(job)
			const out = runTileJob(r, builders, { continent: job.continent, tx: job.tx, tz: job.tz, input })
			scope.postMessage({ id, out }, out ? tileBuffers(out) : [])
		})
		.catch((err: unknown) => scope.postMessage({ id, error: String(err) }, []))
}
