# LOOP.md: the repeated prompt

Run this same prompt each time, for example with `/loop` or `claude -p "$(cat LOOP.md)"`.
The backlog is the GitHub issues of `Coldensjo/Meld`, read and written with `gh` (logged in on this
machine). The rest lives in DESIGN.md (goals, rules, priorities) and in the closed issues labelled `decision`
(how finished features were decided), so each run starts fresh.

---

Read CLAUDE.md and DESIGN.md. Do not edit DESIGN.md. Then read the backlog:

```
gh issue list --repo Coldensjo/Meld --state open --limit 300 --json number,title,labels,body
```

and the last comment of the pinned **Loop run log** issue (label `loop-log`). If `gh` fails (no
network, logged out), stop the run and say so; do not fall back to the frozen files.

**Comments.** Every comment the loop (or any Claude session) writes starts with `**Claude:**`. A
comment by `Coldensjo` that doesn't start so is the owner's, and is an instruction for that item: it
ranks above the issue's body and above any `decision` issue. Comments by `github-actions` are only pings (below).
The `**Claude:** notes for the agent` comment on an issue is where earlier sessions left what you need
to know (code, decisions, how to verify, traps); read it before starting. Write each comment or issue body to a temp file and pass it
with `--body-file`, so backticks and backslashes survive the shell.

**0. Triage.** An open issue with no `value:` or `effort:` label was filed by the owner. Give it
`value:` and `effort:` labels by your estimate, `source:owner`, an `area:` label (and `bug` if it
is one), and comment `**Claude:** labelled ...` with a one-line reason. Triage doesn't count toward
the run's cap.

