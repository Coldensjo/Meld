# Documentation rules

Start each session with [the roadmap](DOCUMENTATION_PLAN.md) and [the audit](DOCUMENTATION_AUDIT.md).
This is an on-demand maintenance process, not a scheduled job.

## Writing and terminology

- Write for a named reader and task. State prerequisites, platform limits, actions, expected results
  and recovery precautions before optional details. Prefer short sentences and direct instructions.
- Use **Meld**, **WoW 1.12.1 client**, **VMaNGOS server**, **project**, **region**, **new world** and
  **`.wmap` working file** consistently. Saving, compiling, publishing and launching are distinct
  operations; never use them interchangeably.
- Copy menu labels and default shortcuts from source. Use `Edit › Preferences…` for menu paths,
  and say shortcuts can be rebound. Do not infer Linux support from a Windows build.
- Separate observed behavior, source-verified behavior, historical observations and open questions.
  A passing editor round trip does not prove game compatibility.

## Markdown and structure

- Use one level-one heading per page, sentence-case headings, fenced code blocks with a language,
  descriptive links and simple tables. Do not skip heading levels in new prose.
- A workflow should answer: who needs it, prerequisites, steps, success, side effects and recovery.
  Omit irrelevant sections rather than padding.
- Keep everyday tasks in `docs/getting-started.md`, `docs/MANUAL.md` and `docs/guides/`;
  implementation contracts in `docs/architecture/`; repeatable checks in `docs/tests/`;
  historical investigations in `docs/reference/`; builds in `docs/development.md`.
- Raw HTML is disabled by the site's Markdown configuration. Use Markdown and VitePress containers.
  Root management files remain repository documents, not duplicate site pages.

## Internal links and discovery

- Use relative Markdown links within a documentation tree. Prefer stable section anchors over
  copying explanations. Check inbound links before moving or renaming pages.
