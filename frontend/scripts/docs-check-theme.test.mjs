import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { codeContrast, patchThemeComponent } from '../../docs/.vitepress/theme-patches.mjs'

const require = createRequire(import.meta.url)
const components = join(dirname(require.resolve('vitepress/package.json')), 'dist/client/theme-default/components')

function patched(name) {
	const path = join(components, name)
	return patchThemeComponent(readFileSync(path, 'utf8'), path)
}

test('homepage has a main landmark without changing layout', () => {
	expect(patched('VPHome.vue')).toContain('class="VPHome" role="main"')
})

test('theme switch updates its checked state after dark-mode hydration', () => {
	const source = patched('VPSwitchAppearance.vue')
	expect(source).toContain(':aria-checked="mounted && isDark"')
	expect(source).toContain('onMounted(() => { mounted.value = true })')
	expect(source).toContain('@click="toggleAppearance"')
})

test('mobile sidebar contains focus without trapping the desktop sidebar', () => {
	const source = patched('VPSidebar.vue')
	expect(source).toContain('useFocusTrap(navEl')
	expect(source).toContain('if (props.open && !desktop.value)')
	expect(source).toContain('[props, navEl, desktop]')
	expect(source).not.toContain('navEl.value?.focus()')
})

test('mobile navigation contains focus, includes its close trigger and handles Escape', () => {
	const source = patched('VPNavScreen.vue')
	expect(source).toContain("screen.value?.closest<HTMLElement>('.VPNav')")
	expect(source).toContain("inject<() => void>('close-screen')!")
	expect(source).toContain("onKeyStroke('Escape'")
	expect(source).toContain("immediate: true, initialFocus: '#VPNavScreen a'")
	expect(source).toContain('if (!element) deactivate()')
})

test('sidebar only focuses collapsible controls and exposes their state', () => {
	const source = patched('VPSidebarItem.vue')
	expect(source).toContain('collapsible.value && !isLink.value')
	expect(source).toContain(':aria-expanded="collapsible && !isLink ? !collapsed : undefined"')
	expect(source).toContain(':tabindex="collapsible && !isLink ? 0 : undefined"')
	expect(source).toContain("e.key !== 'Enter' && e.key !== ' '")
	expect(source).toContain(':aria-hidden="!isLink || undefined"')
	expect(source).toContain(':tabindex="isLink ? 0 : undefined"')
})

test('search uses a modal combobox with one interactive element per option', () => {
	const source = patched('VPLocalSearchBox.vue')
	expect(source).toContain('role="dialog"\n      aria-modal="true"')
	expect(source).toContain('role="combobox"')
	expect(source).toContain(':aria-expanded="results.length > 0"')
	expect(source).toContain('aria-autocomplete="list"')
	expect(source).toContain('selectedIndex > -1 && results[selectedIndex] ?')
	expect(source).toMatch(/<li\s+v-for[\s\S]*?role="none"/)
	expect(source).toMatch(/<a\s+:href="p.id"[\s\S]*?role="option"\s+tabindex="-1"/)
	expect(source).toContain('setReturnFocus: inBrowser ? document.activeElement as HTMLElement : false')
	expect(source).toContain('class="back-button"\n              type="button"')
	expect(source).toContain('@click="$emit(\'close\')"')
	expect(source).toContain('router.go(selectedPackage.id)')
	expect(source.match(/<kbd role="img"/g)).toHaveLength(4)
})

test('theme upgrades fail loudly instead of silently dropping corrections', () => {
	expect(() => patchThemeComponent('<template />', join(components, 'VPHome.vue'))).toThrow('Review DOC-013')
	expect(patchThemeComponent('anything', '/other/VPHome.vue')).toBeUndefined()
	expect(patchThemeComponent('anything', join(components, 'VPHome.vue') + '?vue&type=style')).toBeUndefined()
})

test('code contrast changes only the failing token colors', () => {
	const tokens = ['#D73A49', '#E36209', '#005CC5', '#6A737D'].map((color) => ({ htmlStyle: { '--shiki-light': color, '--shiki-dark': '#F97583' } }))
	codeContrast.tokens([tokens])
	expect(tokens.map((token) => token.htmlStyle['--shiki-light'])).toEqual(['#c83040', '#b94d00', '#005CC5', '#626b75'])
	expect(tokens.every((token) => token.htmlStyle['--shiki-dark'] === '#F97583')).toBe(true)
	const comment = { htmlStyle: { '--shiki-dark': '#6A737D' } }
	codeContrast.tokens([[comment]])
	expect(comment.htmlStyle['--shiki-dark']).toBe('#8b949e')
})
