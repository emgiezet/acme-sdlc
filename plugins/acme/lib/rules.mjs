/** Header-stamped copies of the rule file, so "the plugin moved on" and "edited in place" differ. */
import { createHash } from 'node:crypto'

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const HEADER = /^<!-- acme-rules: version=(\S+) source-sha256=([0-9a-f]{64}) body-sha256=([0-9a-f]{64}) -->\n/

export function renderCopy(source, version) {
  const body = source.endsWith('\n') ? source : `${source}\n`
  return `<!-- acme-rules: version=${version} source-sha256=${sha256(source)} body-sha256=${sha256(body)} -->\n${body}`
}

/** { ok, reason } for an existing copy against the current source text. */
export function verifyCopy(copy, source) {
  const m = copy.match(HEADER)
  if (!m) return { ok: false, reason: 'no acme-rules header — not written by acme-rules sync' }
  if (sha256(copy.slice(m[0].length)) !== m[3]) return { ok: false, reason: 'edited in place — move the change into the plugin, then re-sync' }
  if (m[2] !== sha256(source)) return { ok: false, reason: `written by acme ${m[1]}; the rules changed since — run acme-rules sync` }
  return { ok: true, reason: 'current' }
}
