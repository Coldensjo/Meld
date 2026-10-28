// Run with: bun test tests/probeTouches.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globRe, parseHeader } from '../probes/touches.mjs'

// Paths resolve from this file, since `make test` runs from the repo root and `bun test` from frontend/ (#687).
const here = dirname(fileURLToPath(import.meta.url))
const probes = join(here, '..', 'probes')
const root = join(here, '..', '..')

const probeFiles = readdirSync(probes).filter((f) => f.endsWith('.js') && f !== 'lib.js')

/** Every file under `dir` as a repo-root path with forward slashes, leaving out what no probe names (dependencies, builds, git). */
function filesUnder(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'bin') continue
		const p = join(dir, e.name)
		if (e.isDirectory()) filesUnder(p, out)
		else out.push(relative(root, p).split('\\').join('/'))
	}
	return out
}

test('the header parser reads the touches and tier lines of the leading comment block only', () => {
	const h = parseHeader('// First line.\n// touches: a/b.ts,  c/*.go ,\n// tier: smoke\nconst x = 1\n// touches: not/this.ts\n')
	assert.equal(h.first, 'First line.')
	assert.deepEqual(h.touches, ['a/b.ts', 'c/*.go'])
	assert.equal(h.tier, 'smoke')
	assert.equal(h.timeout, null)
	assert.equal(parseHeader('// No touches line.\nrun()\n').touches, null)
	assert.equal(parseHeader('// A slow map.\n// timeout: 600 (why)\nrun()\n').timeout, 600, "a probe's timeout line, read as seconds (#635)")
})

test('a glob matches within one folder with *, across folders with **, and under a folder ending in /', () => {
	assert.ok(globRe('internal/adt/*').test('internal/adt/tile.go'))
	assert.ok(!globRe('internal/adt/*').test('internal/adt/testdata/x.adt'))
	assert.ok(globRe('frontend/**/*.ts').test('frontend/src/lib/a.ts'))
	assert.ok(globRe('docs/').test('docs/tests/ui.md'))
	assert.ok(!globRe('app.go').test('app_go'), 'a dot is literal')
})

test("every probe's touches paths exist, so a rename cannot silently drop a probe from --touching", () => {
	assert.ok(probeFiles.length > 0, `no probes found in ${probes}`)
	let files: string[] | null = null
	const missing: string[] = []
	for (const f of probeFiles) {
		const { touches } = parseHeader(readFileSync(join(probes, f), 'utf8'))
		for (const g of touches ?? []) {
			if (!g.includes('*') && !g.endsWith('/')) {
				if (!existsSync(join(root, g))) missing.push(`${f}: ${g} does not exist`)
				continue
			}
			files ??= filesUnder(root)
			const re = globRe(g)
			if (!files.some((p) => re.test(p))) missing.push(`${f}: ${g} matches no file`)
		}
	}
	assert.deepEqual(missing, [])
})
