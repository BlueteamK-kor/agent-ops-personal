const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { authorizeExecution, consumeExecution } = require('../electron/execution-access.cjs');
const state = { mode: 'personal', connection: 'codex', model: 'fixture', agentName: 'Agent', workspace: os.tmpdir() };

test('chat is the default; no approval or grant', async () => {
  const unexpected = () => { throw new Error('unexpected confirmation'); };
  assert.equal(await authorizeExecution(undefined, state, unexpected), undefined);
  assert.equal(await authorizeExecution('chat', state, unexpected), undefined);
  assert.equal(consumeExecution(undefined, 'fixture'), undefined);
});
test('full access requires native approval and is model-bound and single-use', async () => {
  let confirmations = 0;
  const grant = await authorizeExecution('full', state, async info => {
    confirmations++;
    assert.equal(info.cwd, fs.realpathSync(state.workspace));
    assert.equal(info.model, state.model);
    return true;
  });
  assert.equal(confirmations, 1);
  assert.equal(Object.isFrozen(grant), true);
  assert.equal(consumeExecution(grant, 'fixture'), grant);
  assert.throws(() => consumeExecution(grant, 'fixture'), /승인/);
  assert.throws(() => consumeExecution({ cwd: state.workspace, model: 'fixture' }, 'fixture'), /승인/);
  const changedModel = await authorizeExecution('full', state, async () => true);
  assert.throws(() => consumeExecution(changedModel, 'other'), /승인/);
  assert.throws(() => consumeExecution(changedModel, 'fixture'), /승인/);
});
test('unsupported providers, modes, missing folders and cancellation fail closed', async () => {
  const unexpected = () => { throw new Error('unexpected confirmation'); };
  for (const connection of ['api', 'google', 'gemini-cli']) await assert.rejects(authorizeExecution('full', { ...state, connection }, unexpected), /Codex/);
  await assert.rejects(authorizeExecution('full', { ...state, mode: 'enterprise' }, unexpected), /Codex/);
  for (const mode of ['admin', null, true, {}, 'workspace']) await assert.rejects(authorizeExecution(mode, state, unexpected), /권한/);
  for (const workspace of ['', '.', undefined, path.join(os.tmpdir(), 'missing-' + Date.now())]) await assert.rejects(authorizeExecution('full', { ...state, workspace }, unexpected), /폴더/);
  await assert.rejects(authorizeExecution('full', state, async () => false), /취소/);
});
