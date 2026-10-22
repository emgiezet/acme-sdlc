/**
 * The per-repository binding. It lives in the product repository (`.acme/project.json`), so the
 * plugin stays generic: nothing here knows any particular project. Every field has a default; a
 * repository only writes what differs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CONFIG_PATH = '.acme/project.json'

export const DEFAULT_QUEUE = Object.freeze({
  require_labels: ['leaf', 'fleet-ok', 'status:ready'],
  exclude_labels: ['epic', 'gated', 'core-only', 'blocked'],
  priority_labels: [],
  claim_label: 'in-progress',
  approval_label: 'status:ready',
  require_sections: ['File scope', 'Acceptance criteria'],
  scope_section: 'File scope',
  criteria_section: 'Acceptance criteria',
  forbidden_paths: { file: '.acme/forbidden-paths' },
  specs_dir: 'specs',
  runner: 'aisdlc',
})

const ARRAY_KEYS = ['require_labels', 'exclude_labels', 'priority_labels', 'require_sections']
const STRING_KEYS = ['claim_label', 'approval_label', 'scope_section', 'criteria_section', 'specs_dir', 'runner']

/** `owner/name` from a GitHub remote URL (ssh or https), or null. */
export function slugFromRemote(url) {
  const m = (url ?? '').trim().match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/)
  return m ? m[1] : null
}

/** Merge a raw config over the defaults and validate it. Throws with every problem at once. */
export function resolveConfig(raw, { remoteUrl } = {}) {
  const problems = []
  const queue = { ...DEFAULT_QUEUE, ...(raw.queue ?? {}) }
  queue.forbidden_paths = { ...DEFAULT_QUEUE.forbidden_paths, ...(raw.queue?.forbidden_paths ?? {}) }
  for (const k of ARRAY_KEYS) {
    if (!Array.isArray(queue[k]) || queue[k].some((x) => typeof x !== 'string')) problems.push(`queue.${k} must be an array of strings`)
  }
  for (const k of STRING_KEYS) {
    if (typeof queue[k] !== 'string' || queue[k] === '') problems.push(`queue.${k} must be a non-empty string`)
  }
  if (typeof queue.forbidden_paths.file !== 'string') problems.push('queue.forbidden_paths.file must be a path')
  if (queue.require_labels.length === 0) problems.push('queue.require_labels must name at least one label — an empty list would take every issue')
  if (!queue.require_labels.includes(queue.approval_label)) problems.push(`queue.approval_label "${queue.approval_label}" must be one of require_labels`)
  const repo = raw.repo ?? slugFromRemote(remoteUrl)
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) problems.push('repo must be "owner/name" (or the origin remote must be on GitHub)')
  if (problems.length) throw new Error(problems.join('\n'))
  return { repo, gh_user: raw.gh_user ?? null, queue }
}

export function loadConfig(repoDir, { file, remoteUrl } = {}) {
  const path = file ?? join(repoDir, CONFIG_PATH)
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  return { ...resolveConfig(raw, { remoteUrl }), path, found: existsSync(path) }
}

/** Plain-text list: one glob per line, `#` comments and blank lines ignored. */
export function parseGlobList(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
}

/**
 * The repository's forbidden paths: a text file, or a JS module exporting an array (`export`
 * names the binding) so a repo can keep one list for this queue and its own review-time guard.
 * Anything unreadable yields [] — and the queue refuses every issue on an empty list.
 */
export async function loadForbidden(repoDir, spec) {
  const file = join(repoDir, spec.file)
  if (!existsSync(file)) return []
  if (/\.(mjs|js)$/.test(file)) {
    const mod = await import(pathToFileURL(file).href)
    const list = mod[spec.export ?? 'default']
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()) : []
  }
  return parseGlobList(readFileSync(file, 'utf8'))
}
