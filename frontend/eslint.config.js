// ESLint over the frontend's TypeScript and Svelte (#606), run by `bun run lint` and `make check`.
// It enforces what CLAUDE.md asks and tsc does not: no explicit `any` (strict only forbids the
// implicit kind), and no `as unknown as` double cast without a reason. Only these rules are on: the
// recommended sets (and the type-aware `no-unsafe-*` rules) are off, as too noisy for this code.
//
// An `as unknown as` that is needed (a worker's `self`, a typed object read as a record) carries
// `// eslint-disable-next-line no-restricted-syntax -- <why>` on the line before it.
// The probes and scripts are plain JavaScript (and the probes are function bodies), so they are not linted.

import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'
import svelteConfig from './svelte.config.js'

const noAny = {
	'@typescript-eslint/no-explicit-any': 'error',
	// Engine.ts already marks the two places it aliases `this` (for a closure's getter).
	'@typescript-eslint/no-this-alias': 'error',
}
const rules = {
	...noAny,
	'no-restricted-syntax': [
		'error',
		{
			selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
			message: 'Avoid `as unknown as`: type the value properly, or say why with an eslint-disable comment.',
		},
	],
}

export default [
	{
		ignores: ['bindings/', 'dist/', 'node_modules/', 'src/lib/wails/App.ts', 'src/lib/wails/models.ts', 'src/lib/wails/models/', 'probes/', 'scripts/'],
	},
	{
		linterOptions: { reportUnusedDisableDirectives: 'error' },
	},
	{
		files: ['src/**/*.ts', 'vite.config.ts'],
		languageOptions: { parser: tseslint.parser },
		plugins: { '@typescript-eslint': tseslint.plugin },
		rules,
	},
	{
		// The unit tests stand partial stubs in for engine classes through `as unknown as`, so only `any` is banned there.
		files: ['tests/**/*.ts'],
		languageOptions: { parser: tseslint.parser },
		plugins: { '@typescript-eslint': tseslint.plugin },
		rules: noAny,
	},
	{
		files: ['src/**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'], svelteConfig },
		},
		plugins: { '@typescript-eslint': tseslint.plugin, svelte },
		processor: svelte.processors.svelte,
		rules: { ...rules, 'svelte/valid-compile': 'error' },
	},
]
