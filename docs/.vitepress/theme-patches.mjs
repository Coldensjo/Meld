const patches = {
	'VPSidebar.vue': [
		['import { useScrollLock }', 'import { useMediaQuery, useScrollLock }'],
		["import { inBrowser } from 'vitepress'", "import { inBrowser } from 'vitepress'\nimport { useFocusTrap } from '@vueuse/integrations/useFocusTrap'"],
		['const isLocked = useScrollLock', "const desktop = useMediaQuery('(min-width: 960px)')\nconst { activate, deactivate } = useFocusTrap(navEl, { escapeDeactivates: false, allowOutsideClick: true })\nconst isLocked = useScrollLock"],
		['[props, navEl]', '[props, navEl, desktop]'],
		['if (props.open)', 'if (props.open && !desktop.value)'],
		['navEl.value?.focus()', 'activate()'],
		['} else isLocked.value = false', '} else {\n      isLocked.value = false\n      deactivate()\n    }'],
	],
	'VPNavScreen.vue': [
		['import { useScrollLock }', 'import { onKeyStroke, useScrollLock }'],
		["import { ref } from 'vue'", "import { inject, ref, watch } from 'vue'\nimport { useFocusTrap } from '@vueuse/integrations/useFocusTrap'"],
		[
			'const isLocked = useScrollLock(inBrowser ? document.body : null)',
			"const isLocked = useScrollLock(inBrowser ? document.body : null)\nconst closeScreen = inject<() => void>('close-screen')!\nconst { deactivate } = useFocusTrap(\n  () => screen.value?.closest<HTMLElement>('.VPNav'),\n  { immediate: true, initialFocus: '#VPNavScreen a', escapeDeactivates: false, allowOutsideClick: true }\n)\nwatch(screen, (element) => { if (!element) deactivate() }, { flush: 'post' })\nonKeyStroke('Escape', (event) => {\n  if (screen.value) { event.preventDefault(); closeScreen() }\n})",
		],
	],
	'VPHome.vue': [['class="VPHome"', 'class="VPHome" role="main"']],
	'VPSwitchAppearance.vue': [
		['inject, ref, watchPostEffect', 'inject, onMounted, ref, watchPostEffect'],
		["const switchTitle = ref('')", "const switchTitle = ref('')\nconst mounted = ref(false)\nonMounted(() => { mounted.value = true })"],
		[':aria-checked="isDark"', ':aria-checked="mounted && isDark"'],
	],
	'VPSidebarItem.vue': [
		["(isLink.value ? undefined : 'button')", "(collapsible.value && !isLink.value ? 'button' : undefined)"],
		["e.key !== 'Enter'", "e.key !== 'Enter' && e.key !== ' '"],
		['  !props.item.link && toggle()', "  if ('key' in e) e.preventDefault()\n  !props.item.link && toggle()"],
		[':role="itemRole"', ':role="itemRole"\n      :aria-expanded="collapsible && !isLink ? !collapsed : undefined"'],
		['item.items\n          ? { click:', 'collapsible && !isLink\n          ? { click:'],
		[':tabindex="item.items && 0"', ':tabindex="collapsible && !isLink ? 0 : undefined"'],
		[
			'role="button"\n        aria-label="toggle section"',
			':role="isLink ? \'button\' : undefined"\n        :aria-hidden="!isLink || undefined"\n        :aria-label="isLink ? \'Toggle \' + item.text : undefined"\n        :aria-expanded="isLink ? !collapsed : undefined"',
		],
		['@keydown.enter="onCaretClick"\n        tabindex="0"', '@keydown.enter.prevent="onCaretClick"\n        @keydown.space.prevent="onCaretClick"\n        :tabindex="isLink ? 0 : undefined"'],
	],
	'VPLocalSearchBox.vue': [
		['  immediate: true,', '  immediate: true,\n  setReturnFocus: inBrowser ? document.activeElement as HTMLElement : false,'],
		['role="button"\n      :aria-owns="results?.length ? \'localsearch-list\' : undefined"\n      aria-expanded="true"\n      aria-haspopup="listbox"', 'role="dialog"\n      aria-modal="true"'],
		['ref="searchInput"', 'ref="searchInput"\n            role="combobox"\n            :aria-expanded="results.length > 0"\n            aria-haspopup="listbox"'],
		['aria-autocomplete="both"', 'aria-autocomplete="list"'],
		[':aria-activedescendant="selectedIndex > -1 ?', ':aria-activedescendant="selectedIndex > -1 && results[selectedIndex] ?'],
		['class="back-button"', 'class="back-button"\n              type="button"'],
		...['navigateUpKeyAriaLabel', 'navigateDownKeyAriaLabel', 'selectKeyAriaLabel', 'closeKeyAriaLabel'].map((key) => [
			'<kbd :aria-label="translate(\'modal.footer.' + key + '\')"',
			'<kbd role="img" :aria-label="translate(\'modal.footer.' + key + '\')"',
		]),
		['            :id="\'localsearch-item-\' + index"\n            :aria-selected="selectedIndex === index ? \'true\' : \'false\'"\n            role="option"', '            role="none"'],
		[
			':href="p.id"\n              class="result"',
			':href="p.id"\n              :id="\'localsearch-item-\' + index"\n              :aria-selected="selectedIndex === index ? \'true\' : \'false\'"\n              role="option"\n              tabindex="-1"\n              class="result"',
		],
	],
}

export function patchThemeComponent(source, id) {
	const normalized = id.replaceAll('\\', '/')
	if (!normalized.includes('/vitepress/dist/client/theme-default/components/') || normalized.includes('?')) return
	const replacements = patches[normalized.split('/').at(-1)]
	if (!replacements) return
	let patched = source.replaceAll('\r\n', '\n')
	for (const [before, after] of replacements) {
		if (patched.split(before).length !== 2) throw new Error('Review DOC-013 theme patch for ' + id + ': expected one ' + JSON.stringify(before))
		patched = patched.replace(before, after)
	}
	return patched
}

export function themeAccessibility() {
	return {
		name: 'meld-theme-accessibility',
		enforce: 'pre',
		transform: patchThemeComponent,
	}
}

export const codeContrast = {
	name: 'meld-code-contrast',
	tokens(lines) {
		for (const line of lines) {
			for (const token of line) {
				const color = token.htmlStyle?.['--shiki-light']?.toLowerCase()
				if (color === '#d73a49') token.htmlStyle['--shiki-light'] = '#c83040'
				if (color === '#e36209') token.htmlStyle['--shiki-light'] = '#b94d00'
				if (color === '#6a737d') token.htmlStyle['--shiki-light'] = '#626b75'
				if (token.htmlStyle?.['--shiki-dark']?.toLowerCase() === '#6a737d') token.htmlStyle['--shiki-dark'] = '#8b949e'
			}
		}
	},
}
