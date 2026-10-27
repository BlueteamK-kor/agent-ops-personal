const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const recentId = '019e4828-0000-7000-9000-000000000001';
const staleId = '019e4828-0000-7000-9000-000000000002';
const cliId = '019e4828-0000-7000-9000-000000000003';
const activeId = '019e4828-0000-7000-9000-000000000004';
const now = Date.parse('2026-10-09T10:00:00Z');

function fixture(home, cwd, count = 520) {
  fs.mkdirSync(home, { recursive: true });
  const state = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  state.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, source TEXT, history_mode TEXT, cwd TEXT, title TEXT, model TEXT, updated_at INTEGER)');
  for (const [id, source, title] of [[recentId, 'vscode', 'Recent work'], [staleId, 'vscode', 'Stale work'], [cliId, 'cli', 'CLI work'], [activeId, 'vscode', 'Active work']]) {
    state.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?)').run(id, source, 'paginated', cwd, title, 'source-model', now/1000);
  }
  state.close();
  const history = new DatabaseSync(path.join(home, 'thread_history_1.sqlite'));
  history.exec('CREATE TABLE thread_turns (thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER)');
  history.exec('CREATE TABLE thread_items (thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,started_at_ms INTEGER,completed_at_ms INTEGER,item_json TEXT,item_type TEXT)');
  function turn(id, timestamp, status = 'completed') { history.prepare('INSERT INTO thread_turns VALUES (?,?,?,?,?,?)').run(id, 'turn1', 0, status, timestamp/1000, status === 'completed' ? timestamp/1000 : null); }
  function item(id, ordinal, value, timestamp = now - 1000) { history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?,?,?,?,?)').run(id, 'turn1', 'item'+ordinal, ordinal, timestamp, null, null, JSON.stringify(value), value.type); }
  turn(recentId, now - 1000);
  for (let i = 0; i < count; i++) item(recentId, i, i % 2 ? { type: 'agentMessage', text: '# Reply ' + i, phase: 'final_answer' } : { type: 'userMessage', content: [{ type: 'text', text: 'Question '+i }] });
  item(recentId, count, { type: 'agentMessage', phase: 'commentary', text: 'Private progress note' });
  item(recentId, count+1, { type: 'reasoning', text: 'Hidden reasoning fixture' });
  item(recentId, count+2, { type: 'commandExecution', command: 'fixture command', aggregatedOutput: 'Raw execution fixture' });
  item(recentId, count+3, { type: 'userMessage', content: [{ type: 'text', text: 'Attachment question' }, { type: 'localImage', path: 'missing-fixture-image.png' }] });
  const old = now - 8*86400000;
  turn(staleId, old); item(staleId, 0, { type: 'agentMessage', text: 'Old' }, old);
  turn(cliId, now - 1000); item(cliId, 0, { type: 'agentMessage', text: 'CLI' });
  turn(activeId, old, 'inProgress');
  item(activeId, 0, { type: 'userMessage', content: [{ type: 'text', text: 'Active request' }] });
  item(activeId, 1, { type: 'agentMessage', phase: 'commentary', text: 'Active progress' });
  history.close();
  return { recentId, staleId, cliId, activeId, now };
}
module.exports = { fixture, recentId, activeId, now };
