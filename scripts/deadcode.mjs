// Lists what a large removal leaves dead in the frontend. Prints, changes nothing, exits 0.
// Run from editor/frontend through `make -C editor deadcode` (docs/TESTS.md, "Dead code").
//   1. files under src not reachable from src/main.ts, with the tests and probes that still name them;
//   2. exports of src that no other file in src, tests or probes names.
// Imports are read with a regex: `from '..'`, `import '..'`, `import('..')` and `new URL('..', import.meta.url)`.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const root = process.cwd()
const src = join(root, 'src')

function walk(dir, exts, out = []) {
	if (!existsSync(dir)) return out
	for (const name of readdirSync(dir)) {
		const p = join(dir, name)
		if (statSync(p).isDirectory()) walk(p, exts, out)
		else if (exts.some((e) => name.endsWith(e))) out.push(p)
	}
	return out
}

const rel = (p) => relative(root, p).replaceAll('\\', '/')
const srcFiles = walk(src, ['.ts', '.js', '.svelte']).filter((f) => !f.endsWith('.d.ts'))
const otherFiles = [...walk(join(root, 'tests'), ['.ts', '.js']), ...walk(join(root, 'probes'), ['.js', '.mjs', '.ts'])]
const text = new Map([...srcFiles, ...otherFiles].map((f) => [f, readFileSync(f, 'utf8')]))

const importRe = /(?:\bfrom\s*|\bimport\s*\(?\s*|new\s+URL\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g
function resolveSpec(from, spec) {
	const base = resolve(dirname(from), spec.replace(/\?.*$/, ''))
	for (const c of [base, base + '.ts', base + '.js', base + '.svelte', join(base, 'index.ts'), join(base, 'index.js'), base.replace(/\.js$/, '.ts')]) {
		if (existsSync(c) && statSync(c).isFile()) return c
	}
	return null
}
function imports(file) {
	const out = []
	for (const m of text.get(file).matchAll(importRe)) {
		const r = resolveSpec(file, m[2])
		if (r) out.push(r)
	}
	return out
}

// 1. Unreachable files.
const main = join(src, 'main.ts')
const seen = new Set([main])
const stack = [main]
while (stack.length) {
	for (const dep of imports(stack.pop())) {
		if (!seen.has(dep) && text.has(dep)) {
			seen.add(dep)
			stack.push(dep)
		}
	}
}
console.log('== Files in src not reachable from src/main.ts ==')
const dead = srcFiles.filter((f) => !seen.has(f)).sort()
for (const f of dead) {
	const users = otherFiles.filter((o) => imports(o).includes(f)).map(rel)
	console.log(rel(f) + (users.length ? '   (still imported by ' + users.join(', ') + ')' : ''))
}
if (!dead.length) console.log('none')

// 2. Exports nothing else names.
console.log('\n== Exports of src that no other file in src, tests or probes names ==')
const declRe = /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|abstract\s+class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
const listRe = /^export\s+(?:type\s+)?\{([^}]*)\}/gm
const wordCache = new Map()
const words = (f) => {
	if (!wordCache.has(f)) wordCache.set(f, new Set(text.get(f).match(/[A-Za-z_$][\w$]*/g)))
	return wordCache.get(f)
}
let n = 0
for (const f of srcFiles.filter((f) => f.endsWith('.ts') || f.endsWith('.js')).sort()) {
	const names = new Set()
	for (const m of text.get(f).matchAll(declRe)) names.add(m[1])
	for (const m of text.get(f).matchAll(listRe)) {
		for (const part of m[1].split(',')) {
			const name = part.trim().split(/\s+as\s+/).pop().trim()
			if (name) names.add(name)
		}
	}
	for (const name of names) {
		const used = [...text.keys()].some((o) => o !== f && words(o).has(name))
		if (!used) {
			console.log(rel(f) + ': ' + name)
			n++
		}
	}
}
if (!n) console.log('none')
