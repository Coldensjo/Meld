// The game's kinds of monster (#91), read from the repository's crates/gameplay/monsters.toml, which
// the server simulates them by and the client draws them by. Vite imports the file's text (`?raw`), so
// the build carries it and the editor never falls out of step with the game; `make dev` serves it
// because vite.config.ts adds that folder to server.fs.allow, as it does the cube textures.

import text from '../../../../../crates/gameplay/monsters.toml?raw'
import { parseMonsterKinds, type MonsterKind } from './monsters'

/** The game's monster kinds, in the file's order. */
export const MONSTER_KINDS: readonly MonsterKind[] = parseMonsterKinds(text)

/** The kind named `name`, or undefined when the game has none by that name. */
export function monsterKind(name: string): MonsterKind | undefined {
	return MONSTER_KINDS.find((k) => k.name === name)
}
