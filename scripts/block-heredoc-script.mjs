// PreToolUse hook for Bash (#1052): blocks a heredoc that feeds an edit script with a backslash
// to python, node, bun and the like. The agents' Git Bash halves doubled backslashes in a heredoc
// (CLAUDE.md, Conventions), so such a script must be written with the Write tool and run as a file.
// A commit message heredoc (`git commit -m "$(cat <<'EOF'`) has no interpreter on its line and passes.
// Exit code 2 with a message on stderr blocks the call and shows the message to the agent.

let raw = ''
for await (const chunk of process.stdin) raw += chunk

let command = ''
try {
	command = String(JSON.parse(raw)?.tool_input?.command ?? '')
} catch {
	process.exit(0)
}

const interpreter = /(^|[\s;&|(`])(python3?|py|node|nodejs|bun|bunx|deno|perl|ruby|lua)(\.exe)?(\s[^\n]*)?<<-?\s*(['"]?)\\?(\w+)\5\s*\n/g
for (const m of command.matchAll(interpreter)) {
	const body = command.slice(m.index + m[0].length)
	const end = body.search(new RegExp('^\\s*' + m[6] + '\\s*$', 'm'))
	const script = end < 0 ? body : body.slice(0, end)
	if (script.includes('\\')) {
		process.stderr.write(
			'Blocked: a heredoc holding a script with a backslash. The agents\' Git Bash halves doubled backslashes in a heredoc, which corrupts the script or the file it edits (CLAUDE.md, Conventions). ' +
				'Write the script with the Write tool (or change the file with the Edit tool) and run the file instead.\n',
		)
		process.exit(2)
	}
}
process.exit(0)
