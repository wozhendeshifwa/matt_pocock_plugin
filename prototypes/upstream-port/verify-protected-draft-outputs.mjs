import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProtectedDraftOutputs } from './protected-draft-outputs.mjs';

// This is an external host boundary with controlled capabilities, not a native
// Codex integration or evidence that ui/message supports these operations.
function controlledHost() {
  let identity = { projectRoot: 'C:/project-a', threadId: 'chat-a' };
  let draft = '', revision = 0;
  const listeners = new Set();
  const requests = [], confirmations = [];
  const hooks = {};
  const host = {
    requests, confirmations, hooks,
    getIdentity: () => ({ ...identity }),
    readIdentity: async () => ({ ...identity }),
    subscribeIdentity(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    switchTo(next) { identity = next; for (const listener of listeners) listener(identity); },
    setDraft(text) { draft = text; revision++; },
    get draft() { return draft; },
    confirmReplace: async details => { confirmations.push(details); return hooks.confirm ? hooks.confirm(details) : true; },
    adapter: {
      contract: { atomicTargetAndRevision: true, confirmedDraft: true },
      async readDraft(request) {
        await hooks.read?.();
        return hooks.snapshot ?? { known: true, text: draft, revision };
      },
      async writeDraft(request) {
        requests.push(request);
        await hooks.write?.();
        request.signal.throwIfAborted();
        assert.deepEqual(request.expectedIdentity, identity, 'conditional destination must match');
        assert.equal(request.expectedRevision, revision, 'conditional input must match');
        if (hooks.failure) throw new Error(hooks.failure);
        draft = request.text; revision++;
        return hooks.receipt ?? { confirmed: true, target: request.target, text: draft, send: false, editable: true, source: { ...identity }, destination: { ...identity, threadId: request.target === 'new' ? 'new-chat' : identity.threadId } };
      },
    },
  };
  return host;
}

test('a controlled reliable host fills exact visible text without sending and reports its destination', async () => {
  for (const target of ['active', 'new']) {
    const host = controlledHost();
    const actions = createProtectedDraftOutputs(host);
    const text = 'User edited final text\n保留中文与换行';
    const result = await actions.prefill(target, text);
    assert.equal(host.draft, text);
    assert.equal(result.status, 'filled');
    assert.equal(result.target, target);
    assert.equal(host.requests[0].send, false);
    assert.equal(host.confirmations.length, 0, 'an empty host input needs no replacement confirmation');
  }
});

test('existing input needs explicit replacement confirmation; cancellation preserves it', async () => {
  const host = controlledHost();
  host.setDraft('Existing unsent input');
  host.hooks.confirm = () => false;
  const actions = createProtectedDraftOutputs(host);
  await assert.rejects(actions.prefill('active', 'Replacement'), /取消/);
  assert.equal(host.draft, 'Existing unsent input');
  assert.equal(host.requests.length, 0);
  assert.equal(host.confirmations.length, 1);
  host.hooks.confirm = () => true;
  await actions.prefill('active', 'Replacement');
  assert.equal(host.draft, 'Replacement');
});

test('unknown host input or missing revision never becomes an empty editable draft', async () => {
  for (const snapshot of [{ known: false, text: '', revision: 1 }, { known: true, text: '' }, {}]) {
    const host = controlledHost();
    host.hooks.snapshot = snapshot;
    await assert.rejects(createProtectedDraftOutputs(host).prefill('active', 'Keep preview'), /读取|版本/);
    assert.equal(host.requests.length, 0);
  }
});

test('request delivery or a mismatched receipt never reports a filled draft', async () => {
  for (const receipt of [{}, { confirmed: true, target: 'new', text: 'Wrong contents', editable: true, send: false }]) {
    const host = controlledHost();
    host.hooks.receipt = receipt;
    await assert.rejects(createProtectedDraftOutputs(host).prefill('active', 'Keep preview'), /结果|确认/);
    assert.equal(host.requests.length, 1, 'no automatic retry or redirection');
  }
});

test('same-project chat and cross-project changes during read or confirmation stop the old operation', async () => {
  for (const phase of ['read', 'confirm']) for (const projectRoot of ['C:/project-a', 'C:/project-b']) {
    const host = controlledHost();
    if (phase === 'confirm') host.setDraft('Existing input');
    host.hooks[phase] = () => { host.switchTo({ threadId: 'chat-changed', projectRoot }); return true; };
    await assert.rejects(createProtectedDraftOutputs(host).prefill('active', 'Keep preview'), /切换|停止/);
    assert.equal(host.requests.length, 0, 'target changes before commit must not write');
  }
});

test('an in-flight conditional write is cancelled even after a target switches away and back', async () => {
  const host = controlledHost();
  host.setDraft('Original');
  host.hooks.write = () => {
    host.switchTo({ threadId: 'chat-other', projectRoot: 'C:/project-a' });
    host.switchTo({ threadId: 'chat-a', projectRoot: 'C:/project-a' });
  };
  await assert.rejects(createProtectedDraftOutputs(host).prefill('active', 'Keep preview'), /切换|停止/);
  assert.equal(host.draft, 'Original');
  assert.equal(host.requests.length, 1);
});

test('host errors or externally edited input stop without retry or redirect', async () => {
  const failed = controlledHost();
  failed.setDraft('Original');
  failed.hooks.failure = 'Host unavailable';
  await assert.rejects(createProtectedDraftOutputs(failed).prefill('new', 'Keep preview'), /Host unavailable/);
  assert.equal(failed.draft, 'Original');
  assert.equal(failed.requests.length, 1);
  const changed = controlledHost();
  changed.setDraft('Original');
  changed.hooks.confirm = () => { changed.setDraft('New unsent edit'); return true; };
  await assert.rejects(createProtectedDraftOutputs(changed).prefill('active', 'Keep preview'), /conditional input/);
  assert.equal(changed.draft, 'New unsent edit');
});

test('native unavailable and incomplete adapters refuse both exits before any host write', async () => {
  for (const options of [{}, { adapter: { readDraft() { throw Error('should not read'); }, writeDraft() { throw Error('should not write'); } } }]) {
    const actions = createProtectedDraftOutputs(options);
    assert.equal(actions.capabilities.reliableDraft, false);
    assert.equal(actions.capabilities.active, false);
    assert.equal(actions.capabilities.new, false);
    for (const target of ['active', 'new']) await assert.rejects(actions.prefill(target, 'Keep preview'), /读取.*确认.*复制/);
  }
});
