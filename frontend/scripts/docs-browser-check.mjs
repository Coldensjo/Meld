import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(process.env.DOCS_BROWSER_TOOLS ? join(resolve(process.env.DOCS_BROWSER_TOOLS), 'package.json') : import.meta.url)
const { chromium } = require('playwright-core')
const axePath = require.resolve('axe-core/axe.min.js')
const base = process.env.DOCS_BASE_URL || 'http://localhost:4173/Meld/'
const output = resolve(process.env.DOCS_BROWSER_OUTPUT || join(tmpdir(), 'meld-doc013-browser'))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.DOCS_BROWSER_EXECUTABLE ? { executablePath: process.env.DOCS_BROWSER_EXECUTABLE } : {}) })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const report = { base, browser: browser.version(), axe: require('axe-core/package.json').version, audits: [], contrast: [], checks: [], events: [] }
page.on('pageerror', (error) => report.events.push({ type: 'pageerror', message: error.message }))
page.on('console', (message) => {
	if (['error', 'warning'].includes(message.type())) report.events.push({ type: message.location().url.endsWith('/favicon.ico') ? 'optional-favicon' : message.type(), message: message.text(), location: message.location() })
})
page.on('response', (response) => {
	if (response.status() >= 400) report.events.push({ type: 'http', status: response.status(), url: response.url() })
})
page.on('requestfailed', (request) => {
	if (request.failure()?.errorText !== 'net::ERR_ABORTED') report.events.push({ type: 'requestfailed', url: request.url(), error: request.failure() })
})

async function visit(route = '') {
	await page.goto(new URL(route, base).href)
	await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
	await page.waitForFunction(() => [...document.querySelectorAll('.VPSwitchAppearance')].every((element) => element.getAttribute('aria-checked') === String(document.documentElement.classList.contains('dark'))))
}

async function check(label, action) {
	await action()
	report.checks.push(label)
}

async function audit(label) {
	await page.addScriptTag({ path: axePath })
	const result = await page.evaluate(async () => {
		const results = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
		const main = document.querySelector('main, [role="main"]')
		const headings = main ? [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')] : []
		const simplify = (finding) => ({ id: finding.id, nodes: finding.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })
		return {
			theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
			viewport: [innerWidth, innerHeight],
			violations: results.violations.map(simplify),
			incomplete: results.incomplete.map(simplify),
			mainCount: document.querySelectorAll('main, [role="main"]').length,
			h1Count: headings.filter((heading) => heading.tagName === 'H1').length,
			headingSkips: headings.filter((heading, index) => index && Number(heading.tagName.slice(1)) > Number(headings[index - 1].tagName.slice(1)) + 1).map((heading) => heading.textContent.trim()),
			imageProblems: [...document.images].filter((image) => !image.hasAttribute('alt') || !image.complete || image.naturalWidth === 0).map((image) => image.src),
			imageCount: document.images.length,
			overflow: document.documentElement.scrollWidth > innerWidth,
		}
	})
	report.audits.push({ label, url: page.url(), ...result })
	console.log(label + ': ' + result.violations.length + ' axe violations, ' + result.incomplete.length + ' incomplete')
}

async function setTheme(dark) {
	const toggle = page.locator('.VPSwitchAppearance:visible').first()
	if ((await toggle.getAttribute('aria-checked')) !== String(dark)) {
		await toggle.click()
		await page.waitForFunction((expected) => localStorage.getItem('vitepress-theme-appearance') === (expected ? 'dark' : 'auto') || localStorage.getItem('vitepress-theme-appearance') === (expected ? 'dark' : 'light'), dark)
	}
	await page.waitForFunction((expected) => document.documentElement.classList.contains('dark') === expected, dark)
}

async function searchContrast(label) {
	const evidence = await page.evaluate(() => {
		const rgba = (color) => {
			const values = color.match(/[\d.]+/g).map(Number)
			return [...values.slice(0, 3), values[3] ?? 1]
		}
		const blend = (foreground, background) => foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]))
		const luminance = (color) =>
			color
				.map((channel) => channel / 255)
				.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
				.reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
		const samples = [...document.querySelectorAll('.VPLocalSearchBox .titles .text, .VPLocalSearchBox mark, .search-keyboard-shortcuts > span, .search-keyboard-shortcuts kbd, .excerpt p, .excerpt li, .excerpt span[style]')]
			.map((element) => {
				const ancestors = []
				for (let parent = element; parent; parent = parent.parentElement) ancestors.unshift(parent)
				let background = [255, 255, 255]
				for (const ancestor of ancestors) background = blend(rgba(getComputedStyle(ancestor).backgroundColor), background)
				const opacity = ancestors.reduce((total, ancestor) => total * Number(getComputedStyle(ancestor).opacity), 1)
				const color = rgba(getComputedStyle(element).color)
				color[3] *= opacity
				const foregroundLuminance = luminance(blend(color, background))
				const backgroundLuminance = luminance(background)
				return { text: element.textContent.trim().slice(0, 70), ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05) }
			})
			.filter((sample) => sample.text)
		const input = document.querySelector('#localsearch-input')
		return {
			theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
			count: samples.length,
			minimum: Math.min(...samples.map((sample) => sample.ratio)),
			failures: samples.filter((sample) => sample.ratio < 4.5),
			controlsExists: Boolean(document.getElementById(input.getAttribute('aria-controls'))),
			activeOptionExists: Boolean(document.getElementById(input.getAttribute('aria-activedescendant'))),
		}
	})
	report.contrast.push({ label, ...evidence })
	assert.equal(evidence.failures.length, 0, 'Review non-axe search contrast checks')
	assert.ok(evidence.controlsExists && evidence.activeOptionExists)
}

