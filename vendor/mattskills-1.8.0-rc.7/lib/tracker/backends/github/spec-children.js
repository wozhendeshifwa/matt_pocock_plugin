import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'

async function readChildDependencies(c, parsed, raw, ctx) {
  if (raw.issue_dependencies_summary?.total_blocked_by === 0) return { state: 'complete', refs: [] }
  const refs = []
  for (let page = 1; page <= 100; page++) {
    try {
      const result = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${raw.number}/dependencies/blocked_by?per_page=100&page=${page}`], { cwd: ctx && ctx.cwd })
      if (!result.ok) break
      const rows = JSON.parse(result.data.stdout || '')
      if (!Array.isArray(rows) || rows.some(ref => !ref || !Number.isSafeInteger(ref.number) || ref.number <= 0 || !['open', 'closed'].includes(String(ref.state).toLowerCase()))) break
      refs.push(...rows)
      if (rows.length < 100) {
        const expected = raw.issue_dependencies_summary?.total_blocked_by
        return { state: Number.isInteger(expected) && refs.length < expected ? 'failed' : 'complete', refs }
      }
    } catch { break }
  }
  return { state: 'failed', refs }
}

// Read native children independently of the repository's bounded issue pool.
// Exhausting an explicit REST page is the only source of "complete" here.
export async function enrichSpecChildren(issues, parsed, ctx, { dependenciesKnown = true } = {}) {
  const c = ghClient(ctx)
  const byKey = new Map(issues.filter(issue => issue.isPullRequest !== true).map(issue => [issue.key, issue]))
  const specs = issues.filter(issue => issue.type !== 'map' && issue.labels.some(label => label.name === 'spec'))
  for (const spec of specs) {
    const children = []
    const seen = new Set()
    let damaged = false
    let complete = false
    for (let page = 1; page <= 100; page++) {
      try {
        const result = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${spec.key}/sub_issues?per_page=100&page=${page}`], { cwd: ctx && ctx.cwd })
        if (!result.ok) break
        const rows = JSON.parse(result.data.stdout || '')
        if (!Array.isArray(rows)) break
        for (const raw of rows) {
          try {
            if (!raw || !Number.isSafeInteger(raw.number) || raw.number <= 0 || !['open', 'closed'].includes(String(raw.state).toLowerCase()) || raw.pull_request) { damaged = true; continue }
            let child = byKey.get(String(raw.number))
            const isNew = !child
            const expectedDependencies = raw.issue_dependencies_summary?.total_blocked_by
            if (!child || !dependenciesKnown || child.dependenciesRead?.state === 'failed' || (Number.isInteger(expectedDependencies) && (child.blockedBy || []).length < expectedDependencies)) {
              const dependencies = await readChildDependencies(c, parsed, raw, ctx)
              const hydrated = normalizeIssue(Object.assign({}, raw, { blocked_by: dependencies.refs }))
              if (child) child.blockedBy = hydrated.blockedBy
              else child = hydrated
              child.dependenciesRead = { state: dependencies.state, openKeys: dependencies.refs.filter(ref => String(ref.state).toLowerCase() === 'open').map(ref => String(ref.number)) }
            }
            if (isNew) {
              byKey.set(child.key, child)
              issues.push(child)
            }
            child.parentKey = spec.key
            if (seen.has(child.key)) { damaged = true; continue }
            seen.add(child.key)
            children.push(child)
          } catch { damaged = true }
        }
        if (rows.length < 100) { complete = !damaged; break }
      } catch { break }
    }
    spec.childrenRead = { state: complete ? 'complete' : (children.length ? 'partial' : 'failed'), total: complete ? children.length : null }
    spec.children = children
  }
  return issues
}
