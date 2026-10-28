// The documentation site (VitePress), published to GitHub Pages by .github/workflows/docs.yml.
// Build it with `cd frontend && bun run docs:build`; `bun run docs:dev` serves it with hot reload.
// VitePress is installed in frontend/, so this file imports only types (erased when it is bundled).
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { DefaultTheme, UserConfig } from 'vitepress'

const repo = 'https://github.com/Coldensjo/Meld'

// The pages sit outside frontend/, so their bare imports of Vue find no node_modules above them
// under Bun (Node falls back to VitePress's own copy): resolve them from frontend/. The alias names
// the package's folder, not `require.resolve('vue')`, which is the CommonJS entry: bundled into the
// browser build that left `vue` undefined, so the site never started and no button worked.
const frontend = createRequire(new URL('../../frontend/package.json', import.meta.url))
const vueDir = dirname(frontend.resolve('vue/package.json'))

const config: UserConfig<DefaultTheme.Config> = {
	title: 'Meld',
	description: 'A fast 3D map editor for World of Warcraft 1.12.1',
	base: '/Meld/',
	cleanUrls: true,
	lastUpdated: true,
	// The dev page (http://localhost:34115) is a real link only on the machine running make dev.
	ignoreDeadLinks: 'localhostLinks',
	// The docs mention <placeholders> in plain text, which Vue would read as tags: render HTML as text.
	markdown: { html: false },
	vite: {
		resolve: {
			alias: [
				{ find: /^vue$/, replacement: vueDir },
				{ find: /^vue\/server-renderer$/, replacement: `${vueDir}/server-renderer` },
			],
		},
	},
	themeConfig: {
		nav: [
			{ text: 'Get started', link: '/getting-started' },
			{ text: 'Manual', link: '/MANUAL' },
			{ text: 'Development', link: '/development' },
			{ text: 'Testing', link: '/TESTS' },
		],
		sidebar: [
			{
				text: 'Using Meld',
				items: [
					{ text: 'Getting started', link: '/getting-started' },
					{ text: 'Manual', link: '/MANUAL' },
					{ text: 'Saving, compiling and playing', link: '/guides/saving-and-compiling' },
					{ text: 'Database and client-table authoring', link: '/guides/database-editing' },
					{ text: 'Settings, local data and backups', link: '/guides/settings-and-data' },
					{ text: 'Troubleshooting', link: '/troubleshooting' },
					{ text: 'Benilla as the game client', link: '/BENILLA' },
				],
			},
			{
				text: 'Contributing',
				items: [
					{ text: 'Building and development', link: '/development' },
					{ text: 'Architecture overview', link: '/architecture/' },
					{ text: 'Testing guide', link: '/TESTS' },
				],
			},
			{
				text: 'Architecture',
				collapsed: true,
				items: [
					{ text: 'Terrain and maps', link: '/architecture/terrain' },
					{ text: 'Tools and selection', link: '/architecture/tools' },
					{ text: 'Placed models', link: '/architecture/objects' },
					{ text: 'Water', link: '/architecture/water' },
					{ text: 'Lighting and sky', link: '/architecture/lighting' },
					{ text: 'UI', link: '/architecture/ui' },
					{ text: 'The client and spawns', link: '/architecture/client' },
					{ text: 'Scripting', link: '/architecture/scripting' },
				],
			},
			{
				text: 'Regression checks',
				collapsed: true,
				items: [
					{ text: 'Terrain, water and map data', link: '/tests/terrain' },
					{ text: 'Tools and placing models', link: '/tests/tools' },
					{ text: 'Rendering', link: '/tests/rendering' },
					{ text: 'UI and the window', link: '/tests/ui' },
					{ text: 'Creatures and the database', link: '/tests/spawns' },
					{ text: 'Export, the client and the game', link: '/tests/client' },
					{ text: 'Scripting', link: '/tests/scripting' },
				],
			},
			{
				text: 'Engineering notebooks',
				collapsed: true,
				items: [
					{ text: 'How to use these notes', link: '/reference/' },
					{ text: 'Testing investigations', link: '/reference/testing-notes' },
					{ text: 'Benilla integration', link: '/reference/benilla-notes' },
					{ text: 'Earlier feature inventory', link: '/reference/editor-notes' },
					{ text: 'Design draft', link: '/DESIGN' },
				],
			},
		],
		outline: 'deep',
		search: { provider: 'local' },
		socialLinks: [{ icon: 'github', link: repo }],
		editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
	},
}

export default config