async function openSearch(query) {
	await page.getByRole('button', { name: 'Search', exact: true }).click()
	await page.locator('#localsearch-input').fill(query)
	await page.locator('a.result').first().waitFor()
}

async function assertClosed() {
	await page.locator('#localsearch-input').waitFor({ state: 'detached' })
}

async function assertFocus(selector) {
	await page.waitForFunction((target) => document.activeElement?.matches(target), selector)
}

async function searchChecks(label) {
	await check(label + ' mouse result destination', async () => {
		await openSearch('compiling')
		const destination = new URL(await page.locator('a.result').first().getAttribute('href'), base).href
		await page.locator('a.result').first().click()
		await page.waitForURL(destination)
		await assertClosed()
		assert.ok(await page.locator(decodeURIComponent(new URL(destination).hash)).count())
	})
	await check(label + ' Escape restores search-button focus', async () => {
		await openSearch('compiling')
		await page.keyboard.press('Escape')
		await assertClosed()
		await assertFocus('#local-search button')
	})
	await check(label + ' ArrowDown/ArrowUp/Enter destination', async () => {
		await openSearch('compiling')
		await page.keyboard.press('ArrowDown')
		assert.equal(await page.locator('#localsearch-input').getAttribute('aria-activedescendant'), 'localsearch-item-1')
		await page.keyboard.press('ArrowUp')
		assert.equal(await page.locator('#localsearch-input').getAttribute('aria-activedescendant'), 'localsearch-item-0')
		const destination = new URL(await page.locator('.result.selected').getAttribute('href'), base).href
		await page.keyboard.press('Enter')
		await page.waitForURL(destination)
		await assertClosed()
	})
	await check(label + ' focus trap and modal semantics', async () => {
		await openSearch('troubleshooting')
		assert.equal(await page.getByRole('dialog').getAttribute('aria-modal'), 'true')
		assert.equal(await page.locator('#localsearch-input').getAttribute('role'), 'combobox')
		for (let index = 0; index < 8; index++) {
			await page.keyboard.press('Tab')
			assert.ok(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))))
		}
		await page.locator('#localsearch-input').focus()
		await audit(label + '-search-light')
		await searchContrast(label + '-search-light')
		await page.keyboard.press('Escape')
		await assertClosed()
	})
	await check(label + ' no results and Enter keeps dialog open', async () => {
		await page.getByRole('button', { name: 'Search', exact: true }).click()
		await page.locator('#localsearch-input').fill('zzzxxyynomatchdoc013')
		await page.getByText('No results for', { exact: false }).waitFor()
		assert.equal(await page.locator('a.result').count(), 0)
		for (const key of ['ArrowDown', 'ArrowUp']) {
			await page.keyboard.press(key)
			assert.equal(await page.locator('#localsearch-input').getAttribute('aria-activedescendant'), null)
		}
		await page.keyboard.press('Enter')
		assert.equal(await page.getByRole('dialog').count(), 1)
		await audit(label + '-search-no-results')
		await page.keyboard.press('Escape')
		await assertClosed()
	})
}

