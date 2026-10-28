# Issue loop: Codex/T3 compatibility

Status: configured. The owner authorized resolving Codex setup against the existing
Claude IssueLoop configuration in this session on 2026-10-27. This enables later
explicitly requested runs; it does not start a run or enable recurrence.

## Shared configuration

Read [the existing configuration](../.claude/issue-loop.md) in full before every run
or worker invocation. It remains the single source of repository identity, owner,
design constraints, cap, question mode, areas, priorities, approval requirements,
checks, services, generated-file policy, and forbidden repositories. Do not duplicate
those settings here. Read the applicable project guidance in `CLAUDE.md` as well.

The Codex-specific authorization and compatibility rules below override personal
skill defaults and conflicting delivery/identity/recovery guidance only. They do
not weaken project checks, owner approvals, or higher-priority instructions.

## Authorization and delivery

- Repository: `Coldensjo/Meld`; human owner: `Coldensjo`.
- Delivery: `direct-push`, preserving the existing repository policy, not pull requests.
- Allowed push target: `origin`, `refs/heads/main`, in this repository only. Verify
  the remote still identifies `Coldensjo/Meld` and its default branch is `main`.
- During an explicitly requested issue-loop run, authorize task-scoped GitHub
  comments and labels, triage, follow-up/decision/friction issues, and run-log
  creation/rotation using the existing labels and workflows. Owner/external issue
  rejection or closure as obsolete still requires the owner's decision.
- Authorize local commits for eligible, approved work and the coordinator's verified
  push to `main`. Workers never push. Do not create feature branches, worktrees, PRs,
  or schedules without separate permission.
- Close a completed issue only after its checks pass and its fixing commit is
  confirmed on remote `main`. Local commits alone do not authorize closure. Keep
  failed-push items open and report their local commits.
- Preserve all existing `needs-approval` requirements, external-request acceptance,
  manual-check blockers, and limits recorded in owner replies.
- No force push or automatic stash/reset/clean. Start writes only on clean `main`
  with no pending merge/rebase. Synchronize by fast-forward only. On divergence,
  dirty state, or unsafe worker recovery, stop and report rather than borrowing the
  owner's changes or rewriting history. Stage only named task files.
- Recurrence remains disabled. A run request authorizes one bounded pass only.

## Cross-agent identity

- Agent prefix: `**Claude:** **Codex:**` for every Codex issue body or comment.
  Keeping `**Claude:**` first lets the existing Claude loop recognize these as agent
  output rather than instructions from the owner; the second marker identifies Codex.
- When recognizing human replies, exclude comments beginning with `**Claude:**`,
  `**Codex:**`, or `**IssueLoop:**`, including combined prefixes. Never count an agent's
  approval wording as the owner's approval, even through the same GitHub login.
- Read existing Claude notes and decisions; do not recreate issues or re-triage only
  because an earlier agent used a different prefix.

## Shared runtime ownership

Use the exact existing lock in `.claude/issue-loop.md`: before synchronization,
services, or issue mutations, run `cd frontend && bun probes/loop-lock.mjs take`.
If another loop owns it, stop without touching issues. Release it on every exit
after a successful acquisition; never release a lock this coordinator did not take.
Do not invent a separate Codex lock. Follow the existing service/probe sequencing.

Use fresh sequential T3 workers in the shared owned checkout, passing both this file
and the canonical Claude config. Do not start another writer if a worker leaves
uncommitted changes. The coordinator delivers only after the configured integrated
checks pass. Do not invent model names or coauthor trailers.

## Initialization scope

The existing GitHub workflows, labels, design document, and run log are reused.
Do not run remote setup again merely because this compatibility file exists.
This setup change itself does not authorize a commit, push, issue run, or scheduler
action now; those happen only when separately requested.
