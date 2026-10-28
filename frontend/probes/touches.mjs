// The `// touches:`, `// tier:` and `// timeout:` lines of a probe's header (#397, #635), shared by run.mjs and tests/probeTouches.test.ts (#687).

/**
 * A probe's header: its first comment line, and the globs of its `// touches:` line (repo-root paths, comma-separated,
 * anywhere in the leading comment block), or null when it has none, which counts as touching every file; its tier; and the
 * seconds of its `// timeout:` line, which raises the runner's limit for it (#635), or null.
 * @param {string} text the probe file's source
 * @returns {{ first: string, touches: string[] | null, tier: string | null, timeout: number | null }}
 */
export const parseHeader = (text) => {
	const lines = text.split(/\r?\n/)
	/** @type {string[] | null} */
	let touches = null
	/** @type {string | null} */
	let tier = null
	/** @type {number | null} */
	let timeout = null
	for (const l of lines) {
		if (!l.startsWith('//')) break
		const m = /^\/\/\s*touches:\s*(.*)$/.exec(l)
		const t = /^\/\/\s*tier:\s*(\S+)/.exec(l)
		const s = /^\/\/\s*timeout:\s*(\d+)/.exec(l)
		if (t) tier = t[1]
		if (s) timeout = Number(s[1])
		if (m)
			touches = m[1]
				.split(',')
				.map((g) => g.trim())
				.filter(Boolean)
	}
	return { first: lines[0].replace(/^\/\/\s*/, ''), touches, tier, timeout }
}

/**
 * A glob as a RegExp over repo-root paths: `**` any run of folders, `*` within one name; a path ending in / matches what is under it.
 * @param {string} g
 */
export const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?|\*/g, (m) => (m === '*' ? '[^/]*' : '.*')) + (g.endsWith('/') ? '.*' : '') + '$')
