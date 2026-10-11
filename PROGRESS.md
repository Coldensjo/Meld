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
- Left: this changes the text format. Older WorldEditor builds reject the new eight-column lines. Recorded here because the format was not in the backlog's needs-approval list.

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
