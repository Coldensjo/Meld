// The game's NPCs (#99), read from the repository's crates/gameplay/npcs.toml, which the server gives
// them their looks, speed and lines by and the client draws them by. Vite imports the file's text
// (`?raw`), as monsterKinds.ts does monsters.toml, so the build carries it and the editor never falls
// out of step with the game; `make dev` serves it because vite.config.ts adds it to server.fs.allow.

import text from '../../../../../crates/gameplay/npcs.toml?raw'
import { parseNpcLooks, type NpcLook } from './npcs'

/** The game's NPCs, in the file's order. */
export const NPC_LOOKS: readonly NpcLook[] = parseNpcLooks(text)

/** The NPC named `name`, or undefined when the game has none by that name. */
export function npcLook(name: string): NpcLook | undefined {
	return NPC_LOOKS.find((n) => n.name === name)
}
