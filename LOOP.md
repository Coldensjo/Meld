# LOOP.md: the repeated prompt

Run this same prompt each time, for example with `/loop` or `claude -p "$(cat LOOP.md)"`.
All state lives in DESIGN.md, BACKLOG.md, IDEAS.md and PROGRESS.md, so each run starts fresh.

---

Read CLAUDE.md, DESIGN.md, BACKLOG.md, IDEAS.md and PROGRESS.md. Do not edit DESIGN.md.

**1. Work through items until a stop condition applies.** Skip anything tagged `needs-approval`.
Bugs come first, then the rest in DESIGN.md priority order, then value (highest first), then effort
(smallest first). Prefer items that finish cleanly. Do up to **8 items per run**. Finish each item
(steps 3 to 4) before you choose the next one.

**2. Stop conditions.** Stop when any of these holds:
- 8 items are done in this run.
- Nothing eligible is left, or the top remaining items are all value L.
- The context is getting full. Stop after the item in progress, not in the middle of it.

When you stop, append a `stopped` entry to PROGRESS.md that says which condition applied. Do not
invent work.

**Blocked items.** If an item needs the owner's decision and IDEAS.md does not record one, or a check
fails and cannot be fixed, log it as unfinished in PROGRESS.md, leave it open in BACKLOG.md, and go on
to the next item. Do not guess at behaviour the owner has not defined. Where IDEAS.md records a
decision, follow it; do not reopen it.

**Unknown meaning.** If an item uses a term or describes a behaviour you cannot pin down from
BACKLOG.md, noggit3-feature-gap.md, IDEAS.md or the code, check noggit3 before you decide it is blocked:

1. Find the behaviour in noggit3 source. Clone it once per run, shallow, into the scratchpad, never into
   the repo: `git clone --depth 1 https://github.com/wowdev/noggit3.git <scratchpad>/noggit3`. Look in
   `src/noggit/` (the UI is in `src/noggit/ui/`). If the clone fails, use WebFetch on
   `https://github.com/wowdev/noggit3`. If neither works, log the item as blocked, with the failure.
2. Pick the behaviour. The default is noggit3's. Keep our current behaviour instead only when ours is
   clearly better, and say why.
3. Record the decision in IDEAS.md under the item: the term, the noggit3 file and function it came
   from, the choice (noggit3 or ours), and the reason. Then note it in the item's BACKLOG.md line as
   decided in IDEAS.md.
4. Continue the item. Recording a decision is not a DESIGN.md change, so do not edit DESIGN.md. If the
   decision would change a hard rule or a non-goal, log it as blocked instead.

A decision made this way is the loop's own call, not the owner's. The IDEAS.md entry should say
"chosen by the loop from noggit3" so the owner can see it and change it.

**3. For each item, in order:**

a. Read the code it touches before changing it. Keep the change to that item. Follow the hard rules
   in DESIGN.md, and every edit through `History`.

b. Verify it:
   - `make test`
   - `make check`
   - `make build-windows`
   - `make build-linux`, only if this is Linux. On a Windows host it cannot run. Say so in the log.

   If a check fails, fix it. If it cannot be fixed in this run, do not commit the item. Log it as
   left unfinished in PROGRESS.md and move on.

c. If the item changes what the app shows, check it in the app or say in the log that you did not.

d. Commit that item alone, following CLAUDE.md. Stage only the files you changed, by name. Never run
   `git add -A` or `git add .`. The working tree already has the owner's uncommitted changes
   (go.mod and frontend/wailsjs). Leave them unstaged. Regenerate wailsjs only if the item changed a
   bound Go method, and stage only the wailsjs files that changed for that reason. Do not push.
   The message is one imperative sentence that says what changed and why, and ends with:

   ```
   Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
   ```

e. Mark the item `[x]` in BACKLOG.md. If it is a gap item, strike it through in
   noggit3-feature-gap.md and add a short *Done:* note, as earlier commits did. Append its entry to
   PROGRESS.md. Put these doc changes in the item's commit, or in a separate
   `Update the backlog and progress logs` commit.

**4. Log new ideas, do not build them.** Anything you notice that is not the current item goes into
BACKLOG.md as a new line, with `Source: loop: <item>` and a one-line reason. Do not implement it in
this run.

**5. Before stopping, tidy the backlog.** Merge duplicates. Remove any item that is done but still
listed. Move anything that no longer fits DESIGN.md into a `## Parked` section at the bottom, with the
reason. Do not delete owner-written items without saying so in PROGRESS.md.

**6. Report.** End the run with a short summary: items done with their commit hashes, items left
unfinished and why, which stop condition applied, and the next top item. Do not start work after
the stop condition applies.
