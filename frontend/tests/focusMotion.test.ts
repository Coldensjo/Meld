// Run with: bun test tests/focusMotion.test.ts
// The app's focus ring and reduced-motion rule in app.css (#374): a keyboard user sees a 2 px ring on
// the focused control, a click shows none, and with reduced motion the UI's animations and transitions
// end at once. Read from the stylesheet's text, which the page loads as it is.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Comments out, so a rule quoted in one never counts.
const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the first top-level rule whose selector list holds `selector`, or null. */
function rule(selector: string): string | null {
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectors = m[1].split(',').map((s) => s.trim())
		if (selectors.includes(selector)) return m[2]
	}
	return null
}

test('a keyboard user gets a 2 px focus ring', () => {
	const ring = rule(':root[data-kbd-nav] :focus-visible')
	assert.ok(ring, 'no :root[data-kbd-nav] :focus-visible rule')
	assert.match(ring, /outline:\s*2px solid/)
})

test('a click shows no ring: plain :focus-visible has no outline', () => {
	const plain = rule(':focus-visible')
	assert.ok(plain, 'no :focus-visible rule')
	assert.match(plain, /outline:\s*none/)
})

test('reduced motion ends animations and transitions at once', () => {
	const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
	assert.ok(at >= 0, 'no prefers-reduced-motion media rule')
	const body = css.slice(at, css.indexOf('}', css.indexOf('{', css.indexOf('{', at) + 1)) + 1)
	assert.match(body, /animation-duration:\s*0\.01ms/)
	assert.match(body, /transition-duration:\s*0\.01ms/)
})
