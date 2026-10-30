<script lang="ts" module>
	import { DEFAULT_ICON_OPTIONS, type IconOptions } from '../lib/wow/iconPicture'

	// The options stay as last set for the session, so a batch of pictures drawn alike takes them once.
	const kept: IconOptions = { ...DEFAULT_ICON_OPTIONS }
</script>

<script lang="ts">
	import { ImportIconPictures, ReadImageFile } from '../lib/wails/App'
	import type { main } from '../lib/wails/models'
	import { base64ToBytes, wailsBytes } from '../lib/io/base64'
	import { ICON_SIZE, iconNameFromFile, iconNameOK, makeIcon } from '../lib/wow/iconPicture'
	import ItemIcon from './ItemIcon.svelte'
	import Modal from './Modal.svelte'

	// The import step of PNG pictures made into icons (#717): each picture's icon as it will be, under
	// the name it takes (its file's, which can be changed), with the options for turning a picture into
	// an icon: Fit to size, Border (the client's grey bevelled frame, drawn here, never copied from the
	// client) and Black background (under the transparent pixels only). The page makes the 64 x 64
	// pixels (lib/wow/iconPicture.ts) and Go writes them into Meld's patch (ImportIconPictures). With
	// `replace` it is the Icons tool's Replace…: one picture, under that name, over the client's icon.

	interface Props {
		/** The PNG files picked. */
		paths: string[]
		/** The icon a Replace… puts the first picture over (its name is kept), shown beside it. */
		replace?: string
		/** After the import, with what it did. */
		ondone: (r: main.IconsImported) => void
		onclose: () => void
	}
	let { paths, replace = '', ondone, onclose }: Props = $props()

	interface Picture {
		path: string
		name: string
		img: ImageBitmap | null
		w: number
		h: number
		error: string
	}

	let pictures = $state<Picture[]>([])
	let options = $state<IconOptions>({ ...kept })
	let busy = $state(false)
	let error = $state('')
	const canvases: HTMLCanvasElement[] = $state([])

	$effect(() => {
		const list = replace ? paths.slice(0, 1) : paths
		pictures = list.map((path) => ({ path, name: replace || iconNameFromFile(path), img: null, w: 0, h: 0, error: '' }))
		list.forEach((path, i) => void load(path, i))
	})

	async function load(path: string, i: number) {
		try {
			const bytes = base64ToBytes(await ReadImageFile(path))
			const img = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
			if (pictures[i]?.path !== path) return
			Object.assign(pictures[i], { img, w: img.width, h: img.height })
		} catch (e) {
			if (pictures[i]?.path === path) pictures[i].error = String(e)
		}
	}

	// Each preview is drawn again when the options or the picture change.
	$effect(() => {
		const o = { ...options }
		Object.assign(kept, o)
		pictures.forEach((p, i) => {
			const c = canvases[i]
			if (!c || !p.img) return
			const ctx = c.getContext('2d')
			if (!ctx) return
			ctx.putImageData(new ImageData(makeIcon(p.img, p.w, p.h, o), ICON_SIZE, ICON_SIZE), 0, 0)
		})
	})

	const ready = $derived(pictures.filter((p) => p.img && iconNameOK(p.name)))
	const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

	async function run() {
		if (!ready.length) return
		busy = true
		error = ''
		try {
			const pics = ready.map((p) => ({ name: p.name, pixels: wailsBytes(new Uint8Array(makeIcon(p.img!, p.w, p.h, options).buffer)) }) as main.IconPicture)
			const r = await ImportIconPictures(pics, !!replace)
			// A picture not read or badly named is refused here, as Go refuses its own.
			const skipped = pictures.filter((p) => !ready.includes(p)).map((p) => `${p.name || fileName(p.path)}: ${p.error || "an icon's name takes only letters, digits, _ and -"}`)
			ondone({ ...r, refused: [...skipped, ...(r.refused ?? [])] })
		} catch (e) {
			error = String(e)
		} finally {
			busy = false
		}
	}
</script>

<Modal title={replace ? `Replace ${replace}` : `Import ${paths.length === 1 ? 'a picture' : `${paths.length} pictures`} as icons`} width={560} {onclose}>
	<div class="import" data-icon-import>
		<fieldset class="options">
			<legend>Make each picture an icon</legend>
			<label title="Scale the whole picture to fit the icon's 64 x 64 (inside the frame with Border), keeping its shape. Off, its middle is cut out at its own size."
				><input type="checkbox" bind:checked={options.fit} /> Fit to size</label
			>
			<label title="Draw the grey bevelled frame the client's icons have, with its cut corners, over the icon's edge"><input type="checkbox" bind:checked={options.border} /> Border</label>
			<label title="Paint black under the picture's transparent pixels (the client's icons are opaque); with Border, inside the frame only"><input type="checkbox" bind:checked={options.background} /> Black background</label>
		</fieldset>
		<ul class="pictures">
			{#each pictures as p, i (p.path)}
				<li>
					<canvas width={ICON_SIZE} height={ICON_SIZE} bind:this={canvases[i]} class:hidden={!p.img} aria-label="The icon {p.name}"></canvas>
					{#if !p.img}<span class="empty">{p.error ? '✕' : '…'}</span>{/if}
					<div class="about">
						{#if replace}
							<p class="name">{p.name}</p>
						{:else}
							<label class="field">Name <input bind:value={p.name} aria-label="Icon name" class:bad={!iconNameOK(p.name)} title="The icon's name: its file under Interface\Icons. Letters, digits, _ and - only." /></label>
						{/if}
						<p class="dim" title={p.path}>{fileName(p.path)}{p.img ? `, ${p.w} x ${p.h}` : ''}</p>
						{#if p.error}<p class="error">{p.error}</p>{/if}
					</div>
					{#if replace}
						<div class="was">
							<ItemIcon icon={replace} size={64} />
							<span class="dim">now</span>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="dim">
			{#if replace}
				The new picture goes into Meld's patch under the same name, so every spell, item and button showing {replace} shows it; the client's own icon is kept, and Delete… brings it back.
			{:else}
				Each icon goes into Meld's patch under Interface\Icons. A name the client has already is refused: to change one of the client's icons, pick it in Tools › Icons and use Replace….
			{/if}
		</p>
		{#if error}<p class="error">{error}</p>{/if}
	</div>
	{#snippet actions()}
		<button class="active" disabled={busy || !ready.length} onclick={run}>{replace ? 'Replace' : ready.length > 1 ? `Import ${ready.length}` : 'Import'}</button>
		<button disabled={busy} onclick={onclose}>Cancel</button>
	{/snippet}
</Modal>

<style>
	.import {
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: 12px;
	}
	.options {
		display: flex;
		gap: 16px;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 6px 10px;
	}
	.options label {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.pictures {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 50vh;
		overflow-y: auto;
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	canvas,
	.empty {
		width: 128px;
		height: 128px;
		flex: none;
		image-rendering: pixelated;
		background: repeating-conic-gradient(var(--border) 0 25%, var(--bg) 0 50%) 0 0 / 16px 16px;
	}
	canvas.hidden {
		display: none;
	}
	.empty {
		display: grid;
		place-items: center;
		color: var(--text-dim);
	}
	.about {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.field input {
		flex: 1;
		min-width: 0;
	}
	input.bad {
		border-color: var(--danger-text);
	}
	.name {
		margin: 0;
		font-size: 14px;
	}
	.was {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.dim {
		color: var(--text-dim);
	}
	.error {
		color: var(--danger-text);
	}
</style>
