/**
 * Gives the editor a turn between slices of long work. A message, not a timeout: a hidden window
 * throttles timeouts to one a second. One channel serves every caller, so a long bake does not
 * make a channel a slice.
 */
let channel: MessageChannel | null = null
const waiting: Array<() => void> = []

export function yieldToFrame(): Promise<void> {
	if (!channel) {
		channel = new MessageChannel()
		channel.port1.onmessage = () => waiting.shift()?.()
	}
	return new Promise<void>((done) => {
		waiting.push(done)
		channel!.port2.postMessage(0)
	})
}
