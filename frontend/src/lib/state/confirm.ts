import { ui } from './editor.svelte'

// The app's own yes/no prompt (#581), in place of the browser's confirm(): themed, it returns the
// focus through `dialogFocus`, it leaves the render loop running, and a probe can answer it (headless
// Chrome dismisses a native prompt). AppDialogs draws `ui.confirm` over whatever dialog asked.

export interface ConfirmOptions {
	/** The dialog's title; "Are you sure?" by default. */
	title?: string
	/** The button that answers yes; "OK" by default. */
	ok?: string
	/** Draw the yes button in the danger colour, for an answer that throws work away; true by default. */
	danger?: boolean
}

let pending: ((yes: boolean) => void) | null = null

/** Shows `text` in the confirm dialog and resolves true when it is answered yes, false on Cancel, Esc or a click outside. */
export function askConfirm(text: string, options: ConfirmOptions = {}): Promise<boolean> {
	// A second question while one is open answers the first no, so no caller waits for ever.
	answerConfirm(false)
	return new Promise((resolve) => {
		pending = resolve
		ui.confirm = { text, title: options.title ?? 'Are you sure?', ok: options.ok ?? 'OK', danger: options.danger ?? true }
	})
}

/** Closes the confirm dialog with the answer (the dialog's buttons, Esc and a probe call this). */
export function answerConfirm(yes: boolean) {
	const resolve = pending
	pending = null
	ui.confirm = null
	resolve?.(yes)
}
