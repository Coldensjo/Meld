/**
 * The names of `EngineDebug` (Engine.ts), the engine's private parts the probes may reach through
 * `P.e.debug` (#562). tests/engineDebug.test.ts checks that this is exactly the interface's keys, that
 * every `.debug.<name>` in frontend/probes is one of them, and that no probe reaches one of them on the
 * engine directly.
 */
export const DEBUG_MEMBERS = ['ctx', 'tools', 'rooms', 'env', 'doc', 'persp', 'ndc', 'particles', 'weather', 'spawnLabels', 'clientLights', 'hour', 'setHour', 'menuSeq', 'frame', 'wrapFrame', 'openContextMenu'] as const

export type DebugMember = (typeof DEBUG_MEMBERS)[number]
