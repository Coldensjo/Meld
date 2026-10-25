import { parse } from 'svelte/compiler'

/**
 * Tags every component's root elements with data-ui="<ComponentName>", so the debug overlay (hold F8)
 * can name the part of the UI under the cursor. Elements nested inside {#if}/{#each}/{#key}/{#snippet}
 * at the top level count as roots too; elements inside other elements don't.
 */
function tagRoots() {
	return {
		name: 'tag-ui-roots',
		markup({ content, filename }) {
			if (!filename || !filename.endsWith('.svelte')) return
			const name = filename
				.replace(/\\/g, '/')
				.split('/')
				.pop()
				.replace(/\.svelte$/, '')
			let ast
			try {
				ast = parse(content, { filename, modern: true })
			} catch {
				return
			}
			const inserts = []
			const visit = (node) => {
				if (!node) return
				if (node.type === 'RegularElement') {
					// Right after the tag name: "<div" + 4 = the spot before its attributes.
					inserts.push(node.start + 1 + node.name.length)
					return
				}
				const kids = []
				if (node.type === 'Fragment') kids.push(...node.nodes)
				else if (node.type === 'IfBlock') kids.push(node.consequent, node.alternate)
				else if (node.type === 'EachBlock') kids.push(node.body, node.fallback)
				else if (node.type === 'KeyBlock' || node.type === 'SnippetBlock') kids.push(node.body)
				for (const k of kids) visit(k)
			}
			visit(ast.fragment)
			if (!inserts.length) return
			let out = ''
			let last = 0
			for (const at of inserts.sort((a, b) => a - b)) {
				out += content.slice(last, at) + ` data-ui="${name}"`
				last = at
			}
			out += content.slice(last)
			return { code: out }
		},
	}
}

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
	preprocess: [tagRoots()],
}