try {
	await visit('troubleshooting')
	const routes = await page.locator('.VPSidebar a[href]').evaluateAll((elements) => [...new Set(['/Meld/', ...elements.map((element) => element.getAttribute('href'))])])
	for (const dark of [false, true]) {
		await setTheme(dark)
		for (const route of routes) {
			await visit(new URL(route, base).href)
			assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), dark)
			await audit('desktop-' + (dark ? 'dark-' : 'light-') + route)
		}
	}
	await visit()
	await setTheme(false)
	await page.screenshot({ path: join(output, 'desktop-home.png') })
	await check('desktop skip link and content focus', async () => {
		await visit()
		await page.keyboard.press('Tab')
		await assertFocus('.VPSkipLink')
		await page.keyboard.press('Enter')
		await page.waitForFunction(() => document.activeElement?.id === 'VPContent')
	})
	await visit('troubleshooting')
	await check('sidebar click, Space, Enter, state and focus ring', async () => {
		const section = page.getByRole('button', { name: 'Architecture', exact: true })
		await section.click()
		assert.equal(await section.getAttribute('aria-expanded'), 'true')
		await page.keyboard.press('Space')
		assert.equal(await section.getAttribute('aria-expanded'), 'false')
		assert.ok(await section.evaluate((element) => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2))
		await page.keyboard.press('Enter')
		assert.equal(await section.getAttribute('aria-expanded'), 'true')
	})
	await searchChecks('desktop')
	await check('keyboard shortcut restores original link focus', async () => {
		await page.getByRole('link', { name: 'Meld', exact: true }).focus()
		await page.keyboard.press('Control+k')
		await page.locator('#localsearch-input').waitFor()
		await page.keyboard.press('Escape')
		await assertClosed()
		await assertFocus('.VPNavBarTitle a')
	})
	await openSearch('compiling')
	await page.getByRole('button', { name: 'Display detailed list' }).click()
	await page.locator('.excerpt').first().waitFor()
	assert.ok(await page.locator('.excerpt').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).opacity === '1')))
	await audit('desktop-search-details-light')
	await searchContrast('desktop-search-details-light')
	await page.screenshot({ path: join(output, 'desktop-search-details.png') })
	await page.getByRole('button', { name: 'Display detailed list' }).click()
	await page.keyboard.press('Escape')
	await assertClosed()
	await setTheme(true)
	await openSearch('compiling')
	await audit('desktop-search-dark')
	await searchContrast('desktop-search-dark')
	await page.keyboard.press('Escape')
	await assertClosed()
	await setTheme(false)
	for (const width of [1920, 768, 390, 320]) {
		await page.setViewportSize({ width, height: width > 1000 ? 1080 : 844 })
		for (const route of ['', 'development', 'guides/database-editing', 'troubleshooting']) {
			await visit(route)
			await audit('viewport-' + width + '-' + (route || 'home'))
		}
	}
	await page.setViewportSize({ width: 390, height: 844 })
	await visit('development')
	await page.screenshot({ path: join(output, 'mobile-development.png') })
	await check('mobile main navigation keyboard containment and Escape', async () => {
		const menu = page.getByRole('button', { name: 'mobile navigation', exact: true })
		await menu.focus()
		await page.keyboard.press('Enter')
		await page.waitForFunction(() => Boolean(document.activeElement.closest('#VPNavScreen')))
		for (let index = 0; index < 12; index++) {
			await page.keyboard.press('Tab')
			assert.ok(await page.evaluate(() => Boolean(document.activeElement.closest('.VPNav'))))
		}
		await audit('mobile-navigation-open')
		await page.keyboard.press('Escape')
		await page.waitForFunction(() => document.querySelector('.VPNavBarHamburger').getAttribute('aria-expanded') === 'false')
		await assertFocus('.VPNavBarHamburger')
	})
	await check('mobile main navigation opens and closes on selection', async () => {
		const menu = page.getByRole('button', { name: 'mobile navigation', exact: true })
		await menu.click()
		assert.equal(await menu.getAttribute('aria-expanded'), 'true')
		await page.locator('#VPNavScreen').getByRole('link', { name: 'Get started', exact: true }).click()
		await page.waitForURL(new URL('getting-started', base).href)
		assert.equal(await menu.getAttribute('aria-expanded'), 'false')
	})
	await check('mobile sidebar keyboard containment, Escape and selection', async () => {
		const menu = page.getByRole('button', { name: 'Menu', exact: true })
		await menu.click()
		assert.equal(await menu.getAttribute('aria-expanded'), 'true')
		await page.waitForFunction(() => Boolean(document.activeElement.closest('.VPSidebar')))
		for (let index = 0; index < 24; index++) {
			await page.keyboard.press('Tab')
			assert.ok(await page.evaluate(() => Boolean(document.activeElement.closest('.VPSidebar'))))
		}
		await page.keyboard.press('Escape')
		await assertFocus('.VPLocalNav .menu')
		assert.equal(await menu.getAttribute('aria-expanded'), 'false')
		await menu.click()
		await audit('mobile-sidebar-open')
		await page.locator('#VPSidebarNav').getByRole('link', { name: 'Building and development', exact: true }).click()
		await page.waitForURL(new URL('development', base).href)
		assert.equal(await menu.getAttribute('aria-expanded'), 'false')
	})
	await searchChecks('mobile')
	await check('mobile close button and focus restoration', async () => {
		await openSearch('compiling')
		await page.screenshot({ path: join(output, 'mobile-search.png') })
		const before = page.url()
		await page.getByRole('button', { name: 'Close search' }).focus()
		await page.keyboard.press('Enter')
		await assertClosed()
		assert.equal(page.url(), before)
		await assertFocus('#local-search button')
	})
	await check('reduced motion disables transitions', async () => {
		assert.ok(
			await page.evaluate(
				() =>
					matchMedia('(prefers-reduced-motion: reduce)').matches &&
					getComputedStyle(document.querySelector('.VPNavBar'))
						.transitionDuration.split(',')
						.every((duration) => parseFloat(duration) === 0),
			),
		)
	})
	assert.equal(
		report.audits.filter((entry) => entry.violations.length || entry.overflow || entry.imageProblems.length || entry.h1Count !== 1 || entry.mainCount !== 1 || entry.headingSkips.length).length,
		0,
		'Review browser audit findings in report.json',
	)
	assert.equal(report.events.filter((event) => event.type !== 'optional-favicon').length, 0, 'Review browser console/network findings in report.json')
} catch (error) {
	report.failure = error.stack
	process.exitCode = 1
} finally {
	await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
	await browser.close()
	console.log('Browser evidence: ' + output)
	console.log(report.audits.length + ' audits; ' + report.checks.length + ' interaction checks; ' + report.events.length + ' console/network observations (including optional favicon)')
	if (report.failure) console.error(report.failure)
}
