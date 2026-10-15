# PROGRESS.md: log of loop runs

The loop appends one entry per finished item, and one entry per run that stops early. Newest entries
go at the bottom. Earlier work is recorded in git history and in noggit3-feature-gap.md, not here.

Entry format:

```
## YYYY-MM-DD · B-0NN Title · commit <short-hash>
- Done: what changed, in one or two lines.
- Verified: which checks ran and passed (make test, make check, make build-windows, make build-linux),
  and anything not run with the reason.
- Left: follow-ups, or "none". New ideas are added to BACKLOG.md, not here.
```

Stopped runs use `## YYYY-MM-DD · stopped` and say why.

---

## 2026-10-11 · B-002 Flatten variants · commit 44cfb98
- Done: Sculpt's Flatten mode gets two options. "To average height" levels to the mean height under the brush at the start of the stroke, and "Raise only" / "Lower only" move ground only toward the target. The default (clicked height, raise and lower) is unchanged.
- Verified: make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). The app was not run, so the new options were not checked on screen. The owner's uncommitted wailsjs and go.mod changes were left unstaged and unchanged by the build.
- Left: linear, smooth and smooth-inner variants, logged as B-018 in BACKLOG.md.

## 2026-10-11 · B-001 Edit-mode limits · commit 472a5ef
- Done: Sculpt gets an edit limit: any height, only above the cursor's height, or only below it. Every sculpt mode checks each vertex against the height under the cursor before it changes the ground.
- Verified: make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). The app was not run, so the limit was not checked on screen. The owner's uncommitted wailsjs and go.mod changes were left unstaged and unchanged by the build.
- Left: Road and Water tools don't use the limit yet, logged as B-019 in BACKLOG.md.

## 2026-10-11 · B-035 Tilt and roll in the object list · commit 2af56e9
- Done: The object list text gets two more tab-separated columns, tilt forward-back and roll, in radians. Lists with the old six columns still read, with no tilt. A tilt that is not a number is reported as a bad line.
- Verified: frontend/tests/objectList.test.ts passed, 6 of 6, run with node --test (make test doesn't run frontend tests). make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app. The owner's uncommitted changes were left unstaged and unchanged by the build.
- Left: this changes the text format. Older Meld builds reject the new eight-column lines. Recorded here because the format was not in the backlog's needs-approval list.

## 2026-10-11 · B-019 Edit limit for Road and Water · commit 3cc0fba
- Done: The Road level step and both Water modes (dig lake, raise shore) now use the Sculpt edit limit (any height, only above or below the cursor). The limit select shows in the Road and Water option bars. It is the same setting as Sculpt's.
- Verified: make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). The app was not run, so the limit on Road and Water was not checked on screen. The owner's uncommitted wailsjs and go.mod changes were left unstaged and unchanged by the commit.
- Left: none. The backlog and gap-doc updates are in the next commit. B-019 is removed from BACKLOG.md as done, in the cleanup pass.

## 2026-10-11 · B-018 Flatten linear, smooth and smooth-inner · left unfinished
- Done: nothing. No commit.
- Verified: not run.
- Left: noggit3-feature-gap.md does not define what linear, smooth and smooth-inner do, and linear would need a stroke direction. Building them now would mean inventing behaviour. The owner needs to say what each mode should do. B-018 stays open in BACKLOG.md.

## 2026-10-11 · B-011 Brushed texture swap · commit 652e4be
- Done: Paint has a Paint / Swap switch. In Swap, the texture under the start of a stroke is the source, and the brush moves its weight onto the active layer, in that chunk's slots, as one undoable stroke. The source is read where the stroke starts because the gap doc doesn't say how it is picked. A chunk with four textures and no slot for the active one refuses the stroke with the existing message.
- Verified: frontend tests (node --test): swapPaint, chunkPaint and brush, 26 of 26 passed. make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app, so the Swap switch and the stroke were not seen on screen. The owner's uncommitted wailsjs and go.mod changes were left unstaged and unchanged.
- Left: B-102 (the mask mode has no switch) and B-103 (emptied slots stay assigned), both logged in BACKLOG.md. B-011 is removed from BACKLOG.md as done, in the cleanup pass.

## 2026-10-11 · items left open for owner decisions
- B-003 Vertex edit mode: "oriented from the mouse or from the selection centre" is not defined.
- B-005 Tablet pressure: the gap doc names radius or speed and one on/off setting; the owner needs to pick which, and what a mouse does.
- B-008 Seam fix: the render chunks share edge vertices, so no seam is expected from the code; an in-app check is needed.
- B-010 Spray mode: defined by pen pressure, which depends on B-005.
- B-012 Remove duplicate texture layers: needs a check on imported tiles to see whether duplicates occur.
- B-031 Rotate around a pivot: the pivot point is not defined.
- B-033 Selective paste: the unchosen fields' behaviour on paste is not defined.
- B-034 Hide models: not defined whether the hidden list is session-only or saved in the map file.
- B-037 Mouse-move snap modes: the gap doc doesn't say how the two modes differ.
- B-052 Reload tile from disk: not started; it must re-read the tile's objects and paint too, so it is larger than S/M.

## 2026-10-11 · stopped
- Stopped early: none of the stop conditions held. The run did not reach the 8-item cap, and the list was not exhausted. The items above were judged blocked or larger than estimated. The rest of tier 2 (for example B-006 and B-007) and all of tiers 3 to 6 were not looked at beyond their backlog lines.
- Next top item: B-008 Seam fix, which needs an in-app check first.

## 2026-10-12 · owner decisions recorded in IDEAS.md · no commit
- Done: Not a loop item. The owner asked for the blanks in the 2026-10-11 open list to be filled from noggit3, keeping ours where ours is better. IDEAS.md (new) records each decision. BACKLOG.md now shows each open item as decided, and seven are unblocked and eligible for the loop: B-003, B-005, B-010, B-031, B-034, B-037 and B-052. B-008, B-012 and B-033 are dropped, and the smooth-inner part of B-018 is parked, all in BACKLOG's Parked section. LOOP.md now reads IDEAS.md.
- Verified: doc changes only. No code changed, so no make checks were run.
- Left: the in-app check for B-008 (seam) is no longer required, because the item is dropped. B-102 and B-103 were not part of the decisions and are still open.

## 2026-10-12 · B-102 Mask paint mode has no switch · commit 8d78b5a
- Done: Paint options get a Mask button beside Paint and Swap, so paintMode can be set to mask and the mask strokes and Fill mask can be reached.
- Verified: make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Frontend node tests: brush, chunkPaint, swapPaint, clearTool, liquidLayer, objectList and spawnInfo passed, 45 of 45. tileImport and vmangosExport fail to load under node --test, before this item (logged as B-104). Not checked in the app, so the Mask button was not seen on screen.
- Left: the owner may want the mask kept or removed. The owner's uncommitted BACKLOG.md and PROGRESS.md changes were left unstaged.

## 2026-10-12 · B-103 Emptied texture slots stay assigned · commit 73c522a
- Done: When a stroke ends, each chunk it touched frees any texture slot that no texel in that chunk uses, and the remaining slots move down so slot 0 stays the base. The splat undo rect grows to cover the whole chunk, since its weights are reordered. Paint, Swap, Clear textures, Fill mask and paste all go through this stroke-end pass.
- Verified: make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Two new compactChunk tests were added to chunkPaint.test.ts; chunkPaint, brush, swapPaint, clearTool, liquidLayer, objectList and spawnInfo passed, 47 of 47 with the new tests. Not checked in the app: a chunk that hit four textures after a texture was painted away was not reproduced on screen.
- Left: the slot is freed at stroke end, so within one stroke a chunk can still refuse a new texture after another has been painted away. The owner's uncommitted BACKLOG.md and PROGRESS.md changes were left unstaged.

## 2026-10-12 · B-037 Mouse-move snap · left unfinished
- Done: nothing committed. The single-model checkbox needs a drag plane facing the camera, and ToolContext has no camera. The owner has not defined what a parented model does in that mode. The multiple-models checkbox needs multi-selection (B-032), which the app doesn't have yet.
- Verified: not run.
- Left: B-037 stays open in BACKLOG.md with the reasons. Needs the owner's rule for a parented model in the off mode, and B-032 before the group checkbox.

## 2026-10-12 · stopped
- Stopped early: the context budget for this run was getting full after two items, so the loop stopped between items. The rest of the eligible list was not started.
- Next top item: B-010 Spray mode (M/S), then B-052 Revert to saved map (M/S).

## 2026-10-12 · B-010 Spray mode · commit b6435ef
- Done: Paint mode has a Spray checkbox, toggled with T. While held, random dabs land inside the brush circle, with Dab size (1 to 40), Pressure (0 to 10, the dab density) and Inner radius, which also paints the brush's solid centre. Dab count follows noggit3's grid chance (Pressure/1000 per grid point a quarter dab apart), drawn as random points and scaled to 60 Hz so it doesn't depend on the frame rate. Strokes record undo like ordinary painting.
- Verified: new spray.test.ts plus brush, chunkPaint and swapPaint, 34 of 34 passed (node --test). make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app, so the spray pattern was not seen on screen.
- Left: IDEAS.md called Size "the scatter radius"; noggit3's code uses it for the dab size, so the loop followed the code and recorded the correction in IDEAS.md for the owner.

## 2026-10-12 · B-052 Revert to saved map · commit 90a4787
- Done: File › Revert to Saved re-reads the active map's `.wmap` into the same tab, keeping the camera and bookmarks. With unsaved changes it asks first. Unsaved edits and the undo history are dropped, as closing and reopening the map would; Revert itself is not an undo step. It is disabled for a map that has never been saved.
- Verified: make test passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). No frontend test: the change is engine and UI wiring. Not checked in the app.
- Left: a region map's creature and object spawns are not re-read on revert, the same as when a `.wmap` is opened.

## 2026-10-12 · B-104 Frontend tests fail to load · commit 57bb72a
- Done: The load failure did not reproduce. tileImport and vmangosExport load and pass when run with `--import ./tests/register.mjs`, whose resolve hook already adds `.ts`; the failure came from running them without it. The item's other half is fixed: `pnpm test` runs every `tests/*.test.ts` through the hook, and `make test` runs it after the Go tests. CLAUDE.md's command list says so.
- Verified: make test passed, Go packages plus 65 of 65 frontend tests. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Nothing shows on screen.
- Left: the frontend tests need Node 22.18 or later (type stripping on by default); this machine has 24.18. The Linux machine's Node version was not checked.

