// What the History window shows (components/HistoryList.svelte), in the page or in its own OS window
// (#909): the main page builds it from the active map's undo stack and publishes it on the channel.
import type { HistoryStep } from '../state/historyCore'

/** The tool window kind of the History window (app_toolwindows.go's toolWindowKinds). */
export const HISTORY_KIND = 'history'

export interface HistoryView {
	/** The steps, oldest first. */
	steps: HistoryStep[]
	/** How many are done; the ones after are what Redo brings back. */
	position: number
	/** What the steps hold together (#444). */
	bytes: number
	/** Whether older steps were dropped for the step or byte limit. */
	trimmed: boolean
}

/** The part of a map's undo stack (historyCore.ts) the view reads. */
export interface HistorySource {
	steps(): HistoryStep[]
	readonly position: number
	readonly bytes: number
	readonly trimmed: boolean
}

/** The view of `h`, a plain object that goes over the channel as JSON; the empty view with no map open. */
export function historyView(h: HistorySource | null | undefined): HistoryView {
	if (!h) return { steps: [], position: 0, bytes: 0, trimmed: false }
	return { steps: h.steps().map((s) => ({ label: s.label, at: s.at })), position: h.position, bytes: h.bytes, trimmed: h.trimmed }
}

/** The History window's command to the main page: go to a step (0 undoes every one). */
export type HistoryCommand = { type: 'go'; to: number }

/** The step a `go` command asks for, kept to the stack (0 to `count`), or null if it isn't one. */
export function goTarget(cmd: { type: string; to?: unknown }, count: number): number | null {
	if (cmd.type !== 'go' || typeof cmd.to !== 'number' || !Number.isInteger(cmd.to)) return null
	return Math.max(0, Math.min(count, cmd.to))
}
