// Money as gold, silver and copper with the client's coins (#679): the item editor's Buy price for the Worn Shortsword (25, 35 copper) shows three amounts with a coin image each (cut from Interface\MoneyFrame\UI-MoneyIcons, three different cells), 150 typed as copper is an unsaved edit that rolls over to 1s 50c once the field is left and Revert puts back, the tooltip draws its Sell Price as coins, and the quest editor's Money for Grime-Encrusted Ring (2945, -300) ticks Costs with 3 silver; nothing written.
// touches: frontend/src/components/MoneyField.svelte, frontend/src/components/Money.svelte, frontend/src/components/Coin.svelte, frontend/src/lib/wow/money.ts, frontend/src/lib/wow/coinIcons.ts, frontend/src/components/TemplateFields.svelte, frontend/src/components/ItemTooltipBox.svelte, frontend/src/lib/world/itemFields.ts, frontend/src/lib/world/questFields.ts
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const label = (root, text) => [...(root?.querySelectorAll('.grid > label') ?? [])].find((l) => l.firstChild?.textContent.trim() === text)
const amounts = (l) => [...l.querySelectorAll('.money input[type=number]')].map((i) => i.value)
const loaded = (el) => {
	const imgs = [...(el?.querySelectorAll('img') ?? [])]
	return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0)
}

// The item editor.
const item = () => document.querySelector('[aria-label="Item editor"]')
ui.itemEditor = { entry: 25 }
await P.until(() => item()?.querySelector('h2')?.textContent.includes('Worn Shortsword') && label(item(), 'Buy price'), WAIT, 'the item')
const buy = () => label(item(), 'Buy price')
await P.until(() => loaded(buy()), WAIT, 'the coins')
const before = amounts(buy())
const coins = new Set([...buy().querySelectorAll('img')].map((i) => i.src)).size
const copper = buy().querySelectorAll('.money input[type=number]')[2]
copper.value = '150'
copper.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(1)
const typed = { amounts: amounts(buy()), changed: buy().classList.contains('changed') }
copper.dispatchEvent(new Event('change', { bubbles: true }))
await P.frames(1)
const left = amounts(buy())
button(item().querySelector('header .actions'), 'Revert').click()
await P.frames(2)
const reverted = { amounts: amounts(buy()), changed: buy().classList.contains('changed') }
const sell = [...item().querySelectorAll('.tooltip .line')].find((l) => l.textContent.includes('Sell Price'))
await P.until(() => !sell || loaded(sell), WAIT, 'the sell price coins')
const sellLine = sell ? { text: sell.textContent.replace(/\s+/g, ' ').trim(), coins: sell.querySelectorAll('img').length } : null
ui.itemEditor = null
await P.frames(1)

// The quest editor: a quest that costs money.
const quest = () => document.querySelector('[aria-label="Quest editor"]')
ui.questEditor = { entry: 2945 }
await P.until(() => quest()?.querySelector('h2')?.textContent.includes('Grime-Encrusted Ring') && button(quest().querySelector('nav.tabs'), 'Rewards'), WAIT, 'the quest')
button(quest().querySelector('nav.tabs'), 'Rewards').click()
await P.until(() => label(quest(), 'Money'), WAIT, 'the money field')
const money = label(quest(), 'Money')
const costs = { checked: !!money.querySelector('.costs input')?.checked, amounts: amounts(money) }
ui.questEditor = null
await P.frames(1)

const ok =
	JSON.stringify(before) === JSON.stringify(['', '', '35']) &&
	coins === 3 &&
	typed.changed &&
	JSON.stringify(typed.amounts) === JSON.stringify(['', '', '150']) &&
	JSON.stringify(left) === JSON.stringify(['', '1', '50']) &&
	!reverted.changed &&
	JSON.stringify(reverted.amounts) === JSON.stringify(['', '', '35']) &&
	sellLine?.coins === 1 &&
	costs.checked &&
	JSON.stringify(costs.amounts) === JSON.stringify(['', '3', ''])
return { ok, before, coins, typed, left, reverted, sellLine, costs }
