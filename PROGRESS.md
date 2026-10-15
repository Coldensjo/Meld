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
