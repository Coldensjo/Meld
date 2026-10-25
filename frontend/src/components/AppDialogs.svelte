<script module lang="ts">
	/** The manual (docs/MANUAL.md in the project's repository), which Help › Manual opens in the browser. */
	export const MANUAL_URL = 'https://github.com/Coldensjo/Meld/blob/main/docs/MANUAL.md'
</script>

<script lang="ts">
	import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
	import Modal from './Modal.svelte'
	import GameLoginDialog from './GameLoginDialog.svelte'
	import ProjectDialog from './ProjectDialog.svelte'
	import FolderSetupDialog from './FolderSetupDialog.svelte'
	import MapPropertiesDialog from './MapPropertiesDialog.svelte'
	import GroundEffectsDialog from './GroundEffectsDialog.svelte'
	import PortalsDialog from './PortalsDialog.svelte'
	import ZonesDialog from './ZonesDialog.svelte'
	import WorldMapDialog from './WorldMapDialog.svelte'
	import LightsDialog from './LightsDialog.svelte'
	import BrushStackDialog from './BrushStackDialog.svelte'
	import TextureLooksDialog from './TextureLooksDialog.svelte'
	import SpawnRulesDialog from './SpawnRulesDialog.svelte'
	import HeightmapImportDialog from './HeightmapImportDialog.svelte'
	import RecoveryDialog from './RecoveryDialog.svelte'
	import FitGroundDialog from './FitGroundDialog.svelte'
	import ErodeDialog from './ErodeDialog.svelte'
	import SmoothAreaDialog from './SmoothAreaDialog.svelte'
	import HotkeyManager from './HotkeyManager.svelte'
	import WeaponPicker, { SLOTS } from './WeaponPicker.svelte'
	import { EquipmentFor } from '../../wailsjs/go/main/App'
	import { setStatus } from '../lib/state/editor.svelte'
	import { appLog, clearLog, docs, editor, prefs, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { saveSpawns } from '../lib/io/compile'
	import { compileAndLaunch, launchGame } from '../lib/io/game'
	import { revertMap } from '../lib/io/mapio'
	import { saveAndPublish } from '../lib/io/publish'
	import { openWowRegion } from '../lib/io/region'
	/** Keeps the Log window scrolled to its newest line while it is open. */
	function stickToEnd(el: HTMLElement) {
		const toEnd = () => (el.scrollTop = el.scrollHeight)
		toEnd()
		const obs = new MutationObserver(toEnd)
		obs.observe(el, { childList: true, subtree: true })
		return { destroy: () => obs.disconnect() }
	}

	function copyLog() {
		const text = appLog.lines.map((l) => `${l.time} ${l.text}`).join('\n')
		void navigator.clipboard?.writeText(text)
	}
	import { quitNow } from '../lib/io/session'
	import { answerConfirm } from '../lib/state/confirm'
	import { APP_VERSION } from '../lib/version'
	import { shortcutSections } from '../lib/ui/commands'

	const close = () => (ui.dialog = null)

	/** The spawn the weapon dialog is for, in the active map. */
	const weaponSpawn = $derived.by(() => {
		const p = ui.weaponPick
		return p ? (engineRef.current?.activeDocument().spawnLayer.get(p.key) ?? null) : null
	})

	/** Puts item `entry` (0 for none) in the dialog's slot: the equipment template with those items becomes the spawn's. */
	async function pickWeapon(entry: number) {
		const p = ui.weaponPick
		const s = weaponSpawn
		const engine = engineRef.current
		if (!p || !s || !engine) return close()
		const items = [...(s.equipItems ?? [0, 0, 0])] as number[]
		while (items.length < 3) items.push(0)
		items[p.slot] = entry
		close()
		try {
			const equipment = await EquipmentFor(items)
			await engine.editSpawn(p.key, { equipment, equipItems: items }, `${SLOTS[p.slot]} (${s.name})`)
		} catch (err) {
			setStatus(`Equipping failed: ${err}`, 8000)
		}
	}

	// The texture dialog's choices: palette indices.
	let texFrom = $state(0)
	let texTo = $state(1)
	const textureName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

	/** The help window's sections: a title and short paragraphs each (Help › Help…, F1). */
	const HELP: Array<[string, string[]]> = [
		[
			'Getting started',
			[
				'Preferences › WoW client folder points Meld at your 1.12 client. Its doodads, buildings and tileset textures then fill the asset browser along the bottom; nothing is copied out of it.',
				'File › New World (Ctrl+N) makes a world of a few tiles from a preset, and File › Open Part of Azeroth opens a square of tiles of a continent with its ground, textures, models and water.',
				"Save (Ctrl+S) writes a .wmap file; for a map made for the client it also offers Publish, which writes the tiles into the client and builds the server's files. A part of Azeroth goes back into the game with File › Compile to Client (its tiles in the client's patch), Compile to Server (the server's map data, built from those tiles) or Compile All (both); Launch asks first when the open region has edits the client lacks.",
			],
		],
		[
			'Tools (keys 1 to 9, 0 and K)',
			[
				'Select (1): click a model, Shift+click adds one, drag moves the selection; drag on the ground to select an area and the models in it. Alt+click is the pipette. I opens the Inspector with the placement numbers.',
				'Sculpt (2): raise, lower, smooth, flatten, noise, mountain, crevice, terrace (levels of a set step; Shift+drag keeps the level of the first click), erode (water carving gullies, or thermal sliding off slopes steeper than the talus angle; Terrain › Erode does a whole area, and Terrain › Smooth Selection runs smooth over one), vertex and hole modes. Painting while shaping paints a texture, or rock and dirt by slope, under the brush as the ground moves.',
				'Paint (3): paints the texture picked in the browser; a chunk of 8x8 cells takes four textures, and the Layers panel shows the ones under the cursor. Mask mode marks ground to fill with one texture.',
				"Roads (4) paint a hard-edged texture and level the ground across it. Water (5) paints lakes and rivers by liquid type, or shapes the sea's shore; the sea level is in Map Properties.",
				'Place (6) puts down the model picked in the browser, onto the ground or onto a building. Clear (7) wipes textures or models under the brush. Doodad brush (8) scatters a brush of weighted models like paint; World › Doodad Brushes makes brushes. Map data (9) paints the zone each chunk belongs to, which the export writes into the tiles; Alt+click takes the zone of the chunk under the cursor.',
				'Stamp (0) applies a stack of sculpt and paint brushes in one stroke (Edit stack in the options bar). Paths (K) draws a road, river or fence along a curve of points, then Apply levels, carves, paints, fills or fences along it.',
			],
		],
		[
			'Brushes and undo',
			[
				'[ and ] step the brush size, Shift+[ and Shift+] the falloff, and Alt+right-drag sizes the brush where it stands. Ctrl+scroll also steps the size.',
				'Every edit is undoable with Ctrl+Z and Ctrl+Y, including strokes, placements, water and spawn changes.',
			],
		],
		[
			'Camera and view',
			[
				'Right-drag looks around, W A S D fly, Space and X go up and down, the wheel sets the speed; T follows the ground, so the camera orbits a point on it. F focuses the selection.',
				'Lighting has the time of day, shadows and fog, and View the grid and chunk lines and the layers to show. Tab hides every panel but the menu bar. Hold F8 to name the part of the UI under the cursor for a bug report.',
			],
		],
	]

	/** Help › Keyboard Shortcuts' rows, from the shortcut table the key handler and the menus use (#583), with the Hotkey Manager's bindings (#396). */
	const SHORTCUTS = $derived(shortcutSections())
</script>

{#if ui.dialog === 'about'}
	<Modal title="About Meld" onclose={close}>
		<div class="about">
			<div class="logo">⛰</div>
			<div>
				<p class="name">Meld <span>v{APP_VERSION}</span></p>
				<p>A 3D world editor for building WoW-style landscapes: sculpt terrain, paint textures, shape water and roads, and place doodads and buildings.</p>
				<p class="dim">Built with Wails (Go), Svelte 5 and Three.js.</p>
				<p class="dim">
					Models and textures are read at runtime from your own World of Warcraft 1.12 client. No game assets are included with or distributed by this application. World of Warcraft is a trademark of Blizzard Entertainment, Inc.;
					this project is not affiliated with or endorsed by Blizzard.
				</p>
			</div>
		</div>
		{#snippet actions()}
			<button class="active" onclick={close}>Close</button>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'help'}
	<Modal title="Help" width={560} onclose={close}>
		{#each HELP as [title, paragraphs] (title)}
			<h3>{title}</h3>
			{#each paragraphs as text (text)}
				<p class="help">{text}</p>
			{/each}
		{/each}
		<p class="dim">The manual has every tool, menu and format in full.</p>
		{#snippet actions()}
			<button onclick={() => (hasBackend() ? BrowserOpenURL(MANUAL_URL) : window.open(MANUAL_URL, '_blank', 'noopener'))}>Open the manual</button>
			<button onclick={() => (ui.dialog = 'shortcuts')}>Keyboard shortcuts</button>
			<button class="active" onclick={close}>Close</button>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'log'}
	<Modal title="Log" width={640} onclose={close}>
		<div class="log" use:stickToEnd>
			{#each appLog.lines as l, i (i)}
				<div><span class="time">{l.time}</span>{l.text}</div>
			{:else}
				<p class="dim">Nothing yet. Status messages, the progress of exports and (with Preferences › Log file loading) every file read from the client appear here.</p>
			{/each}
		</div>
		{#snippet actions()}
			<label class="check"><input type="checkbox" bind:checked={prefs.logFileLoading} /> Log file loading</label>
			<button onclick={copyLog} disabled={!appLog.lines.length}>Copy</button>
			<button onclick={clearLog} disabled={!appLog.lines.length}>Clear</button>
			<button class="active" onclick={close}>Close</button>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'shortcuts'}
	<Modal title="Keyboard Shortcuts" width={520} onclose={close}>
		{#each SHORTCUTS as [group, rows] (group)}
			<h3>{group}</h3>
			<table>
				<tbody>
					{#each rows as row (row.id)}
						<tr><td><kbd>{row.keys || '(none)'}</kbd></td><td>{row.desc}</td></tr>
					{/each}
				</tbody>
			</table>
		{/each}
		{#snippet actions()}
			<button onclick={() => (ui.dialog = 'hotkeys')}>Change keys…</button>
			<button class="active" onclick={close}>Close</button>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'closeDoc'}
	{@const tab = docs.tabs.find((t) => t.id === ui.closeDocId)}
	<Modal title="Unsaved changes" width={380} onclose={close}>
		<p>“{tab?.name ?? 'This map'}” has unsaved changes. Close it anyway?</p>
		{#snippet actions()}
			<button onclick={close}>Cancel</button>
			<button
				class="danger"
				onclick={() => {
					engineRef.current?.closeDocument(ui.closeDocId)
					close()
				}}>Close without saving</button
			>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'revert'}
	<Modal title="Revert to saved" width={380} onclose={close}>
		<p>Discard the unsaved changes to “{editor.mapName}” and reload it from {editor.filePath}? This can't be undone.</p>
		{#snippet actions()}
			<button onclick={close}>Cancel</button>
			<button
				class="danger"
				onclick={() => {
					const engine = engineRef.current
					close()
					if (engine) revertMap(engine)
				}}>Revert</button
			>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'saveSpawns'}
	<Modal title="Save spawns to the world database" width={400} onclose={close}>
		<p>
			Write {ui.spawnChanges}
			{ui.spawnChanges === 1 ? 'change' : 'changes'} to the creatures and game objects of {editor.region} into the server's world database?
		</p>
		<p class="dim">The world database keeps no undo. The SQL that is run is kept in the user cache folder (Meld/spawn-sql). Restart the world server to see the changes in the game.</p>
		{#snippet actions()}
			<button onclick={close}>Cancel</button>
			<button
				class="active"
				onclick={() => {
					const e = engineRef.current
					close()
					if (e) saveSpawns(e)
				}}>Save</button
			>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'compileBeforeLaunch'}
	<Modal title="Edits not in the game yet" width={420} onclose={close}>
		<p>{ui.uncompiledRegion} has edits to its ground, textures, models or water that the client doesn't have yet, so the game would show it as it was.</p>
		<p class="dim">Compile and Launch writes them into the client's tiles first (File › Compile to Client). The server's map data is left as it is: File › Compile to Server rebuilds it.</p>
		{#snippet actions()}
			<button onclick={close}>Cancel</button>
			<button
				onclick={() => {
					close()
					void launchGame(engineRef.current, { anyway: true })
				}}>Launch Anyway</button
			>
			<button
				class="active"
				onclick={() => {
					const e = engineRef.current
					close()
					if (e) void compileAndLaunch(e)
				}}>Compile and Launch</button
			>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'publish'}
	<Modal title="Publish to the server" width={400} onclose={close}>
		<p>Publishing rebuilds this map for the server and the client. It writes the map into your WoW client's patch, then extracts this map again for the server (well under a minute).</p>
		<p class="warn">Meld closes and starts nothing: close World of Warcraft and stop the world server, and the publish goes on once they have stopped. Start them again afterwards.</p>
		{#snippet actions()}
			<button onclick={close}>Cancel</button>
			<button
				class="active"
				onclick={() => {
					const e = engineRef.current
					close()
					if (e) saveAndPublish(e)
				}}>Save and publish</button
			>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'textures'}
	<Modal title="Replace textures" width={380} onclose={close}>
		<p class="dim">Replaces a texture everywhere on the map. A chunk that already uses the new texture merges the two.</p>
		<div class="fields">
			<label for="tex-from">Replace</label>
			<select id="tex-from" bind:value={texFrom}>
				{#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
			</select>
			<label for="tex-to">With</label>
			<select id="tex-to" bind:value={texTo}>
				{#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
			</select>
		</div>
		{#snippet actions()}
			<button onclick={close}>Cancel</button>
			<button
				title="Make the whole map the texture on the right"
				onclick={() => {
					engineRef.current?.fillTextures(texTo)
					close()
				}}>Fill whole map</button
			>
			<button
				class="active"
				disabled={texFrom === texTo}
				onclick={() => {
					engineRef.current?.swapTexture(texFrom, texTo)
					close()
				}}>Replace</button
			>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'effects'}
	<GroundEffectsDialog onclose={close} />
{:else if ui.dialog === 'zones'}
	<ZonesDialog onclose={close} />
{:else if ui.dialog === 'worldMap'}
	<WorldMapDialog onclose={close} />
{:else if ui.dialog === 'portals'}
	<PortalsDialog onclose={close} />
{:else if ui.dialog === 'lights'}
	<LightsDialog onclose={close} />
{:else if ui.dialog === 'stack'}
	<BrushStackDialog onclose={close} />
{:else if ui.dialog === 'looks'}
	<TextureLooksDialog onclose={close} />
{:else if ui.dialog === 'spawnRules'}
	<SpawnRulesDialog onclose={close} />
{:else if ui.dialog === 'heightmap'}
	<HeightmapImportDialog onclose={close} />
{:else if ui.dialog === 'watermap'}
	<HeightmapImportDialog water onclose={close} />
{:else if ui.dialog === 'weapon' && ui.weaponPick}
	<Modal title="{SLOTS[ui.weaponPick.slot]}{weaponSpawn ? ` of ${weaponSpawn.name}` : ''}" width={980} onclose={close}>
		<WeaponPicker which={ui.weaponPick.slot} selected={weaponSpawn?.equipItems?.[ui.weaponPick.slot] ?? 0} onpick={pickWeapon} />
	</Modal>
{:else if ui.dialog === 'mapProps'}
	<MapPropertiesDialog onclose={close} />
{:else if ui.dialog === 'quit'}
	<Modal title="Unsaved changes" width={380} onclose={close}>
		<p>Some open maps have unsaved changes. Quit anyway?</p>
		{#snippet actions()}
			<button onclick={close}>Cancel</button>
			<button class="danger" onclick={() => quitNow()}>Quit without saving</button>
		{/snippet}
	</Modal>
{:else if ui.dialog === 'gameLogin'}
	<GameLoginDialog />
{:else if ui.dialog === 'recovery'}
	<RecoveryDialog onclose={close} />
{:else if ui.dialog === 'fitGround'}
	<FitGroundDialog onclose={close} />
{:else if ui.dialog === 'erode'}
	<ErodeDialog onclose={close} />
{:else if ui.dialog === 'smoothArea'}
	<SmoothAreaDialog onclose={close} />
{:else if ui.dialog === 'hotkeys'}
	<HotkeyManager onclose={close} />
{:else if ui.dialog === 'project'}
	<ProjectDialog onclose={close} />
{:else if ui.dialog === 'folderSetup'}
	<FolderSetupDialog onclose={close} />
{/if}

<!-- Over every other dialog and editor, so it can ask for the one that is open (#581). -->
{#if ui.confirm}
	<Modal title={ui.confirm.title} width={380} onclose={() => answerConfirm(false)}>
		<p>{ui.confirm.text}</p>
		{#snippet actions()}
			<button data-confirm="no" onclick={() => answerConfirm(false)}>Cancel</button>
			<button data-confirm="yes" class={ui.confirm?.danger ? 'danger' : 'active'} onclick={() => answerConfirm(true)}>{ui.confirm?.ok}</button>
		{/snippet}
	</Modal>
{/if}

<style>
	.fields {
		display: grid;
		grid-template-columns: 56px 1fr;
		gap: 8px;
		align-items: center;
		margin-top: 10px;
	}
	.about {
		display: flex;
		gap: 14px;
	}
	.logo {
		font-size: 40px;
		line-height: 1;
		color: var(--accent-text);
	}
	.name {
		margin-top: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.name span {
		font-weight: 400;
		color: var(--text-dim);
		font-size: 13px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	h3 {
		margin-top: 12px;
	}
	.help {
		margin: 4px 0;
		font-size: 12.5px;
		line-height: 1.45;
	}
	.log {
		max-height: calc(60 * var(--vh));
		overflow: auto;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-all;
	}
	.log .time {
		color: var(--text-dim);
		margin-right: 8px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-right: auto;
		font-size: 12px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	td {
		padding: 3px 0;
		vertical-align: top;
	}
	td:first-child {
		width: 46%;
	}
	.danger {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--accent-ink);
	}
</style>
