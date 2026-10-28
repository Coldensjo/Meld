// Which failed probes the runner retries (#388, #628), shared by run.mjs and tests/probeRetry.test.ts.

/**
 * Why a failed probe's result is not worth the runner's one retry, or '' when it is. A probe whose own body ran past its
 * timeout (`timedOut`) would only time out again, doubling a wait that prints nothing (#628), and a SyntaxError or
 * ReferenceError is in the probe's code, not the page, unless it is a load the page lost (an app module imported through
 * P.app while Vite rebuilds it, an error page read as JSON), which a retry gets past. A lost page at setup, a page error,
 * `ok: false` and any other throw (a `P.until` that gave up, a TypeError on page state) keep the retry, which is what
 * finds a flake (#388).
 * @param {{ timedOut?: boolean, error?: string }} out the failed attempt's result line
 */
export const noRetryReason = (out) => {
	if (out.timedOut) return 'timed out: a retry would wait as long again'
	const err = out.error ?? ''
	if (/^(SyntaxError|ReferenceError)\b/.test(err) && !/export named|import|JSON|Unexpected token '<'/.test(err)) return "an error in the probe's own code"
	return ''
}

/**
 * A failed attempt's result as kept in the retry's line (`first`, #624): every field the probe returned and the runner added,
 * less the name and `ok` (the line has them) and the CPU profile (`--profile`), which is long and the retry's own is beside it.
 * @param {Record<string, unknown>} out the failed attempt's result line
 */
export const firstAttempt = (out) => {
	const { probe: _probe, ok: _ok, profile: _profile, ...rest } = out
	return rest
}
