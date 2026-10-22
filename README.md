# acme-sdlc

A small, generic organisation overlay on [aisdlc](https://github.com/emgiezet/aisdlc) (the `sdlc`
plugin and its `aisdlc` runner). It knows no particular project: each repository describes itself
in `.acme/project.json`, and every field has a default.

Two things, nothing more:

1. **Five rules** (`plugins/acme/rules/acme.md`) agents follow in every repository that uses it.
2. **A leaf queue** (`acme-queue`). Upstream takes issues labelled `bug`. This queue takes any issue
   a human labelled ready, after checking it mechanically, and hands it to the upstream runner.

## Rules

| id | Rule | Checked by |
|---|---|---|
| `ACME-1` | Stay inside the approved File scope and off the repository's forbidden paths | `acme-queue` gate; the repo's own diff guard |
| `ACME-2` | Unattended work starts from a human approval; agents never approve | `acme-queue` gates |
| `ACME-3` | Every acceptance criterion has a test named with its `UC-<n>`; no test is weakened | review, QA |
| `ACME-4` | No secrets or personal data in code, fixtures, logs, commits, issues or PRs | review; the forbidden list |
| `ACME-5` | A human merges; no force-push, no `--no-verify`, no self-approval | upstream runner and hooks |

`acme-rules sync` writes them to `<repo>/.claude/rules/acme.md`, stamped with the plugin version
and checksums. `acme-rules check` tells a stale copy (re-sync) from one edited in place (move the
edit into the plugin).

## Queue

```bash
acme-queue list --all                  # every candidate and the first gate it fails
acme-queue check <n>                   # one issue, gate by gate
acme-queue pull --dry-run              # what would be taken, the spec, the aisdlc command
acme-queue pull -- --runtime omp       # claim, write specs/GH-<n>/spec.md, aisdlc add GH-<n>
aisdlc run --repo . --once             # the upstream runner does the rest
```

A leaf is taken only when every gate passes:

| Gate | Rule |
|---|---|
| labels | all `require_labels`, none of `exclude_labels` |
| unclaimed | no assignee, no `claim_label` (the upstream claim lock) |
| sections | every `require_sections` heading present (prefix match) |
| no open questions | no unchecked `- [ ]` box |
| file scope | at least one glob under the scope section |
| forbidden paths | no scope glob intersects the repo's forbidden list. Rules starting with `**/` refuse only scopes that name files. A missing list refuses everything. |
| not built yet | no upstream task record and no `ai/GH-<n>-*` branch |

The written spec says `status: approved` and `approved-by: issue #<n> (label <approval_label>)`.
The human's label is the approval, the same way upstream treats `bug`.

## Configuration

`.acme/project.json` in the product repository. It is optional; these are the defaults:

```json
{
  "repo": "<from the origin remote>",
  "gh_user": null,
  "queue": {
    "require_labels": ["leaf", "fleet-ok", "status:ready"],
    "exclude_labels": ["epic", "gated", "core-only", "blocked"],
    "priority_labels": [],
    "claim_label": "in-progress",
    "approval_label": "status:ready",
    "require_sections": ["File scope", "Acceptance criteria"],
    "scope_section": "File scope",
    "criteria_section": "Acceptance criteria",
    "forbidden_paths": { "file": ".acme/forbidden-paths" },
    "specs_dir": "specs",
    "runner": "aisdlc"
  }
}
```

- `gh_user` pins the GitHub account used to read and claim, for machines logged into several.
- `forbidden_paths.file` is a text list (one glob per line, `#` comments) or a JS module. For a
  module, `forbidden_paths.export` names the exported array, so one list can serve both this queue
  and a review-time guard.
- A config the queue cannot trust is refused outright. Examples: an empty `require_labels`, or an
  `approval_label` that is not one of the required labels.

Examples: [`examples/.acme/`](examples/.acme).

## Install

```bash
make install    # links acme-queue and acme-rules into ~/.local/bin
```

The skill `acme-fleet-loop` is an overlay on upstream `fleet-loop`. Install it through the plugin
marketplace manifests in `.claude-plugin/` and `.omp-plugin/`.

## Develop

```bash
make test       # node:test, no dependencies
make validate   # manifests, versions, example config
```

MIT licensed.
