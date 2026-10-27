const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const { PersonalError } = require('./personal.cjs');
const { validateGroups } = require('./workspace-store.cjs');

const failure = () => new PersonalError('VS Code 이력을 가져오지 못했습니다. 원본과 기존 대화는 보존됩니다.');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const milliseconds = value => Number.isSafeInteger(value) && value > 0 ? value : 0;

function messageText(item) {
  if (item.type === 'agentMessage') return typeof item.text === 'string' ? item.text : '';
  if (item.type !== 'userMessage' || !Array.isArray(item.content)) return '';
  return item.content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
}

function textChunks(text) {
  const result = [];
  while (text.length) {
    let end = Math.min(100000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(0, end)); text = text.slice(end);
  }
  return result;
}

// Source databases are read-only. Imported archives are immutable, encrypted snapshots;
// the workspace contains their portable conversation projection and new Personal replies.
class CodexHistory {
  constructor({ directory, safeStorage, home = path.join(os.homedir(), '.codex'), now = Date.now }) {
    this.directory = directory; this.safe = safeStorage; this.home = home; this.now = now;
  }
  async import(groups, agentId) {
    let state, history;
    const temporary = [], committed = [];
    let totalBytes = 0, totalItems = 0;
    try {
      if (!this.safe.isEncryptionAvailable() || this.safe.getSelectedStorageBackend?.() === 'basic_text') throw failure();
      const merged = validateGroups(groups);
      if (!merged[agentId]) throw failure();
      for (const name of ['state_5.sqlite', 'thread_history_1.sqlite']) {
        const file = path.join(this.home, name);
        if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw failure();
      }
      state = new DatabaseSync(path.join(this.home, 'state_5.sqlite'), { readOnly: true });
      history = new DatabaseSync(path.join(this.home, 'thread_history_1.sqlite'), { readOnly: true });
      state.exec('BEGIN'); history.exec('BEGIN');
      const capturedAt = this.now(), cutoff = capturedAt - 7 * 86400000;
      const candidates = new Set(history.prepare('SELECT DISTINCT thread_id FROM thread_turns WHERE COALESCE(completed_at,started_at)*1000 BETWEEN ? AND ?').all(cutoff, capturedAt).map(row => row.thread_id));
      for (const row of history.prepare('SELECT DISTINCT thread_id FROM thread_items WHERE COALESCE(completed_at_ms,started_at_ms,created_at_ms) BETWEEN ? AND ?').all(cutoff, capturedAt)) candidates.add(row.thread_id);
      const selected = [];
      for (const id of candidates) {
        const meta = state.prepare('SELECT id,source,history_mode,cwd,title,model FROM threads WHERE id=?').get(id);
        if (meta?.source !== 'vscode') continue;
        if (!uuid(id) || meta.history_mode !== 'paginated') throw failure();
        selected.push(meta);
      }
      const existing = new Set(Object.values(merged).flatMap(group => group.items.map(item => item.importedFrom?.threadId)).filter(Boolean));
      const pending = selected.filter(meta => !existing.has(meta.id));
      if (merged[agentId].items.length + pending.length > 20) throw new PersonalError('세션 공간이 부족합니다. 기존 대화를 삭제하지 않고 가져오기를 중단했습니다.');
      const archives = [];
      let messageCount = 0, itemCount = 0, attachmentCount = 0;
      for (const meta of pending) {
        const turns = history.prepare('SELECT * FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal').all(meta.id);
        const statuses = new Map(turns.map(turn => [turn.turn_id, turn.status]));
        const messages = [], sourceItems = [], digest = createHash('sha256');
        let attachments = 0, lastActivity = 0;
        for (const turn of turns) lastActivity = Math.max(lastActivity, milliseconds(turn.completed_at)*1000, milliseconds(turn.started_at)*1000);
        for (const row of history.prepare('SELECT * FROM thread_items WHERE thread_id=? ORDER BY rollout_ordinal,item_id').iterate(meta.id)) {
          const size = Buffer.byteLength(row.item_json);
          totalBytes += size; totalItems++;
          if (size > 16*1024*1024 || totalBytes > 256*1024*1024 || totalItems > 200000) throw failure();
          sourceItems.push(row); digest.update(JSON.stringify(row) + '\n');
          lastActivity = Math.max(lastActivity, milliseconds(row.completed_at_ms), milliseconds(row.started_at_ms), milliseconds(row.created_at_ms));
          const item = JSON.parse(row.item_json), text = messageText(item);
          if (item.type === 'userMessage') attachments += (item.content || []).filter(part => part.type !== 'text').length;
          if (!text.trim()) continue;
          const role = item.type === 'userMessage' ? 'user' : 'assistant';
          const complete = statuses.get(row.turn_id) === 'completed';
          for (const [index, content] of textChunks(text).entries()) messages.push({
            id: `vscode_${meta.id}_${row.rollout_ordinal}_${index}`, role, content,
            state: complete ? 'completed' : role === 'user' ? 'failed' : 'partial',
            ...(!complete && role === 'user' ? { error: '가져올 때 진행 중이거나 완료가 확인되지 않은 요청입니다.' } : {}),
            ...(item.phase === 'commentary' ? { phase: 'commentary' } : {}),
            ...(role === 'assistant' && meta.model ? { model: meta.model } : {}), output: 'chat',
          });
        }
        if (!messages.length || lastActivity < cutoff) throw failure();
        const importedFrom = { source: 'vscode', threadId: meta.id, archiveId: randomUUID(), cwd: meta.cwd || '', model: meta.model || '',
          importedAt: new Date(capturedAt).toISOString(), lastActivityAt: new Date(lastActivity).toISOString(),
          sourceItems: sourceItems.length, messages: messages.length, attachments };
        const session = { id: `vscode_${meta.id}`, title: (meta.title || 'VS Code').slice(0,80), draft: '', output: 'chat', sources: [], messages, importedFrom };
        archives.push({ importedFrom, turns, sourceItems, digest: digest.digest('hex') });
        merged[agentId].items.push(session);
        messageCount += messages.length; itemCount += sourceItems.length; attachmentCount += attachments;
      }
      // Capacity/shape checks happen before any archive or workspace write.
      const checked = validateGroups(merged);
      history.exec('ROLLBACK'); state.exec('ROLLBACK'); history.close(); state.close(); history = null; state = null;
      if (archives.length) {
        const root = path.join(this.directory, 'imported-sessions');
        for (const file of [this.directory, root]) if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw failure();
        fs.mkdirSync(root, { recursive: true });
        for (const archive of archives) {
          const staging = path.join(root, '.' + archive.importedFrom.archiveId + '.tmp');
          const destination = path.join(root, archive.importedFrom.archiveId);
          fs.mkdirSync(staging); temporary.push(staging);
          let page = [], bytes = 0, number = 0;
          const write = (name, value) => fs.writeFileSync(path.join(staging, name), this.safe.encryptString(JSON.stringify(value)), { flag: 'wx', mode: 0o600 });
          for (const row of archive.sourceItems) {
            const size = Buffer.byteLength(JSON.stringify(row));
            if (page.length && bytes + size > 2*1024*1024) { write(`${number++}.enc`, page); page = []; bytes = 0; await new Promise(resolve => setImmediate(resolve)); }
            page.push(row); bytes += size;
          }
          if (page.length) write(`${number++}.enc`, page);
          write('index.enc', { schema: 1, ...archive.importedFrom, pages: number, sha256: archive.digest, turns: archive.turns });
          fs.renameSync(staging, destination); temporary.splice(temporary.indexOf(staging),1);
          committed.push(destination);
        }
        const workspace = path.join(this.directory, 'workspace.enc');
        if (fs.existsSync(workspace)) fs.copyFileSync(workspace, path.join(root, `workspace-before-${randomUUID()}.enc`), fs.constants.COPYFILE_EXCL);
      }
      return { groups: checked, report: { selected: selected.length, imported: archives.length, alreadyImported: selected.length-pending.length,
        messages: messageCount, executionItems: itemCount, attachments: attachmentCount, cutoff: new Date(cutoff).toISOString(), capturedAt: new Date(capturedAt).toISOString() } };
    } catch (error) {
      for (const destination of committed) fs.rmSync(destination, { recursive: true, force: true });
      throw error instanceof PersonalError ? error : failure();
    }
    finally {
      try { history?.close(); } catch {}
      try { state?.close(); } catch {}
      for (const staging of temporary) fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
module.exports = { CodexHistory, messageText, textChunks };
