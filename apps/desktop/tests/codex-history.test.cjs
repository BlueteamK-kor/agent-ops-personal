const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { CodexHistory, textChunks } = require('../electron/codex-history.cjs');
const { WorkspaceStore, validateGroups } = require('../electron/workspace-store.cjs');
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


const key = crypto.randomBytes(32);
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(text) { const iv = crypto.randomBytes(16), cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(text,'utf8'), cipher.final()]); },
  decryptString(data) { const cipher = crypto.createDecipheriv('aes-256-cbc', key, data.subarray(0,16)); return Buffer.concat([cipher.update(data.subarray(16)),cipher.final()]).toString('utf8'); },
};
function setup(t, count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'aegis-history-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'source'), directory = path.join(root,'personal');
  fixture(home, root, count);
  const store = new WorkspaceStore({ directory, safeStorage }); store.load();
  const groups = { default: { selected: 'existing', items: [{ id: 'existing',title:'Existing',draft:'Preserved draft',messages:[],sources:[],output:'chat' }] } };
  store.save(groups);
  return { root, home, directory, store, groups, importer: new CodexHistory({ directory, safeStorage, home, now: () => now }) };
}

test('imports actual recent VS Code activity, preserving source bytes, drafts and encrypted full execution archive', async t => {
  const value = setup(t);
  const before = ['state_5.sqlite','thread_history_1.sqlite'].map(name => fs.readFileSync(path.join(value.home,name)));
  const workspaceBefore = fs.readFileSync(value.store.file);
  const result = await value.importer.import(value.groups,'default');
  assert.equal(result.report.selected,2); assert.equal(result.report.imported,2);
  assert.equal(result.report.messages,524); assert.equal(result.report.executionItems,526); assert.equal(result.report.attachments,1);
  assert.equal(result.groups.default.selected,'existing');
  assert.equal(result.groups.default.items[0].draft,'Preserved draft');
  assert.deepEqual(fs.readFileSync(value.store.file),workspaceBefore, 'Importer never races renderer workspace writes');
  for (const [i,name] of ['state_5.sqlite','thread_history_1.sqlite'].entries()) assert.deepEqual(fs.readFileSync(path.join(value.home,name)),before[i]);
  const imported = result.groups.default.items.find(item => item.importedFrom?.threadId === recentId);
  assert.equal(imported.messages.length,522);
  assert.ok(imported.messages.every(row => !row.content.includes('Hidden reasoning fixture')));
  const archive = path.join(value.directory,'imported-sessions',imported.importedFrom.archiveId);
  const read = name => JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(archive,name))));
  const index = read('index.enc');
  const rows = Array.from({length:index.pages},(_,i)=>read(`${i}.enc`)).flat();
  assert.equal(rows.length,index.sourceItems);
  assert.equal(crypto.createHash('sha256').update(rows.map(row=>JSON.stringify(row)+'\n').join('')).digest('hex'),index.sha256);
  assert.ok(rows.some(row => row.item_type === 'commandExecution'));
  assert.ok(!fs.readFileSync(path.join(archive,'0.enc')).includes(Buffer.from('Question')));
  assert.ok(fs.readdirSync(path.join(value.directory,'imported-sessions')).some(name=>name.startsWith('workspace-before-')));
  const active = result.groups.default.items.find(item=>item.importedFrom?.threadId===activeId);
  assert.equal(active.messages[0].state,'failed'); assert.equal(active.messages[1].state,'partial');
  assert.match(active.messages[0].error,/완료가 확인되지/);
  value.store.save(result.groups);
  assert.equal(new WorkspaceStore({ directory:value.directory,safeStorage }).load().default.items.length,3);
  const repeat = await value.importer.import(result.groups,'default');
  assert.equal(repeat.report.imported,0); assert.equal(repeat.report.alreadyImported,2);
  assert.deepEqual(repeat.groups,result.groups);
});

test('commentary and incomplete imported requests never enter follow-up model context; imported titles persist', async t => {
  const value=setup(t,4), result=await value.importer.import(value.groups,'default');
  const { conversationInput, sessionReducer }=await import('../src/sessions.mjs');
  const item=result.groups.default.items.find(item=>item.importedFrom?.threadId===recentId);
  const input=conversationInput(item.messages,'Next');
  assert.ok(input.every(row=>!row.content.includes('Private progress')));
  const active=result.groups.default.items.find(item=>item.importedFrom?.threadId===activeId);
  assert.deepEqual(conversationInput(active.messages,'Next'),[{role:'user',content:'Next'}]);
  const recovered=sessionReducer(result.groups.default,{type:'recover',id:active.id,messageId:active.messages[0].id,mode:'edit'});
  assert.equal(recovered.items.find(row=>row.id===active.id).title,'Active work');
  const changed=sessionReducer(result.groups.default,{type:'messages',id:item.id,value:item.messages});
  assert.equal(changed.items.find(row=>row.id===item.id).title,'Recent work');
});

test('long source text splits losslessly at Unicode boundaries and restores over 500 messages only for valid import metadata', async t => {
  const text='x'.repeat(99999)+'\u{1f600}'+'y'.repeat(100001), chunks=textChunks(text);
  assert.equal(chunks.join(''),text); assert.ok(chunks.every(chunk=>chunk.length<=100000));
  assert.equal(chunks[0].length,99999);
  const value=setup(t,502), result=await value.importer.import(value.groups,'default');
  const item=result.groups.default.items[1];
  assert.doesNotThrow(()=>validateGroups(result.groups));
  delete item.importedFrom;
  assert.throws(()=>validateGroups(result.groups),/workspace_storage/);
});

test('corrupt source, unavailable encryption and capacity errors never overwrite existing workspace or create archives', async t => {
  const value=setup(t,4), before=fs.readFileSync(value.store.file);
  value.importer.safe={isEncryptionAvailable:()=>false};
  await assert.rejects(value.importer.import(value.groups,'default'),/원본과 기존 대화/);
  value.importer.safe=safeStorage;
  const full=structuredClone(value.groups);
  full.default.items=Array.from({length:20},(_,i)=>({...full.default.items[0],id:'session'+i})); full.default.selected='session0';
  await assert.rejects(value.importer.import(full,'default'),/세션 공간/);
  const db=new DatabaseSync(path.join(value.home,'thread_history_1.sqlite')); db.exec("UPDATE thread_items SET item_json='invalid' WHERE rollout_ordinal=0"); db.close();
  await assert.rejects(value.importer.import(value.groups,'default'),/원본과 기존 대화/);
  assert.deepEqual(fs.readFileSync(value.store.file),before);
  assert.equal(fs.existsSync(path.join(value.directory,'imported-sessions')),false);
});

test('failed archive encryption cleans only newly created archive directories', async t => {
  const value=setup(t,4);
  let writes=0;
  value.importer.safe={...safeStorage,encryptString(text){if(++writes===3)throw Error('Fixture failure');return safeStorage.encryptString(text);}};
  await assert.rejects(value.importer.import(value.groups,'default'),/원본과 기존 대화/);
  assert.deepEqual(fs.readdirSync(path.join(value.directory,'imported-sessions')),[]);
});
