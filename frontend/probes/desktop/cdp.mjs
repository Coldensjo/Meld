// Evaluates a JavaScript file (or an expression) in the built desktop app's main page over the
// DevTools protocol (#989). Start the app with MELD_DEBUG_PORT set:
//   $env:MELD_DEBUG_PORT = '9333'; Start-Process build\bin\Meld.exe
// then: bun frontend/probes/desktop/cdp.mjs [--port 9333] (--file script.js | --expr "document.title")
// The result is printed as JSON. The script runs as an expression, awaited, so a script that ends in
// a value or an async IIFE returns it. The main window's page is http://wails.localhost/; the model
// workers are extra targets of type `worker`, which this skips.
const args = process.argv.slice(2)
const opt = (name, fallback) => {
	const i = args.indexOf('--' + name)
	return i >= 0 ? args[i + 1] : fallback
}
const port = opt('port', process.env.MELD_DEBUG_PORT || '9333')
const file = opt('file')
const expr = opt('expr')
if (!file && !expr) {
	console.error('usage: bun cdp.mjs [--port N] (--file script.js | --expr "js")')
	process.exit(2)
}
const source = file ? await Bun.file(file).text() : expr

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('wails.localhost/'))
if (!page) {
	console.error('no wails.localhost page among: ' + list.map((t) => t.type + ' ' + t.url).join(', '))
	process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
	ws.onopen = resolve
	ws.onerror = () => reject(new Error('websocket failed'))
})
const reply = await new Promise((resolve) => {
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data)
		if (m.id === 1) resolve(m)
	}
	ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: source, awaitPromise: true, returnByValue: true } }))
})
ws.close()
if (reply.error || reply.result?.exceptionDetails) {
	console.error(JSON.stringify(reply.error ?? reply.result.exceptionDetails, null, 2))
	process.exit(1)
}
console.log(JSON.stringify(reply.result.result.value ?? null))
