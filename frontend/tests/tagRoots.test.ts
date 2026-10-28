// Run with: bun test tests/tagRoots.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { tagMarkup, tagRoots } from '../tagRoots.mjs'

const tag = (src: string, file = 'src/components/Foo.svelte') => tagMarkup(src, file, () => {})

test('a root element gets the component name, before its attributes', () => {
	assert.equal(tag('<div class="a"><span>x</span></div>'), '<div data-ui="Foo" class="a"><span>x</span></div>')
})

test('elements nested inside another element are left alone', () => {
	const out = tag('<section><div><p>x</p></div></section>') ?? ''
	assert.equal(out.match(/data-ui/g)?.length, 1)
	assert.ok(out.startsWith('<section data-ui="Foo">'))
})

test('every top-level element counts as a root, scripts and styles do not', () => {
	const src = '<script>let a = 1</script>\n<header></header>\n<main></main>\n<style>main { color: red }</style>'
	assert.equal(tag(src), '<script>let a = 1</script>\n<header data-ui="Foo"></header>\n<main data-ui="Foo"></main>\n<style>main { color: red }</style>')
})

test('roots inside {#if} and {:else} branches are tagged', () => {
	assert.equal(tag('{#if a}<b></b>{:else if c}<i></i>{:else}<u></u>{/if}'), '{#if a}<b data-ui="Foo"></b>{:else if c}<i data-ui="Foo"></i>{:else}<u data-ui="Foo"></u>{/if}')
})

test('roots inside {#each} (with its fallback), {#key} and {#snippet} are tagged', () => {
	assert.equal(tag('{#each xs as x}<li></li>{:else}<p></p>{/each}'), '{#each xs as x}<li data-ui="Foo"></li>{:else}<p data-ui="Foo"></p>{/each}')
	assert.equal(tag('{#key k}<div></div>{/key}'), '{#key k}<div data-ui="Foo"></div>{/key}')
	assert.equal(tag('{#snippet s()}<div></div>{/snippet}'), '{#snippet s()}<div data-ui="Foo"></div>{/snippet}')
})

test('roots inside every branch of {#await} are tagged', () => {
	assert.equal(tag('{#await p}<i></i>{:then v}<b></b>{:catch e}<u></u>{/await}'), '{#await p}<i data-ui="Foo"></i>{:then v}<b data-ui="Foo"></b>{:catch e}<u data-ui="Foo"></u>{/await}')
})

test('components, text and non-svelte files are left alone', () => {
	assert.equal(tag('<Child />text'), undefined)
	assert.equal(tag('<div></div>', 'src/a.ts'), undefined)
})

test('the name comes from the file name, Windows paths too', () => {
	assert.equal(tag('<div></div>', 'C:\\meld\\src\\Bar.svelte'), '<div data-ui="Bar"></div>')
})

test('a file the parser rejects is left alone and named in a warning', () => {
	const warnings: string[] = []
	assert.equal(
		tagMarkup('<div>{#if a}</div>', 'src/Broken.svelte', (m: string) => warnings.push(m)),
		undefined,
	)
	assert.equal(warnings.length, 1)
	assert.match(warnings[0], /Broken\.svelte/)
})

test('the preprocessor wraps the result as Svelte expects', () => {
	assert.deepEqual(tagRoots().markup({ content: '<div></div>', filename: 'X.svelte' }), { code: '<div data-ui="X"></div>' })
	assert.equal(tagRoots().markup({ content: '<div></div>' }), undefined)
})
