// Run: bun scripts/block-heredoc-script.test.mjs
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const hook = fileURLToPath(new URL('./block-heredoc-script.mjs', import.meta.url))
const run = (command) => spawnSync('bun', [hook], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' }).status

const bs = '\\'
const cases = [
	[`python - <<'EOF'\nprint("a${bs}${bs}n")\nEOF`, 2],
	[`node <<EOF\nconsole.log('x${bs}n')\nEOF`, 2],
	[`python - <<'EOF'\nprint(1)\nEOF`, 0],
	[`git commit -m "$(cat <<'EOF'\nFix C:${bs}WoW paths\n\nCo-Authored-By: x\nEOF\n)"`, 0],
	[`cat <<'EOF' > f.txt\na${bs}b\nEOF`, 0],
	[`ls`, 0],
]
let bad = 0
for (const [cmd, want] of cases) {
	const got = run(cmd)
	if (got !== want) {
		bad++
		console.log('FAIL', JSON.stringify(cmd), 'want', want, 'got', got)
	}
}
console.log(bad ? `${bad} failed` : 'ok')
process.exit(bad ? 1 : 0)
