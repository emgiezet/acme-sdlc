---
name: acme-fleet-loop
description: >
  ACME's overlay on the upstream fleet loop: take leaf issues that a human labelled ready, prove
  each one safe for an unattended run (labels, sections, File scope against the repo's forbidden
  paths), turn it into an approved spec and queue it with upstream `aisdlc`. Use when asked to work
  the issue queue of a repository that has an .acme/ configuration, to explain why a leaf is not
  being taken, or to check an issue before labelling it ready. Read skill://fleet-loop first.
---

# ACME fleet loop

Read `skill://fleet-loop` first. Everything there holds — the runner, the phases, the stop
conditions, nothing merges. This file lists only what differs.

## What differs: selection and approval

Upstream pulls the oldest issue carrying one approval label (`bug`) and lets `triage` write a
bugfix spec. ACME work is mostly not bugs, so selection is `acme-queue`, beside this skill:

```bash
ACME="$(realpath skill://acme-fleet-loop)/../../bin/acme-queue"
"$ACME" list --all          # every candidate and the gate it fails
"$ACME" check <n>           # one issue, gate by gate
"$ACME" pull --dry-run      # what would be taken, the spec it would write, the add command
"$ACME" pull [-- <aisdlc add flags>]   # claim, write specs/GH-<n>/spec.md, aisdlc add GH-<n>
"$AISDLC" run --repo . --once           # then the upstream runner, as in fleet-loop
```

A leaf is taken only when **every** gate passes:

| Gate | Rule |
|---|---|
| labels | all of `queue.require_labels`, none of `queue.exclude_labels` |
| unclaimed | no assignee, no `queue.claim_label` (the upstream claim lock) |
| sections | every `queue.require_sections` heading present |
| no open questions | no unchecked `- [ ]` box — epics carry them, leaves must not |
| file scope | at least one glob under `## File scope` |
| forbidden paths | no scope glob reaches the repo's own forbidden list (`queue.forbidden_paths`); a missing list refuses everything |
| not built yet | no `.aisdlc/tasks/*` record for `GH-<n>`, no `ai/GH-<n>-*` branch |

The approval is the human's label: the written spec says
`approved-by: issue #<n> (label <queue.approval_label>)`, exactly as upstream treats `bug`. Never
add the approval label yourself to make the loop take an issue, and never edit a generated spec to
get past a gate — fix the issue, then pull again.

## Configuration and rules

`.acme/project.json` in the product repository; every field has a default (see the plugin
README). `gh_user` pins the GitHub account used for reading and claiming. The rules `ACME-1`…`5`
are in `.claude/rules/acme.md` once `acme-rules sync` has run. Before a tick, `acme-rules check`
must pass. A stale or hand-edited copy means the rules in play are not the ones you think.

## Stop and tell the user when

- `acme-queue` exits 2 — the configuration, the forbidden list or `gh` is broken; nothing is safe
- a pull claimed an issue but `aisdlc add` failed twice for the same leaf
- `list --all` shows every candidate failing the same gate — the issues need fixing, not the loop
