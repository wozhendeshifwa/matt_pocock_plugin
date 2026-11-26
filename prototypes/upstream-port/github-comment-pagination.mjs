const fields = 'comments(first:50,after:$after){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}}';
const query = `query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){issueOrPullRequest(number:$n){... on Issue{${fields}} ... on PullRequest{${fields}}}}}`;
const fail = (kind, message) => ({ ok: false, error: { kind, message } });

function failure(result) {
  const message = String(result.error?.message || result.error || '评论读取失败').slice(0, 800);
  if (/rate.?limit|限流/i.test(message)) return fail('rateLimit', message);
  if (/cursor/i.test(message)) return fail('parse', '评论游标已失效，请重新加载详情');
  if (/401|403|forbidden|unauthorized|permission|not accessible|resource not accessible/i.test(message)) return fail('auth', message);
  if (/404|not.?found|could not resolve/i.test(message)) return fail('notFound', message);
  return fail(result.kind || 'network', message);
}

export async function readGithubComments({ n, after, cwd, getRepoKey, runGh }) {
  const repo = await getRepoKey(cwd);
  if (!repo) return fail('env', '无法解析 owner/repo');
  if (!Number.isSafeInteger(n) || n <= 0) return fail('parse', '无效评论对象编号');
  const cursor = after == null || after === '' ? null : String(after);
  // Numeric cursors come only from the REST detail fallback. Continue in REST;
  // never reinterpret a GraphQL cursor as an offset or silently restart page 2.
  if (cursor !== null && /^\d+$/.test(cursor)) {
    const offset = Number(cursor);
    if (!Number.isSafeInteger(offset) || offset % 50 !== 0) return fail('parse', '评论偏移无效，请重新加载详情');
    const page = offset / 50 + 1;
    const r = await runGh(['api', `repos/${repo.owner}/${repo.name}/issues/${n}/comments?per_page=50&page=${page}`], cwd);
    if (!r.ok) return failure(r);
    try {
      const rows = JSON.parse(r.text);
      if (!Array.isArray(rows) || rows.length > 50 || rows.some(c => !c || typeof c.body !== 'string' || !c.created_at)) return fail('parse', '评论响应不完整');
      const nodes = rows.map(c => ({ author: { login: c.user?.login || '' }, authorAssociation: c.author_association || '', body: c.body, createdAt: c.created_at, updatedAt: c.updated_at }));
      return { ok: true, nodes, pageInfo: { hasNextPage: rows.length === 50, endCursor: String(offset + rows.length) }, fallback: 'rest' };
    } catch { return fail('parse', '评论响应不是有效 JSON'); }
  }
  const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${repo.owner}`, '-F', `name=${repo.name}`, '-F', `n=${n}`];
  if (cursor !== null) args.push('-f', `after=${cursor}`);
  // Omit the optional variable for the first page. gh -F coerces numeric strings
  // to numbers; opaque GraphQL cursors must always use -f, never -F.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runGh(args, cwd);
    if (!r.ok) {
      const error = failure(r);
      if (error.error.kind === 'network' && attempt === 0) continue;
      return error;
    }
    try {
      const j = JSON.parse(r.text);
      if (j.errors?.length) return failure({ kind: 'graphql', error: j.errors.map(e => e.message || String(e)).join('; ') });
      const object = j.data?.repository?.issueOrPullRequest;
      if (!object) return fail('notFound', '工单或拉取请求不存在，或当前账号不可见');
      const connection = object.comments;
      if (!connection || !Array.isArray(connection.nodes) || connection.nodes.length > 50 || connection.nodes.some(c => !c || typeof c.body !== 'string' || !c.createdAt)) return fail('parse', '评论响应不完整');
      const info = connection.pageInfo;
      if (!info || typeof info.hasNextPage !== 'boolean' || (info.hasNextPage && (connection.nodes.length === 0 || typeof info.endCursor !== 'string' || !info.endCursor || info.endCursor === cursor))) return fail('parse', '评论分页信息无效，请重新加载详情');
      return { ok: true, nodes: connection.nodes, pageInfo: info };
    } catch { return fail('parse', '评论响应不是有效 JSON'); }
  }
}
