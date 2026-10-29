import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte()],
	// make dev and make dev-page (wails3 dev) give the port, which the app's FRONTEND_DEVSERVER_URL names.
	// IPv4, since Wails' proxy to it dials localhost over IPv4 only, and Vite's localhost may be IPv6 alone.
	server: {
		host: '127.0.0.1',
		port: Number(process.env.WAILS_VITE_PORT) || 9245,
		strictPort: true,
	},
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
