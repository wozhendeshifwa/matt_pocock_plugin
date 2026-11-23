import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { prepareWriteIntent } from './write-intents.mjs';
import { canonical, digest, threadId as identityOf } from './protocol.mjs';
import { localGithubHost } from './github-host.mjs';

export const GITHUB_EFFECT_METHODS = Object.freeze(['deck_issue_create', 'deck_issue_patch', 'deck_map_link', 'deck_map_plan_create', 'commentIssue', 'setLabelColors']);
const run = promisify(execFile), METHODS = new Set(GITHUB_EFFECT_METHODS);
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const same = (left, right) => canonical(left) === canonical(right);
const hash = value => digest(canonical(value));
const need = (condition, text) => { if (!condition) throw new Error(text); };
const number = value => { const text = String(value ?? ''); need(/^\d{1,10}$/.test(text) && Number(text) > 0, 'Use a numeric local issue identity'); return Number(text); };
const names = list => { need(Array.isArray(list), 'Missing complete name set'); return [...new Set(list.map(item => { const name = typeof item === 'string' ? item : item?.name ?? item?.login; need(typeof name === 'string' && name.trim(), 'Invalid name'); return name.trim().toLowerCase(); }))].sort(); };
const numbers = list => { need(Array.isArray(list), 'Missing complete issue set'); return [...new Set(list.map(item => number(item?.number ?? item?.key ?? item)))].sort((a, b) => a - b); };
const business = response => response?.error || response?.result?.isError || response?.result?.structuredContent?.ok === false ? null : response?.result?.structuredContent?.value ?? response?.result?.structuredContent;
const fields = issue => ({ title: issue.title, body: issue.body, state: issue.state, labels: issue.labels, assignees: issue.assignees });

