// Run with: bun test tests/contrast.test.ts
// The text tokens in app.css keep WCAG AA contrast (4.5:1) on every panel, in both themes (#371).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8')

/** Token values of one block: the first `:root {` or the `:root[data-theme='light'] {` one. */
function tokens(selector: string): Record<string, string> {
	const start = css.indexOf(selector)
	assert.ok(start >= 0, selector)
	const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
	const out: Record<string, string> = {}
	for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2]
	return out
}

function luminance(hex: string): number {
	const c = [1, 3, 5].map((i) => {
		const v = parseInt(hex.slice(i, i + 2), 16) / 255
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function ratio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

const themes: [string, string][] = [
	['dark', ':root {'],
	['light', ":root[data-theme='light']"],
]

for (const [name, selector] of themes) {
	test(`${name} theme: text tokens reach 4.5:1 on every panel`, () => {
		const t = tokens(selector)
		for (const fg of ['text', 'text-dim', 'accent-text', 'danger-text']) {
			for (const bg of ['bg', 'panel', 'panel-2', 'panel-3']) {
				assert.ok(t[fg] && t[bg], `${fg} or ${bg} missing`)
				const r = ratio(t[fg], t[bg])
				assert.ok(r >= 4.5, `${name} --${fg} on --${bg} is ${r.toFixed(2)}`)
			}
		}
	})
	test(`${name} theme: accent-ink on the accent fill reaches 4.5:1`, () => {
		const t = tokens(selector)
		assert.ok(ratio(t['accent-ink'] ?? '#ffffff', t.accent) >= 4.5)
	})
}
