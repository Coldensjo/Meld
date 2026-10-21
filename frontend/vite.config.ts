import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte()],
	build: {
		target: 'es2022',
		// Desktop app loading from disk. three.js is most of the start-up bundle and is needed at once,
		// so it gets its own named chunk (fetched in parallel with the app chunk). The five editors and
		// the recast WASM load on first use (App.svelte, navBuild.ts).
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