// Only fixed GET recipes. The optional reader is a local test dependency, never
// a request/config field. Every repository comes from the bound local context.
function endpoint({ repository, resource, issueNumber, page = 1 }) {
  need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository), 'Invalid locally selected GitHub repository');
  need(Number.isSafeInteger(page) && page >= 1 && page <= 100, 'Readback page exceeds its bound');
  const base = 'repos/' + repository, suffix = '?per_page=100&page=' + page;
  if (resource === 'viewer') return 'user';
  if (resource === 'repository') return base;
  if (resource === 'issues') return base + '/issues?state=all&per_page=100&page=' + page;
  if (resource === 'labels') return base + '/labels' + suffix;
  const key = number(issueNumber), issue = base + '/issues/' + key;
  if (resource === 'issue') return issue;
  if (resource === 'parent') return issue + '/parent';
  if (resource === 'children') return issue + '/sub_issues' + suffix;
  if (resource === 'blockers') return issue + '/dependencies/blocked_by' + suffix;
  if (resource === 'comments') return issue + '/comments' + suffix;
  throw new Error('Readback resource is not allowlisted');
}
async function fixedReader(env) {
  const gh = await resolveExecutable('gh', { env }); need(gh, 'Local GitHub CLI is unavailable for independent readback');
  const hostname = localGithubHost(env);
  return async scope => {
    const args = ['api', '--hostname', hostname, '--include', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2026-03-10', endpoint(scope)];
    let output;
    try { output = (await run(gh, args, { cwd: scope.projectRoot, env, windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 })).stdout; }
    catch (error) { output = error.stdout; }
    need(typeof output === 'string', 'Independent GitHub readback failed');
    const header = /^HTTP\/[\d.]+\s+(\d{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n/.exec(output);
    need(header, 'Independent GitHub response has no status');
    return { status: Number(header[1]), body: JSON.parse(output.slice(header[0].length)) };
  };
}

export async function createGithubWriteEffects({ adapterPath, env = process.env, readGithub } = {}) {
  const hostname = localGithubHost(env);
  need(typeof adapterPath === 'string' && path.isAbsolute(adapterPath), 'Use the verified frozen sidebar entrypoint');
  const file = await realpath(adapterPath), root = await realpath(path.resolve(path.dirname(file), '../..'));
  need(fold(file) === fold(path.join(root, 'prototypes/upstream-port/sidebar-server.mjs')), 'Use the verified frozen sidebar entrypoint');
  const vendor = path.join(root, 'vendor/mattskills-1.8.0-rc.7');
  const [plan, patch, anchors] = await Promise.all([
    import(pathToFileURL(path.join(vendor, 'shared/deck-tools/plan.js')).href),
    import(pathToFileURL(path.join(vendor, 'lib/tools/deckIssuePatch.js')).href),
    import(pathToFileURL(path.join(vendor, 'shared/refresh/idempotency.js')).href),
  ]);
  const reader = readGithub ?? await fixedReader(env);
  need(typeof reader === 'function', 'Use a trusted local GitHub reader');

  async function prepare({ method, request, projectRoot, threadId, adapter }) {
    need(METHODS.has(method) && request?.method === 'tools/call' && identityOf(request) === threadId, 'Unsupported or unbound GitHub write');
    const localRoot = await realpath(projectRoot), context = { projectRoot: localRoot, threadId };
    const rpc = !method.startsWith('deck_'), args = structuredClone(rpc ? request.params.arguments?.payload : request.params.arguments);
    need(args && typeof args === 'object' && !Array.isArray(args), 'Use the original write parameters');
    if (rpc) need(request.params.name === 'deck_upstream_write' && request.params.arguments.method === method && args.expectedThreadId === threadId, 'GitHub RPC belongs to another host thread');
    else need(request.params.name === method, 'GitHub write method mismatch');
    let sequence = 0, selected;
    async function call(name, parameters) {
      return adapter.request({ jsonrpc: '2.0', id: 'github-readback-' + ++sequence, method: 'tools/call', params: { name, arguments: parameters, _meta: request.params._meta } }, context);
    }
    async function getContext() {
      const value = business(await call('deck_context', {}));
      need(value?.ok === true && value.status === 'ok' && value.tool === 'deck_context' && value.backend?.id === 'github' && value.repo?.backend === 'github' &&
        typeof value.workspace?.root === 'string' && fold(await realpath(value.workspace.root)) === fold(localRoot) && value.data?.workspace?.sessionId === threadId, 'No trusted local GitHub context');
      // The original backend formats github.com links even with GH_HOST. Keep
      // that UI behavior while pinning actual API/CLI authority independently.
      need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value.repo.refId ?? '') &&
        ['https://github.com/' + value.repo.refId, 'https://' + hostname + '/' + value.repo.refId].includes(value.repo.url), 'Local GitHub context has no exact repository');
      if (selected) need(value.repo.refId === selected.repo.refId, 'Local GitHub repository changed during write');
      return value;
    }
    selected = await getContext();
    const repository = selected.repo.refId, readScope = { repository, projectRoot: localRoot, hostname };
    async function read(resource, issueNumber, page) {
      const scope = { ...readScope, resource, ...(issueNumber === undefined ? {} : { issueNumber }), ...(page === undefined ? {} : { page }) };
      endpoint(scope); const result = await reader(scope);
      need(result && Number.isInteger(result.status), 'GitHub reader omitted HTTP status'); return result;
    }
    async function pages(resource, key) {
      const rows = [], seen = new Set(); let bytes = 0;
      for (let page = 1; page <= 100; page++) {
        const reply = await read(resource, key, page); need(reply.status === 200 && Array.isArray(reply.body) && reply.body.length <= 100, 'GitHub pagination is incomplete');
        bytes += Buffer.byteLength(canonical(reply.body)); need(bytes <= 32 * 1024 * 1024, 'Readback exceeded its bounded complete-snapshot budget');
        for (const row of reply.body) { const id = row?.id; need((typeof id === 'number' || typeof id === 'string') && String(id) && !seen.has(String(id)), 'Duplicate or missing identity during pagination'); seen.add(String(id)); rows.push(row); }
        if (reply.body.length < 100) return rows;
      }
      throw new Error('GitHub pagination reached its local bound without proving completion');
    }
    let repositoryApiUrl = 'https://api.github.com/repos/' + repository;
    if (hostname !== 'github.com') {
      const metadata = await read('repository');
      need(metadata.status === 200 && metadata.body?.full_name === repository && Number.isSafeInteger(metadata.body.id) && metadata.body.id > 0, 'Enterprise repository identity cannot be independently read');
      const api = new URL(metadata.body.url);
      need(api.protocol === 'https:' && !api.username && !api.password && !api.search && !api.hash &&
        [new URL('https://' + hostname).host, new URL('https://api.' + hostname).host].includes(api.host) &&
        ['/repos/' + repository, '/api/v3/repos/' + repository].includes(api.pathname), 'Enterprise repository API authority differs from the trusted host');
      repositoryApiUrl = metadata.body.url;
    }
    function issue(raw) {
      need(raw && raw.repository_url === repositoryApiUrl && typeof raw.title === 'string' && ['open', 'closed'].includes(raw.state), 'Issue readback belongs to another repository or is incomplete');
      return { key: number(raw.number), id: raw.id, title: raw.title, body: typeof raw.body === 'string' ? raw.body : '', state: raw.state,
        labels: names(raw.labels), assignees: names(raw.assignees), isPull: Boolean(raw.pull_request) };
    }
    function boundEnvelope(response, tool) {
      const value = business(response);
      need(value?.ok === true && value.status === 'ok' && value.tool === tool && value.backend?.id === 'github' && value.repo?.backend === 'github' &&
        value.repo.refId === repository && value.workspace?.root === selected.workspace.root, 'Tool result is partial or belongs to another tracker');
      need(!value.items?.some(item => item?.status !== 'ok'), 'Tool result contains a failed step'); return value;
    }
    async function readIssue(key, graph = false) {
      const value = boundEnvelope(await call('deck_issue_get', { key: String(key), comments: 1, blocking: graph }), 'deck_issue_get');
      const response = await read('issue', key); need(response.status === 200, 'Independent issue read failed'); const actual = issue(response.body), shown = value.data?.ticket;
      need(actual.key === key && shown && number(shown.key) === key && same(fields(actual), { title: shown.title, body: shown.body ?? '', state: shown.state, labels: names(shown.labels), assignees: names(shown.assignees) }), 'Adapter and independent issue fields disagree');
      if (graph) {
        need(!actual.isPull, 'Native issue relations are unavailable for pull requests');
        const parent = await read('parent', key); need(parent.status === 200 || parent.status === 404, 'Native parent read failed');
        actual.parent = parent.status === 404 ? null : issue(parent.body).key;
        actual.blockedBy = numbers((await pages('blockers', key)).map(issue));
        need((value.data?.relations?.parentKey ? number(value.data.relations.parentKey) : null) === actual.parent && same(numbers(value.data?.relations?.blockedBy), actual.blockedBy), 'Contract relations disagree with native GitHub relations');
      }
      return actual;
    }
    async function children(key) { return numbers((await pages('children', key)).map(issue)); }
    async function snapshot(key, expected) {
      const value = boundEnvelope(await call('deck_map_snapshot', { key: String(key), detail: 'thin' }), 'deck_map_snapshot');
      need(value.data?.truncated === false && same(numbers(value.data.children), expected), 'Map snapshot is incomplete or contains different children');
    }
    async function comments(key) {
      const raw = await pages('comments', key), rows = [];
      for (const item of raw) { need(typeof item.body === 'string' && typeof item.created_at === 'string' && typeof item.user?.login === 'string', 'Incomplete comment readback'); rows.push({ id: String(item.id), body: item.body, author: item.user.login.toLowerCase(), createdAt: item.created_at, updatedAt: item.updated_at ?? item.created_at }); }
      const shown = [], cursors = new Set(); let after = null;
      for (let page = 0; page < 100; page++) {
        const value = business(await call('deck_upstream_read', { method: 'issueComments', payload: { number: key, after, expectedThreadId: threadId } }));
        need(value?.ok === true && Array.isArray(value.nodes) && value.pageInfo && typeof value.pageInfo.hasNextPage === 'boolean', 'Adapter comments page is incomplete');
        shown.push(...value.nodes.map(item => ({ body: item.body, author: item.author?.login?.toLowerCase(), createdAt: item.createdAt, updatedAt: item.updatedAt ?? item.createdAt })));
        if (!value.pageInfo.hasNextPage) break;
        const cursor = value.pageInfo.endCursor; need(typeof cursor === 'string' && cursor && !cursors.has(cursor) && page < 99, 'Adapter comments pagination did not finish'); cursors.add(cursor); after = cursor;
      }
      need(same(rows.map(({ id, ...row }) => row).sort((a, b) => canonical(a).localeCompare(canonical(b))), shown.sort((a, b) => canonical(a).localeCompare(canonical(b)))), 'Adapter comments omit or duplicate independent rows'); return rows;
    }
    async function labelState() {
      const raw = await pages('labels'), labels = raw.map(row => ({ name: String(row.name).trim().toLowerCase(), color: String(row.color).toLowerCase(), description: row.description ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
      need(new Set(labels.map(row => row.name)).size === labels.length && labels.every(row => row.name && /^[a-f0-9]{6}$/.test(row.color)), 'Incomplete or ambiguous labels');
      const value = business(await call('deck_upstream_read', { method: 'listLabels', payload: { expectedThreadId: threadId } }));
      need(value?.ok === true && value.backendId === 'github' && same(labels, value.labels?.map(row => ({ name: String(row.name).trim().toLowerCase(), color: String(row.color).toLowerCase(), description: row.description ?? '' })).sort((a, b) => a.name.localeCompare(b.name))), 'Adapter labels disagree with independent full list'); return labels;
    }
    async function viewer() { const value = await read('viewer'); need(value.status === 200 && typeof value.body?.login === 'string' && value.body.login, 'Local GitHub actor is unavailable'); return value.body.login.toLowerCase(); }
    let beforeIssues = [], beforeComments = null, beforeLabels = null, actor = null, beforePlanMap = null;
    const beforePlanChildren = new Map();
    const before = new Map(), parentChildren = new Map();
    const key = method === 'commentIssue' ? number(args.number) : method === 'deck_issue_patch' ? number(args.key) : null;
    let jobs = [];
    if (method === 'deck_map_link') {
      const source = args.edges?.length ? args.edges : args.key ? [args] : [], merged = new Map();
      for (const job of source) { const key = number(job.key), row = merged.get(key) ?? { key }; if (job.parentKey !== undefined && job.parentKey !== null) row.parent = job.parentKey === '' ? null : number(job.parentKey); if (job.blockedBy !== undefined) row.blockedBy = [...new Set([...(row.blockedBy ?? []), ...numbers(job.blockedBy)])].sort((a, b) => a - b); merged.set(key, row); }
      jobs = [...merged.values()]; need(jobs.length, 'No native relation change was requested');
      for (const job of jobs) { before.set(job.key, await readIssue(job.key, true)); for (const parent of [before.get(job.key).parent, job.parent]) if (parent && !parentChildren.has(parent)) parentChildren.set(parent, await children(parent)); }
    } else if (key) before.set(key, await readIssue(key, method === 'deck_issue_patch'));
    if (method === 'commentIssue' || method === 'deck_issue_patch' && typeof args.comment === 'string' && args.comment.trim()) { beforeComments = await comments(key); actor = await viewer(); }
    if (method === 'setLabelColors') beforeLabels = await labelState();
    if (method === 'deck_issue_create' || method === 'deck_map_plan_create') beforeIssues = (await pages('issues')).filter(row => !row.pull_request).map(issue);
    if (method === 'deck_map_plan_create' && args.planId) {
      const prefix = 'deck-plan-' + args.planId + '-', mapHits = beforeIssues.filter(row => row.state === 'open' && anchors.idempotencyKeyOf(row.body) === prefix + 'map');
      need(mapHits.length <= 1, 'Existing plan map anchor is ambiguous');
      if (mapHits.length) beforePlanMap = await readIssue(mapHits[0].key, true);
      for (const row of beforeIssues.filter(row => row.state === 'open' && anchors.idempotencyKeyOf(row.body).startsWith(prefix + 'child-'))) {
        const short = anchors.idempotencyKeyOf(row.body).slice((prefix + 'child-').length);
        need(short && !beforePlanChildren.has(short), 'Existing plan child anchor is ambiguous'); beforePlanChildren.set(short, await readIssue(row.key, true));
      }
    }
    const endpoints = [...new Set([...before.keys(), ...(args.parentKey ? [number(args.parentKey)] : []), ...jobs.flatMap(job => [job.parent, ...(job.blockedBy ?? [])]).filter(Boolean)])];
    for (const endpoint of endpoints) if (!before.has(endpoint)) before.set(endpoint, await readIssue(endpoint));
    const matching = beforeIssues.filter(row => method === 'deck_issue_create' ? row.title === args.title?.trim() || args.idempotencyKey && anchors.idempotencyKeyOf(row.body) === args.idempotencyKey : args.planId ? anchors.idempotencyKeyOf(row.body).startsWith('deck-plan-' + args.planId + '-') : [args.title, ...(args.children ?? []).map(child => child.title)].some(title => row.title === title?.trim()));
    const readTracker = async () => ({ backendId: 'github', repository, complete: true, issues: [...before.values()].map(row => ({ key: String(row.key) })), existingMatches: matching.map(row => ({ key: row.key, bodySha256: digest(row.body) })), stateSha256: hash({ issues: [...before], beforeIssues, beforeComments, beforeLabels, parents: [...parentChildren], planMap: beforePlanMap, planChildren: [...beforePlanChildren] }), ...(beforeLabels ? { labels: beforeLabels } : {}) });
    const intentArgs = structuredClone(args);
    if (method === 'deck_map_plan_create' && beforePlanChildren.size) for (const [key, row] of beforePlanChildren) if (!intentArgs.children?.some(child => child.key === key)) {
      intentArgs.children.push({ key, title: row.title, body: row.body, labels: row.labels, assignees: row.assignees });
    }
    const prepared = method === 'setLabelColors' && Array.isArray(args.changes) && args.changes.length === 0
      ? { intent: { target: { repository, beforeStateSha256: hash(beforeLabels), contentSha256: hash(args) } } }
      : await prepareWriteIntent({ method, parameters: intentArgs, projectRoot: localRoot, threadId }, { readBackend: async () => ({ backendId: 'github', repository }), readTracker });
    // The executor's installation ledger already owns correlationKey=operationId.
    // A local utility correlation must not replace that permanent identity.
    const { correlationKey: ignored, ...target } = prepared.intent.target; target.contentSha256 = hash(args); target.repositoryHost = hostname;
    const startedAt = Date.now();
    await getContext();
    async function expectedAssignees(value = []) { const list = names(value); if (list.includes('@me')) return names(list.map(name => name === '@me' ? actor ?? '' : name)); return list; }
    if (JSON.stringify(args.assignees ?? []).includes('@me') || args.children?.some(child => child.assignees?.includes('@me'))) actor ??= await viewer();
    async function creation(spec, anchor, all, parent) {
      const hits = all.filter(row => anchors.idempotencyKeyOf(row.body) === anchor && row.state === 'open'); need(hits.length === 1, 'Creation anchor is missing or ambiguous');
      const row = await readIssue(hits[0].key, true), kind = ['map', 'bug'].includes(spec.kind) ? spec.kind : 'task';
      need(row.state === 'open' && row.title === spec.title.trim() && row.body === anchors.anchorLineFor(anchor) + plan.ensureBody(spec.body, kind).body && same(row.labels, names(plan.ensureLabels(spec.labels, kind).labels)) && same(row.assignees, await expectedAssignees(spec.assignees)) && row.parent === (parent ?? null) && row.blockedBy.length === 0, 'Created issue does not match every requested field'); return row;
    }
    async function verifyComment(value) {
      const after = await comments(key), old = new Set(beforeComments.map(row => row.id));
      need(beforeComments.every(previous => after.some(row => same(row, previous))), 'Existing comments changed during operation');
      const body = method === 'commentIssue' ? args.body : args.comment, fresh = after.filter(row => !old.has(row.id) && row.body === body && row.author === actor && Date.parse(row.createdAt) >= Math.floor(startedAt / 1000) * 1000);
      need(fresh.length === 1, 'Posted comment is missing or not unique');
      const echoed = value?.data; if (echoed?.id !== undefined) need(String(echoed.id) === fresh[0].id, 'Comment identity does not match independent readback'); return fresh[0];
    }
    return { target, dispatchContext: { tracker: { backendId: 'github', repository, hostname } }, async verify(response) {
      try {
        need(response?.id === request.id, 'Write response identity changed'); await getContext();
        const value = rpc ? business(response) : boundEnvelope(response, method); need(value?.ok === true, 'Unsuccessful original GitHub write');
        let evidence, additions = {}, outcome = 'succeeded';
        if (method === 'deck_issue_create') {
          const anchor = value.data?.idempotencyKey; need(anchors.checkIdempotencyKey(anchor).ok && (!args.idempotencyKey || anchor === args.idempotencyKey), 'Creation anchor changed');
          const all = (await pages('issues')).filter(row => !row.pull_request).map(issue), made = await creation(args, anchor, all, args.parentKey ? number(args.parentKey) : null);
          need(number(value.data?.ticket?.key) === made.key, 'Create response identifies another issue');
          if (args.parentKey) { const kids = await children(number(args.parentKey)); need(kids.includes(made.key), 'Native parent membership is missing'); }
          evidence = made; additions.issueNumber = made.key;
        } else if (method === 'deck_issue_patch') {
          const old = before.get(key), after = await readIssue(key, true), expected = { ...fields(old) };
          if (args.title !== undefined) { need(typeof args.title === 'string', 'Invalid title intent'); expected.title = args.title; }
          if (args.body !== undefined) { need(typeof args.body === 'string', 'Invalid body intent'); expected.body = args.body; }
          if (args.progress !== undefined) expected.body = patch.replaceProgressSection(args.body === undefined ? plan.ensureBody(old.body, 'task').body : args.body, args.progress);
          expected.labels = names([...old.labels, ...(args.addLabels ?? [])].filter(name => !names(args.removeLabels ?? []).includes(name.toLowerCase())));
          if (args.assignees !== undefined) expected.assignees = await expectedAssignees(args.assignees);
          if (typeof args.close === 'boolean') expected.state = args.close ? 'closed' : 'open';
          need(same(fields(after), expected) && after.parent === old.parent && same(after.blockedBy, old.blockedBy), 'Patch did not preserve and apply the exact fields');
          evidence = { issue: after, ...(beforeComments ? { comment: await verifyComment(null) } : {}) };
        } else if (method === 'deck_map_link') {
          const after = [];
          for (const job of jobs) { const actual = await readIssue(job.key, true), old = before.get(job.key); need(same(fields(actual), fields(old)) && actual.parent === (job.parent === undefined ? old.parent : job.parent) && same(actual.blockedBy, job.blockedBy ?? old.blockedBy), 'Native relation set differs from the complete intended set'); after.push(actual); }
          for (const [parent, kids] of parentChildren) { const expected = new Set(kids); for (const job of jobs) if (job.parent !== undefined) { if (job.parent === parent) expected.add(job.key); else expected.delete(job.key); } const actual = await children(parent); need(same(actual, [...expected].sort((a, b) => a - b)), 'Native parent children differ'); await snapshot(parent, actual); }
          evidence = after;
        } else if (method === 'deck_map_plan_create') {
          const id = value.data?.planId; need(anchors.checkIdempotencyKey(id).ok && (!args.planId || id === args.planId) && Array.isArray(value.data.restKeys) && value.data.restKeys.length === 0, 'Plan is partial or has another identity');
          const all = (await pages('issues')).filter(row => !row.pull_request).map(issue), mapHits = all.filter(row => row.state === 'open' && anchors.idempotencyKeyOf(row.body) === 'deck-plan-' + id + '-map'); need(mapHits.length === 1, 'Plan map anchor is missing or ambiguous');
          const madeMap = await readIssue(mapHits[0].key, true);
          const mapExpected = beforePlanMap ? fields(beforePlanMap) : { title: args.title.trim(), body: anchors.anchorLineFor('deck-plan-' + id + '-map') + plan.ensureBody(args.body, 'map').body, state: 'open', labels: names(plan.ensureLabels(args.labels, 'map').labels), assignees: [] };
          need(same(fields(madeMap), mapExpected), 'Plan map fields changed');
          need(number(value.data.mapKey) === madeMap.key, 'Plan returned another map');
          const refs = new Map([['@map', madeMap.key], ...[...beforePlanChildren].map(([key, row]) => [key, row.key])]), made = [];
          for (const child of args.children) { const anchor = 'deck-plan-' + id + '-child-' + child.key, hits = all.filter(row => anchors.idempotencyKeyOf(row.body) === anchor && row.state === 'open'); need(hits.length === 1, 'Plan child anchor is missing or ambiguous'); refs.set(child.key, hits[0].key); }
          const parents = new Map([[madeMap.key, beforePlanMap?.parent ?? null], ...[...beforePlanChildren.values()].map(row => [row.key, row.parent]), ...args.children.map(child => [refs.get(child.key), beforePlanChildren.get(child.key)?.parent ?? madeMap.key])]);
          const blockers = new Map([[madeMap.key, beforePlanMap?.blockedBy ?? []], ...[...beforePlanChildren.values()].map(row => [row.key, row.blockedBy])]);
          const replacedBlockers = new Set();
          for (const edge of args.edges ?? []) { const from = refs.get(edge.from), to = refs.get(edge.to); need(from && to, 'Unknown plan edge endpoint'); if (edge.type === 'parent') parents.set(from, to); else { if (!replacedBlockers.has(from)) { blockers.set(from, []); replacedBlockers.add(from); } blockers.set(from, [...new Set([...(blockers.get(from) ?? []), to])].sort((a, b) => a - b)); } }
          need(madeMap.parent === parents.get(madeMap.key) && same(madeMap.blockedBy, blockers.get(madeMap.key)), 'Map native relation set differs');
          const specs = new Map(args.children.map(child => [child.key, child]));
          for (const [short, key] of refs) if (short !== '@map') { const row = await readIssue(key, true), child = specs.get(short), previous = beforePlanChildren.get(short), kind = ['map', 'bug'].includes(child?.kind) ? child.kind : 'task';
            const expected = previous ? fields(previous) : { title: child.title.trim(), body: anchors.anchorLineFor('deck-plan-' + id + '-child-' + short) + plan.ensureBody(child.body, kind).body, state: 'open', labels: names(plan.ensureLabels(child.labels, kind).labels), assignees: await expectedAssignees(child.assignees) };
            need(same(fields(row), expected) && row.parent === parents.get(row.key) && same(row.blockedBy, blockers.get(row.key) ?? []), 'Plan child fields or native relation set differ'); made.push(row); }
          const expectedKids = made.filter(row => row.parent === madeMap.key).map(row => row.key).sort((a, b) => a - b), actualKids = await children(madeMap.key);
          need(same(actualKids, expectedKids) && same(numbers(value.data.builtKeys), numbers(made)) && value.data.counts?.ok === true, 'Plan identities/counts disagree'); await snapshot(madeMap.key, actualKids);
          for (const parent of new Set(made.filter(row => row.parent && row.parent !== madeMap.key).map(row => row.parent))) need(same(await children(parent), made.filter(row => row.parent === parent).map(row => row.key).sort((a, b) => a - b)), 'Nested native child membership differs');
          evidence = { map: madeMap, children: made }; additions.issueNumber = madeMap.key;
          if (made.length < 128) additions.issueNumbers = [madeMap.key, ...made.map(row => row.key)];
        } else if (method === 'commentIssue') evidence = await verifyComment(value);
        else {
          need(value.backendId === 'github' && Array.isArray(value.applied) && Array.isArray(value.failed), 'Label result omitted per-item outcomes');
          const requested = args.changes.map(change => ({ name: change.name.trim().toLowerCase(), color: change.color.toLowerCase() }));
          need(new Set(requested.map(row => row.name)).size === requested.length && same(names([...value.applied, ...value.failed]), names(requested)) && value.applied.length + value.failed.length === requested.length, 'Label result omitted or duplicated a requested item');
          const after = await labelState(), expected = structuredClone(beforeLabels);
          for (const applied of value.applied) { const change = requested.find(row => row.name === applied.name.trim().toLowerCase()); need(change && applied.color.toLowerCase() === change.color, 'Applied label color differs'); const row = expected.find(row => row.name === change.name); need(row, 'An applied label was not present before'); row.color = change.color; }
          need(same(after, expected), 'Label state differs from the complete per-item terminal outcome'); evidence = after; if (value.failed.length) outcome = 'failed';
        }
        await getContext(); const result = { target: { ...target, ...additions }, resultSha256: hash(evidence) };
        return outcome === 'failed' ? { outcome, result: { ...result, errorKind: 'partial' } } : result;
      } catch { return null; }
    } };
  }
  return { prepare };
}
