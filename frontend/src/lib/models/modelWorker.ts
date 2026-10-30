// The model worker (#507): builds a loaded model's bounds tree, LOD and WMO group cull (modelData.ts)
// off the main thread. modelBuild.ts starts it and posts it jobs.
import { buildModelData, transfers, type ModelJob } from './modelData'

interface Request {
	id: number
	job: ModelJob
}

// eslint-disable-next-line no-restricted-syntax -- the worker scope, typed without the webworker lib
const scope = self as unknown as {
	onmessage: ((e: MessageEvent<Request>) => void) | null
	postMessage(message: unknown, transfer: Transferable[]): void
}

scope.onmessage = (e) => {
	const { id, job } = e.data
	buildModelData(job).then(
		(data) => scope.postMessage({ id, data }, transfers(data)),
		(err: unknown) => scope.postMessage({ id, error: String(err) }, []),
	)
}
