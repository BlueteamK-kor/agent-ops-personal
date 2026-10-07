const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileTask, snapshot } = require('../electron/file-task.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-file-task-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, relative: 'notes.md', objective: 'Write a report', agentId: 'default' };
}
const adapter = content => ({ confirm: async () => true, complete: async () => ({ status: 'completed', text: JSON.stringify({ content }) }) });

test('provider-independent proposals require approval, bind snapshots and are one-use', async t => {
  const input = setup(t);
  const task = new FileTask();
  const proposal = await task.generate(input, adapter('# Report'));
  assert.equal(fs.existsSync(path.join(input.root, input.relative)), false);
  assert.equal((await task.apply({ ...input, id: proposal.id }, async () => false)).cancelled, true);
  assert.equal(fs.existsSync(path.join(input.root, input.relative)), false);
  await assert.rejects(task.apply({ ...input, agentId: 'other', id: proposal.id }, async () => true), /file_task_expired/);
  await assert.rejects(task.apply({ ...input, root: os.tmpdir(), id: proposal.id }, async () => true), /file_task_expired/);
  await task.apply({ ...input, id: proposal.id, after: 'unreviewed tampering' }, async () => true);
  assert.equal(fs.readFileSync(path.join(input.root, input.relative), 'utf8'), '# Report');
  await assert.rejects(task.apply({ ...input, id: proposal.id }, async () => true), /file_task_expired/);
  const next = await task.generate(input, adapter('# Report\nUpdated'));
  assert.equal(next.before, '# Report');
  await task.apply({ ...input, id: next.id }, async () => true);
  assert.equal(fs.readFileSync(path.join(input.root, input.relative), 'utf8'), '# Report\nUpdated');
});

test('cancelled transmission, partial/malformed responses, secrets and no-change never produce writes', async t => {
  const input = setup(t), task = new FileTask(); let calls = 0;
  await assert.rejects(task.generate(input, { confirm: async () => false, complete: async () => { calls++; } }), /file_task_cancelled/);
  assert.equal(calls, 0);
  await assert.rejects(task.generate(input, { confirm: async () => { task.cancelled = true; return true; }, complete: async () => { calls++; } }), /file_task_cancelled/);
  assert.equal(calls, 0);
  for (const result of [{ status: 'partial', text: '{}' }, { status: 'completed', text: 'not JSON' }, { status: 'completed', text: '{"content":"safe", "command":"run"}' }]) {
    await assert.rejects(task.generate(input, { confirm: async () => true, complete: async () => result }), /file_task_(incomplete|format)/);
    assert.equal(task.proposal, null);
  }
  fs.writeFileSync(path.join(input.root, input.relative), 'sk-' + 'fixture'.repeat(5));
  await assert.rejects(task.generate(input, adapter('x')), /보안 정책/);
  fs.writeFileSync(path.join(input.root, input.relative), 'same');
  await assert.rejects(task.generate(input, adapter('same')), /file_task_unchanged/);
  assert.equal(fs.readFileSync(path.join(input.root, input.relative), 'utf8'), 'same');
});

test('rejects traversal, hidden/credential paths, reserved names, hardlinks and non-text', t => {
  const input = setup(t);
  for (const relative of ['../outside.md', '/outside.md', 'C:/outside.md', 'a\\b.md', '.env', '.git/config.json', 'node_modules/a.js', 'credentials.json', 'secret.txt', 'CON.txt', 'a./x.md', 'file.exe', 'a.md:stream', 'new/x.md']) {
    assert.throws(() => snapshot(input.root, relative));
  }
  const file = path.join(input.root, 'a.md'); fs.writeFileSync(file, 'a');
  fs.linkSync(file, path.join(input.root, 'linked.md'));
  assert.throws(() => snapshot(input.root, 'linked.md'), /file_task_path/);
  fs.writeFileSync(path.join(input.root, 'bad.txt'), Buffer.from([255, 0]));
  assert.throws(() => snapshot(input.root, 'bad.txt'), /file_task_encoding/);
  fs.writeFileSync(path.join(input.root, 'big.md'), 'a'.repeat(24001));
  assert.throws(() => snapshot(input.root, 'big.md'), /file_task_size/);
});

test('junction directories cannot read or write outside the workspace', t => {
  const input = setup(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-file-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(input.root, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => snapshot(input.root, 'redirect/a.md'), /file_task_path/);
});

test('creation and edit conflicts, expiry and concurrent requests are rejected', async t => {
  const input = setup(t), task = new FileTask();
  let p = await task.generate(input, adapter('generated'));
  fs.writeFileSync(path.join(input.root, input.relative), 'external');
  await assert.rejects(task.apply({ ...input, id: p.id }, async () => true), /file_task_conflict/);
  p = await task.generate(input, adapter('edited'));
  await assert.rejects(task.apply({ ...input, id: p.id }, async () => { fs.writeFileSync(path.join(input.root, input.relative), 'newer'); return true; }), /file_task_conflict/);
  assert.equal(fs.readFileSync(path.join(input.root, input.relative), 'utf8'), 'newer');
  task.proposal.createdAt = 0;
  await assert.rejects(task.apply({ ...input, id: p.id }, async () => true), /file_task_expired/);
  let release;
  const pending = task.generate(input, { confirm: async () => true, complete: () => new Promise(resolve => { release = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(task.generate(input, adapter('second')), /file_task_busy/);
  task.cancelled = true;
  release({ status: 'completed', text: '{"content":"cancelled"}' });
  await assert.rejects(pending, /file_task_cancelled/);
  assert.equal(task.proposal, null);
});
