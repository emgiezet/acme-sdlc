import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_QUEUE, loadForbidden, parseGlobList, resolveConfig, slugFromRemote } from '../lib/config.mjs'
import { renderCopy, verifyCopy } from '../lib/rules.mjs'

test('the GitHub slug comes from ssh and https remotes', () => {
  assert.equal(slugFromRemote('git@github.com:owner/app.git\n'), 'owner/app')
  assert.equal(slugFromRemote('https://github.com/owner/app'), 'owner/app')
  assert.equal(slugFromRemote('git@gitlab.com:owner/app.git'), null)
})

test('an empty config resolves to the defaults and the origin repo', () => {
  const c = resolveConfig({}, { remoteUrl: 'git@github.com:o/r.git' })
  assert.equal(c.repo, 'o/r')
  assert.deepEqual(c.queue, DEFAULT_QUEUE)
  assert.equal(c.gh_user, null)
})

test('a repo overrides only what differs; forbidden_paths merges field by field', () => {
  const c = resolveConfig(
    { repo: 'o/r', queue: { priority_labels: ['P0'], forbidden_paths: { file: 'scripts/guard.mjs', export: 'LIST' } } },
    {},
  )
  assert.deepEqual(c.queue.priority_labels, ['P0'])
  assert.deepEqual(c.queue.require_labels, DEFAULT_QUEUE.require_labels)
  assert.deepEqual(c.queue.forbidden_paths, { file: 'scripts/guard.mjs', export: 'LIST' })
})

test('configs that would take the wrong issues are refused, with every problem listed', () => {
  assert.throws(() => resolveConfig({ queue: { require_labels: [] } }, { remoteUrl: 'git@github.com:o/r.git' }), /at least one label/)
  assert.throws(() => resolveConfig({ queue: { approval_label: 'yes' } }, { remoteUrl: 'git@github.com:o/r.git' }), /must be one of require_labels/)
  assert.throws(() => resolveConfig({}, {}), /repo must be "owner\/name"/)
  assert.throws(() => resolveConfig({ queue: { exclude_labels: 'epic', runner: '' } }, { remoteUrl: 'git@github.com:o/r.git' }), (e) =>
    /exclude_labels/.test(e.message) && /runner/.test(e.message))
})

test('a text forbidden list ignores comments and blanks; a module list is read by its export', async () => {
  assert.deepEqual(parseGlobList('# secrets\n**/.env  # anywhere\n\nMakefile\n'), ['**/.env', 'Makefile'])
  const dir = mkdtempSync(join(tmpdir(), 'acme-'))
  mkdirSync(join(dir, '.acme'))
  writeFileSync(join(dir, '.acme/forbidden-paths'), 'a/**\n')
  writeFileSync(join(dir, 'guard.mjs'), 'export const LIST = ["b/**", 7]\n')
  assert.deepEqual(await loadForbidden(dir, { file: '.acme/forbidden-paths' }), ['a/**'])
  assert.deepEqual(await loadForbidden(dir, { file: 'guard.mjs', export: 'LIST' }), ['b/**'])
  assert.deepEqual(await loadForbidden(dir, { file: 'guard.mjs', export: 'MISSING' }), [])
  assert.deepEqual(await loadForbidden(dir, { file: 'nope' }), [])
})

test('a rules copy is current until the source changes or the copy is edited', () => {
  const copy = renderCopy('# rules\n', '1.0.0')
  assert.equal(verifyCopy(copy, '# rules\n').ok, true)
  assert.match(verifyCopy(copy, '# rules v2\n').reason, /rules changed since/)
  assert.match(verifyCopy(`${copy}extra\n`, '# rules\n').reason, /edited in place/)
  assert.match(verifyCopy('# rules\n', '# rules\n').reason, /no acme-rules header/)
})
