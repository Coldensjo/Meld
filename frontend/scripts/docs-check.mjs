import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarkdownRenderer } from 'vitepress'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const docs = join(repository, 'docs')
const output = join(docs, '.vitepress/dist')

export function exactFile(path) {
	if (!existsSync(path)) return false
	const parent = dirname(path)
	if (parent === path) return true
	return readdirSync(parent).includes(path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1))) && exactFile(parent)
}

export function siteTarget(root, page, reference, base) {
	const url = new URL(reference, `https://docs.invalid${base}${relative(root, page).split(sep).join('/')}`)
	if (url.origin !== 'https://docs.invalid') return null
	if (!url.pathname.startsWith(base)) throw new Error(`URL escapes site base ${base}: ${reference}`)
	const path = resolve(root, decodeURIComponent(url.pathname.slice(base.length)))
	if (path !== root && !path.startsWith(root + sep)) throw new Error(`URL escapes output directory: ${reference}`)
	const candidates = extname(path) ? [path] : [path, `${path}.html`, join(path, 'index.html')]
	const target = candidates.find((candidate) => exactFile(candidate) && statSync(candidate).isFile())
	if (!target) throw new Error(`Missing built page/asset: ${reference}`)
	return { path: target, anchor: decodeURIComponent(url.hash.slice(1)) }
}

export async function readHtml(html) {
	const ids = new Set()
	const references = []
	let h1Count = 0
	const collect = (attribute) => ({
		element(element) {
			references.push(element.getAttribute(attribute))
		},
	})
	await new HTMLRewriter()
		.on('h1', {
			element() {
				h1Count++
			},
		})
		.on('[id]', {
			element(element) {
				ids.add(element.getAttribute('id'))
			},
		})
		.on('[href]', collect('href'))
		.on('[src]', collect('src'))
		.transform(new Response(html))
		.text()
	return { ids, references, h1Count }
}

export function validateReference(root, page, reference, base, pages) {
	const target = siteTarget(root, page, reference, base)
	if (target?.anchor && pages.has(target.path) && !pages.get(target.path).ids.has(target.anchor)) throw new Error(`Missing rendered anchor ${reference}`)
}

function filesUnder(directory, extension) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name.startsWith('.')) return []
		const path = join(directory, entry.name)
		return entry.isDirectory() ? filesUnder(path, extension) : path.endsWith(extension) ? [path] : []
	})
}

export function markdownStructure(tokens, source) {
	const errors = []
	if (tokens.filter((token) => token.type === 'heading_open' && token.tag === 'h1').length !== 1) errors.push('Expected exactly one H1')
	if (source.includes('\0')) errors.push('Unexpected NUL character')
	for (const token of tokens.filter((token) => token.type === 'fence')) {
		const closing = source.split(/\r?\n/)[token.map[1] - 1]?.trim() ?? ''
		const marker = token.markup[0]
		if (!new RegExp(`^${marker}{${token.markup.length},}\\s*$`).test(closing)) errors.push(`Unclosed code fence at line ${token.map[0] + 1}`)
	}
	return errors
}

export async function check() {
	const config = (await import('../../docs/.vitepress/config.mts')).default
	const markdown = await createMarkdownRenderer(docs, config.markdown)
	const documents = [
		...filesUnder(docs, '.md'),
		...['README.md', 'CLAUDE.md', 'DOCUMENTATION_PLAN.md', 'DOCUMENTATION_AUDIT.md', 'DOCUMENTATION_RULES.md', 'build/README.md', 'frontend/tests/browser/README.md'].map((path) => join(repository, path)),
	]
	const errors = []
	const parsed = new Map()
	const report = (path, message) => errors.push(`${relative(repository, path)}: ${message}`)
	for (const path of documents) {
		const source = readFileSync(path, 'utf8')
		const tokens = markdown.parse(source, { path, relativePath: relative(docs, path) })
		const ids = new Set(tokens.filter((token) => token.type === 'heading_open').map((token) => token.attrGet('id')))
		parsed.set(path, { tokens, ids })
		const structure = markdownStructure(tokens, source)
		const homeLayout = path === join(docs, 'index.md') && /^---\r?\n[\s\S]*?\blayout: home\b[\s\S]*?\r?\n---/.test(source)
		for (const error of structure) {
			if (homeLayout && error === 'Expected exactly one H1') continue
			report(path, error)
		}
	}
	let markdownLinks = 0
	for (const [path, { tokens }] of parsed) {
		const inspect = (token) => {
			const reference = token.type === 'link_open' ? token.attrGet('href') : token.type === 'image' ? token.attrGet('src') : null
			if (reference && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
				markdownLinks++
				try {
					const url = new URL(reference, 'https://docs.invalid/')
					const rawPath = reference.split(/[?#]/)[0]
					const target = rawPath ? resolve(rawPath.startsWith('/') ? docs : dirname(path), decodeURIComponent(rawPath.replace(/^\//, ''))) : path
					if (!exactFile(target)) throw new Error(`Missing relative link/image ${reference}`)
					const anchor = decodeURIComponent(url.hash.slice(1))
					if (anchor && parsed.has(target) && !parsed.get(target).ids.has(anchor)) throw new Error(`Missing Markdown anchor ${reference}`)
				} catch (error) {
					report(path, error.message)
				}
			}
			for (const child of token.children ?? []) inspect(child)
		}
		for (const token of tokens) inspect(token)
	}
	if (!existsSync(output)) throw new Error('Missing docs/.vitepress/dist; run bun run docs:build first')
	const pages = new Map()
	for (const path of filesUnder(output, '.html')) pages.set(path, await readHtml(readFileSync(path, 'utf8')))
	let renderedLinks = 0
	const validate = (path, reference) => {
		try {
			validateReference(output, path, reference, config.base, pages)
		} catch (error) {
			report(path, error.message)
		}
	}
	for (const [path, page] of pages) {
		if (path !== join(output, '404.html') && page.h1Count !== 1) report(path, `Expected exactly one rendered H1, found ${page.h1Count}`)
		for (const reference of page.references) {
			renderedLinks++
			validate(path, reference)
		}
	}
	const navigation = (value) => {
		if (!value || typeof value !== 'object') return
		if (typeof value.link === 'string') validate(join(output, 'index.html'), value.link.startsWith('/') ? config.base + value.link.slice(1) : value.link)
		for (const child of Object.values(value)) navigation(child)
	}
	navigation(config.themeConfig.nav)
	navigation(config.themeConfig.sidebar)
	if (errors.length) throw new Error(`Documentation validation failed (${errors.length}):\n${errors.join('\n')}`)
	console.log(`Documentation checks passed: ${documents.length} Markdown files, ${markdownLinks} relative links/images, ${pages.size} HTML pages, ${renderedLinks} rendered references; navigation, anchors, assets and Markdown structure.`)
}

if (import.meta.main) await check()
