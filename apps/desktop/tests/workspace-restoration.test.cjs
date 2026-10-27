const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the actual hook with a controlled lifecycle. This models the window
// between an asynchronous storage read and React committing the hydration update;
// it does not assert browser scheduling or write any real settings.
function fixture() {
  const initial = { default: { selected: 'blank', items: [{ id: 'blank', messages: [] }] } };
  const saved = { default: { selected: 'saved', items: [{ id: 'saved', messages: [{ role: 'user', content: 'fixture message' }] }] } };
  const refs = [], effects = [], layouts = [], handlers = new Map(), timers = new Map();
  const writes = [], hydrations = [], statuses = [];
  let cursor = 0, nextTimer = 0, resolveRead, rejectRead;
  const context = {
    useState: () => [null, value => statuses.push(value)],
    useEffect: callback => effects.push(callback),
    useLayoutEffect: callback => layouts.push(callback),
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    window: {
      btk: { personal: { workspace: {
        read: () => new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }),
        save: groups => { writes.push({ type: 'save', groups }); return Promise.resolve({ saved: true }); },
        flush: groups => { writes.push({ type: 'flush', groups }); return { saved: true }; },
      } } },
      addEventListener: (name, callback) => handlers.set(name, callback),
      removeEventListener: name => handlers.delete(name),
    },
  };
  // Refs retain identity across render passes, including a render that never commits.
  context.useRef = value => {
    const index = cursor++;
    return refs[index] || (refs[index] = { current: value });
  };
  const file = path.join(__dirname, '../src/useWorkspaceStore.js');
  const source = fs.readFileSync(file, 'utf8').replace(/^import[^\n]+\n/, '').replace('export function useWorkspaceStore', 'function useWorkspaceStore');
  vm.runInNewContext(source + '\nthis.hook = useWorkspaceStore;', context, { filename: file });
  const render = (groups, commit = true) => {
    cursor = 0; effects.length = 0; layouts.length = 0;
    context.hook(groups, value => hydrations.push(value.action.groups));
    if (commit) layouts.forEach(callback => callback());
    return [...effects];
  };
  const first = render(initial);
  const cleanups = first.map(callback => callback());
  const close = () => handlers.get('beforeunload')?.({ preventDefault() {}, returnValue: '' });
  const settled = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  return {
    initial, saved, writes, hydrations, statuses, render, close, settled,
    resolve: value => resolveRead(value), reject: () => rejectRead(new Error('fixture storage failure')),
    unmount: () => cleanups.forEach(callback => callback?.()),
    runTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

test('close before a restored read resolves never writes the initial empty conversation', async () => {
  const f = fixture();
  f.close();
  assert.equal(f.writes.length, 0);
  f.resolve(f.saved); await f.settled();
  assert.equal(f.hydrations.length, 1);
});

test('close after read resolves but before hydration commits preserves the restored conversation', async () => {
  const f = fixture();
  f.resolve(f.saved); await f.settled();
  assert.equal(f.hydrations[0].default.selected, 'saved');
  f.close(); f.unmount();
  assert.equal(f.writes.length, 0, 'The initial blank render must never replace restored data');
});

test('restoration retains unrelated initial agent groups and does not flush them prematurely', async () => {
  const f = fixture();
  const other = { worker: { selected: 'worker-saved', items: [] } };
  f.resolve(other); await f.settled();
  assert.equal(f.hydrations[0].default.selected, 'blank');
  assert.equal(f.hydrations[0].worker.selected, 'worker-saved');
  f.close();
  assert.equal(f.writes.length, 0);
});

test('an unreadable store stays nonwritable and is never replaced by blank state', async () => {
  const f = fixture();
  f.reject(); await f.settled();
  assert.ok(f.statuses.includes('restoreError'));
  f.close(); f.unmount(); f.runTimers();
  assert.equal(f.hydrations.length, 0);
  assert.equal(f.writes.length, 0);
});

test('a late read after unmount cannot enable writes or hydrate an abandoned UI', async () => {
  const f = fixture();
  f.unmount(); f.resolve(f.saved); await f.settled();
  assert.equal(f.hydrations.length, 0);
  assert.equal(f.writes.length, 0);
});

test('committed edits after hydration are flushed with their actual contents on close', async () => {
  const f = fixture();
  f.resolve(f.saved); await f.settled();
  f.render(f.hydrations[0]);
  const edited = { default: { ...f.saved.default, items: [{ ...f.saved.default.items[0], draft: 'fixture edited draft' }] } };
  const effects = f.render(edited);
  effects[1]();
  f.close();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].type, 'flush');
  assert.equal(f.writes[0].groups.default.items[0].draft, 'fixture edited draft');
  assert.equal(f.writes[0].groups.default.items[0].messages[0].content, 'fixture message');
});

test('an uncommitted render cannot replace the last committed edit in the unload snapshot', async () => {
  const f = fixture();
  f.resolve(f.saved); await f.settled();
  f.render(f.hydrations[0]);
  const committed = { default: { ...f.saved.default, items: [{ ...f.saved.default.items[0], draft: 'committed fixture' }] } };
  f.render(committed);
  f.render({ default: { ...f.saved.default, items: [{ ...f.saved.default.items[0], draft: 'abandoned fixture' }] } }, false);
  f.close();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].groups.default.items[0].draft, 'committed fixture');
});