**1. Work through items until a stop condition applies.** Skip issues labelled `needs-approval`,
`parked` or `owner-question` (but see *Asking the owner* for answered questions). The order:
`bug` first; then `benilla-port`, lowest issue number first (the owner's order,
#103); then the rest in DESIGN.md priority order, then value (H first), then effort (S first).
Prefer items that finish cleanly. Do up to **8 items per run**. Finish each item (steps 3 to 4) before
you choose the next one. Before starting one, read it with its comments:
`gh issue view <n> --repo Coldensjo/Meld --comments`.

**2. Stop conditions.** Stop when any of these holds:
- 8 items are done in this run.
- Nothing eligible is left. When no value H or M item is eligible, go on with value L items, as
  the owner decided 2026-10-15 (#80); do not stop only because the rest are value L.
- The context is getting full. Stop after the item in progress, not in the middle of it.

Do not invent work.

**Blocked items.** If a check fails and cannot be fixed, comment on the issue what failed, why, what
you tried and where the work stands (`**Claude:** left unfinished: ...`), so the next run doesn't
start over, leave it open, and go on to the next item. Where a comment on
the issue or a `decision` issue records a decision, follow it; do not reopen it. Do not guess at behaviour the
owner has not defined: if an item needs the owner's decision, neither the issue's comments nor
a `decision` issue record one, and Noggit Red does not settle it (see below), ask the owner.

**Asking the owner.**
- In an interactive session: enter plan mode (`EnterPlanMode`), then ask with `AskUserQuestion`: one
  question per open decision, with the options you see, your recommendation first and marked
  "(Recommended)", and the trade-off of each in its description. Record each answer as a comment on
  the issue: `**Claude:** decided by the owner <date>`, the question and the choice. Leave plan mode
  with `ExitPlanMode`, giving the plan for that item, and continue the item once it is approved.
- Otherwise (a non-interactive `claude -p` run, or no answer): comment the questions on the issue,
  starting `**Claude:** @Coldensjo`, each with its options, your recommendation and the trade-offs,
  then add the `owner-question` label, and go on to the next item. The label is what notifies the
  owner: `.github/workflows/ping-owner.yml` mentions them as `github-actions[bot]`, since a mention
  from their own login (which `gh` uses) is silent. Do the same for an item only the owner can do,
  such as a check in the game.
- At the start of each run, look at the `owner-question` issues. Where the owner has commented since
  the question, remove the label, record their answer as a decision comment, and treat the item as
  eligible again.

**Unknown meaning.** If an item uses a term or describes a behaviour you cannot pin down from the
issue and its comments, the `decision` issues or the code, check Noggit Red before you decide it is
blocked:

1. Find the behaviour in Noggit Red source. Clone it once per run, shallow, into the scratchpad, never
   into the repo: `git clone --depth 1 https://gitlab.com/prophecy-rp/noggit-red.git <scratchpad>/noggit-red`.
   Look in `src/noggit/` (the UI is in `src/noggit/ui/`). If the clone fails, use WebFetch on
   `https://gitlab.com/prophecy-rp/noggit-red`. If neither works, leave the item with a comment
   saying so. Noggit Red targets later clients as well as 1.12, so check that a file-format behaviour
   holds for 1.12 tiles before you follow it.
2. Pick the behaviour. The default is Noggit Red's. Keep our current behaviour instead only when ours
   is clearly better, and say why.
3. Record the decision as a comment on the issue: the term, the Noggit Red file and function it came
   from, the choice (Noggit Red or ours), the reason, and "chosen by the loop from Noggit Red", so the
   owner can see it and change it. A decision that reaches beyond the one item (a rule for many items
   or for the loop) becomes its own issue labelled `decision`, closed once recorded and linked from
   this one; a change to the loop's own rules is the owner's to put in LOOP.md, so ask.
4. Continue the item. Recording a decision is not a DESIGN.md change, so do not edit DESIGN.md. If the
   decision would change a hard rule or a non-goal, ask the owner instead (see *Asking the owner*).

**3. For each item, in order:**

a. Read the code it touches before changing it, and search the decisions about the features it
   changes: `gh issue list --repo Coldensjo/Meld --state closed --label decision --search "<words>"`. Keep the change to that item. Follow the hard rules
   in DESIGN.md, and every edit through `History`.

b. Verify it:
   - `make test`
   - `make check`
   - `make build-windows`
   - `make build-linux`, only if this is Linux. On a Windows host it cannot run. Say so in the log.

   If a check fails, fix it. If it cannot be fixed in this run, do not commit the item. Comment on
   the issue that it was left unfinished and why, and move on.

c. If the item changes what the app shows, check it in the app or say in the log that you did not.

d. Commit that item alone, following CLAUDE.md. Stage only the files you changed, by name. Never run
   `git add -A` or `git add .`. The working tree may hold the owner's uncommitted changes. Leave them
   unstaged. Regenerate wailsjs only if the item changed a bound Go method, and stage only the wailsjs
   files that changed for that reason. Do not push. The message is one imperative sentence that says
   what changed and why, then a blank line, `Closes #<n>`, and the `Co-Authored-By` trailer the
   harness gives for the model running the loop. Do not hard-code a model name here, and do not note
   in the log which model ran.

e. Close the issue with its log as the last comment: `gh issue comment <n> --repo Coldensjo/Meld
   --body-file <file>`, then `gh issue close <n> --repo Coldensjo/Meld`. The comment is:

   ```
   **Claude:** done in <short-hash>.
   - Done: what changed, in one or two lines.
   - Verified: which checks ran and passed (make test, make check, make build-windows,
     make build-linux), and anything not run with the reason; whether it was checked in the app.
   - Left: follow-ups as new issues (#n), or "none".
   ```

**4. Log new ideas, do not build them.** Anything you notice that is not the current item becomes a
new issue: a short title, a body that says what and why, `Found while working on #<n>.`, a
`**Claude:** notes for the agent working on this.` comment (the code to read, the decisions that
apply, how to verify it, the traps you know of; CLAUDE.md, "Backlog: GitHub issues"), and the
labels `source:loop`, `value:`, `effort:`, an `area:` (and `bug` for a bug, `needs-approval` for
large, format-level or non-goal work; that label also pings the owner). Search the open issues first (`gh issue list --search`) and
comment on an existing one instead of filing a duplicate. Do not implement it in this run.

**5. Before stopping, tidy the backlog.** Close duplicates with `--reason "not planned"` and a comment
`**Claude:** duplicate of #<m>`. Anything that no longer fits DESIGN.md gets the `parked` label and is
closed as not planned, with the reason in a comment. Never close an owner-filed issue except as a
duplicate, and say so in the run log.

**6. Report.** Comment on the pinned Loop run log issue, and end the run with the same short summary:
items done with their issue numbers and commit hashes, items left unfinished and why, owner questions
asked, which stop condition applied, and the next top item. Do not start work after the stop
condition applies.
