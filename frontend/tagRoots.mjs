import { parse } from 'svelte/compiler'

/**
 * @typedef {{ type: string, start: number, name?: string, nodes?: Node[], consequent?: Node | null, alternate?: Node | null, body?: Node | null, fallback?: Node | null, fragment?: Node | null, pending?: Node | null, then?: Node | null, catch?: Node | null }} Node
 */

/** The component's name from its file path: "src/components/Foo.svelte" gives "Foo". */
function componentName(/** @type {string} */ filename) {
	return (
		filename
			.replace(/\\/g, '/')
			.split('/')
			.pop()
			?.replace(/\.svelte$/, '') ?? ''
	)
}

/**
 * Tags a component's root elements with data-ui="<ComponentName>", so the debug overlay (hold F8)
 * can name the part of the UI under the cursor. Elements nested inside {#if}/{#each}/{#key}/{#snippet}/{#await}
 * at the top level count as roots too; elements inside other elements don't. Returns undefined when
 * nothing changes; a file the Svelte parser rejects is left alone with a warning naming it.
 *
 * @param {string} content
 * @param {string} filename
 * @param {(msg: string) => void} [warn]
 * @returns {string | undefined}
 */
export function tagMarkup(content, filename, warn = console.warn) {
	if (!filename || !filename.endsWith('.svelte')) return
	const name = componentName(filename)
	/** @type {Node} */
	let fragment
	try {
		fragment = /** @type {Node} */ (/** @type {unknown} */ (parse(content, { filename, modern: true }).fragment))
	} catch (e) {
		warn(`tagRoots: could not parse ${filename}, so its F8 labels are missing: ${e instanceof Error ? e.message : String(e)}`)
		return
	}
	/** @type {number[]} */
	const inserts = []
	const visit = (/** @type {Node | null | undefined} */ node) => {
		if (!node) return
		if (node.type === 'RegularElement') {
			// A hand-written data-ui stays as it is: a second one fails to compile in Vite (svelte-check does not run this preprocessor).
			const attrs = /** @type {{ type: string, name?: string }[]} */ (/** @type {{ attributes?: unknown }} */ (node).attributes ?? [])
			if (attrs.some((x) => x.type === 'Attribute' && x.name === 'data-ui')) return
			// Right after the tag name: "<div" + 4 = the spot before its attributes.
			inserts.push(node.start + 1 + (node.name ?? '').length)
			return
		}
		/** @type {(Node | null | undefined)[]} */
		const kids = []
		if (node.type === 'Fragment') kids.push(...(node.nodes ?? []))
		else if (node.type === 'IfBlock') kids.push(node.consequent, node.alternate)
		else if (node.type === 'EachBlock') kids.push(node.body, node.fallback)
		else if (node.type === 'KeyBlock') kids.push(node.fragment)
		else if (node.type === 'SnippetBlock') kids.push(node.body)
		else if (node.type === 'AwaitBlock') kids.push(node.pending, node.then, node.catch)
		for (const k of kids) visit(k)
	}
	visit(fragment)
	if (!inserts.length) return
	let out = ''
	let last = 0
	for (const at of inserts.sort((a, b) => a - b)) {
		out += content.slice(last, at) + ` data-ui="${name}"`
		last = at
	}
	return out + content.slice(last)
}

/** The Svelte preprocessor that runs tagMarkup over every component (svelte.config.js). */
export function tagRoots() {
	return {
		name: 'tag-ui-roots',
		markup(/** @type {{ content: string, filename?: string }} */ { content, filename }) {
			const code = tagMarkup(content, filename ?? '')
			return code === undefined ? undefined : { code }
		},
	}
}
