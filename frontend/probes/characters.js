// The Characters and Accounts tool (#855): Tools › Characters and Accounts… lists the realm's accounts, an account's page lists its characters, and a character's page shows its fields; a new level is an unsaved edit (Save character (1)), Revert drops it, a value Go refuses outlines its field (SaveCharacter stood in, so nothing is written), and the New account form asks for a name and password. Nothing is saved: Go's rules (the SRP6 verifier, online and rename refusals) are tests in internal/vmangos/accounts_test.go.
// touches: frontend/src/components/CharacterEditor.svelte, internal/vmangos/accounts.go, app_characters.go, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts
const { ui } = await P.state()
const App = window.go.main.App
const accounts = await App.ListAccounts().catch((err) => String(err))
if (typeof accounts === 'string') return { ok: true, skipped: `the server's databases can't be read: ${accounts}` }
const withChars = (accounts ?? []).find((a) => a.characters > 0)
if (!withChars) return { ok: true, skipped: 'no account on the server has a character' }

const WAIT = 60_000
const root = () => document.querySelector('[aria-label="Characters and accounts"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const label = (text) => [...root().querySelectorAll('.grid > label, .grid > .field')].find((l) => l.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}

ui.characterEditor = { account: 0, guid: 0 }
await P.until(() => root()?.querySelector('[aria-label="Accounts"] button'), WAIT, 'the accounts')
const listed = root().querySelectorAll('[aria-label="Accounts"] button').length

button(root().querySelector('[aria-label="Accounts"]'), withChars.name).click()
await P.until(() => root().querySelector('[aria-label="Characters"] button'), WAIT, 'the characters')
const chars = root().querySelectorAll('[aria-label="Characters"] button').length
const deleteOff = button(root(), 'Delete account').disabled

root().querySelector('[aria-label="Characters"] button').click()
await P.until(() => label('Level')?.querySelector('input')?.value, WAIT, 'the character')
const name = label('Name').querySelector('input').value
const level = Number(label('Level').querySelector('input').value)
type(label('Level').querySelector('input'), String(level === 60 ? 59 : level + 1))
await P.frames(1)
const saveText = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
const marked = label('Level').classList.contains('changed')

// A refused value outlines its field; the stand-in keeps the database untouched.
const real = App.SaveCharacter
let sent = null
App.SaveCharacter = async (guid, values) => {
	sent = values
	return { sql: '', refused: { column: 'level', message: 'Probe: refused' } }
}
try {
	button(root().querySelector('header .actions'), 'Save').click()
	await P.until(() => root().querySelector('.bar.error'), WAIT, 'the refusal')
} finally {
	App.SaveCharacter = real
}
const refusedShown = root().querySelector('.bar.error').textContent.includes('Probe: refused')
const outlined = label('Level').classList.contains('refused')

button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(1)
const reverted = Number(label('Level').querySelector('input').value) === level && button(root().querySelector('header .actions'), 'Saved')?.disabled === true

button(root().querySelector('aside'), 'New account').click()
await P.until(() => button(root(), 'Make account'), WAIT, 'the new account form')
const makeOff = button(root(), 'Make account').disabled

button(root().querySelector('header .actions'), 'Close').click()
await P.frames(1)
const closed = !root() && ui.characterEditor === null

const ok = listed > 0 && chars === withChars.characters && deleteOff && !!name && saveText === 'Save character (1)' && marked && sent?.level !== undefined && refusedShown && outlined && reverted && makeOff && closed
return { ok, listed, account: withChars.name, chars, deleteOff, name, level, saveText, marked, sent, refusedShown, outlined, reverted, makeOff, closed }
