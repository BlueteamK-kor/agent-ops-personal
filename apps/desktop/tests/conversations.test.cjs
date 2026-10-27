const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Conversations } = require('../electron/conversations.cjs');

function fixture() {
  const queue = new Conversations(), started = [], closed = [], clients = new Map();
  function submit(id, exclusive = false, agentId = 'default') {
    const request = { agentId, sessionId: `session-${id}`, requestId: `request-${id}`, exclusive };
    const result = queue.submit(request, cancelled => {
      started.push(id);
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      clients.set(id, { resolve, reject, cancelled });
      return { run: () => promise, cancel: () => reject(new Error('cancelled')), close: () => closed.push(id) };
    });
    result.catch(() => {});
    return { request, result };
  }
  return { queue, started, closed, clients, submit };
}
test('two isolated conversations run concurrently; third is FIFO queued', async () => {
  const f = fixture(); const a = f.submit('a'), b = f.submit('b'), c = f.submit('c');
  assert.deepEqual(f.started, ['a', 'b']);
  assert.deepEqual(f.queue.state().map(row => row.status), ['running', 'running', 'queued']);
  f.clients.get('b').resolve('B'); assert.equal(await b.result, 'B');
  assert.deepEqual(f.started, ['a', 'b', 'c']);
  f.clients.get('c').resolve('C'); f.clients.get('a').resolve('A');
  assert.deepEqual(await Promise.all([a.result, c.result]), ['A', 'C']);
  assert.equal(f.queue.active, false); assert.equal(f.closed.length, 3);
});
test('exclusive filesystem work waits for reads and blocks subsequent reads', async () => {
  const f = fixture(); const a = f.submit('a'), b = f.submit('b'), full = f.submit('full', true), c = f.submit('c');
  f.clients.get('a').resolve('A'); await a.result;
  assert.deepEqual(f.started, ['a', 'b']);
  f.clients.get('b').resolve('B'); await b.result;
  assert.deepEqual(f.started, ['a', 'b', 'full']);
  f.clients.get('full').resolve('FULL'); await full.result;
  assert.deepEqual(f.started, ['a', 'b', 'full', 'c']);
  f.clients.get('c').resolve('C'); await c.result;
});
test('queued cancellation never opens a client and cannot cancel a different owner', async () => {
  const f = fixture(); const a = f.submit('a'), b = f.submit('b'), c = f.submit('c');
  assert.equal(f.queue.cancel({ ...c.request, agentId: 'other' }).cancelled, false);
  assert.equal(f.queue.cancel({ ...c.request, sessionId: 'other' }).cancelled, false);
  assert.equal(f.queue.cancel(c.request).cancelled, true);
  await assert.rejects(c.result, /취소/);
  assert.deepEqual(f.started, ['a', 'b']);
  f.clients.get('a').resolve('A'); f.clients.get('b').resolve('B');
  await a.result; await b.result;
});
test('running cancellation is isolated and cancellation wins over late completion', async () => {
  const f = fixture(); const a = f.submit('a'), b = f.submit('b');
  f.queue.cancel(a.request); await assert.rejects(a.result, /cancelled/);
  assert.equal(f.clients.get('b').cancelled(), false);
  f.clients.get('b').resolve('B'); assert.equal(await b.result, 'B');
  const request = { agentId: 'default', sessionId: 'prompt', requestId: 'prompt' };
  let finish; const waiting = f.queue.submit(request, () => ({ run: () => new Promise(resolve => { finish = resolve; }), cancel() {} }));
  f.queue.cancel(request); finish('late'); await assert.rejects(waiting, /취소/);
});
test('duplicate sessions/replayed request IDs and malformed identities are rejected', async () => {
  const f = fixture(); const a = f.submit('a');
  assert.throws(() => f.queue.submit({ ...a.request, requestId: 'other' }, () => {}), /이미/);
  assert.throws(() => f.queue.submit({ ...a.request, sessionId: '__proto__' }, () => {}), /확인/);
  f.clients.get('a').resolve('A'); await a.result;
  assert.throws(() => f.queue.submit(a.request, () => {}), /이미/);
});
test('reload cancellation drains no queued work; shutdown rejects new submissions', async () => {
  const f = fixture(); const a = f.submit('a'), b = f.submit('b'), c = f.submit('c');
  f.queue.cancelAll();
  await assert.rejects(a.result); await assert.rejects(b.result); await assert.rejects(c.result);
  assert.deepEqual(f.started, ['a', 'b']); assert.equal(f.queue.active, false);
  const next = f.submit('next'); f.clients.get('next').resolve('NEXT'); await next.result;
  f.queue.cancelAll(true); assert.throws(() => f.submit('later'), /대기/);
});
test('client creation and cleanup errors do not strand ownership or the queue', async () => {
  const queue = new Conversations();
  await assert.rejects(queue.submit({ agentId: 'default', sessionId: 'a', requestId: 'a' }, () => { throw new Error('creation'); }), /creation/);
  assert.equal(await queue.submit({ agentId: 'default', sessionId: 'b', requestId: 'b' }, () => ({ run: async () => 'B', close() { throw new Error('cleanup'); } })), 'B');
  assert.equal(queue.active, false);
});
test('different agents may use identical session IDs without sharing ownership', async () => {
  const queue = new Conversations();
  const a = queue.submit({ agentId: 'a', sessionId: 'same', requestId: 'a' }, () => ({ run: async () => 'A' }));
  const b = queue.submit({ agentId: 'b', sessionId: 'same', requestId: 'b' }, () => ({ run: async () => 'B' }));
  assert.equal(await a, 'A'); assert.equal(await b, 'B');
});
