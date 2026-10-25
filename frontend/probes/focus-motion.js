// The app has a focus-visible ring and a reduced-motion rule in app.css (#374).
// touches: frontend/src/app.css
const rules = []
const walk = (list) => {
	for (const r of list) {
		rules.push(r)
		if (r.cssRules) walk(r.cssRules)
	}
}
for (const s of document.styleSheets) {
	try {
		walk(s.cssRules)
	} catch (e) {
		// a cross-origin sheet
	}
}
const ring = rules.find((r) => r.selectorText.includes('[data-kbd-nav] :focus-visible') && r.cssText.includes('outline'))
const reduced = rules.find((r) => r.type === CSSRule.MEDIA_RULE && r.conditionText.includes('prefers-reduced-motion'))
const results = {
	ring: !!ring && /2px solid/.test(ring.cssText),
	noRingOnClick: rules.some((r) => r.selectorText === ':focus-visible' && /outline: none/.test(r.cssText)),
	reducedMotion: !!reduced && /0\.01ms/.test(reduced.cssText),
}
return { ok: Object.values(results).every(Boolean), results }
