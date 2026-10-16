# LOOP.md: the repeated prompt

Run this same prompt each time, for example with `/loop` or `claude -p "$(cat LOOP.md)"`.
The backlog is the GitHub issues of `Coldensjo/Meld`, read and written with `gh` (logged in on this
machine). The rest lives in DESIGN.md (goals, rules, priorities) and in the closed issues labelled `decision`
(how finished features were decided), so each run starts fresh.

**Two kinds of run** work the same backlog at the same time, and both claim the issue they work on
(*Claims*), so neither starts what the other is doing. Find out which you are first: a session on
the owner's Windows machine with `gh` is local; a claude.ai/code session in a Linux container (no
`gh`, a branch named `claude/...` given by the harness) is cloud.

| | Local run | Cloud run |
| --- | --- | --- |
| Where | The owner's machine, on `main` | A container, on the branch it was given |
| GitHub | `gh` | The GitHub tools of the session, for the same reads and writes as `gh` |
| Checks | `make test`, `make check`, `make build-windows` | All four, after setup (*Cloud runs*) |
| In the app | With the WoW client, the server and the game | Headless, no client: UI and an own map only |
| Items | Any eligible item | Only items it can verify (*Cloud runs*) |
| Result | A commit on `main`, issue closed | A pull request, issue left open |
| Also | Verifies and merges the cloud pull requests (step P), pushes `main` (step 7) | One item a pull request (step 3f) |

**Cloud runs.** The container has no WoW client, no world database, no game and no owner at the
keyboard, so a cloud run only does work it can show is right without them:

- Setup, before choosing work: the steps of the TESTS.md entry *In a cloud session* (WebKitGTK
  packages, the wails CLI, `pnpm install`). If setup fails, do triage and step 4 only, and say so in
  the report.
- Eligible: items whose change is checked by a unit test (Go under `internal/`, frontend logic under
  `frontend/tests/`), by `make check`, or in the headless app on a map of its own (menus, dialogs,
  options, sculpting and painting with colours, holes, water on the default ocean map, undo); and
  issue work: triage (step 0), notes for the agent, duplicates.
- Not eligible, leave them to a local run: items whose result can only be seen with the client's
  assets (models, textures, WMOs, particles, client lighting, regions, spawns, the asset browser),
  that touch the server, the database or the game, that need a check in the game, or that depend on
  Windows (WebView2, file locking, paths). An item that is mostly logic with a small visible part may
  be done if a unit test covers the logic; say in the pull request what the local run must look at
  in the app.
- Unless the owner is talking to you in the session, never wait for them: ask by comment and the
  `owner-question` label (*Asking the owner*), and go on to another item.
- Read the owner's paths in CLAUDE.md (`C:\WoW\...`) as facts about their machine, not this one.

---

