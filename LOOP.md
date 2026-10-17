# LOOP.md: the repeated prompt

Run this same prompt each time, for example with `/loop` or `claude -p "$(cat LOOP.md)"`.
The backlog is the GitHub issues of `Coldensjo/Meld`, read and written with `gh` (logged in on this
machine). The rest lives in docs/DESIGN.md (goals, rules, priorities) and in the closed issues labelled `decision`
(how finished features were decided), so each run starts fresh.

---

First pull, so the run starts from the remote's state: `git pull --rebase --autostash` (the working
tree may hold the owner's uncommitted changes, which `--autostash` puts back). If the pull fails or
conflicts, stop the run and say so; do not work on a stale or half-rebased tree.

Read CLAUDE.md and docs/DESIGN.md. Do not edit docs/DESIGN.md. Then read the backlog:

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

**0. Triage.** An open issue the owner wrote by hand is a backlog item like any other, but it is in
their words and the next agent starts cold. Such an issue has no `value:` or `effort:` label, or it
has `source:owner` and no comment starting `**Claude:**`, which this lists:

```
gh issue list --repo Coldensjo/Meld --state open --label source:owner --limit 300 --json number,comments --jq '.[] | select(all(.comments[]; .body | startswith("**Claude:**") | not)) | .number'
```

Triage each one before choosing work, and
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
   the files and functions to read, the decisions that apply, how to verify it (a docs/TESTS.md section,
   a spot on the map, a client test) and the traps you know of.
e. Label it: `value:` and `effort:` by your estimate, `source:owner`, one `area:`, and `bug` if it
   is one. An issue with the potential for a large optimization (a big gain in frame time, memory,
   load time or draw calls) gets the highest value, `value:H`, whatever its effort. Add `needs-approval` for large, format-level or non-goal work (docs/DESIGN.md), which pings the
   owner. Keep any label the owner set themselves.
f. If it cannot be worked without the owner (what they want is ambiguous, or it needs a choice the
   decisions, the comments and Noggit Red don't settle), ask as in *Asking the owner*: the comment
   starting `**Claude:** @Coldensjo` with the options and your recommendation, then the
   `owner-question` label, so the owner is pinged.
g. Comment `**Claude:** triaged.` with a line each on what you changed in the title and body, the
   labels and why, and any question asked. Mention the triaged issues in the run log.

**1. Work through items until a stop condition applies.** Skip issues labelled `needs-approval`,
`parked` or `owner-question` (but see *Asking the owner* for answered questions). The owner
approves by commenting `approved` (any limits after it bind the work), and a workflow then removes
`needs-approval`; if the label is still there under such a comment by the owner, the workflow didn't
run, so remove the label yourself and treat the item as approved. The order:
`bug` first; then `benilla-port`, lowest issue number first (the owner's order,
#103); then the rest in docs/DESIGN.md priority order, then value (H first), then effort (S first).
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
4. Continue the item. Recording a decision is not a docs/DESIGN.md change, so do not edit docs/DESIGN.md. If the
   decision would change a hard rule or a non-goal, ask the owner instead (see *Asking the owner*).

**3. For each item, in order:**

a. Read the code it touches before changing it, and search the decisions about the features it
   changes: `gh issue list --repo Coldensjo/Meld --state closed --label decision --search "<words>"`. Keep the change to that item. Follow the hard rules
   in docs/DESIGN.md, and every edit through `History`.

b. Verify it:
   - `make test`
   - `make check`
   - the build for the OS you run on: `make build-windows` on Windows, `make build-linux` on Linux.
     The other cannot run here. Say so in the log.

   If a check fails, fix it. If it cannot be fixed in this run, do not commit the item. Comment on
   the issue that it was left unfinished and why, and move on.

c. If the item changes what the app shows, check it in the app or say in the log that you did not.

d. Commit that item alone, following CLAUDE.md. Stage only the files you changed, by name. Never run
   `git add -A` or `git add .`. The working tree may hold the owner's uncommitted changes. Leave them
   unstaged. Regenerate wailsjs only if the item changed a bound Go method, and stage only the wailsjs
   files that changed for that reason. Do not push per item; the run pushes once, in step 6. The message is one imperative sentence that says
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
large, format-level or non-goal work; that label also pings the owner). As in triage, an issue
with the potential for a large optimization gets `value:H`. Search the open issues first (`gh issue list --search`) and
comment on an existing one instead of filing a duplicate. Do not implement it in this run.

**5. Before stopping, tidy the backlog.** Close duplicates with `--reason "not planned"` and a comment
`**Claude:** duplicate of #<m>`. Anything that no longer fits docs/DESIGN.md gets the `parked` label and is
closed as not planned, with the reason in a comment. Never close an owner-filed issue except as a
duplicate, and say so in the run log.

**6. Push.** After every run, even one that stopped early or did no items, pull and push so the
remote has the run's commits: `git pull --rebase --autostash`, then `git push`. This is the owner's
standing rule for every session (CLAUDE.md, "Git workflow"). Never force push. If the pull conflicts or the push is rejected, do not resolve it by guessing: abort the rebase
(`git rebase --abort`), leave the commits local, and say so in the report. Push only `main` of this
repository, never `vmangos`, `noggit-red` or `benilla`.

**7. Report.** Comment on the pinned Loop run log issue, and end the run with the same short summary:
items done with their issue numbers and commit hashes, items left unfinished and why, owner questions
asked, which stop condition applied, whether the push went through, and the next top item. Do not start work after the stop
condition applies.