## 2026-10-12 · B-034 Hide models · commit 515e94e
- Done: With a model selected in the Select or Place tool, H hides it for the session and deselects it. Edit › Show Hidden Models draws hidden models again, so they can be picked and H shows one again. Shift+H, or Edit › Unhide All Models, shows them all. Hidden models are left out of drawing, picking and prop flames and lights. The hidden list is per placed object and per map tab, and is not saved or undoable, as IDEAS.md decided.
- Verified: make test passed (Go plus 65 of 65 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: a hidden model's attachments stay visible, since hiding is per object. The overlap warning on a selected model still counts hidden models. Both are logged in BACKLOG.md.

## 2026-10-12 · B-005 Tablet pressure · commit 343b4b9
- Done: Camera › Tablet support (pen pressure), a saved preference, off by default. With it on and a pen drawing, every Sculpt mode's speed and Paint's strength (paint, spray dabs, swap) are the Strength slider times the pen's pressure. A mouse, and the Mask brush, are unchanged. Radius never follows pressure.
- Verified: make test passed (Go plus 65 of 65 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or with a pen; there is no tablet on this host.
- Left: noggit3 replaces the slider with the pressure; the loop multiplied instead and recorded why in IDEAS.md.

## 2026-10-12 · B-030 Follow-ground rotation · commits b47461b, 7a77640
- Done: The Select tool has a Follow ground rotation checkbox, with Smooth. While a model is dragged along the ground, its tilts are set so its up axis matches the ground's normal at its position; Smooth takes the slope over a cell each way, otherwise the slope right under it. Dragging onto another model leaves the tilt alone. The drag is one undo step as before. A separate fix (b47461b): undoing a move now clears a tilt the object didn't have before, which a tilting drag would otherwise leave behind.
- Verified: new groundTilt.test.ts (3 tests, including that the tilts map the model's up axis onto the normal through three's YXZ Euler). make test passed (Go plus 68 of 68 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: off by default. noggit3 has it on, but on by default would overwrite hand-set tilts on every drag, so the loop kept the current behaviour as the default; recorded in IDEAS.md. noggit3 applies it only to drags, not to placement; placement with ground tilt is logged as B-107. B-039 was the same noggit checkbox and is closed with this item.

## 2026-10-12 · B-003 Vertex edit mode · commit 255feb8
- Done: Sculpt has a Vertex mode, after noggit3's. Dragging the brush selects heightmap vertices, drawn as orange dots; Ctrl or Alt+drag deselects. Shift+drag moves the selection up and down with the mouse. Flatten levels it at its mean height, Clear empties it. Slope (−89° to 89°) and Direction (0° to 360°) lay the selection on a plane through the selection centre (default) or the cursor, using noggit3's `misc::angledHeight`; Space turns the direction to rise from the cursor toward the centre. A new selection resets the slope to level. Every change is undoable; a run of slope changes merges into one undo step while it stays on top.
- Verified: new vertexEdit.test.ts, 6 tests. make test passed (Go plus 74 of 74 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). An in-app check was tried in Chrome against the Vite dev server, but the tab was hidden, so the render loop didn't run and strokes could not be driven. The mode was not seen working on screen.
- Left: noggit3 moves the selection with Shift+right-drag; Meld's right button belongs to the camera, so it is Shift+left-drag. The selection is kept per map tab by the Sculpt tool and is lost on Revert.

## 2026-10-12 · B-027 MCLQ export · commit b0180a7
- Done: Checked first, as the item asked. noggit3's "MCLQ export" is a setting that writes vanilla/BC MCLQ liquids instead of WotLK MH2O (`MapTile.cpp`, `use_mclq_liquids_export`). Meld's tile writer only writes MCLQ, so the feature is already there. What was missing was a check against the reader: a new Go test builds a tile with water and reads it back through `ParseLiquids`, the reader that opens the client's tiles, and checks the level on every vertex, the water bit, and which cells are covered.
- Verified: make test passed (Go, with the new TestBuildTileWaterReadsBack, plus 74 of 74 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Nothing shows on screen.
- Left: none.

## 2026-10-12 · backlog tidy
- Removed the items finished in this run (B-003, B-005, B-010, B-027, B-030, B-034, B-039, B-052, B-104). Their entries above and the gap doc keep the record.
- Removed the open-list copies of B-008, B-012, B-018 and B-033, which were owner decisions already moved to Parked; the Parked section still holds each one with its reason. No owner-written item was deleted otherwise.
- B-031 now notes that it needs multi-selection (B-032) first. New lines from this run: B-105, B-106 (from B-034) and B-107 (from B-030).
- The doc files (BACKLOG.md, PROGRESS.md, IDEAS.md, noggit3-feature-gap.md) were left uncommitted, as the last run did, because they already held uncommitted changes from the owner's decision session, and staging them would bundle those in.

## 2026-10-12 · stopped
- Stopped: 8 items were done in this run (B-010, B-052, B-104, B-034, B-005, B-030, B-003, B-027), which is the cap. B-039 closed as a duplicate of B-030, and one fix (b47461b) came out of B-030.
- Next top item: B-007 Clear tool for the remaining categories, or B-006 Chunk Mover (both priority 2, M/L); B-031 and B-037 wait on multi-selection (B-032). Smaller next picks: B-021 Crop water and B-022 Cursor intersects liquids (M/S).

## 2026-10-12 · B-106 Overlap warning ignores hidden models · commit 7a36a67
- Done: The overlap check that turns a selected model's outline red skips other models that are hidden (`ObjectLayer.isHidden`, which is false while hidden models are shown, so the check matches what is drawn).
- Verified: make test passed (Go, plus 74 of 74 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: none.

## 2026-10-12 · B-107 Follow ground rotation on placement · commit 01ac6f1
- Done: The Follow ground rotation option (same setting as the Select tool's, with Smooth) now also applies in the Place tool. On open ground, a placed model, and each scattered model, takes the slope's tilt in place of Random tilt; the preview leans the same way. Props attached to another model keep Random tilt. The option is still off by default, so the default behaviour is unchanged. The loop chose to share the Select tool's checkbox rather than add a second one, and noggit3 only does this on drags, so the placement tilt is ours; the owner can change either.
- Verified: groundTilt.test.ts 4 of 4, including a new test for the output-object path. make test passed (Go, plus 75 of 75 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the preview tilt and placed tilts were not seen on screen.
- Left: none. The preview and the placed model both take their tilt from the hit point under the cursor.

## 2026-10-12 · B-021 and B-022 · left unfinished
- Done: nothing. No commit.
- Verified: not run.
- Left: the editor has one water plane at a level (`Water`, `editor.waterLevel`). The region liquids are display-only meshes from the client import (`LiquidLayer.ts`), so there are no editable per-cell liquids to crop (B-021). B-022 would change which ground the brush picks under water, and the default ocean scene (floor at -12, water at 0) would be affected. Both need the owner's decision on the water model first. Logged in BACKLOG.md.

## 2026-10-12 · B-020 and B-024 · left unfinished
- Done: nothing. No commit.
- Verified: not run.
- Left: B-020 (liquid ID per type) changes the `.wmap` format, so it is tagged needs-approval. B-024 (angled river) needs a flow direction the water model does not have. Logged in BACKLOG.md.

## 2026-10-12 · B-006, B-007 and B-032 · re-estimated, not started
- Done: nothing. No commit. Their effort is re-estimated in BACKLOG.md.
- Verified: not run.
- Left: B-006 (Chunk Mover) moves chunk data and objects across the grid, so it is L. B-007 has no per-cell liquid data to clear, and holes, shadows, vertex colours and impassable need format fields (B-055 to B-058). B-032 (multi-selection) is L: the selection is one object through the Engine, tools, gizmo and nudging.

## 2026-10-12 · stopped
- Stopped: nothing clean is left among the value M items. B-020 and B-024 are blocked or need approval, B-021 and B-022 need the owner's water model, and B-006, B-007 and B-032 are L once their size is counted. Two items were done in this run (B-106, B-107), and the loop stopped before the 8-item cap. This is not the L-value stop: the next clean item is B-036 Reset rotation, which is value L.
- Next top item: B-036 Reset rotation (Ctrl+R), value L, effort S. It is the next item that can finish cleanly in one run.
- Doc files (BACKLOG.md, PROGRESS.md) are left uncommitted, as earlier runs did, because they already held the owner's uncommitted changes.

## 2026-10-12 · B-053 Port coordinates export · commit 17a1b62
- Done: File › Export Port Coordinates writes the camera's position as the Trinity `.go xyz X Y Z MAP` line and the ArcEmu `.worldport MAP X Y Z` line, using noggit's coordinate mapping (X = zero point less z, Y = zero point less x, height = y). It uses the map's VMaNGOS map ID, so a map that was not made for the client refuses with a message. The Trinity line adds the `xyz` subcommand that noggit's line leaves out; IDEAS.md records this.
- Verified: new portCoords.test.ts, 3 of 3. make test passed (Go plus 78 of 78 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app. The zero-point mapping was checked against internal/adt's ZeroPoint and the builder's chunk positions, not in game.
- Left: noggit's `Map: <area> on ADT x y` header is not written, since there are no area names (logged as B-108). The file is overwritten, not appended as noggit's hotkey does.

## 2026-10-12 · B-061 Map entry list · commit 88d03b9
- Done: New Map (For the WoW 1.12 client) gets a Client map list, read from the client's Map.dbc when the option is first ticked and grouped by instance type: continents, dungeons, raids, battlegrounds, arenas. Picking one fills the Map ID. A new `vmangos.LoadMapEntries` reads the table, and a new App.MapEntries binding returns it; wailsjs was regenerated for that binding only.
- Verified: new mapentries_test.go. The synthetic table test passed. The real-client test passed against the owner's SoloCraft 1.12.1 client (WOW_DIR), checking the names and types of maps 0, 1, 30, 389 and 409, which confirmed the field layout. make test passed (Go plus 78 of 78 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). The dialog was not checked in the app.
- Left: the list is not in Open, only New Map (noted in the gap doc). The Map ID field is still there for IDs outside the client's table.

## 2026-10-12 · B-051, B-054, B-055, B-056 · left unfinished
- Done: nothing. No commit.
- Verified: not run.
- Left: B-051 (tile-level save) would split the one `.wmap` file into per-tile or changed-tile saves, a format change, so it waits for the owner's decision on the format. B-054 (area IDs), B-055 (impassable) and B-056 (holes) each need a field the `.wmap` format doesn't have. All four are logged in BACKLOG.md with the reason. They are not tagged needs-approval, which the owner may want to do.

## 2026-10-12 · stopped
- Stopped: none of the stop conditions holds exactly. The run did two items, not the cap of 8. The loop stopped because every unblocked item left is either effort L (B-006 Chunk Mover and B-032 multi-selection, both M value, which the rule to prefer items that finish cleanly leaves for a later run) or L value (for example B-036 Reset rotation, B-004 Blur). The rest are blocked on the owner's decisions above or on the water model (B-021, B-022, B-024).
- Next top item: B-006 Chunk Mover (M/L) or B-032 Multi-selection (M/L), both priority 2. B-036 Reset rotation (L/S) is the smallest clean item after them.
- The doc files (BACKLOG.md, PROGRESS.md, IDEAS.md, noggit3-feature-gap.md) are left uncommitted, as earlier runs did, because they already held the owner's uncommitted changes.

## 2026-10-15 · owner session (B-110 to B-116, B-121) · commits fd48318 to c32075e
- Done, at the owner's request over 2026-10-14 and 2026-10-15: the Doodad brush tool with its editor window, preview, stacking, spinning, erasing and TOML files (B-110); Sculpt painting while shaping, one texture or rock and dirt by slope, with per-map texture roles (B-111); Photoshop-style brush size controls (B-112); growing a region by a tile from the Map panel (B-113); the game's ground effects drawn in the editor and written on export (B-114); the dock reduced to Layers (B-115); Sculpt strength up to 10 (B-116); the `?nosave` dev page flag (B-121). Larger toolbar icons and a new brush icon too.
- Verified: make test, make check and make build-windows passed after every commit; make build-linux was not run (Windows host). Each feature was driven in the dev page (TESTS.md has the probes) and most were looked at on screen. The learned ground effects were checked against the owner's SoloCraft 1.12.1 client (346 textures, 681 effects, Elwynn grass = effect 505).
- Left: B-117 (per-cell no-doodad bits and a density preference), B-118 (the dropped panels' functions need a new home), B-119, B-120, B-122 in BACKLOG.md. The owner's "Bushes" doodad brush may have been lost to the config overwrite that B-121 now prevents.

## 2026-10-15 · B-118 Re-home the dropped panels' functions, and the owner's approvals
- Done: File › Grow region (four actions, shown for a region), File › Save Spawns to Database… and Export Spawn SQL…, a spawn-change chip in the status bar, and a floating Inspector (I, Esc closes) holding the Properties panel. The owner dropped the spawn list. B-084 approved, B-016 disapproved (1.12 only), B-050 asked about: the answer given was that streaming reworks terrain, paint, objects, undo and save (weeks), that the block editor can stay as the editing model while streaming becomes a second document kind that loads tiles around the camera and hands a block to the same tools, and that a cheaper middle step is B-051 tile-level save plus a larger block limit.
- Verified: make test, make check and make build-windows passed; make build-linux not run (Windows host).
- Left: B-050 still needs the owner's yes or no.


## 2026-10-15 · B-120 Doodad brush: slope and surface rules
- Done: The Doodad brush's options bar gets Max slope (degrees, 90 allows any) and On props. A placement whose ground is steeper than Max slope is dropped, and its ghost is hidden. With On props a ray straight down at each point finds the prop under it; the model is then attached to that prop (`ObjectLayer.place`, as the Place tool attaches), keeps its entry's random tilt instead of the ground's, and is spaced only against the other models standing on that prop (`fitsOn`). What the stroke itself placed is never a surface, so a brush doesn't pile onto its own models. Both are undone with the stroke as before. `groundSlopeDeg` in `world/groundTilt.ts` is the slope arithmetic.
- Verified: new tests for `groundSlopeDeg` and `fitsOn`. make test passed (Go plus 181 of 181 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the ghosts on a prop and the bare steep flanks were not seen on screen.
- Left: a model on a prop takes its footprint at its own scale, not its world scale, for the spacing (the parent's scale is ignored). The ray is one per attempt (up to 256 a frame) while On props is on; a map with very many models could feel it.

## 2026-10-15 · B-117 Ground effects: no-doodad cells and density
- Done: The MCNK `noEffectDoodad` bits are read (`adt.Chunk.NoEffect`, into `Terrain.noEffect` through the region view) and written (`ChunkPaint.NoEffect`, ORed into the chunk's own bits so the client's road bits survive a write that lacks them). The cells under the map's root WMOs (a WMO whose bottom is within 4 yards of the ground) are marked automatically (`coverCells`, the turned box's footprint) and joined with the client's bits (`blockedCells`); the tuft layer skips them and the export sends them per chunk as row bits (`PaintSpec.NoEffect`, `RegionPaint.NoEffect`). View › Sparse / Normal / Full tufts (`prefs.groundEffectDensity`) draws a quarter, half or all of the game's amount per cell (cap 16). The painted per-cell switch was not built: it needs a `.wmap` field, logged as B-123 for the owner's format decision. wailsjs was regenerated for the two changed structs (models.ts only).
- Verified: Go test TestRewriteNoEffectBitsReadBackAndKeepTheTilesOwn writes bits and reads them back with ParseTerrain, the reader that opens the client's tiles, including the OR with earlier bits and a write without bits. Frontend tests for coverCells, chunkNoEffect, the density factor and the export's row bits. make test passed (Go plus 183 of 183 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or in game: the bare cells under a building were not seen on screen.
- Left: the client's bits are not saved in the `.wmap`, so a region reopened from a map file draws tufts on its roads until exported again (the export keeps the client's bits either way). A removed building leaves its bare patch in the client, since the bits are ORed, never cleared.

## 2026-10-15 · B-076 Toggle UI (Tab)
- Done: Tab hides every panel but the menu bar (`ui.hidePanels`: the toolbar, options bar, asset browser, dock and status bar leave the layout and the viewport fills the window below the menu); Tab again brings them back, and Graphics › Hide panels is the same switch with the key shown. The menu bar stays, as Photoshop's Tab keeps it, so the switch is always reachable; the loop chose that over noggit's all-or-nothing. Ctrl+Tab still cycles the map tabs, and Tab in an input is left to the input. Listed in Keyboard Shortcuts.
- Verified: make test passed (Go plus 183 of 183 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the viewport filling the window was not seen on screen (the Engine's ResizeObserver resizes the canvas with its container).
- Left: none. The hidden state is not a preference; the app starts with the panels shown.

## 2026-10-15 · B-075 Tile and chunk grid lines
- Done: Checked first, as B-027 was. The lines are already there: Graphics › Show grid draws a line every four cells, Show chunk lines the 8x8-cell paint chunk edges in pale blue, and a region always draws amber lines at its tile edges (`Terrain.setTileBorders`, set in `Engine.activate`). noggit's "hole lines always on" draws the chunk lines around a hole so it can be seen when the lines are off; Meld cuts holes out of the mesh and draws their walls, so a hole is visible on its own. Nothing to build; marked done in the backlog and the gap list.
- Verified: nothing changed in the code, so no checks were run. Not checked in the app.
- Left: none.

## 2026-10-15 · B-092 Help window and manual links
- Done: The About menu is now Help. Help › Help… (F1) opens a Help dialog with short sections: getting started (client folder, New World and Part of Azeroth, save, publish and export), the eight tools, brushes and undo, camera and view; its buttons open the manual and the Keyboard Shortcuts dialog. Help › Manual (README on GitHub) opens the repository's README in the system browser through the Wails runtime (the dev page uses window.open). The README's menu list names the new menu.
- Verified: make test passed (Go plus 183 of 183 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the dialog was not seen on screen.
- Left: the help text is written by hand in `AppDialogs.svelte` (`HELP`), so it must be kept in step with the tools; the README is the full manual.

## 2026-10-15 · B-122 Preferences written by two windows
- Done: A save no longer writes the whole preferences object. The frontend keeps each key's JSON as last loaded or saved (`baseline` in `prefs.ts`) and sends only the keys that differ (`changedPrefs` in `prefsPatch.ts`); `SavePrefs` in Go reads the config file again and merges those keys over the file's current preferences (`config.MergePrefs`), then writes it. So a window that changed its camera speed can't wipe the brushes another window (or the dev page) saved; only a key both changed is last-writer-wins. The binding's signature is unchanged, so wailsjs was not regenerated.
- Verified: new Go tests (merge keeps the other keys, starts from nothing, replaces a broken file, refuses a non-object patch) and a frontend test for the patch. make test passed (Go plus 184 of 184 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked by hand with two windows.
- Left: the config's other fields (client folder, server folder, window size, login) are still written whole from the saving instance, as before; the item was about the preferences. A merge there would need the same patch approach per field.

## 2026-10-15 · B-077 Detail info panel
- Done: Graphics › Detail info (`prefs.detailInfo`) shows a readout in the viewport's top right corner for the ground under the cursor, after noggit's detail window: the client tile and the chunk in it (a region), the cell, height and slope, hole and no-tuft flags, the chunk's texture layers with their share at the cell and their ground effect IDs, the liquid layers covering the cell with their surface height, and the root models standing in the chunk. The Engine fills `stats.detail` in the 2 Hz stats block, so nothing reactive is written per frame.
- Verified: make test passed (Go plus 184 of 184 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the readout was not seen on screen.
- Left: no area ID (the editor has none, see B-054) and no chunk flags; the no-tuft flag is the client's own bit, not the cells under buildings.

## 2026-10-15 · B-090 Settings panel
- Done: Checked first, as B-075 was. The settings noggit's panel holds are already in Meld's Preferences menu where they apply: the game path (WoW Client Folder), the project path (VMaNGOS Server Folder, which the tiles, map table and spawn SQL are written into), plus the game login, the thumbnail cache, camera speed, mouse sensitivity, invert Y and tablet support. noggit's import path names its model import list, which Meld asks for in a file dialog (File › Import Object List); its WMV log path imports from WoW Model Viewer, which Meld has no use for; and its MCLQ export path is moot, since Meld's tiles are always written as MCLQ for the 1.12 client. Nothing to build; marked covered in the backlog and the gap list.
- Verified: nothing changed in the code, so no checks were run.
- Left: none.

## 2026-10-15 · backlog tidy
- Removed the items finished in this run (B-120, B-117, B-076, B-075, B-092, B-122, B-077, B-090), as earlier tidies did; PROGRESS.md and the gap list keep the record. The owner session's [x] items (B-110 to B-116, B-118, B-121 and the water and holes items) stay listed, since the owner wrote them. No owner-written item was deleted.
- No duplicates found. Nothing new fits Parked: B-050 stays open with its needs-approval tag and the owner's back-burner note.
- New lines from this run: B-123 (painted no-doodad cells and the client's bits in the map file, from B-117), B-124 (On props footprint and lookup, from B-120), B-125 (the other config fields, from B-122).

## 2026-10-15 · stopped
- Stopped: 8 items were done in this run (B-120, B-117, B-076, B-075, B-092, B-122, B-077, B-090), which is the cap. Two of them (B-075, B-090) closed on a check that the behaviour was already there.
- Next top item: B-072 Top-down 2D tile mode (M/M, priority 5) or B-091 Log window (M/M); B-060 Minimap window (H/L) and B-084 Client lighting data (L/L, approved) are the larger picks. B-032 Multi-selection (M/L) is the biggest core-authoring item still open and gates B-031 and B-037.

## 2026-10-15 · B-031 Rotate around a pivot
- Done: As IDEAS.md decided (noggit3's behaviour): with two or more models selected and the Select tool's "Rotate around pivot point" on (`editor.rotatePivot`, default on), R, Shift+R and Alt+arrows turn each model about the mean of the selection's world positions as well as about its own origin, so the group keeps its shape; off, each turns about itself, as a single model always does. A ground model is re-seated on the terrain where it lands (its height above the ground kept); an attached one keeps its height on its parent. `world/pivot.ts` holds the arithmetic (`meanPivot`, `turnAbout`), checked against three's rotation in a test. The nudge stays one merged undo step. The 2026-10-12 note that this needed multi-selection first was stale: the owner's session gave the editor a selection set (`editor.selectedIds`), so B-032's remaining part is the group gizmo, which the next item does.
- Verified: new pivot.test.ts, 2 tests. make test passed (Go plus 186 of 186 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: the gizmo ring for a group is B-032 (next). The Inspector's rotation field still edits the primary model alone.

## 2026-10-15 · B-032 Multi-selection move mode
- Done: The gizmo now works a multi-selection. It stands at the group's pivot (the mean position), its ring round the whole group and its arrow over the tallest model; the ring turns the group (each model about the pivot with Rotate around pivot point on, else in place), the knob scales every model and, with the pivot option on, their spread from it, and the arrow lifts them all. Ground models are re-seated on the terrain where they land and attached ones keep their height. A drag is one undo step ("Turn / Scale / Raise N objects"). The knob is hidden when a WMO is in the group, as it is for one. The "local or world gizmo" in the item's title was the gap doc's guess: noggit3's object editor (`ui/ObjectEditor.cpp`) has no such toggle, only the pivot and ground-snap checkboxes, so nothing was built for it and the gap entry says so. The 2026-10-12 effort note was stale, since the owner's session had already given the editor a selection set.
- Verified: make test passed (Go plus 186 of 186 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the group's handles were not seen or dragged on screen.
- Left: B-037's group half (keep each model's height instead of re-seating it) is still open with B-037.

## 2026-10-15 · B-037 Mouse-move snap
- Done: noggit's two checkboxes, as IDEAS.md decided, in the Select tool's options bar. Follow cursor on the ground (`editor.moveFollowCursor`, on): a dragged single model follows the surface under the cursor as before; off, it slides across a level plane at the height it started at (the pointer's ray meets that plane) and keeps its parent. Snap models to the ground (`editor.moveSnapGroup`, off): a dragged group lands on the ground where it goes (each model's height above it kept); off, the default, every model keeps its height. The IDEAS.md entry now records the two details the loop chose (an attached model stays attached; a snapped model keeps its `yOff`). The two things the 2026-10-12 run left open are resolved: the camera-facing plane is a level plane at the model's height, which is what noggit's "at its current height" means, and the parented rule is recorded.
- Verified: make test passed (Go plus 186 of 186 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no drag was done on screen.
- Left: the default for a group drag changed from landing on the ground to keeping heights, as noggit's default; the owner may prefer the old default (one line in `editor.svelte.ts`).

## 2026-10-15 · B-072 Top-down 2D tile mode
- Done: U (and Camera › Top-down View) switches to noggit's tile mode: an orthographic camera straight above the controller's target, turned with the yaw so Q, E and a right drag still turn the map, sized so the ground spans what the 3D view would show at the controller's distance (so the wheel zooms, and toggling keeps the apparent size), with the keys and a middle drag panning across the ground. The Engine's `camera` is now a getter for whichever camera draws the view, so picking, culling, shadows, the outline and the sky follow it; what sizes itself by the viewer's distance (the gizmo's handles, the tufts' range, the small-model cutoff) uses a view eye the controller's distance above the target instead of the camera 1500 above. Fog is off while top-down. The tools keep working (noggit switches to paint; ours is better, since any tool reads the straight-down ray).
- Verified: make test passed (Go plus 186 of 186 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the 2D view was not seen on screen.
- Left: the gizmo's arrow (height) can't be dragged top-down, since its drag plane is edge-on to the view; the ring and knob work. The state is not a preference, so the app starts in 3D.

## 2026-10-15 · B-091 Log window
- Done: Help › Log… opens a Log window with the last 500 lines, each with its time: every status message (so the Go side's progress lines, which arrive as status messages, are kept too) and, with Preferences › Log file loading on (`prefs.logFileLoading`, noggit's "additional file loading log"), every file read from the client through `fetchBinary` (models, textures and lists, with the time taken or the error). The window stays scrolled to the newest line and has Copy and Clear. `appLog`, `logLine`, `logFile` and `clearLog` live in `editor.svelte.ts` beside `setStatus`.
- Verified: make test passed (Go plus 186 of 186 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the window was not seen on screen.
- Left: console warnings (a failed model load, a bad preference) are not in the log; only what goes through setStatus or fetchBinary is. The Go side has no log channel of its own beyond the export and ground effect progress events.

## 2026-10-15 · B-060 Minimap window
- Done: M (and Camera › Minimap Window) opens a floating minimap at the top left of the viewport (`MinimapWindow.svelte`, `ui.minimap`): the map's heights drawn grey by height and blue under the sea, so a new world has a map too, with the client's continent overview behind it for a part of Azeroth (the 64-tile overview cropped to the open block), amber tile borders on a map bigger than a tile, and the camera's target and facing as a white dot and line. A click moves the camera there, keeping its distance and yaw. The Engine publishes the camera's spot in the 2 Hz stats (`stats.view`) only while the window is open, and the heights are redrawn when their version changes.
- Verified: make test passed (Go plus 186 of 186 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the window was not seen on screen.
- Left: no zones or light zones on it (B-082), no drag to pan, and the window's place is fixed (top left).

## 2026-10-15 · B-007 Clear tool: height, liquids and holes
- Done: The Clear tool (7) has three more modes beside Models and Textures: Height (to zero) brings the ground under the brush to height zero by the brush weight (noggit's `clearHeight` sets a chunk to 0; the brush and falloff are ours, so a soft edge blends), and re-snaps the models on it; Liquids (painted water) removes every painted liquid layer's cells under the brush through the liquid brush's remove path; Holes (fill) fills the holes of the cells whose centre is under it. Each stroke is one undo step through `TerrainStroke` or `LiquidStroke`. The 2026-10-12 note was stale on liquids and holes: both have had per-chunk and per-cell data since B-020 and B-056. Shadows, vertex colours and impassable have no field in the `.wmap`, so they stay with B-057, B-058 and B-055 (the first two need approval, the last the owner's format decision).
- Verified: make test passed (Go plus 186 of 186 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no stroke was made on screen.
- Left: the three format-bound categories above.

## 2026-10-15 · B-006 Chunk Mover
- Done: Checked noggit3 first (IDEAS.md records it): its chunk mover is a copy of selected chunks to the cursor with a preview, not a drag, and Meld's area copy and paste already does that for any cell rect. Two gaps were closed: the area clipboard now carries the painted liquid cells (`copyLiquidCells`, `pasteLiquidCells` in `liquids.ts`: the pasted rect loses the liquid it had and the clip's cells are laid in, a layer per liquid ID in each chunk, undone with the paste through `LiquidStroke`), and R (or Turn 90° in the options bar) turns the pending paste a quarter turn (`rotateClip` in `world/clipRotate.ts`: heights, holes, texels, liquids and models together, the models' yaw turning too; the preview rect swaps its sides). The old 2026-10-12 estimate assumed a chunk-grid move that noggit3 doesn't do either.
- Verified: new clipboard.test.ts, 2 tests (a turn moves every part the same way and four turns come back; liquid cells copy, paste anywhere and turn). make test passed (Go plus 188 of 188 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: no mirror and no min/max/add/subtract height modes; a hole of one triangle keeps its value when turned, so it may land on the other triangle of its cell.

## 2026-10-15 · backlog tidy (2nd run)
- Removed the items finished in this run (B-031, B-032, B-037, B-072, B-091, B-060, B-007, B-006), as earlier tidies did; PROGRESS.md, IDEAS.md and the gap list keep the record. No owner-written item was deleted; the owner session's [x] items stay listed.
- No duplicates found. Nothing new fits Parked.
- New lines from this run: B-126 (paste mirror and height modes, from B-006) and B-127 (the group gizmo's arrow top-down, from B-072).

## 2026-10-15 · stopped (2nd run)
- Stopped: 8 items were done in this run (B-031, B-032, B-037, B-072, B-091, B-060, B-007, B-006), which is the cap.
- Next top item: every item still open and unblocked is value L (B-004, B-009, B-013 to B-017, B-036, B-038, B-040, B-059, B-070, B-071, B-073, B-074, B-078 to B-083, B-105, B-108, B-119, B-123 to B-127). The next run will meet the "top remaining items are all value L" stop unless the owner raises one; B-084 (approved) and B-123 (the painted no-doodad cells, which needs the owner's format decision) are the ones to look at first.

## 2026-10-15 · stopped (3rd run)
- Stopped before any item: the top remaining items are all value L. The open items above L are either tagged `needs-approval` (B-026, B-050, B-057, B-058, B-094, B-100, B-101) or wait on the owner's `.wmap` format decision, which IDEAS.md does not record (B-051 H/M, B-054 M/M, B-055 M/M). No code changed, so no checks were run.
- Backlog tidy: no duplicates, no finished loop items still listed, nothing new for Parked. No owner-written item was deleted.
- Next top item: unchanged from the 2nd run. To let the loop go on, the owner can decide the format question behind B-051, B-054, B-055 and B-123 in IDEAS.md, or raise the value of an L item such as B-084 (approved, L/L).

## 2026-10-15 · B-054 Area ID painting (and the `.wmap` version 5 format)
- Done: As the owner decided (IDEAS.md), `.wmap` is now version 5, with three blobs after the liquids: an AreaTable.dbc ID per chunk, a flag byte per chunk (bit 0 impassable, for B-055) and a byte per cell where no tufts grow (for B-123). Versions 1 to 4 still read, with the fields empty, and a document then has `chunkDataKnown` false so a region's export leaves the client's headers alone. A region now keeps its chunks' area IDs and impassable flags (`ChunkView.Impassable` is new) and its no-tuft cells. The new Map data tool (9) paints the zone picked from the client's areas (the `Areas` binding reads AreaTable.dbc's ID, map, parent and name; the picker is a searchable list) into the chunks under the brush, or clears it; Alt+click takes a chunk's zone; an overlay colours the chunks by zone, the options bar names the zone under the cursor, and Detail info shows it. A stroke is one undo step (`ChunkDataStroke`). The export sends every chunk's header (`TileSpec.Headers`, `RegionEdit.Headers`), and Go writes the area ID at MCNK 0x34 and the 0x2 flag (`adt/header.go`); an area of 0 keeps the tile's own.
- Verified: new Go tests (v5 round trip, a v4 map reads with no chunk data, empty chunk data writes zeros, the header write reads back on a built tile, and against the owner's client with WOW_DIR: AreaTable's layout (Elwynn Forest 12, Goldshire 87 under it) and a region save that sets chunk 17's zone and flag while every other chunk keeps what the same save without headers writes). New frontend tests in chunkFlags.test.ts. make test passed (Go plus 193 of 193 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the tool and its overlay were not seen on screen.
- Left: the area clipboard does not carry the chunk data (B-128, new). The Impassable and No tufts modes are B-055 and B-123, next.

## 2026-10-15 · B-055 Impassable flag tool
- Done: The Map data tool (9) has an Impassable mode beside Zone: Set marks the chunks under the brush impassable, Clear makes them passable, as one undo step; the overlay hatches the impassable chunks red, and Detail info says "impassable". The flag lives in `Terrain.chunkFlags` (saved since the version 5 format of B-054), is read from a region's chunk headers, and is written as the MCNK header's 0x2 flag on export (the Go write and its client check came with B-054). `ChunkDataStroke` now has its own byte-rect copy instead of brush.ts's, so it can be tested under node (brush.ts uses parameter properties, which node's type stripping refuses).
- Verified: new chunkDataStroke.test.ts (undo and redo of zones, flags and no-tuft cells; a stroke that changed nothing is no step). make test passed (Go plus 195 of 195 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: whether the 1.12 client or VMaNGOS acts on the 0x2 flag was not tested in game; noggit's tool writes the same bit.

## 2026-10-15 · B-123 Painted no-doodad cells, kept in the map file
- Done: The Map data tool's No tufts mode marks the cells under the brush as growing no ground effect doodads (Set) or lets them grow again (Clear), one undo step a stroke; the overlay hatches them orange and the tufts redraw at once (`GroundEffectLayer` now also rebuilds on `Terrain.chunkDataVersion`). The cells, with the client's own bits read from a region, are kept in the `.wmap` since the version 5 format (B-054), so a reopened region draws them. On export, a map that holds them sends each chunk's exact rows in its header (`HeaderSpec.NoEffect`, from the same cells plus those under its buildings), which Go copies over the chunk's bits instead of ORing (`ChunkHeader.NoEffect`), so a cleared cell comes off; a map saved before version 5 sends no headers and keeps the old OR.
- Verified: the header test now checks that the bits are replaced over what a paint adds; the client test (WOW_DIR) sets chunk 17's rows through a region save and checks every other chunk keeps the bits the plain save writes; a frontend test checks the rows in the headers, zeros included. make test passed (Go plus 196 of 196 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: a building's cells, written into the tile on export, come back from the client as painted cells when the region is reopened (as they did before with the OR), so moving the building later leaves them bare until cleared.

## 2026-10-15 · B-108 Port commands: area name and ADT header
- Done: File › Export Port Coordinates now starts with noggit's `Map: <zone> on ADT x y` line: the zone of the chunk under the camera (from B-054's area IDs, named from the client's AreaTable with its parent zone, "Unknown area" for none) and the tile the camera is in, by column then row as the tiles are named. `Engine.areaAt` gives a chunk's area ID, which the Map data tool's readout uses too.
- Verified: portCoords.test.ts checks the new first line (zone and tile) and the old lines after it. make test passed (Go plus 197 of 197 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no file was written by hand.
- Left: the export still needs a map made for the client (a map ID); a part of Azeroth has no port export, as before.

## 2026-10-15 · B-059 Save minimap image
- Done: Checked noggit3 first (IDEAS.md records it): its "Save minimaps" action sets a flag nothing reads. Meld's File › Save Minimap Image… (Ctrl+Shift+P) saves the map from above as a PNG: the ground shaded by height and blue under the sea (the Minimap window's drawing, now `shadeHeights` in `io/minimapImage.ts`, which the window uses too), the client's overview of the block for a part of Azeroth, and the tile borders, at a few pixels a cell so a one-tile map is 512 across. The image goes through two new bindings, `SaveImageDialog` and `WritePNG` (base64, refused unless it is a PNG), since the asset server must not get request bodies.
- Verified: new minimapImage.test.ts (shading and scale). make test passed (Go plus 199 of 199 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no image was saved by hand.
- Left: the client's own minimap textures are not written (B-129, new).

## 2026-10-15 · B-036 Reset rotation
- Done: Checked first: Meld had no reset. Checked noggit3 (IDEAS.md records it): its Reset rotation zeroes the X and Z rotation and keeps the heading. Edit › Reset Rotation (Ctrl+R) does the same for every selected model (`Engine.resetRotation`): the tilt goes, the turn stays, as one undo step ("Reset rotation of N objects"), and it says so when they already stand upright. Ctrl+R no longer reaches the webview, which would reload the page.
- Verified: make test passed (Go plus 199 of 199 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: none.

## 2026-10-15 · B-105 Hide a model with its attachments
- Done: As the owner decided (IDEAS.md): H now hides the selected models and everything attached to them, found in one walk over the parent links (`ObjectLayer.descendantsOf`, which `descendantIds` now uses), so no prop is left in mid-air; H on an all-hidden selection shows them again with their attachments, and Shift+H still shows everything. The status line counts the attached ones ("Model with 3 attached hidden"). Still session only.
- Verified: make test passed (Go plus 199 of 199 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: none.

## 2026-10-15 · backlog tidy (owner-picked run)
- Removed the items finished in this run (B-054, B-055, B-123, B-108, B-059, B-036, B-105), as earlier tidies did; PROGRESS.md, IDEAS.md and the gap list keep the record. No owner-written item was deleted.
- No duplicates found. Nothing new fits Parked.
- New lines from this run: B-128 (the area clipboard carries the chunk data, from B-054) and B-129 (write the client's minimap textures, from B-059).

## 2026-10-15 · stopped (owner-picked run)
- Stopped: the run did the set the owner picked in planning (the Map data set, with B-105 in place of B-070), which is seven backlog items, the `.wmap` version 5 format going in with B-054. B-038 (bounding boxes) and B-070 (reset camera roll) were moved to the next run by that plan.
- The commit trailers name Claude Opus 5.5, the model that ran this, not the Haiku 5.5 of LOOP.md.
- Next top item: B-038 Bounding box display (L/S) and B-070 Reset camera roll (L/S), as planned; everything else open is value L too, so the next loop run stops at once unless the owner picks again.

## 2026-10-15 · B-130 Flatten lock mode
- Done: Sculpt › Flatten has Noggit Red's Lock (`ui/FlattenTool.cpp`, `MapChunk::flattenTerrain` with `use_ref_pos`): with Lock on, every stroke levels to the locked point's height instead of the height where it starts, and Angled pivots its plane on the locked point, so several strokes meet at one level. Alt+click in Flatten locks the point under the cursor and turns Lock on (Noggit Red sets it with a key; Alt+click is what Meld's Water tool already uses for its lock, and the eyedropper cursor shows it); the height can be typed in the options bar. The target select is disabled while locked. The lock is a tool setting (`editor.flattenLock`), like Noggit Red's, not per map.
- Verified: make test passed (Go plus 199 of 199 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: the locked point is not drawn on the ground; the X and Z are only set by Alt+click, not typed.

## 2026-10-15 · B-133 Texture swap brush
- Done: Checked Noggit Red first (IDEAS.md records it). Paint › Swap now has Noggit Red's scopes: Under the brush (as before, by the brush's strength and falloff), Entire chunks (the whole layer of the swapped texture in every chunk the brush circle reaches, once a chunk a stroke) and Entire tile (every chunk of the tile under the cursor), through `replaceInChunk`, which folds the layer into the new texture where a chunk has it already. Keep holds the texture the first stroke swapped (by path, so it holds across maps) as the one to swap, like Noggit Red's "texture to swap"; the bar names it. A stroke is one undo step, whole chunks saved.
- Verified: make test passed (Go plus 199 of 199 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: Noggit Red's "Remove this texture from ADT" is the Layers panel's Delete for a selected area, not a button of its own.

## 2026-10-15 · B-139 Selection brush
- Done: The Select tool has Area and Brush buttons. With Brush, a drag on the ground selects the drawn models whose place is within the brush radius (Noggit Red's `World::range_add_to_selection`), as the brush passes over them: a plain stroke starts a new selection, Shift adds to the one there is and Ctrl takes models out (Noggit Red adds with Shift and removes with Ctrl; its plain click selects one model, which Meld's click on a model still does). The brush ring shows, its size is a slider in the bar and follows [ ], ] and the other size keys. Selecting is not an edit, so it is no undo step, as before.
- Verified: make test passed (Go plus 199 of 199 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: Noggit Red's Drag Selection Depth (how deep a box select reaches) has no counterpart, since Meld's area select is on the ground, not a screen box.

## 2026-10-15 · B-140 Replace models with the copied one
- Done: Checked Noggit Red first (IDEAS.md records it). Edit › Replace with Copied Model swaps every selected model for the one model on the clipboard (Ctrl+C with one model selected), keeping its place, turn, tilt, scale and attachments, as one undo step; models of that type already are skipped, and a doodad only replaces doodads and a building only buildings (the status says how many were left). The type changes in place (`ObjectLayer.setType`, which moves the instance between the two types' meshes), so a region keeps the placement's unique ID and the save rewrites it with the new model (`unchanged` in `vmangos/region.go` compares the type).
- Verified: make test passed (Go plus 199 of 199 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: attached models keep their local offsets, so on a differently shaped model they may float or sink.

## 2026-10-15 · B-131 Image brushes
- Done: Checked Noggit Red first (IDEAS.md records it). Sculpt's shaping modes and Paint's texture brush take a brush image: a greyscale PNG or JPEG from the user's own brush image folder (Noggit Red's Samples folder; picked through the image select's "Image folder…", kept as `prefs.brushImageDir`), laid over the brush's square, turned by Turn (and to a random turn after each stroke with Random turn), so the stroke takes the image's light parts. Go reads the image as grey levels boxed down to 256 a side (`heightmap.ReadGrey`, bindings `BrowseBrushImageFolder`, `ListBrushImages`, `ReadBrushImage`); the frontend samples it bilinearly per vertex or texel (`tools/brushImage.ts`) inside `forEachVertex` and `forEachTexel`, switched on only while a Sculpt or Paint stroke ticks, so Clear, Roads, Water and the rest are never shaped by it. Strokes stay one undo step each.
- Verified: new Go test (boxing down and grey levels, the folder listing) and brushImage.test.ts (no image, the square, a turn). make test passed (Go plus 202 of 202 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no image brush stroke was made on screen.
- Left: the brush ring does not show the image; Noggit Red's Stamp mode (one imprint grown by a drag) waits with B-132.

## 2026-10-15 · B-138 Selection groups
- Done: Checked Noggit Red first (IDEAS.md records it). Edit › Group Selected Models (Ctrl+G) puts two or more selected models into a new selection group, out of any they were in, and Ungroup Selected Models (Ctrl+Shift+G) breaks up the groups the selected models are in; each is one undo step. A click on a grouped model selects the whole group, Shift+click adds or takes out the whole group, and the area select and the selection brush take whole groups too (`withGroups` in `state/selection.ts`). The group is a number on each model (`WorldObject.group`, `PlacedObject.Group` in the `.wmap` header's JSON, so no format bump), and pasted copies get groups of their own.
- Verified: the mapfile round trip now checks a model's group. make test passed (Go plus 202 of 202 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: groups are not drawn (Noggit Red draws a group's box); the Inspector does not say a model is grouped.

## 2026-10-15 · B-145 Export holes to client tiles
- Done: As the owner decided in plan mode (IDEAS.md B-145): every hole edit works on whole 2×2-cell blocks, as the 1.12 tile keeps a chunk's holes in a 4×4 bitmap. Sculpt › Hole cuts or fills the block under the cursor, the Select tool's Cut and Fill hole grow the area out to the blocks it touches, the hole walls move by blocks and their + and − badges do one block, and Clear › Holes fills the blocks whose centre is under the brush. The export sends each chunk's hole cells in its header (`HeaderSpec.Holes`), and Go writes the low-resolution bitmap at MCNK 0x3C and clears the later clients' high-resolution flag (`adt.HoleBits`, `ChunkHeader.Holes`); a block with any hole cell is a hole, which only matters for holes made before the snap. A map saved before version 5 sends no headers, so the client's holes stay.
- Verified: new adt tests (the block rule; the bitmap reads back, the flag is clear, other chunks untouched), a client test sending a Westfall block's own holes back unchanged (`TestRegionHolesRoundTrip`, 4 holed chunks) and the region header test now setting a chunk's holes, with WOW_DIR set; frontend tests for block snapping and the holes in the headers. make test passed (Go plus 205 of 205 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in game or in the app: a cut cave mouth was not walked through in the client.
- Left: triangle holes are no longer made, but an older map's are still drawn and export as their whole block.

## 2026-10-15 · B-144 WMO doodad set per placed WMO
- Done: Checked what the export wrote first: a region save kept the client's doodad and name sets, a new map wrote set 0, and the editor drew the global set 0 only, so a building whose placement shows set 2 (an inn's furniture, say) looked bare. Now the Inspector has a Doodad set choice for a selected WMO with more than the global set, named from the WMO's MODS (`WMODoodadSets` binding), as Noggit Red's Selected WMO Options do; picking one is an undo step. The set rides in the model's type, `wmo:<path>?set=<n>` (`models/wmoSet.ts`), so the model endpoint draws set 0 plus that set (`WMORoot.DoodadsOf`, `Look.Set`), each set its own instanced mesh. A region opens with each WMO's own set in its type (`modelType` in `vmangos/modeltype.go`), and the region save and the map export write the type's set as the MODF doodad set (`parseModelType`); a bare `wmo:` type, as a map saved before keeps, leaves a region's placement on its own set.
- Verified: new Go tests (the type round trip, an explicit set 0, a bare type keeping the placement's set, `DoodadsOf`) and wmoSet.test.ts; the client round-trip test now compares each written placement's set with the editor's view, and passed with WOW_DIR set (a WMO there has a non-zero set). make test passed (Go plus 207 of 207 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no set was switched on screen.
- Left: the name set is kept as the client has it (0 for a new building) and is not shown; an older region map's WMOs show set 0 in the editor until reopened from the client, though their export keeps the client's set.

## 2026-10-15 · backlog tidy (4th run)
- Removed the items finished in this run (B-130, B-133, B-139, B-140, B-131, B-138, B-145, B-144), as earlier tidies did; they were in the owner's Noggit Red gap commit (a542e11), and PROGRESS.md, IDEAS.md and noggit-red-feature-gap.md keep their record. No other item was deleted.
- No duplicates found. Nothing new fits Parked.
- New lines from this run: B-158 (draw selection groups, from B-138) and B-159 (the brush image on the cursor, from B-131).

## 2026-10-15 · stopped (4th run)
- Stopped: 8 items were done in this run (B-130, B-133, B-139, B-140, B-131, B-138, B-145, B-144), which is the cap. B-145 needed the owner's decision on the hole mapping, asked in plan mode as LOOP.md now says (snap the Hole tool to the client's blocks).
- The commit trailers name Claude Opus 5.5, the model that ran this, not the Haiku 5.5 of LOOP.md.
- Next top item: B-146 Generate the WDL for an exported map (M/M, client round trip), then B-153 Climb view (M/S) and B-156 History panel (M/M); B-051 Tile-level save (H/M) still waits on the owner's format decision, which the next run should ask in plan mode.

## 2026-10-15 · B-146 Generate the WDL
- Done: Checked Noggit Red and the client's own WDLs first (IDEAS.md records it). Export to Client now writes the new map's WDL (`vmangos/wdl.go`: MVER 18, MAOF, one MARE per tile, no MAHO, as 1.12's are) from its tiles, so the far horizon and the WDL's tile table match the new tiles; a region save reads the map's WDL, redraws its block's tiles from the edited heights and writes it into the patch with the tiles (a map with no WDL is left without one). The outer heights are the chunk corners truncated, the inner ones the chunk's mean height.
- Verified: new wdl tests: a build and parse round trip with truncation and clamping, and with WOW_DIR set, Azeroth.wdl parsed and written back is byte-identical and three tiles' sampled outer heights equal the client's exactly (inner within 3 yards on average). The export test reads the new map's WDL back from the patch; the region round trip checks the block's horizon is redrawn and every other tile is the client's. make test passed (Go plus 207 of 207 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in game: the far horizon of an exported map was not looked at in the client.
- Left: the editor does not draw the WDL horizon itself (B-155).

## 2026-10-15 · B-153 Climb view
- Done: Checked Noggit Red first (IDEAS.md records it). View › Climb (Shift+F2) tints the ground too steep for a character to walk up: the terrain shader blends red into each triangle whose slope passes the chosen one (`climbCos`, from the triangle's own normal by screen derivatives), picked in the View menu from 40°, 45°, 49° (Noggit Red's default), 55° and 60°. The setting is a preference (`prefs.climbView`, `prefs.climbAngle`), kept in scenes and listed in Help.
- Verified: make test passed (Go plus 207 of 207 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no browser tools in this run, so the tint was not seen on screen.
- Left: Noggit Red's Smooth and all-angle colour options.

## 2026-10-15 · B-156 History panel
- Done: Checked Noggit Red first (IDEAS.md records it). Edit › History opens a floating History window (`HistoryWindow.svelte`, left of the viewport so it doesn't cover the Inspector): the active map's undo stack, oldest first, each step with its label and time, the count against the 100-step limit, and a first row for the state before them. A click undoes or redoes to that step (`History.goTo`, `Engine.goToHistory`, which then refreshes the selection and mask as Undo does); the steps Redo would bring back are dimmed. The window follows tab switches and new steps through `ui.historyVersion`, which only moves on history changes, never per frame.
- Verified: make test passed (Go plus 207 of 207 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no browser tools in this run, so the window was not opened on screen. No unit test: `History` imports the runes state, which the node tests cannot load.
- Left: no key opens the window.

## 2026-10-15 · B-051 Tile-level save (blocked)
- Not started: it needs the owner's decision on the `.wmap` format, and this run was non-interactive (no plan mode or questions to the owner), so per LOOP.md it is logged as blocked and left open.
- Open questions for the owner: (1) What does "tile-level save" save to: one `.wmap` that rewrites only changed tiles in place (a new format version with a tile index), a folder of per-tile files, or only the client export (write only changed tiles into the patch)? (2) Is a region save to the client already enough, so the item is only about standalone `.wmap` maps? (3) Must older single-file maps still open and be saved as before?

## 2026-10-15 · backlog tidy (5th run)
- Removed the items finished in this run (B-146, B-153, B-156), as earlier tidies did; PROGRESS.md, IDEAS.md and noggit-red-feature-gap.md keep their record. The older done items (owner-written ones among them) stay listed as the earlier tidies left them; no owner-written item was deleted.
- No duplicates found. Nothing new fits Parked.
- New line from this run: B-160 (unit tests for History, from B-156).

## 2026-10-15 · stopped (5th run)
- Stopped: the top remaining items are all value L. The run did the three value-M items (B-146, B-153, B-156); B-050 is needs-approval and B-051 (H/M) is blocked on the owner's format decision (questions above).
- The commit trailers name Claude Opus 5.5, the model that ran this, not the Haiku 5.5 of LOOP.md.
- Next top item: B-051 Tile-level save once the owner answers; otherwise every open item is value L (by DESIGN.md order the first is B-128, the area clipboard carrying the chunk data, L/S), so the next loop run stops at once unless the owner picks again.

## 2026-10-15 · approval round (owner, in plan mode)
- The owner answered the items tagged `needs-approval` and B-051 (IDEAS.md records each answer). Approved, and the tag dropped: B-148, B-149, B-150, B-151, B-132, B-026, B-057. Not approved: B-094, and the scripting items B-100, B-101 and B-157 stay off. B-051 is now "export only the changed tiles" and is no longer blocked. B-050 was not asked; it stays on the back burner by the owner's earlier decision.

## 2026-10-15 · B-051 Tile-level save: export only the changed tiles
- Done, as the owner decided (IDEAS.md): Export to Client (publish) and the region save build every file as before, then write only those that differ from the copies already in Meld's patch (`ChangedFiles` in `vmangos/install.go`; the patch's carry-over keeps the rest). The status says how many of the block's tiles were written. A region save with nothing changed leaves the patch alone and no longer closes and reopens the game and servers (`RegionChanges` runs before `App.SaveRegion` stops anything); a publish with nothing changed leaves the server running when its extracted map files are newer than the patch, which saves the minutes of extraction. `SaveRegion` now returns a `RegionResult` (patch, tiles, changed); wailsjs regenerated for it. The region save's message no longer says paint isn't exported, which stopped being true.
- Verified: new `TestChangedFiles` (no patch, our patch, a foreign patch); with WOW_DIR set the export test now re-exports unedited (nothing written) and with one tile edited (that tile written), and the region round trip checks two builds of the same edit are byte-identical. make test passed (Go plus 207 of 207 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or in game.
- Left: the server extraction still runs over the whole client when any tile changed; the extractors have no per-tile mode.

## 2026-10-15 · B-148 Zone editor
- Done, approved by the owner (IDEAS.md records the choices): Edit › Zones… lists a map's zones and their subzones from the client's AreaTable.dbc (the open map's by default, any map from a select). A picked row shows every field: name, zone, exploration level, faction, flags, liquid, music, intro music, ambience, the two sound preferences, minimum elevation, ambient multiplier and light, with its ID and exploration bit. New zone and New subzone add a row with the next free ID and exploration bit (a subzone takes its zone's sounds, music, faction, liquid and level). Save writes the changed rows into AreaTable.dbc in Meld's patch (the game and servers closed around it on Windows, `installWithGameClosed`, now shared with the region save) and, with a server folder set, REPLACEs them into the world database's area_template, which VMaNGOS reads areas from. The Map data tool's zone list is re-read after a save.
- Verified: new areatable tests: a synthetic table (unchanged write is the same bytes, edit, add, a clashing exploration bit and an empty name refused, the SQL), and with WOW_DIR set, the client's Azeroth rows written back are byte-identical, and renaming Goldshire and adding a subzone of Elwynn changes only those rows and reads back through `ReadAreas`. make test passed (Go plus 207 of 207 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app, in game or against the running database: the SQL path is the spawn edits' `ApplySQL`.
- Left: no pickers that name or play the sounds (B-161).

## 2026-10-15 · B-128 Area copy and paste carries the chunks' zones and flags
- Done: an area copy now keeps, per cell, the zone and flags of the chunk the cell is in and the cell's no-tuft byte (`world/clipChunkData.ts`). With the ground pasted, the no-tuft cells land cell for cell, and a chunk whose centre cell lies in the paste takes the zone and impassable flag of the clip cell there; a clip cell with no zone keeps the chunk's own, as the export does with zone 0. The quarter turn turns them with the rest (`rotateClip`). It is part of the paste's one undo step (`ChunkDataStroke`). A clip copied before keeps pasting as it did.
- Verified: new clipChunkData tests (copy, paste with the centre rule and undo, zone 0 kept, the turn). make test passed (Go plus 211 of 211 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-141 Snap selected to ground
- Done: Checked first whether a one-key drop existed (it did not; Page Down lowers by a step) and Noggit Red's behaviour (IDEAS.md). Edit › Put Selected Models on the Ground (Ctrl+Page Down) sets every selected root model's height offset to 0, so it stands on the ground under its position, as one undo step (`Engine.snapSelectedToGround`, `groupTransformCommand`); attached models ride their parents and are left alone. Listed in Help.
- Verified: make test passed (Go plus 211 of 211 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-134 Remove empty texture layers
- Done: Edit › Remove Empty Texture Layers (… in Selection with an area selected) frees, in every chunk that has one, the texture layers whose weight is 0 on all of the chunk's texels, as Noggit Red's Assist › Loaded ADTs clean-up does, through the existing `compactChunk` (used layers move down so slot 0 stays the base; every texel keeps its blend). Only the chunks with an empty layer are touched (`hasEmptySlot`), as one undo step, and the status says how many layers went.
- Verified: a new chunkPaint test for `hasEmptySlot`. make test passed (Go plus 212 of 212 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-126 Area paste: mirror and height modes
- Done (IDEAS.md records the meanings): while pasting an area, the options bar has a Heights select (replace, raise only, lower only, add the bumps, subtract the bumps; `world/pasteHeight.ts`, used by `pasteRegion` before the edge blend) and Mirror ↔ and Mirror ↕ beside Turn 90° (`mirrorClip` in `world/clipRotate.ts`, `mirrorLiquidClip`): heights, holes, texels, liquids, chunk data and models flip together, models turning to face the mirrored way. The paste stays one undo step.
- Verified: new clipboard tests (each height mode, the mirror both ways including liquids and models, mirrored twice is the same). make test passed (Go plus 214 of 214 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.
- Left: a model can't be mirrored itself (see IDEAS.md).

## 2026-10-15 · B-038 Bounding box display
- Done: View › Bounding boxes (`prefs.showBoxes`, kept in scenes) draws a box around every shown model, its model box turned, tilted and scaled with it (`world/ModelBoxes.ts`). All boxes are one set of lines, rebuilt only when the models, their loaded meshes or the ground change (`ObjectLayer.version`, `heightsVersion`), never per frame; with the view off nothing is built.
- Verified: make test passed (Go plus 214 of 214 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-158 Draw selection groups
- Done: with grouped models selected, each of their selection groups gets a yellow box around all its members (the union of their boxes, drawn over everything; `GroupBoxes` in `world/ModelBoxes.ts`), rebuilt only when the selection, the models, the ground or the history moves, with nothing looked at or allocated on other frames. The Inspector says the selection is grouped (how many groups, of how many models) with Ungroup, or offers Group for an ungrouped selection of several; it re-reads the groups on every history change.
- Verified: make test passed (Go plus 214 of 214 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · backlog tidy (6th run)
- Removed the items finished in this run (B-051, B-148, B-128, B-141, B-134, B-126, B-038, B-158), as earlier tidies did; PROGRESS.md, IDEAS.md and noggit-red-feature-gap.md keep their record. B-051 was the owner's item in the sense that its scope was the owner's decision; it is done as decided.
- Parked B-070 (reset camera roll): Meld's camera has no roll.
- No duplicates found. New line from this run: B-161 (sound and music pickers in the zone editor, from B-148).

## 2026-10-15 · stopped (6th run)
- Stopped: 8 items were done in this run (B-051, B-148, B-128, B-141, B-134, B-126, B-038, B-158), which is the cap. It followed the owner's approval round in plan mode, and the new LOOP.md rule to go on with value L items.
- Next top item: B-149 Light editor needs B-084 (client lighting data) first, so B-084 (L/L, approved) is the next client-data item; by DESIGN.md order the next small ones are B-159 brush image on the cursor and B-119 by-slope base restore (core authoring, L/S).

## 2026-10-15 · B-119 By-slope painting: restore the base
- Done (IDEAS.md records the meaning): Sculpt's By-slope painting has a Restore base switch, off by default. With it on, the ground gentler than the dirt angle gets its chunk's base texture (the chunk's first layer, which slot compaction keeps as the base) painted back by how flat it is, so lowering a hill takes its rock away too; it never paints where that base is the rock or the dirt itself. Same stroke and undo step as the rest of the shaping.
- Verified: make test passed (Go plus 214 of 214 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-159 Brush image on the cursor
- Done: while a tool the image brush shapes is active (Sculpt's shaping modes, Paint's texture brush), the brush ring shows the image's grey over the brush's square, turned by Turn exactly as the stroke samples it (`imageWeight`'s frame), in place of the plain inner tint, so a stroke can be aimed. The image goes to the GPU once per image picked (`brushImage.version`, `Engine.updateBrushImageCursor`); each frame only sets two uniforms.
- Verified: make test passed (Go plus 214 of 214 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-013 Show unpaintable chunks
- Done: Paint's texture mode has a Show unpaintable chunks switch (`prefs.showUnpaintable`, off by default as in Noggit Red's texturing tool). With it on, the terrain shader tints red every chunk whose four slots are all taken by other textures, so the paint texture can't go there (Noggit Red's paintability overlay multiplies the colour by red the same way). It reads the chunk slots the shader already has; nothing is computed on the CPU.
- Verified: make test passed (Go plus 214 of 214 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-136 Heightmap import modes
- Done: File › Import Heightmap… opens a small dialog first, as Noggit Red's importer (`MapTile::setHeightmapImage`) has: a mode (Set, Add, Subtract, Multiply) and the Min and Max heights black and white become; each sample's grey becomes min + grey × (max − min) and is set on the ground or added, subtracted or multiplied in (`io/heightmapImport.ts`). An image of another size is now stretched over the map (bilinear) instead of refused, as Noggit Red scales its images. The defaults (Set, −1024 to 1024) read back a Meld-exported heightmap exactly. One undo step, as before; the choices are kept for the session.
- Verified: new heightmapImport tests (exact read-back, the four modes, stretching). make test passed (Go plus 217 of 217 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-127 Gizmo height arrow in the top-down view
- Done: the height arrow's drag is now screen-space in the top-down view (`Engine.dragAt`): the cursor's height on screen, a yard per yard of the orthographic view, instead of the upright drag plane that a straight-down ray never meets. It covers the single model's arrow, the group gizmo's (the item) and a spawn's, which had the same flaw; in the 3D view nothing changes.
- Verified: make test passed (Go plus 217 of 217 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: whether the arrow, seen end-on from above, is easy to pick was not tried.

## 2026-10-15 · B-124 Doodad brush On props: world-scale footprint and a cheaper prop lookup
- Done: with On props, the prop under each point is no longer found by a ray through every instance of every model on the map. The brush keeps a list of the models whose box may reach over it (gathered again only when the brush leaves a margin or the map's models change, `ensureProps`), and the ray tests just those, each through its own model's bounds tree after a box check (`ObjectLayer.raycastAmong`); the hover ghosts, which asked every frame, use the same list. A model already standing on a prop is now spaced by its world scale, its own times its parents' (`ObjectLayer.worldScale`, no allocation), not its own alone.
- Verified: make test passed (Go plus 217 of 217 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: neither placing on props nor the frame time on a dense map was tried.

## 2026-10-15 · B-125 Config fields written whole
- Done: every config write now goes through `config.Update`, which reads the file as it is now, changes the one field the binding owns and saves that: the client folder (`SetWowPath`), the server folder, the game login, the window size on close and the preferences (still merged key by key, B-122). Before, each saved this window's whole copy, so a window that only changed its prefs or closed wrote its older client folder, server folder, login and size over what another window had saved. A window still keeps its own client folder in use until it sets another.
- Verified: new config test (one field set, another window's field kept). make test passed (Go plus 217 of 217 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked with two windows open.

## 2026-10-15 · B-152 Camera collision
- Done (IDEAS.md records the choice): Camera › Camera Collision (`prefs.cameraCollision`, off by default, kept in scenes) keeps the flying camera at least 3 yards above the ground under it, as Noggit Red's camera collision does (`COLLIDE_HEIGHT` in `CameraController`); off, the free camera still enters caves and cellars. Following the ground already kept the camera above it.
- Verified: make test passed (Go plus 217 of 217 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-137 Watermap import (decided, not built)
- Asked the owner in plan mode, since Noggit Red's import is unfinished: the grey is the water's depth above the ground (IDEAS.md). Left open for the next run, as this run reached its cap; the approved plan sketches it (water/liquids.ts through one LiquidStroke, a dialog like the heightmap import's).

## 2026-10-15 · backlog tidy (7th run)
- Removed the items finished in this run (B-119, B-159, B-013, B-136, B-127, B-124, B-125, B-152), as earlier tidies did; PROGRESS.md, IDEAS.md and noggit-red-feature-gap.md keep their record. No owner-written item was deleted.
- No duplicates found. Nothing new fits Parked. No new lines from this run.

## 2026-10-15 · stopped (7th run)
- Stopped: 8 items were done in this run (B-119, B-159, B-013, B-136, B-127, B-124, B-125, B-152), which is the cap. The commits were not pushed, as LOOP.md says, except B-119's, which was pushed out of habit from the previous run's push request.
- Next top item: B-137 Watermap import (L/S, decided by the owner); then B-004 Blur (L/S, which may only need Noggit Red's blur compared with Smooth), B-073, B-079, B-081 and the other small view items, and the approved larger ones (B-084 before B-149).

## 2026-10-15 · B-137 Watermap import
- Done, as the owner decided (IDEAS.md): File › Import Watermap… asks for a Min and Max depth (the heightmap import's dialog in its water form, `HeightmapImportDialog` with `water`), then reads a greyscale PNG stretched over the map: black is no water, and every cell whose four corners aren't black gets water (LiquidType 1) with its surface at the ground plus min + grey × (max − min) at each corner (`io/watermapImport.ts`). The cells are laid with `layLiquidCells` (new in `water/liquids.ts`), which takes those cells from any other liquid and leaves every other cell's liquid alone, and the depth colours are worked out again over the touched cells (`regenOpacity`, auto). One undo step (`Engine.importWatermap`, `LiquidStroke`).
- Verified: new watermapImport tests (the corner rule and heights; laying cells keeps the cells not listed). make test passed (Go plus 219 of 219 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-004 Blur
- Done (IDEAS.md records the choice): Sculpt has a Blur mode beside Smooth. Smooth averages each vertex with its eight neighbours, so it rubs out bumps a cell wide; Blur, after Noggit Red's (`MapChunk::blurTerrain`), pulls each vertex under the brush toward the average of the heights within the brush's radius, weighted down linearly to nothing there, so it evens out a whole slope (`terrain/blur.ts`, a separable tent from a snapshot, so a big brush costs its width per vertex, not its area). It follows the falloff, strength, Only above/below and the image brush, paints while shaping like the other shaping modes, and is one undo step a stroke.
- Verified: new blur tests (flat stays flat, a spike spreads over the radius keeping its mass, only the rect written). make test passed (Go plus 221 of 221 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-014 Animated texture layers and B-015 Overbright
- Done together, as the backlog said for B-015 (IDEAS.md records the choices): Edit › Texture Looks… lists the map's textures; each keeps "The client's" look or takes "This map's": Scroll with a direction (45° steps) and a speed (0 to 7), and Overbright. The looks are per map (`editor.textureLooks`, in `DocMeta` and the `.wmap` header's `textureLooks`) and each change is an undo step. The export sends each layer's look flags (`PaintSpec.Flags`, `RegionPaint.flags`, -1 to keep) and Go writes them into MCLY (`adt.Layer.Flags`, `LayerLookFlags`).
- Data-loss fix found on the way: a region save rewriting a painted chunk dropped the client's animation and overbright flags (only "has alpha" was written). A layer without the map's own look now keeps the flags its texture has in the tile (`tileLayerFlags`, as the ground effects are kept).
- Verified: new adt test (flags written with the alpha flag, kept on a rewrite without them, cleared by an explicit 0), a client test (`TestClientAnimatedLayersKept`: Burning Steppes 33_44 chunk 233's lava keeps 0xf2 through a rewrite, which failed before the fix as only 0x100 was written), the map file round trip with looks, and textureLooks.test.ts (flags round trip, the export's Flags). make test passed (Go plus 223 of 223 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or in game.
- Left: the editor's view doesn't scroll or brighten the textures.

## 2026-10-15 · B-135 Alphamap image export and import
- Done (IDEAS.md records the choices): File › Export Alphamap of the Paint Texture… writes the paint texture's weight at every splat texel of the map as a 16-bit grey PNG (black none, white all of it, through the heightmap writer), and File › Import Alphamap into the Paint Texture… reads a grey image, stretched to the map, into that texture: each texel takes as much of it as the image is light, and its other textures share the rest as before (`terrain/alphamap.ts`). A chunk that lacks the texture takes it into a free slot where the image wants it; a chunk already holding four other textures keeps its paint, and the status counts them. One undo step. New `OpenImageDialog` binding (wailsjs regenerated).
- Verified: new alphamap tests (laid in reads back out within a 255th, sums stay 255, a full chunk refuses, an unwanted texture isn't added). make test passed (Go plus 225 of 225 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-142 Object palette
- Done (IDEAS.md records the choice): a right-click on any asset browser tile stars it as a favourite (a yellow star in its corner; again to unstar), and with the search box empty the browser shows a Favourites row first, above Recent, for the kind tab in use (`prefs.favoriteAssets`, so every map has them; textures can be favourites too). A click on one places or paints it as any tile does.
- Verified: make test passed (Go plus 225 of 225 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-017 Undockable quick texture palette
- Done (IDEAS.md records the choice): Edit › Map Textures (quick palette) opens a floating window (`TexturePaletteWindow.svelte`, `ui.texturePalette`) with the map's own textures and colours as tiles numbered by palette slot; a click makes one the paint texture and switches to Paint (or, while Sculpt paints a texture, makes it the one sculpting paints), without the asset browser. It floats over the viewport like the History window and closes with its ✕.
- Verified: make test passed (Go plus 225 of 225 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-143 Three-axis gizmo
- Done (IDEAS.md records the choices): the gizmo has a red x and a blue z move arrow standing out from the ring, next to the height arrow (the third axis), the ring and the scale knob. Dragging one moves the selected model, or the whole selection, along that axis only (Shift snaps to half yards); a model on the ground stays on it, an attached one keeps its height; one undo step a drag. Edit › Gizmo Arrows in Local Space turns the arrows to the model's own yaw (the primary model's for a group; `ObjectLayer.worldYaw`, no allocation). Region spawns keep their ring and height arrow only.
- Verified: new gizmoAxes test (the drag directions in world and local space match the drawn arrows). make test passed (Go plus 226 of 226 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-040 Helper models (decided, not built)
- Asked the owner in plan mode, since helpers would be built-in shapes and CLAUDE.md says Meld ships no prefabs: editor-only primitives, never exported (IDEAS.md). Left open for the next run, as this run reached its cap; the approved plan sketches it.

## 2026-10-15 · backlog tidy (8th run)
- Removed the items finished in this run (B-137, B-004, B-014, B-015, B-135, B-142, B-017, B-143), as earlier tidies did; PROGRESS.md, IDEAS.md and noggit-red-feature-gap.md keep their record. No owner-written item was deleted.
- No duplicates found. Nothing new fits Parked. New line: B-162 (preview texture looks in the editor, from B-014).

## 2026-10-15 · stopped (8th run)
- Stopped: 8 items were done in this run (B-137, B-004, B-014, B-015, B-135, B-142, B-017, B-143), which is the cap. B-014 brought a data-loss fix with it: a region save no longer drops the client's animated and overbright texture flags. The commits were not pushed, as LOOP.md says.
- Next top item: B-040 Helper models (L/M, decided by the owner), then the approved larger items (B-084 before B-149, B-150, B-151, B-132, B-026, B-057, B-147, B-129) and the small view items (B-073, B-079, B-081, B-071, B-080).

## 2026-10-15 · B-040 Helper models
- Done, as the owner decided (IDEAS.md): the asset browser (Doodads and All) has a Helpers category with generated shapes: a human-height post (2 yards), cubes of 1, 4 and 16 yards, discs 8 and 33 yards across, and spheres of 2 and 10 yards (`models/helpers.ts`, types `helper:*`). They are placed with the Place tool like any model, picked, moved, copied and saved in the `.wmap` as ordinary placed objects (no format change), and drawn see-through and unlit. They never reach the client: the map export and publish (`exportInput`), the region save (`regionObjects`) and the object list leave them out. Their thumbnails and the live preview draw the shapes themselves. CLAUDE.md notes the exception to "no built-in prefabs".
- Verified: new helpers test (each shape stands on its origin at its size; only `helper:` types are helpers). make test passed (Go plus 227 of 227 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-162 Preview texture looks in the editor
- Done (IDEAS.md records the choice): the terrain shader now draws the looks a map sets (Edit › Texture Looks): a scrolling texture moves one repeat every 1.6 s × 7 / speed in its direction, as Noggit Red's terrain shader scrolls it (`animUVOffset`), and an overbright one is drawn 1.5 times brighter. The looks reach the shader as a 256-entry lookup texture by palette slot, rebuilt only when the map's looks or palette change (`Engine.updateLookTexture`); each frame only sets the time. Textures left on the client's look are drawn still, since the editor doesn't know the client's own flags per texture.
- Verified: make test passed (Go plus 227 of 227 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the shader change was not seen running.

## 2026-10-15 · B-132 Stamp tool with brush stacks
- Done, approved by the owner (IDEAS.md records the choices): a Stamp tool (key 0) applies the active brush stack: while the button is held, every brush of the stack that is on applies under the cursor, top to bottom, in one stroke and one undo step. A brush is a sculpt mode (Raise, Lower, Smooth, Blur, Flatten, Noise, Mountain, Crevice) or a paint texture, with its own size, strength, falloff and image-brush turn, or the stack's (the Stamp tool's own size and strength and its Turn) where it inherits them. Stacks are preferences (`prefs.brushStacks`), picked in the options bar and edited in a dialog (brushes added, reordered, switched off, removed; stacks made, renamed, deleted).
- How: each brush runs the Sculpt or Paint tool's own code (a pooled tool per brush, sharing one `TerrainStroke`), reading a copy of the editor's settings made when the stroke starts: the brush tools' module now reads its settings through a swappable binding (`withSettings` in `TerrainTools.ts`), so nothing is written to the reactive editor per frame. A paint brush whose texture the map hasn't got is skipped with a message.
- Verified: new brushStack tests (inheriting and own settings, a stack brush only shapes or paints, free names). make test passed (Go plus 229 of 229 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: no stamp stroke was made on screen.
- Left: Noggit Red's Stamp mode (one imprint grown by a drag) and its shader brushes (vertex colours, after 1.12).

## 2026-10-15 · B-084 Client lighting data for the preview
- Done, approved by the owner (IDEAS.md records the choices): View › Client Lighting (`prefs.clientLighting`, kept in scenes) makes the preview's lighting the client's own where the camera is. Go reads the open map's lights from Light.dbc and their clear-weather LightParams with all 18 colour bands (LightIntBand) and 6 float bands (LightFloatBand) (`vmangos/lights.go`, `MapLights` binding; the 1.12 layouts probed from the client: Light 12 fields with 5 params, positions in thirty-sixths of a yard, band times in half-minutes); a map without a global light (a new one) takes Azeroth's. The frontend blends them at the camera and hour as Noggit Red's Skies do (`wow/clientLight.ts`: the global light, then every local light reaching the camera, fading from its inner to its outer radius, the farthest first) and sets the sun's light (diffuse band), the sky light (ambient), the horizon and fog colour, and the water's shallow and deep colours and alphas from it each frame, without allocating. The map is found by its Map.dbc ID (a region's by its folder). The sky dome stays the editor's own.
- Verified: a client test (`TestClientMapLights`: Azeroth's global light is Light 1 with params 12, whose ocean band is the one the liquid shader was tuned to, fog 500 yards, local lights in yards; a new map gets Azeroth's global light) and clientLight tests (band interpolation and wrap, blending by distance). make test passed (Go plus 231 of 231 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the colours were not seen, so whether the light positions line up with the map (x and z as the tiles' placements) is checked only against the table's ranges.
- Left: the sky dome's colours, the fog distance, weather other than clear, and the light zones on the minimap (B-082).

## 2026-10-15 · B-149 Light editor
- Done, approved by the owner (IDEAS.md records the choices): Edit › Lights… lists the open map's lights from the client (the global light, then the others by distance from the camera, the one the camera is in picked). A light can be moved (typed, or Move to the camera) and its inner and outer radii set; New light at the camera adds one with its own params copied from the global light's. Its clear-weather params are edited too: each of the 18 colour bands as times of day with a colour each (added, moved, recoloured, removed; up to 16), the fog distance and start for the whole day, and the river and ocean alphas. Save writes only the changed lights and params into the client's Light, LightParams, LightIntBand and LightFloatBand in Meld's patch (`vmangos.WriteLights`, `setRecords`, `SaveLights` with the game closed around it), and the preview's client lighting reads them again.
- Verified: a client test (`TestClientLightsWriteBack`: Azeroth's lights and params written back leave the params and band tables byte-identical, after keeping the client's 0xcccccccc in unused key slots; a moved light, a recoloured fog band and a new light with its own params read back; keys out of order are refused). make test passed (Go plus 231 of 231 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or in game.
- Left: the light spheres aren't drawn on the map (B-082), weather other than clear isn't edited, and a float band is set for the whole day only.

## 2026-10-15 · B-147 More Map.dbc fields for a new map
- Done (IDEAS.md records the choices): for a map made for the client, Map Properties has a Client map section: the shown name, the kind (world map, dungeon, raid, battleground), the zone (one of the map's own, Edit › Zones), the loading screen (from the client's LoadingScreens.dbc, `LoadingScreens` binding), the player limit and where a ghost goes back to its corpse (map, x, y). Each change is an undo step; the facts are kept with the map (`VmangosRef.info`, the `.wmap` header's `vmangos.info`, no format bump). On publish they go into the client's Map.dbc row (`SetMapRowInfo`: field 2 the type, 3 the PvP flag, 4 the English name, 19 the zone, 38 the loading screen, checked against Molten Core's, Onyxia's and Warsong's rows) and the server's map_template (type, zone, player limit, ghost entrance, name; `templateSQL` now updates an existing row when the map has its info).
- Verified: a client test (`TestClientMapRowInfo`: a map added to the client's Map.dbc as a raid reads back with its type and name through the client's own reader, and the zone and loading screen sit where Molten Core's do; a bad type is refused), `TestTemplateSQLWithInfo`, and the map file round trip with the info. make test passed (Go plus 231 of 231 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or in game.
- Left: WMO-only maps (B-163).

## 2026-10-15 · B-151 New ground effect sets, and effects per zone or tile
- Done, approved by the owner (IDEAS.md records the choices): Edit › Ground Effects… now has a scope: the whole map (as before), the zone of the chunk under the camera, or the tile under the camera; a texture's choice in a narrower scope wins (tile, then zone, then map, then the client's), each change is an undo step (the map-wide choice too, which wasn't), and ↺ drops a scope's own choice. The choices are kept with the map (`editor.scopedEffects`, the `.wmap` header's `zoneEffects` and `tileEffects`, no format bump), drawn by the tuft preview (resolved per texture, zone and tile once a build, only when the map has such choices) and written into each chunk's layers on export (`ExportInput.effectAt`). New effect… makes a ground effect of up to four of the client's detail models with a density and footstep sounds, written as a new GroundEffectTexture.dbc row into the client's patch (`AddGroundEffect`, the game closed around it) and offered at once.
- Verified: a client test (`TestClientAddGroundEffect`: the new row takes the next ID with the models' doodad IDs, density and terrain, every other row unchanged, an unknown model refused), the resolution order test, and the map file round trip with zone and tile effects. make test passed (Go plus 232 of 232 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or in game.
- Left: new effects can only use detail models the client's effects use already (a new GroundEffectDoodad row isn't made).

## 2026-10-15 · B-163 WMO-only maps
- Done (IDEAS.md records the choice): Map Properties' Client map section has WMO-only ("the map is its first building"). Publishing such a map writes no tiles and no horizon: the WDT is the 1.12 client's WMO-only form (`BuildWMOOnlyWDT`: the MPHD's global-WMO flag, an empty tile table, the building's path in MWMO and one MODF placement with unique ID 0xFFFFFFFF), placing the map's first WMO where it stands, with its bounds read from the WMO and its doodad set (`MapSpec.Global`). A map flagged WMO-only without a building on it says so instead of publishing. The flag is kept with the map's info.
- Verified: client tests (`TestClientWMOOnlyWDT`: Blackfathom Deeps' WDT rebuilt from its own placement is the client's file byte for byte; `TestExportWMOOnlyMap`: a map of Blackfathom's building exports a WDT with the flag, the building and real bounds, and no tiles or WDL). make test passed (Go plus 232 of 232 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in game: a WMO-only map was not entered.

## 2026-10-15 · backlog tidy (9th run)
- Removed the items finished in this run (B-040, B-162, B-132, B-084, B-149, B-147, B-151, B-163), as earlier tidies did; PROGRESS.md, IDEAS.md and noggit-red-feature-gap.md keep their record. No owner-written item was deleted.
- No duplicates found. Nothing new fits Parked. New line from this run: B-163 (WMO-only maps, from B-147), done in the same run.

## 2026-10-15 · stopped (9th run)
- Stopped: 8 items were done in this run (B-040, B-162, B-132, B-084, B-149, B-147, B-151, B-163), which is the cap. The commits were not pushed, as LOOP.md says.
- Next top item: the client round trip's remaining approved items, all L/L: B-129 (write the client's minimap textures), B-150 (area triggers), B-057 (baked shadows), B-026 (water layers); then the small view items (B-073, B-079, B-081, B-071, B-080) and B-082 (light zones on the minimap, which B-084's data now makes possible).

## 2026-10-15 · Benilla as the game client (owner request)
- Done: cloned Benilla (the open-source 1.12.1 client in Rust) to `C:\Servers\Software\benilla` and built it (`cargo build --release -p benilla`). Meld can now use it as its game client: Preferences › Game client (World of Warcraft or Benilla), Benilla Folder… and Launch Benilla/World of Warcraft. Around an export Meld closes and reopens `benilla.exe` instead of `Wow.exe`, starting it from its folder with `WOW_DATA` and, with a saved Game Login, `WOW_USER`/`WOW_PASS` so it logs itself in (`game.Session.Benilla`, `OSRunner.StartEnv`, `config.GameClient`/`BenillaPath`). BENILLA.md records the setup, what Benilla reads of Meld's output (checked in its source) and what is left (B-164 to B-171).
- Verified: a new session test (Benilla closed instead of Wow.exe, started from its folder with the data folder and login in its environment). make test passed (Go plus 232 of 232 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked by running Benilla against the client (B-164).

## 2026-10-15 · Benilla ports planned (owner request)
- Read Benilla's source for what Meld can take from it and recorded it in BENILLA.md ("Porting from Benilla": the Benilla modules, the Meld code each replaces, the order) and in its own BACKLOG.md section, "Benilla ports" (B-172 ground tufts, B-166 sun/sky/fog, B-173 baked shadows, B-167 WDL horizon, B-168 particles and texture animation, B-170 terrain look, B-174 water look, B-169 minimap textures, B-175 footsteps, B-176 WMO interiors). The owner wants these worked first, in that order, in a fresh session. No code changed.

## 2026-10-15 · B-177 Ground effect slots name the wrong models (bug, found in B-172)
- Fixed: a GroundEffectTexture slot names a GroundEffectDoodad by its internal ID (field 1), as the client's `CMapChunk::CreateDetailDoodads` looks it up (Benilla's `ground_effects.rs`, MIT/Apache), not by its row ID (field 0, one more in 367 of the client's 443 rows). Meld keyed by the row ID, so the tuft preview grew the next row's model, and a new effect (Edit › Ground Effects › New effect…) was written with row IDs, which the client reads as other models, and with 0 in its unused slots, which is ElwFlo01 rather than none (0xFFFFFFFF). Both now use the internal ID (`detailPaths`), and empty slots are 0xFFFFFFFF.
- Checked against the client: keyed by the internal ID, 29 of the client's effects mix models from more than one zone; keyed by the row ID, 264 (`TestClientGroundEffectModels`). `TestClientAddGroundEffect` now also reads a new effect's slots back as the same models.
- Note for the owner: an effect added with New effect… before this fix sits in Meld's patch with the old IDs; adding it again writes a correct row.
- Verified: make test passed (Go plus 232 of 232 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the models the preview now draws were not looked at.

## 2026-10-15 · B-172 Ground tufts placed as the client places them
- Done, ported from Benilla (`benilla-formats/src/ground_effects.rs`, MIT/Apache): the tuft preview now scatters each chunk as the client's `CMapChunk::CreateDetailDoodads` does (`scatterChunk`, `BlizzardRandomizer` in `world/groundEffects.ts`): Blizzard's randomizer seeded by the chunk's place in the client's map (a region's chunks counted from its first tile, so a region grows the tufts the game grows there), `frillDensity` cells drawn with repeats, the effect's density of doodads in each (8 for a density of 0), the nth taking slot (n + the cell's turn) & 3 of the row's four slots, an empty slot placing nothing, size 0.9 to 1.1 and a random turn. Go now sends each effect's four slots (`GroundEffect.Slots`). The range is the client's 70 yd (was 90), and View › Sparse/Normal/Full tufts are the client's Ground Clutter stops, 16, 32 and 48 cells a chunk (IDEAS.md). A cell still grows nothing under a building, on a no-tuft cell or over a hole, and its texture is the one weighing most on it, as the export writes the predominant map.
- Found on the way and fixed first in its own commit: B-177 (slots matched against the wrong DBC ID).
- Verified: new tests against vectors printed by Benilla's own Rust (the randomizer's stream from a chunk seed and from 0, and a whole chunk's scatter with an empty slot and a bare row), the density stops, and a client test that every effect's slots name its models in order. make test passed (Go plus 233 of 233 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or side by side with Benilla: the tufts were not looked at on screen.
- Left: the client's fade over the last of the 70 yd (B-178), and the height comes from Meld's own triangles (Meld's grid has no cell-centre vertex), where the client puts a tuft on its four-triangle fan.

## 2026-10-15 · B-166 The client's sun, sky and fog
- Done, ported from Benilla (MIT/Apache: `benilla-world/src/lighting/daynight.rs`, `lighting/resolve.rs`, `shaders/sky.wgsl`, `benilla-formats/src/light/tables.rs` and `atmosphere.rs`; IDEAS.md records the scope). With View › Client Lighting on: the sun's direction is the client's DayNight one (`wow/dayNight.ts`: azimuth 225°, 20° to 37° up all day, so it lights and shadows from the north-west and night is only the light's colours); the scene fog ends at the light's fog end (band 0, in thirty-sixths of a yard) or the far clip and starts at its share (band 1), a storm's negative share putting fog at the eye (`sceneFog`); and the sky dome is the client's (`Environment.setClientSky`): the five sky bands (2 to 6) on the client's ring elevations (90°, 16.8°, 9.8°, 3.7°, 1.8°), the fog colour at and below the horizon, the four middle rings warped toward the sun at dawn and dusk for lights whose LightParams has highlightSky (Go now reads it, read only: `LightParamSet.HighlightSky`), drawn raw as the client draws the bytes, with the visible sun (twice as big at the horizon), the moon and the stars on the client's tables. Bands are now walked as the client walks them, keys as a cycle in stored order (`segment`), which some client rows need. Off, the editor's sun and sky stay.
- Verified: new tests from Benilla's own cases (the DayNight interpolation, the sun never setting on a fixed bearing, the visible sun's elevations, the moon, the warp, star and disc curves; the band walk on the client's out-of-order rows; the fog rule; highlightSky blending) and a client test (13 of Azeroth's 49 params rows highlight the sky). The sky shader was compiled and drawn in headless Chrome (TESTS.md): no shader errors, and each ring elevation reads its band's colour, the fog colour below the horizon. make test passed (Go plus 240 of 240 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app or against Benilla on screen.
- Left: the clouds (B-179); three's fog is a smoothstep where the client's is linear.
- Found: with Shadows off nothing aims the key light, so props are lit from straight above at every hour (B-180, fixed next).

## 2026-10-15 · B-180 The key light isn't aimed with Shadows off (bug, found in B-166)
- Fixed: only the shadow fit placed the key light, so with Shadows off it stayed at three's default (straight overhead) and props were lit from above at every hour, while the terrain shader followed the sun. Now `Environment.aimKey` points it along the sun's direction each frame the shadows are off (after Client Lighting has set that direction).
- Verified: a new Environment test (aimed along the key direction at the given point). make test passed (Go plus 241 of 241 frontend tests). make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app.

## 2026-10-15 · B-173 Baked terrain shadows (MCSH) read and drawn
- Done, after Benilla (MIT/Apache: `benilla-adt` reads MCSH wherever the header gives it a size, `terrain.wgsl` shades with it as the client's `terrainp_s.bls`; IDEAS.md records the choices): `adt` reads each chunk's 64x64-bit shadow map (`Chunk.Shadow`), `vmangos.ReadRegionShadows` (`RegionShadows` binding) stitches a region's into one bit map, and the Engine reads it once per region terrain and draws it: the terrain shader keeps 70% of the light where the client bakes shadow (`bakedShadowTex`), a chunk without a map lit. View › Baked Shadows (`prefs.bakedShadows`, on) shows or hides them. A map of its own has none.
- Verified: a client test (`TestClientRegionShadows`: Northshire's tile reads 1024 texels a side with about half in tree shadow) and the map drawn as an image: canopy shapes running smoothly across chunk seams, so the stitching and bit order hold. A unit test of the bit order. The terrain shader was compiled and drawn in headless Chrome through a Vite bundle of the real `Terrain` (TESTS.md): no shader errors, a shadowed texel at 0.70 of the lit one in linear light, unchanged when hidden. make test passed (Go plus 242 of 242 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app on a real region.

## 2026-10-15 · B-167 Far horizon from the WDL (and B-155)
- Done, after Benilla (MIT/Apache: `benilla-formats/src/wdl.rs` for the mesh, `benilla-assets/src/shaders/wdl.wgsl` for the look; IDEAS.md records the choices): around an open region, Go reads the map's WDL tiles within five tiles of the block (`vmangos.ReadRegionHorizon`, `RegionHorizon` binding), and the frontend meshes them as the client does (`world/horizonMesh.ts`: 17x17 chunk corners and 16x16 chunk centres a tile, four triangles a chunk about its centre) and draws them unlit in the horizon colour (`world/HorizonLayer.ts`), a silhouette against the sky as in the game, read once per document. View › Far Horizon (`prefs.showHorizon`, on) shows or hides it. B-155 (the gap list's far horizon) is done with it.
- Verified: a client test (`TestClientRegionHorizon`: Northshire's 24 neighbours within two tiles, none of them its own, and the east and south neighbours' edge heights within a yard of the block's own edges, so the tiles sit the right way round) and a mesh test (placement, heights, every triangle facing up). make test passed (Go plus 243 of 243 frontend tests); the WOW_DIR client tests passed. make check passed (0 errors, 0 warnings). make build-windows passed. make build-linux was not run (Windows host). Not checked in the app: the horizon wasn't seen on screen.