- Site pages linking outside `docs/` use GitHub source URLs, as explained in
  [development](docs/development.md#work-on-the-documentation). Root files can use repository-relative
  links. Pair source paths with useful symbols rather than brittle line numbers alone.
- Add user-facing pages to `docs/.vitepress/config.mts` and link them from a relevant entry page.
  A successful build does not by itself verify anchors, navigation behavior or search.

## Examples, screenshots and diagrams

- Verify commands, arguments, working directory, platform and side effects against source/config.
  Identify placeholders; give PowerShell alternatives where shell syntax differs.
- Use synthetic examples and disposable output paths. Warn before commands that write client files,
  databases or shared development state. Do not run live tests merely to eliminate skip messages.
- Never include passwords, private connection strings or Blizzard assets in examples or attachments.
  Review screenshots, logs, scene text and project paths before sharing.
- Add screenshots only when they materially clarify a task. Record the relevant build and
  regeneration steps in the audit, use alt text and crop irrelevant UI.
- Use diagrams for difficult boundaries/relationships, with editable source alongside the page.
  Do not add decorative screenshots, diagrams or reference tables as backlog filler.

## Verification

- Discover functionality from source, tests and configuration, not only prose. Indexing a directory
  or reading headings is not an implementation audit.
- Record date, Git revision/range, inspected paths, depth and source symbols in the audit. Identify
  relevant tests/probes and distinguish checks that ran, skipped, failed or were not attempted.
- Coverage labels: **Complete** means sufficient and verified for the stated audience/scope;
  **Partial** means useful with important gaps; **Missing** means valuable docs absent;
  **Outdated** means a verified implementation mismatch; **Unverified** means accuracy not established;
  **Not needed** means insufficient reader value. One verified section does not complete a subsystem.
- For docs-only changes, run `cd frontend; bun run docs:check` (build, relative Markdown links,
  rendered routes/anchors/assets, navigation, basic structure and checker regression tests) and
  `git diff --check`. Do not start a game/server/probe. Record browser validation separately and
  never claim it occurred when it did not. Record build failures and environment limitations.
- The existing Docs workflow validates relevant pull requests and `main` pushes. Only `main`
  publishes Pages. Verify the live `revision.txt` against the intended workflow head after an
  authorized push; record old-site browser checks separately from post-deployment acceptance.
- Do not mark tasks Done unless every acceptance criterion was satisfied.

## Incremental maintenance

### Maintenance phase after initial implementation

The current phase is **sustainable maintenance**, following authorized implementation on
2026-10-28 (sessions 6–7). All currently Ready source-verifiable tasks are complete; DOC-011 is
Blocked on disposable native hosts/distributor decisions and DOC-010 remains Deferred for explicit
owner approval. Do not restart completed tasks simply to keep producing documentation. Update the
canonical page when its implementation changes, a concrete user report exposes a gap or planned
release verification supplies new evidence. Preserve accurate detail and preexisting edits, and
update these three files for meaningful status/evidence changes. Do not modify application source
or run live game/database/extractor/probe/installer operations merely to validate prose.

Track audit coverage separately from documentation coverage and static inspection depth. Use
**Unaudited** for no meaningful feature-level inspection, **Broadly Audited** for an initial
purpose/feature/workflow/source/document/gap/question inventory, and **Deeply Audited** only for a
bounded implementation/configuration/test/document review. Broad coverage does not verify every
implementation detail or make documentation Complete. Keep parent status independent of deeply
reviewed children. Preserve dated evidence when changing current labels.

The breadth-first pass finished in session 4; session 5 resolved DA-01/02/05 for documentation.
Reuse that evidence; inspect source only for specific writing questions or changed contracts.
Do not repeat a repository-wide audit. Label source/synthetic evidence and unexecuted native checks.
If acceptance cannot be met, name the exact remaining question/resource and continue another Ready
task. Preserve concrete continuation instructions at an execution/context limit.

Session 6 completed DOC-004/005/007/008/009/012; session 7 completed DOC-006's bounded source
questions and whole-documentation quality review. Follow the current roadmap, not an older
audit/implementation stop notice. DOC-011 has a concrete disposable-host verification matrix in
the development guide, not permission to test uninstall on the development machine. A completed
source-backed guide must retain its unexecuted native/game limits. Keep remaining runtime evidence
in existing DA/DOC entries, rather than generating a task per platform, field, screenshot or helper.

For a quality review, trace a reader from project purpose to prerequisites, first edit, safe Save As,
Compile/Publish, troubleshooting and contributor build/debug/test. Check entry links and rendered
anchors, not just page counts. Prefer short task routes and links to specialist references over
copying implementation detail into onboarding. Revisit page splitting only when a real task is hard
to find. Record browser/search/accessibility QA separately from a successful static site build.

DOC-013's session-10 theme corrections are local, not deployed acceptance. For future theme changes,
run the guarded theme tests with `bun run docs:check` and the optional browser recipe in
`docs/development.md#check-documentation-accessibility`. Retain axe incomplete findings, independently
check clipped/overlaid search text and distinguish automation/preview-server failures from site bugs.
Review build-time compatibility patches whenever VitePress changes; do not silently skip a guard or
edit installed dependencies. Publication was authorized on 2026-10-29; DOC-013 is Done only after
a deployed-revision retest. Automated checks never certify full WCAG or screen-reader behavior.

Track persistent inspection-unit IDs separately from `DOC-NNN` work items. For static depth use
**Fully inspected**, **Partially inspected** or **Not inspected**, with an explicit feature boundary,
implementation/configuration/test/document paths and remaining work. Filenames, symbols or headings
alone do not count as implementation inspection. Large feature families must have smaller units.
Resolve handoff source paths against the checkout before carrying them forward. Correct inferred
filenames explicitly; an absent file or similarly named component is not inspected evidence.

Fully inspected means all relevant implementation, configuration, existing tests and documentation
within that bounded unit were reviewed. It does not mean every test branch is covered, that live
behavior was verified, or that documentation is Complete. Record those dimensions independently.
Missing tests or unavailable runtime checks are findings/limitations, not proof of correctness.
Do not promote a parent subsystem to Fully inspected because a few child units are finished.
Count delegated inspection only after a usable evidence report has been delivered and reconciled.
A failed worker, assigned scope or discovered filename contributes no inspected coverage. Record
provider/runtime limits without retry loops, silently switching providers or crediting unfinished work.

At a logical stopping point, record exact files/functions/sections read, confirmed mismatches,
sufficient existing coverage, remaining dependencies and the next concrete inspection steps. Keep
all implementation tasks Todo unless their actual documentation acceptance criteria are fulfilled.

### Documentation readiness and investigation closure

Record **Ready**, **Needs Investigation** or **Blocked** independently of task status and coverage.
Ready means enough evidence exists to write the named scope accurately, with explicit limitations;
it is not permission to implement and is not Done. Needs Investigation names an unanswered
question and the DA unit/source/test needed. Blocked names an external resource, owner decision or
unavailable runtime environment, not merely unread source. Ready slices may proceed independently
when implementation is authorized; a parent task with remaining acceptance blockers stays Needs
Investigation. Include all P0/P1 tasks; retain historical Done evidence without reopening it merely
because related advanced work remains.

A DA unit is Complete when its bounded documentation-critical questions are answered or explicitly
classified unresolved with an owner/resource/next check. This does not automatically promote a
child to Fully inspected or certify a whole subsystem Deeply Audited. Record source-only, synthetic
test and real-runtime evidence separately. Merge overlaps into existing DA/DOC IDs rather than
creating duplicate investigations or guides.

### Routine for each execution

1. Read all three management files and `git status --short`; preserve unrelated work.
2. Compare `HEAD` with the last audit revision using `git diff --name-status <revision>..HEAD`;
   inspect working-tree changes too. The revision is a discovery baseline, not full-source approval.
3. Map changes to coverage rows/tasks. Reopen Done tasks if their contracts change, keeping dated
   completion history. Investigate the highest-risk unexplored area next.
4. Reconcile before adding work: merge overlapping tasks and retire obsolete tasks with reasons.
   Prefer the canonical page over another guide. Keep IDs forever; assign the next unused `DOC-NNN`.
   Findings use stable `F-NNN` IDs in the audit. Never recycle removed/merged IDs.
5. When implementation is permitted, select the highest-priority actionable task by user impact,
   frequency, confusion, complexity, onboarding value and maintenance cost. During audit-only work,
   select the next bounded inspection unit instead. Finish a useful slice, not a page/file quota.
6. Claim In Progress work with an owner/session and next checkpoint. Clear the claim at handoff;
   leave concrete next steps for unfinished work. Blocked means an identified external dependency,
   not merely unread code. Deferred means a deliberate scope/value decision.
7. Verify criteria, update inventory/matrix, append audit results and retain completed history.
   Report remaining P0/P1 tasks and uninspected areas explicitly.

Every actionable task records ID, title, description, priority, status, audience, source paths,
target document, acceptance criteria and dependencies (or `None`). Use P0 for critical onboarding
failures or dangerous incorrect essential instructions, P1 for core workflows, P2 for useful advanced
guides/references, and P3 for optional details. Statuses: Todo, In Progress, Done, Blocked, Deferred.

When functionality changes, check its guide, architecture reference and regression recipe in the
same change. Update only affected roadmap entries; preserve dated audit entries. Reassess deferred
work periodically rather than expanding indefinitely. Honor owner-approval restrictions such as
`docs/DESIGN.md`. These files do not replace engineering issues, authorize product changes or
require autonomous scheduling.
