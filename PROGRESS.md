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
