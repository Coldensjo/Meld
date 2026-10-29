// A texture's short name for the UI (#593): the file name of a client path without its folder and its
// .blp extension ("Tileset\Elwynn\ElwynnGrassBase.blp" gives "ElwynnGrassBase"). A palette colour
// ("#6a8f3c") has neither, so it comes back as it is.

/** The texture's file name without folder or .blp extension; a colour entry as it is. */
export function texName(path: string): string {
	return path.slice(path.search(/[^\\/]*$/)).replace(/\.blp$/i, '')
}
