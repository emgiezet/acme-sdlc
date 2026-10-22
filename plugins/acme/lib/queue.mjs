/**
 * Pure logic of the ACME issue queue: everything here is a function of its inputs, so it is
 * testable without GitHub. The CLI (`bin/acme-queue`) does the I/O.
 */

/** Markdown sections keyed by their `## Heading` line (heading text without the hashes). */
export function sections(body) {
  const out = new Map()
  let current = null
  for (const line of (body ?? '').split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) {
      current = h[1]
      out.set(current, [])
    } else if (current !== null) {
      out.get(current).push(line)
    }
  }
  return out
}

/** Text of the first section whose heading starts with `prefix` ("File scope" matches "File scope (allowed)"). */
export function sectionText(body, prefix) {
  for (const [heading, lines] of sections(body)) {
    if (heading.toLowerCase().startsWith(prefix.toLowerCase())) return lines.join('\n').trim()
  }
  return null
}

/** `- item` bullets of a section, as written; continuation lines are ignored. */
export function bullets(text) {
  return (text ?? '')
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+(.*\S)\s*$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
}

/** File scope globs (backticks and trailing notes stripped); a trailing `/` means the whole directory. */
export function scopeGlobs(body, heading) {
  return bullets(sectionText(body, heading))
    .map((g) => g.replace(/`/g, '').split(/\s+/)[0])
    .filter((g) => g.length > 0)
    .map((g) => (g.endsWith('/') ? `${g}**` : g))
}

export const hasOpenCheckbox = (body) => /^\s*[-*]\s*\[\s\]/m.test(body ?? '')

// --- glob intersection -------------------------------------------------------------------
// Two globs overlap when at least one path matches both. Decided structurally (segment by
// segment), so a scope like `backend/src/**` is caught against `backend/src/Commerce/**` and
// `**/.env` against `backend/.env` without needing the files to exist.

function memo(fn) {
  const cache = new Map()
  return (i, j) => {
    const k = `${i},${j}`
    if (!cache.has(k)) cache.set(k, fn(i, j))
    return cache.get(k)
  }
}

/** Do two single-segment patterns (`*`, `?`, literals) match a common string? */
export function segmentsIntersect(a, b) {
  const step = memo((i, j) => {
    if (i === a.length && j === b.length) return true
    if (i < a.length && a[i] === '*') {
      if (step(i + 1, j)) return true
      return j < b.length && step(i, j + 1)
    }
    if (j < b.length && b[j] === '*') {
      if (step(i, j + 1)) return true
      return i < a.length && step(i + 1, j)
    }
    if (i < a.length && j < b.length && (a[i] === b[j] || a[i] === '?' || b[j] === '?')) {
      return step(i + 1, j + 1)
    }
    return false
  })
  return step(0, 0)
}

/** Do two path globs (`**` = zero or more segments) match a common path? */
export function globsIntersect(x, y) {
  const p = x.split('/').filter(Boolean)
  const q = y.split('/').filter(Boolean)
  const step = memo((i, j) => {
    if (i === p.length && j === q.length) return true
    if (i < p.length && p[i] === '**') {
      if (step(i + 1, j)) return true
      return j < q.length && step(i, j + 1)
    }
    if (j < q.length && q[j] === '**') {
      if (step(i, j + 1)) return true
      return i < p.length && step(i + 1, j)
    }
    if (i < p.length && j < q.length && segmentsIntersect(p[i], q[j])) return step(i + 1, j + 1)
    return false
  })
  return step(0, 0)
}

// Scope globs that reach a forbidden glob, as `scope → forbidden` strings.
//
// A forbidden glob that starts with `**/` (`**/.env`, `**/package-lock.json`) names a kind of
// file wherever it lives, not a place. Any directory scope (`src/**`) could in theory contain
// one, so for those rules only a scope that names files itself (one not ending in `/**`) is a
// hit. Touching such a file inside an allowed directory is the diff guard's job at review.
export function forbiddenHits(scope, forbidden) {
  return scope.flatMap((s) => {
    const dirScope = s.endsWith('/**')
    const f = forbidden.find((g) => !(dirScope && g.startsWith('**/')) && globsIntersect(s, g))
    return f ? [`${s} → ${f}`] : []
  })
}

// --- eligibility --------------------------------------------------------------------------

/**
 * Every gate an issue must pass before an unattended run may take it, in order.
 * `issue`: { number, state, title, body, labels: [name], assignees: [login] }.
 * `ctx`: { queue (project.json `queue`), forbidden: [glob], built: boolean }.
 * Returns [{ gate, ok, detail }].
 */
