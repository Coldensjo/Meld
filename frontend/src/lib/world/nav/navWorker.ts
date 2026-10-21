// The walkable-ground worker (#508): runs Recast's tile builds (navBuild.ts, runTileJob) off the main
// thread, with its own WASM instance. navJobs.ts starts it and posts it jobs.
import { loadRecast, runTileJob, tileBuffers, type TileBuilder, type TileJob } from './navBuild'

interface Request {
	id: number
	job: TileJob
}

const scope = self as unknown as {
	onmessage: ((e: MessageEvent<Request>) => void) | null
	postMessage(message: unknown, transfer: Transferable[]): void
}

const builders = new Map<boolean, TileBuilder>()

scope.onmessage = (e) => {
	const { id, job } = e.data
	loadRecast()
		.then((r) => {
			const out = runTileJob(r, builders, job)
			scope.postMessage({ id, out }, out ? tileBuffers(out) : [])
		})
		.catch((err: unknown) => scope.postMessage({ id, error: String(err) }, []))
}
