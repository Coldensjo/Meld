import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exactFile, markdownStructure, readHtml, siteTarget, validateReference } from './docs-check.mjs'

const root = mkdtempSync(join(tmpdir(), 'meld-docs-'))
mkdirSync(join(root, 'guides'))
writeFileSync(join(root, 'index.html'), '<h1 id="home">Home</h1>')
writeFileSync(join(root, 'guides/editing.html'), '<h1 id="save">Save</h1>')
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('clean URLs resolve under the Pages subpath', () => {
	expect(siteTarget(root, join(root, 'index.html'), '/Meld/guides/editing#save', '/Meld/')).toEqual({ path: join(root, 'guides/editing.html'), anchor: 'save' })
})

test('missing pages/assets and wrong-case paths fail', () => {
	expect(() => siteTarget(root, join(root, 'index.html'), '/Meld/missing', '/Meld/')).toThrow('Missing built')
	expect(exactFile(join(root, 'guides/Editing.html'))).toBe(false)
})

test('root-relative links outside the repository subpath fail', () => {
	expect(() => siteTarget(root, join(root, 'index.html'), '/guides/editing', '/Meld/')).toThrow('escapes site base')
})

test('external references are not live-network checks', () => {
	expect(siteTarget(root, join(root, 'index.html'), 'https://example.com/', '/Meld/')).toBeNull()
})

test('rendered IDs distinguish valid and missing anchors', async () => {
	const html = await readHtml('<h1 id="save">Save</h1><a href="#absent">Bad link</a><script src="/Meld/app.js"></script>')
	expect(html.ids.has('save')).toBe(true)
	expect(html.ids.has('absent')).toBe(false)
	expect(html.references).toEqual(['#absent', '/Meld/app.js'])
	const pages = new Map([[join(root, 'index.html'), html]])
	expect(() => validateReference(root, join(root, 'index.html'), '#absent', '/Meld/', pages)).toThrow('Missing rendered anchor')
	expect(() => validateReference(root, join(root, 'index.html'), '#save', '/Meld/', pages)).not.toThrow()
})

test('Markdown structure rejects missing titles and unclosed fences', () => {
	expect(markdownStructure([], 'text')).toContain('Expected exactly one H1')
	expect(
		markdownStructure(
			[
				{ type: 'heading_open', tag: 'h1' },
				{ type: 'fence', markup: '```', map: [1, 3] },
			],
			'# Title\n```sh\nunclosed',
		),
	).toContain('Unclosed code fence at line 2')
})

test('VitePress rejects a broken Markdown link in an isolated build', async () => {
	const fixture = join(root, 'broken-build')
	mkdirSync(fixture)
	writeFileSync(join(fixture, 'index.md'), '# Fixture\n\n[Missing page](./missing.md)\n')
	mkdirSync(join(fixture, '.vitepress'))
	const configPath = fileURLToPath(new URL('../../docs/.vitepress/config.mts', import.meta.url)).replaceAll('\\', '/')
	writeFileSync(join(fixture, '.vitepress/config.mts'), `import config from ${JSON.stringify(configPath)}; export default { ...config, themeConfig: {} }`)
	const cli = fileURLToPath(new URL('dist/node/cli.js', import.meta.resolve('vitepress/package.json')))
	const process = Bun.spawn([Bun.which('bun'), '--bun', cli, 'build', fixture], { stdout: 'pipe', stderr: 'pipe' })
	const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
	expect(exitCode).not.toBe(0)
	expect(stdout + stderr).toContain('dead link')
}, 30000)
