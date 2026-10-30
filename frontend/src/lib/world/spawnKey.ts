/** A spawn's key: its kind and guid, unique within a region. Its own module, so a tool window's page (#910) has it without SpawnLayer and three.js. */
export const spawnKey = (s: { kind: string; guid: number }) => `${s.kind}/${s.guid}`
