import { tagRoots } from './tagRoots.mjs'

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
	preprocess: [tagRoots()],
}
