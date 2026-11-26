import { registerHooks } from 'node:module';

const target = new URL('../../vendor/mattskills-1.8.0-rc.7/lib/commentThreads.js', import.meta.url).href;
const reader = new URL('./github-comment-pagination.mjs', import.meta.url).href;

// Keep the pinned vendor intact. Replace only the legacy GitHub reader; the
// existing handler still resolves project identity and dispatches other backends.
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== target) return result;
  const source = Buffer.from(result.source).toString('utf8');
  const start = '  async function fetchIssueComments(n, after, cwd) {';
  const end = '  async function handleIssueDetail(args) {';
  if (source.split(start).length !== 2 || source.split(end).length !== 2) {
    throw new Error('Upstream comment pagination boundary changed');
  }
  const begin = source.indexOf(start);
  const finish = source.indexOf(end);
  if (finish <= begin) throw new Error('Upstream comment pagination boundary order changed');
  return { ...result, source: `import { readGithubComments } from ${JSON.stringify(reader)};\n` +
    source.slice(0, begin) + start + '\n    return readGithubComments({ n, after, cwd, getRepoKey, runGh });\n  }\n' + source.slice(finish) };
} });
