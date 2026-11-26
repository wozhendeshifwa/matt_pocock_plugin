import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSandboxTaskView } from './view.mjs';
const require = createRequire(new URL('../upstream-port/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const React = require('react');
const pause = () => new Promise(r => setTimeout(r, 30));
const waitFor = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for rendered UI');
    await pause();
  }
};

test('reconnect clears a recovered connection warning without starting another task', async () => {
  const dom = new JSDOM('<main id="root"></main>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const { createRoot } = require('react-dom/client');
  let connected = false;
  const calls = [];
  const service = { async call(method) {
    calls.push(method);
    if (!connected) throw new Error('本机后台未连接');
    return { tasks: [{ id: 'existing', prompt: 'Existing real record', status: 'running' }], models: [], limit: 2 };
  } };
  const root = createRoot(document.getElementById('root'));
  try {
    root.render(React.createElement(createSandboxTaskView(React), { sandboxTasks: service }));
    await waitFor(() => document.querySelector('[role="alert"]'));
    assert.match(document.querySelector('[role="alert"]').textContent, /未连接/);
    connected = true;
    [...document.querySelectorAll('button')].find(b => b.textContent === '重新连接').click();
    await waitFor(() => document.querySelector('.task-row'));
    assert.match(document.querySelector('.task-row').textContent, /Existing real record/);
    assert.equal(Boolean(document.querySelector('[role="alert"]')), false);
    assert.equal(calls.includes('start'), false);
  } finally { root.unmount(); await pause(); dom.window.close(); }
});
test('UI requires editable preview before start and renders logs as text', async () => {
  const dom = new JSDOM('<main id="root"></main>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const { createRoot } = require('react-dom/client');
  const calls = [];
  const task = { id: 'task', prompt: 'fixture', base: 'sha', status: 'completed', checks: { state: 'failed' }, result: { changed: true }, log: '<img src=x onerror="window.BAD=true">', minutes: 60, effort: 'medium', model: 'model' };
  const service = { loadIssue: async () => ({ title: 'Fixture', body: 'Only disposable code' }), async call(method, input) {
    calls.push({ method, input });
    if (method === 'list') return { tasks: [task], models: ['model'], defaultModel: 'model', limit: 2 };
    if (method === 'prepare') return { token: 'preview', ...input, projectName: 'fixture', base: 'sha' };
    if (method === 'start') return task;
    if (method === 'detail') return task;
    return {};
  } };
  const root = createRoot(document.getElementById('root'));
  root.render(React.createElement(createSandboxTaskView(React), { sandboxTasks: service })); await pause();
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
  button('从当前 Issue 载入').click(); await pause();
  assert.ok(document.querySelector('textarea').value.includes('Only disposable code'));
  button('编辑后预览').click(); await pause();
  assert.ok(document.querySelector('[aria-label="启动预览"]'));
  assert.equal(calls.filter(c => c.method === 'start').length, 0);
  button('确认启动').click(); await pause();
  assert.equal(calls.filter(c => c.method === 'start').length, 1);
  await pause();
  button('实时日志').click(); await pause();
  // Select first, then polling fetches full detail in the real component.
  document.querySelector('.task-row').click(); await new Promise(r => setTimeout(r, 2100));
  button('实时日志').click(); await pause();
  assert.ok(document.body.textContent.includes('<img src=x'));
  assert.equal(document.querySelector('img'), null);
  assert.equal(dom.window.BAD, undefined);
  root.unmount(); await pause(); dom.window.close();
});

test('diff pages can be navigated and selecting another task resets the offset', async () => {
  const dom = new JSDOM('<main id="root"></main>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const { createRoot } = require('react-dom/client');
  const tasks = ['first', 'second'].map(id => ({ id, prompt: id, status: 'completed' }));
  const calls = [];
  const service = { async call(method, input) {
    if (method === 'list') return { tasks, models: [], limit: 2 };
    if (method === 'detail') {
      calls.push(input);
      const offset = input.diffOffset ?? 0;
      return { ...tasks.find(task => task.id === input.id), diff: offset ? 'PAGE_TWO' : 'PAGE_ONE',
        diffMessage: input.id === 'first' ? '现场差异收集不完整；原文件和分支保留，请核对本地现场。' : undefined,
        diffPage: { offset, nextOffset: offset ? null : 100, totalBytes: 150 } };
    }
  } };
  const root = createRoot(document.getElementById('root'));
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
  try {
    root.render(React.createElement(createSandboxTaskView(React), { sandboxTasks: service }));
    await waitFor(() => document.querySelector('.task-row'));
    document.querySelector('.task-row').click();
    await new Promise(resolve => setTimeout(resolve, 2100));
    button('代码差异').click();
    await waitFor(() => button('下一页差异'));
    assert.match(document.body.textContent, /PAGE_ONE/);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /现场差异收集不完整/);
    button('下一页差异').click();
    await waitFor(() => document.body.textContent.includes('PAGE_TWO'));
    assert.equal(button('下一页差异').disabled, true);
    button('上一页差异').click();
    await waitFor(() => document.body.textContent.includes('PAGE_ONE'));
    assert.equal(button('上一页差异').disabled, true);
    button('下一页差异').click();
    await waitFor(() => document.body.textContent.includes('PAGE_TWO'));
    document.querySelectorAll('.task-row')[1].click();
    await waitFor(() => calls.some(call => call.id === 'second'));
    assert.equal(calls.find(call => call.id === 'second').diffOffset, 0);
  } finally { root.unmount(); await pause(); dom.window.close(); }
});
