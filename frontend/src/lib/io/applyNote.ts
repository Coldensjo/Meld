// What the author does for a save to show in the game (#661): Meld never closes or restarts the game
// or the servers, so a save says what waits for them.

/** A save's result: its client files wait for the game to close, or the running world server reads it only at its start. */
export interface ApplyState {
	waiting?: boolean
	restart?: boolean
}

/** The sentences (each with a leading space) that tell the author to close the game or restart the world server; '' when neither is needed. */
export function applyNote(r: ApplyState): string {
	let note = ''
	if (r.waiting) note += " The game is running, so the client's files wait for it: close the game to apply them."
	if (r.restart) note += ' Restart the world server for it to read them.'
	return note
}