export function gates(issue, ctx) {
  const q = ctx.queue
  const labels = new Set(issue.labels)
  const missingLabels = q.require_labels.filter((l) => !labels.has(l))
  const excluded = q.exclude_labels.filter((l) => labels.has(l))
  const missingSections = q.require_sections.filter((s) => sectionText(issue.body, s) === null)
  const scope = scopeGlobs(issue.body, q.scope_section)
  const hits = forbiddenHits(scope, ctx.forbidden)
  return [
    { gate: 'open', ok: issue.state === 'OPEN', detail: issue.state },
    {
      gate: 'labels',
      ok: missingLabels.length === 0 && excluded.length === 0,
      detail:
        [missingLabels.length && `missing ${missingLabels.join(', ')}`, excluded.length && `excluded by ${excluded.join(', ')}`]
          .filter(Boolean)
          .join('; ') || q.require_labels.join(' + '),
    },
    {
      gate: 'unclaimed',
      ok: issue.assignees.length === 0 && !labels.has(q.claim_label),
      detail: issue.assignees.length ? `assigned to ${issue.assignees.join(', ')}` : labels.has(q.claim_label) ? q.claim_label : 'free',
    },
    {
      gate: 'sections',
      ok: missingSections.length === 0,
      detail: missingSections.length ? `missing ${missingSections.map((s) => `## ${s}`).join(', ')}` : 'present',
    },
    { gate: 'no open questions', ok: !hasOpenCheckbox(issue.body), detail: hasOpenCheckbox(issue.body) ? 'unchecked - [ ] box' : 'none' },
    { gate: 'file scope', ok: scope.length > 0, detail: scope.length ? `${scope.length} glob(s)` : 'empty' },
    { gate: 'forbidden paths', ok: ctx.forbidden.length > 0 && hits.length === 0, detail: ctx.forbidden.length === 0 ? 'forbidden list unavailable — refusing' : hits.length ? hits.join('; ') : 'clear' },
    { gate: 'not built yet', ok: !ctx.built, detail: ctx.built ? 'task record or ai/GH-n branch exists' : 'new' },
  ]
}

export const eligible = (g) => g.every((x) => x.ok)

/** Lower is better: index of the first priority label present, then issue number. */
export function rank(issue, priorityLabels) {
  const i = priorityLabels.findIndex((p) => issue.labels.includes(p))
  return [i === -1 ? priorityLabels.length : i, issue.number]
}

export function byRank(priorityLabels) {
  return (a, b) => {
    const [ra, na] = rank(a, priorityLabels)
    const [rb, nb] = rank(b, priorityLabels)
    return ra - rb || na - nb
  }
}

// --- spec rendering -----------------------------------------------------------------------

const cell = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

/**
 * The approved spec the upstream `aisdlc add` runs from. The issue is the contract: a human
 * labelled it ready, the same way a `bug` label approves a bugfix spec upstream. Nothing is
 * invented — every section is copied from the issue or derived mechanically from it.
 */
export function renderSpec(issue, q, approvalLabel) {
  const scope = scopeGlobs(issue.body, q.scope_section)
  const criteria = bullets(sectionText(issue.body, q.criteria_section))
  const stacks = [...new Set(scope.map((g) => g.split('/')[0]).filter((s) => !s.includes('*')))]
  const copy = (prefix) => sectionText(issue.body, prefix)
  const context = [copy('Code analysis'), copy('Approach')].filter(Boolean).join('\n\n')
  const checks = copy('Tests/checks')
  const rows = criteria.map((c, i) => `| UC-${i + 1} | — | — | ${cell(c)} | ${checks ? 'see Tests/checks' : 'review'} |`)
  return [
    '---',
    `ticket: GH-${issue.number}`,
    `title: ${issue.title.replace(/\n/g, ' ')}`,
    'status: approved',
    'kind: leaf',
    `approved-by: issue #${issue.number} (label ${approvalLabel})`,
    `stacks: [${stacks.join(', ')}]`,
    '---',
    '',
    `# ${issue.title}`,
    '',
    `Source: ${issue.url ?? `issue #${issue.number}`} — generated by acme-queue from the issue body; edit the issue, not this file.`,
    '',
    '## Problem',
    '',
    copy('Problem') ?? '(see source issue)',
    '',
    '## Scope',
    '',
    'In (the File scope of the issue — a hard boundary):',
    '',
    ...scope.map((g) => `- \`${g}\``),
    '',
    'Out:',
    '',
    '- Every path outside the File scope above.',
    '- Content findings the issue marks as report-only.',
    '',
    '## Context',
    '',
    context || '(see source issue)',
    '',
    '## Acceptance criteria',
    '',
    '| id | actor | action | expected observable result | test |',
    '|----|-------|--------|----------------------------|------|',
    ...rows,
    '',
    ...(checks ? ['## Tests/checks', '', checks, ''] : []),
    '## Open questions',
    '',
    'None — the issue passed the open-questions gate.',
    '',
  ].join('\n')
}
