// The File menu's local server group (#857): its header, which says what runs, and which of Start,
// Stop and Restart Server can be picked. Pure, so the unit tests read it without the app.

/** The local server's state, as the ServerStatus binding gives it. */
export interface ServerState {
	available: boolean
	reason: string
	database: boolean
	ownDatabase: boolean
	auth: boolean
	world: boolean
	busy: boolean
}

/** A server control the File menu runs. */
export type ServerAction = 'start' | 'stop' | 'restart'

const ACTING: Record<ServerAction, string> = { start: 'starting…', stop: 'stopping…', restart: 'restarting…' }

/** The group's header: what runs, or why the controls are off. `acting` is the control running now. */
export function serverHeader(s: ServerState | null, acting: ServerAction | '' = ''): string {
	if (acting) return `VMaNGOS server: ${ACTING[acting]}`
	if (!s) return 'VMaNGOS server'
	if (!s.available) return `VMaNGOS server: ${s.reason}`
	if (s.busy) return 'VMaNGOS server: being started or stopped…'
	const parts: Array<[string, boolean]> = [
		[s.database && !s.ownDatabase ? 'database (not the folder’s own)' : 'database', s.database],
		['login', s.auth],
		['world', s.world],
	]
	const up = parts.filter(([, on]) => on).map(([name]) => name)
	const down = parts.filter(([, on]) => !on).map(([name]) => name)
	if (!down.length) return 'VMaNGOS server: running'
	if (!up.length) return 'VMaNGOS server: stopped'
	return `VMaNGOS server: ${up.join(', ')} running; ${down.join(', ')} stopped`
}

/** Which controls can be picked: Start while something is down, Stop while something Meld may stop runs, Restart while anything runs. */
export function serverControls(s: ServerState | null, acting: ServerAction | '' = ''): Record<ServerAction, boolean> {
	if (!s || !s.available || s.busy || acting) return { start: false, stop: false, restart: false }
	const any = s.database || s.auth || s.world
	return {
		start: !(s.database && s.auth && s.world),
		stop: s.auth || s.world || (s.database && s.ownDatabase),
		restart: any,
	}
}
