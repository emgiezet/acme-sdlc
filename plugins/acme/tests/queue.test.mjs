import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  byRank,
  eligible,
  forbiddenHits,
  gates,
  globsIntersect,
  renderSpec,
  scopeGlobs,
  segmentsIntersect,
} from '../lib/queue.mjs'

const queue = {
  require_labels: ['leaf', 'fleet-ok', 'status:ready'],
  exclude_labels: ['epic', 'gated', 'core-only', 'blocked'],
  priority_labels: ['P0', 'P1', 'P2'],
  claim_label: 'in-progress',
  approval_label: 'status:ready',
  require_sections: ['Problem', 'File scope', 'Acceptance criteria'],
  scope_section: 'File scope',
  criteria_section: 'Acceptance criteria',
}
const FORBIDDEN = ['backend/src/Commerce/**', 'backend/migrations/**', '**/.env', '**/.env.*', 'Makefile', 'docker-compose*.yml']

const body = (scope, extra = '') => `Part of #1.

## Problem

Something is wrong.

## File scope (allowed)

${scope.map((s) => `- \`${s}\``).join('\n')}

## Acceptance criteria

- \`npm run lint\` exits 0.
- The page shows | nothing else.
${extra}`

const leaf = (over = {}) => ({
  number: 7,
  state: 'OPEN',
  title: 'Do a thing',
  url: 'https://github.com/o/r/issues/7',
  labels: ['leaf', 'fleet-ok', 'status:ready', 'P2'],
  assignees: [],
  body: body(['frontend/src/pages/**']),
  ...over,
})
const run = (issue, over = {}) => gates(issue, { queue, forbidden: FORBIDDEN, built: false, ...over })
const failed = (g) => g.filter((x) => !x.ok).map((x) => x.gate)

test('segment patterns intersect on wildcards and literals', () => {
  assert.equal(segmentsIntersect('docker-compose*.yml', 'docker-compose.override.yml'), true)
  assert.equal(segmentsIntersect('*.ts', '*.tsx'), false) // no name ends in both ".ts" and ".tsx"
  assert.equal(segmentsIntersect('a?c', 'abc'), true)
  assert.equal(segmentsIntersect('Makefile', 'makefile'), false)
  assert.equal(segmentsIntersect('*.php', '*.ts'), false)
})

test('path globs intersect through ** in either glob', () => {
  assert.equal(globsIntersect('backend/src/**', 'backend/src/Commerce/**'), true)
  assert.equal(globsIntersect('backend/src/Commerce/Http/X.php', 'backend/src/Commerce/**'), true)
  assert.equal(globsIntersect('backend/.env.dev', '**/.env.*'), true)
  assert.equal(globsIntersect('frontend/src/**', 'backend/src/Commerce/**'), false)
  assert.equal(globsIntersect('backend/src/Catalog/**', 'backend/src/Commerce/**'), false)
})

test('a directory scope is not refused for a file-kind rule, a named file is', () => {
  assert.deepEqual(forbiddenHits(['frontend/src/**'], FORBIDDEN), [])
  assert.deepEqual(forbiddenHits(['frontend/.env'], FORBIDDEN), ['frontend/.env → **/.env'])
  assert.deepEqual(forbiddenHits(['backend/src/**'], FORBIDDEN), ['backend/src/** → backend/src/Commerce/**'])
  assert.deepEqual(forbiddenHits(['Makefile', 'docker-compose.yml'], FORBIDDEN), ['Makefile → Makefile', 'docker-compose.yml → docker-compose*.yml'])
})

test('File scope parsing strips backticks and notes; a trailing slash means the directory', () => {
  const b = body(['frontend/src/store/** (option B only)', 'frontend/src/a/'])
  assert.deepEqual(scopeGlobs(b, 'File scope'), ['frontend/src/store/**', 'frontend/src/a/**'])
})

test('a well-formed, labelled, unclaimed leaf is eligible', () => {
  assert.equal(eligible(run(leaf())), true)
})

test('each gate refuses on its own', () => {
  assert.deepEqual(failed(run(leaf({ state: 'CLOSED' }))), ['open'])
  assert.deepEqual(failed(run(leaf({ labels: ['leaf', 'fleet-ok'] }))), ['labels'])
  assert.deepEqual(failed(run(leaf({ labels: ['leaf', 'fleet-ok', 'status:ready', 'blocked'] }))), ['labels'])
  assert.deepEqual(failed(run(leaf({ assignees: ['someone'] }))), ['unclaimed'])
  assert.deepEqual(failed(run(leaf({ labels: ['leaf', 'fleet-ok', 'status:ready', 'in-progress'] }))), ['unclaimed'])
  assert.deepEqual(failed(run(leaf({ body: body(['frontend/x']).replace('## Problem', '## Context') }))), ['sections'])
  assert.deepEqual(failed(run(leaf({ body: body(['frontend/x'], '\n- [ ] decide later') }))), ['no open questions'])
  assert.deepEqual(failed(run(leaf({ body: body(['backend/migrations/2026.php']) }))), ['forbidden paths'])
  assert.deepEqual(failed(run(leaf(), { built: true })), ['not built yet'])
})

test('an empty File scope is refused, and so is a missing forbidden list (fail closed)', () => {
  assert.deepEqual(failed(run(leaf({ body: body([]) }))), ['file scope'])
  assert.deepEqual(failed(run(leaf(), { forbidden: [] })), ['forbidden paths'])
})

test('ranking: priority label first, then the older issue', () => {
  const issues = [
    { number: 5, labels: ['P2'] },
    { number: 9, labels: ['P0'] },
    { number: 3, labels: [] },
    { number: 4, labels: ['P2'] },
  ]
  assert.deepEqual(issues.sort(byRank(queue.priority_labels)).map((i) => i.number), [9, 4, 5, 3])
})

test('the spec is approved by the issue label and carries every criterion as a UC row', () => {
  const spec = renderSpec(leaf(), queue, 'status:ready')
  assert.match(spec, /^---\nticket: GH-7\n/)
  assert.match(spec, /\nstatus: approved\n/)
  assert.match(spec, /\napproved-by: issue #7 \(label status:ready\)\n/)
  assert.match(spec, /\| UC-1 \| — \| — \| `npm run lint` exits 0\. \|/)
  assert.match(spec, /\| UC-2 \| — \| — \| The page shows \\\| nothing else\. \|/)
  assert.match(spec, /- `frontend\/src\/pages\/\*\*`/)
  // The upstream runner refuses a spec with an unchecked box anywhere.
  assert.doesNotMatch(spec, /^\s*-\s*\[\s\]/m)
})
