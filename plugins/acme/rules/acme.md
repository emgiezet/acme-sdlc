# ACME rules

Five rules for agents working in this repository, whether in a session or in an unattended run.
Each says what is checked mechanically and what is left to review. The repository's own rules
and specs refine these; they never relax them.

## `ACME-1` Stay inside the approved scope

Change only paths the spec's or issue's `## File scope` allows, and never a path on the
repository's forbidden list (`.acme/project.json` → `queue.forbidden_paths`). A change that needs
more scope stops and says so; it does not widen the scope itself.
Checked: `acme-queue` refuses an issue whose File scope reaches a forbidden path.

## `ACME-2` Work starts from a human approval

Unattended work starts only from an approved spec or an issue a human labelled ready. Agents never
add an approval label, never set `status: approved`, and never edit a generated spec to get past a
gate. They fix the issue instead, and a human approves again.
Checked: `acme-queue` gates (labels, sections, no unchecked `- [ ]`).

## `ACME-3` Every acceptance criterion has a test

Each `UC-<n>` is covered by at least one test that carries the id in its name. A test is never
deleted, skipped or weakened to make a change pass; a test that contradicts the spec is reported.
Checked: review and QA.

## `ACME-4` No secrets or personal data outside where they belong

Credentials, tokens, keys and personal data never enter code, fixtures, logs, commit messages,
issues or pull request bodies. Configuration reads them from the environment.
Checked: review; the forbidden list keeps `.env` files and key directories out of unattended scope.

## `ACME-5` A human merges

Agents open draft pull requests and stop at review. They never merge, force-push, bypass hooks
(`--no-verify`) or approve their own work.
Checked: the upstream runner ends at review; hooks block force-push and `--no-verify`.
