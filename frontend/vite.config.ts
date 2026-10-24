import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte()],
	// Fixed and apart from the owner's Meld (34115, Vite 5173): wails.json's devServer and frontend:dev:serverUrl name these (3dgame #66).
	// The cube textures are the game's own images in the repository's assets/textures (src/lib/cubes/textures.ts), and the
	// monster kinds and NPCs its crates/gameplay/monsters.toml and npcs.toml (src/lib/cubes/monsterKinds.ts, npcNames.ts), and the props'
	// models its assets/models and their table crates/gameplay/models.toml (src/lib/cubes/propModels.ts), outside this root.
	server: { host: '127.0.0.1', port: 5273, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../../assets/textures', '../../crates/gameplay/monsters.toml', '../../crates/gameplay/npcs.toml', '../../crates/gameplay/models.toml', '../../assets/models'] } },
	build: {
		target: 'es2022',
		// Desktop app loading from disk. three.js is most of the start-up bundle and is needed at once,
		// so it gets its own named chunk (fetched in parallel with the app chunk).
		chunkSizeWarningLimit: 1000,
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: [{ name: 'three', test: /node_modules[\/]three[\/]/ }],
				},
			},
		},
	},
})
