// The Log window's lines also reach the session's log file in the user cache (#319): lines logged here are read back through the SessionLog binding, in order, and stay in the file after the window's log is cleared.
// touches: frontend/src/lib/io/sessionLog.ts, internal/sessionlog/*
const { setStatus, logLine, flushLog, clearLog } = await P.state()
const { SessionLog } = await P.app('/wailsjs/go/main/App.js')
const mark = 'probe-session-log-' + Date.now()
setStatus(mark + ' one', 0)
logLine(mark + ' two')
clearLog()
flushLog()
let text = ''
for (let i = 0; i < 50 && !text.includes(mark + ' two'); i++) {
	await new Promise((r) => setTimeout(r, 200))
	const r = await SessionLog()
	if (r == null) return { ok: false, why: 'SessionLog gave ' + r }
	text = r
}
const lines = text.split('\n').filter((l) => l.includes(mark))
return { ok: lines.length === 2 && lines[0].endsWith(mark + ' one') && lines[1].endsWith(mark + ' two'), lines }
