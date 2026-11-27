import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'

// Read native children independently of the repository's bounded issue pool.
// Exhausting an explicit REST page is the only source of "complete" here.
export async function enrichSpecChildren(issues, parsed, ctx) {
  const c = ghClient(ctx)
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
            const child = Object.assign(normalizeIssue(raw), { parentKey: spec.key })
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
    for (const child of children) {
      const existing = issues.find(issue => issue.key === child.key && issue.isPullRequest !== true)
      if (existing) Object.assign(existing, { parentKey: spec.key })
      else issues.push(child)
    }
  }
  return issues
}
