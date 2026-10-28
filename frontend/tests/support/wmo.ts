// Shared WMO fixtures for the Bun tests (#612). Not a test file: `bun test` runs only `*.test.ts`.
import type { WmoNavGroup } from '../../src/lib/world/wmoRoom.ts'

/** A WMO group for `WmoNav.groups`: its flags, its box in WoW axes and its run of portal refs, without fogs. */
export function navGroup(flags: number, min: number[], max: number[], refStart = 0, refCount = 0): WmoNavGroup {
	return { flags, min: min as [number, number, number], max: max as [number, number, number], refStart, refCount, fogs: [0, 0, 0, 0], name: '' }
}