Read CLAUDE.md and DESIGN.md. Do not edit DESIGN.md. A local run first brings `main` up to date with
what was merged on GitHub: `git pull --rebase --autostash origin main` (the autostash keeps the
owner's uncommitted changes; if it or the rebase conflicts, stop the run and tell the owner). A
cloud run does its setup (*Cloud runs*). Then read the backlog:

```
gh issue list --repo Coldensjo/Meld --state open --limit 300 --json number,title,labels,body
```

and the last comment of the pinned **Loop run log** issue (label `loop-log`). If `gh` (or, in a
cloud run, the GitHub tools) fails (no network, logged out), stop the run and say so; do not fall
back to the frozen files.

**Claims.** An issue labelled `claimed` is being worked on by another run: skip it. To take an item,
just before reading its code:

1. Read it again with its comments. If it has gained `claimed` since you chose it, choose another.
2. Add the label `claimed` (create it once with `gh label create claimed --repo Coldensjo/Meld
   --color FBCA04 --description "A loop run is working on this"` if it is missing) and comment
   `**Claude:** claimed by the local loop` or `**Claude:** claimed by a cloud session, branch
   <branch>`, with the UTC time.
3. Read the comments once more. If another run's claim comment came before yours, delete your
   comment, leave the label to it and choose another item.

A claim ends when the item does: remove `claimed` when you close the issue, leave it unfinished, or
ask the owner about it. A cloud item keeps its claim while its pull request is open; the local run
that merges or closes the pull request removes it (step P). A claim more than 24 hours old with no
commit, pull request or comment since is stale: comment `**Claude:** taking over a stale claim.` and
claim it as yours.

**P. Pull requests (local runs only), before triage.** Go through the open pull requests of the
cloud runs:

```
gh pr list --repo Coldensjo/Meld --state open --label cloud-pr --json number,title,headRefName,body
```

Do them all, oldest first; they don't count toward the run's cap. For each:

a. Read it with its comments (`gh pr view <n> --repo Coldensjo/Meld --comments`) and its diff, and
   the issue it closes. Review the diff against CLAUDE.md, DESIGN.md and the issue as you would your
   own work (step 3a).
b. Check it out (`gh pr checkout <n>`; the owner's uncommitted changes stay as they are, or stash
   them with a message and pop them after) and run the checks of step 3b, all four on Linux, the
   three that run on Windows. If the item changes what the app shows, check it in the app (step 3c).
   If the pull request conflicts with `main`, merge `main` into its branch and resolve it, as long
   as the resolution is plain; a resolution that would change what the item does counts as a
   failure.
c. If it passes, merge it, keeping the cloud run's one commit as it is:
   `gh pr merge <n> --repo Coldensjo/Meld --rebase --delete-branch` (after a merge of `main` into the
   branch, use `--squash` with the commit's message as `--subject` and `--body`). Go back to `main`
   and `git pull --rebase --autostash origin main`. Comment on the issue `**Claude:** merged in
   <short-hash> from #<pr>.` with the step 3e lines (Verified: the checks the local run made, and
   whether it was checked in the app), remove `claimed`, and close the issue if the merge didn't.
d. If it fails, or the review finds it wrong, do not fix it here. Comment on the pull request what
   failed and why, close it without deleting its branch, and comment on the issue `**Claude:** left
   unfinished: ...` with what failed and the branch the work is on, so the next run can start from
   it. Remove `claimed`, so any run may take the item again. Go back to `main`.

**Comments.** Every comment the loop (or any Claude session) writes starts with `**Claude:**`. A
comment by `Coldensjo` that doesn't start so is the owner's, and is an instruction for that item: it
ranks above the issue's body and above any `decision` issue. Comments by `github-actions` are only pings (below).
The `**Claude:** notes for the agent` comment on an issue is where earlier sessions left what you need
to know (code, decisions, how to verify, traps); read it before starting. Write each comment or issue body to a temp file and pass it
with `--body-file`, so backticks and backslashes survive the shell.

**0. Triage.** An open issue the owner wrote by hand is a backlog item like any other, but it is in
their words and the next agent starts cold. Such an issue has no `value:` or `effort:` label, or it
has `source:owner` and no comment starting `**Claude:**`, which this lists:

```
gh issue list --repo Coldensjo/Meld --state open --label source:owner --limit 300 --json number,comments --jq '.[] | select(all(.comments[]; .body | startswith("**Claude:**") | not)) | .number'
```

Triage each one before choosing work, skipping one that is `claimed` and claiming the others for
the triage (*Claims*; remove the claim when the triage is done), and
the issue is eligible for this run afterwards. Triage doesn't count toward the run's cap. For each:

a. Read it with its comments, and search for a duplicate (`gh issue list --search`, open and
   closed) and for the `decision` issues it touches. If it duplicates an open issue, comment
   `**Claude:** duplicate of #<m>` and copy anything new from it onto #m, then close it as not
   planned; that is the one way an owner-filed issue may be closed.
b. Pin down what it asks for: read the code it names or touches, and where a term is unclear, check
   Noggit Red as in *Unknown meaning*.
c. Rewrite it in the backlog's wording (CLAUDE.md, "Backlog: GitHub issues"): a title that is one
   short sentence of what should change (`gh issue edit <n> --title`), and a body that says what and
   why in plain terms (`gh issue edit <n> --body-file`). Never lose what the owner wrote: keep their
   original text at the end of the body under `**Original text by the owner:**` as a quote, and do
   not narrow or widen the request. Where you are unsure what they meant, ask rather than choose.
d. Add what the next agent needs as a `**Claude:** notes for the agent working on this.` comment:
   the files and functions to read, the decisions that apply, how to verify it (a TESTS.md section,
   a spot on the map, a client test) and the traps you know of.
e. Label it: `value:` and `effort:` by your estimate, `source:owner`, one `area:`, and `bug` if it
   is one. Add `needs-approval` for large, format-level or non-goal work (DESIGN.md), which pings the
   owner. Keep any label the owner set themselves.
f. If it cannot be worked without the owner (what they want is ambiguous, or it needs a choice the
   decisions, the comments and Noggit Red don't settle), ask as in *Asking the owner*: the comment
   starting `**Claude:** @Coldensjo` with the options and your recommendation, then the
   `owner-question` label, so the owner is pinged.
g. Comment `**Claude:** triaged.` with a line each on what you changed in the title and body, the
   labels and why, and any question asked. Mention the triaged issues in the run log.

**1. Work through items until a stop condition applies.** Skip issues labelled `needs-approval`,
`parked`, `owner-question` (but see *Asking the owner* for answered questions) or `claimed` (see
*Claims*). A cloud run also skips the items *Cloud runs* leaves to a local run. The owner
approves by commenting `approved` (any limits after it bind the work), and a workflow then removes
`needs-approval`; if the label is still there under such a comment by the owner, the workflow didn't
run, so remove the label yourself and treat the item as approved. The order:
`bug` first; then `benilla-port`, lowest issue number first (the owner's order,
#103); then the rest in DESIGN.md priority order, then value (H first), then effort (S first).
Prefer items that finish cleanly. Do up to **8 items per run**; a cloud run that can push to only
one branch does **1 item per run**, since each item is its own pull request. Finish each item
(steps 3 to 4) before you choose the next one. Before starting one, read it with its comments:
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

   A cloud run runs all four after its setup. As root it fails `TestLockedPatchIsRefusedUntouched`
   (TESTS.md, *In a cloud session*); that failure is the container's, so say so in the pull request,
   but any other failure is the item's. The local run runs the checks again in step P.

   If a check fails, fix it. If it cannot be fixed in this run, do not commit the item. Comment on
   the issue that it was left unfinished and why, and move on.

c. If the item changes what the app shows, check it in the app or say in the log that you did not.
   A cloud run checks what the headless app can show (TESTS.md, *In a cloud session*) and says in the
   pull request what the local run must look at with the client in step P.

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

   Remove `claimed` from the issue. A cloud run does step f instead of this one.

f. **Cloud runs: open a pull request** instead of closing the issue. Start the item's branch from the
   latest `origin/main`, so the pull request carries this item alone in one commit (step d). Push it
   and open a pull request into `main`: the title is the commit's sentence, the body is `Closes #<n>`
   and the three lines of step e (Verified saying what was checked in the headless app, and what
   the local run must still look at with the client). Label the pull request `cloud-pr` (create the label as for
   `claimed` if it is missing). Comment on the issue `**Claude:** pull request #<pr> for this.` and
   leave the issue open and `claimed`; the local run merges it or sends it back (step P).

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
whether it was a local or a cloud run, items done with their issue numbers and commit hashes (a
cloud run: the pull requests opened), pull requests merged or sent back (step P), items left
unfinished and why, owner questions asked, which stop condition applied, and the next top item. Do
not start work after the stop condition applies.

**7. Push (local runs only).** Last, `git pull --rebase --autostash origin main`, run `make test` if
the rebase brought in anything, and `git push origin main`, so the cloud runs start from the current
code. Never force-push. If the rebase conflicts or the tests fail, do not push: stop and tell the
owner.
