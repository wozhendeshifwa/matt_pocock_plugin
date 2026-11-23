import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKnownGithubHost, localGithubHost, githubReadRecipe, githubChildEnvironment } from './github-host.mjs';

test('local default matches gh and ignores unrelated environment fields', () => {
  assert.equal(localGithubHost({}), 'github.com');
  assert.equal(localGithubHost({ GH_HOST: '' }), 'github.com');
  assert.equal(localGithubHost({ GH_HOST: undefined }), 'github.com');
  assert.equal(localGithubHost({ GH_REPO: 'enterprise.example.invalid/owner/repo', HOST: 'elsewhere.invalid' }), 'github.com');
  assert.deepEqual(githubReadRecipe({}), { hostname: 'github.com' });
  assert.equal(Object.isFrozen(githubReadRecipe({})), true);
});

test('public and enterprise hosts are explicit; domains and valid ports keep CLI authority', () => {
  for (const [input, expected] of [
    ['GITHUB.COM', 'github.com'], ['ghe.Example.COM', 'ghe.example.com'], ['ghe.example.com:8443', 'ghe.example.com:8443'],
    ['localhost:443', 'localhost:443'], ['127.0.0.1:65535', '127.0.0.1:65535'], ['ghe.example:1', 'ghe.example:1'],
    ['xn--bcher-kva.example', 'xn--bcher-kva.example'], ['github.com:443', 'github.com:443'],
    ['api.github.com', 'api.github.com'], ['ghe.example.', 'ghe.example.'], ['ghe.example:00443', 'ghe.example:00443'],
  ]) {
    assert.equal(normalizeKnownGithubHost(input), expected);
    assert.equal(localGithubHost({ GH_HOST: input }), expected);
    assert.deepEqual(githubReadRecipe({ GH_HOST: input }), { hostname: expected });
  }
});

test('Windows case variants must agree after hostname normalization', () => {
  assert.equal(localGithubHost({ gh_host: 'GHE.EXAMPLE.COM:8443' }), 'ghe.example.com:8443');
  assert.equal(localGithubHost({ GH_HOST: 'GITHUB.COM', Gh_Host: 'github.com', gh_host: 'github.com' }), 'github.com');
  assert.equal(localGithubHost({ GH_HOST: '', gh_host: 'github.com' }), 'github.com');
  for (const env of [{ GH_HOST: 'github.com', gh_host: 'ghe.example' }, { GH_HOST: '', Gh_Host: 'ghe.example' },
    { GH_HOST: 'ghe.example:443', gh_host: 'ghe.example:00443' }]) {
    assert.throws(() => localGithubHost(env), { code: 'AMBIGUOUS_GITHUB_HOST' });
  }
});

test('URLs, credentials, flags, control characters, malformed labels and invalid ports reject without echo', () => {
  const invalid = [undefined, null, true, 1, {}, [], '', ' ', 'github.com ', ' github.com', 'https://github.com', 'http://ghe.example:80',
    'user@ghe.example', 'user:password@ghe.example', '--hostname', '-ghe.example', 'ghe.example/path', 'ghe.example\\path',
    'ghe.example?query', 'ghe.example#fragment', 'ghe.example\n', 'ghe.example\r', 'ghe.example\t', 'ghe.example\0',
    '.github.com', 'ghe..example', 'ghe-.example', 'ghe.example:', 'ghe.example:0', 'ghe.example:65536', 'ghe.example:abc',
    'ghe.example:+443', 'ghe.example:443:444', '[::1]:443', '企业.example', 'a'.repeat(64) + '.example'];
  for (const value of invalid) {
    assert.throws(() => normalizeKnownGithubHost(value), error => error.code === 'INVALID_GITHUB_HOST' &&
      error.message === 'Use a local GitHub hostname, optionally followed by a valid port');
    if (value !== '' && value !== undefined) assert.throws(() => localGithubHost({ GH_HOST: value }), { code: 'INVALID_GITHUB_HOST' });
  }
  for (const env of [null, [], 'github.com']) assert.throws(() => localGithubHost(env), { code: 'INVALID_GITHUB_HOST' });
});

test('child pinning removes Windows aliases and preserves parent environment and provider/token fields', () => {
  const env = Object.freeze({ GH_HOST: 'old.example', gh_host: 'other.example', Gh_Host: 'third.example',
    GH_TOKEN: 'fixture-only-not-a-credential', MODEL_PROVIDER: 'deepseek', PATH: 'C:\\example path', GIT_SSH_COMMAND: 'user-owned command' });
  const before = structuredClone(env), child = githubChildEnvironment(env, 'GHE.EXAMPLE:8443');
  assert.deepEqual(env, before); assert.equal(child.GH_HOST, 'ghe.example:8443');
  assert.equal(Object.keys(child).filter(key => key.toUpperCase() === 'GH_HOST').length, 1);
  for (const [key, value] of Object.entries(before)) if (key.toUpperCase() !== 'GH_HOST') assert.equal(child[key], value);
  assert.throws(() => githubChildEnvironment(env), { code: 'INVALID_GITHUB_HOST' });
});

test('routing helpers perform no environment mutation or hostname inference from remote-shaped fields', () => {
  const before = { ...process.env };
  assert.equal(localGithubHost({ GH_HOST: 'ghe.example', hostname: 'attacker.invalid', repositoryHost: 'attacker.invalid', _deckLocalDispatch: { host: 'attacker.invalid' } }), 'ghe.example');
  assert.equal(localGithubHost({ hostname: 'attacker.invalid' }), 'github.com');
  githubReadRecipe({ GH_HOST: 'ghe.example' }); githubChildEnvironment({ GH_HOST: 'ghe.example' }, 'github.com');
  assert.deepEqual({ ...process.env }, before);
});
