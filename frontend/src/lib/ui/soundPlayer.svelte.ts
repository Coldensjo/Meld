// One sound at a time from the client (#674): a Play button plays a sound file under Sound\ through
// the asset server's /wow/sound (WAV or MP3, which the WebView plays itself), and the next Play, or
// the same one again, stops it. The sound pickers share it, so two never play over each other.

export const soundPlayer = $state({ playing: '' })

let audio: HTMLAudioElement | null = null

/** Plays a client sound file, or stops it when it is the one playing; `onerror` hears of a file the WebView can't play. */
export function playSound(file: string, onerror?: (message: string) => void) {
	audio?.pause()
	audio = null
	if (!file || soundPlayer.playing === file) {
		soundPlayer.playing = ''
		return
	}
	const a = new Audio(`/wow/sound?path=${encodeURIComponent(file)}`)
	audio = a
	const done = () => {
		if (audio === a) soundPlayer.playing = ''
	}
	a.onended = done
	a.onerror = () => {
		done()
		onerror?.(`The client's ${file} could not be played.`)
	}
	soundPlayer.playing = file
	void a.play().catch(done)
}

/** Stops the sound playing, if any (a picker closing). */
export function stopSound() {
	audio?.pause()
	audio = null
	soundPlayer.playing = ''
}
