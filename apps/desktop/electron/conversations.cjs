const { EventEmitter } = require('node:events');
const { PersonalError } = require('./personal.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

// Live jobs are authoritative here. Renderer indicators are rebuilt from state();
// stored pending messages are interrupted history, never a queue to replay on restart.
class Conversations extends EventEmitter {
  constructor() { super(); this.jobs = new Map(); this.seen = new Set(); this.closing = false; }
  get active() { return this.jobs.size > 0; }
  state() { return [...this.jobs.values()].map(({ agentId, sessionId, requestId, status, exclusive }) => ({ agentId, sessionId, requestId, status, exclusive })); }
  changed() { this.emit('change', this.state()); }
  submit({ agentId, sessionId, requestId, exclusive = false }, create) {
    if (![agentId, sessionId, requestId].every(validId) || typeof exclusive !== 'boolean' || typeof create !== 'function') throw new PersonalError('대화 요청 정보를 확인해 주세요.');
    if (this.closing || this.jobs.size >= 20) throw new PersonalError('대기 중인 대화가 많습니다. 완료 후 다시 시도해 주세요.');
    if (this.seen.has(requestId) || [...this.jobs.values()].some(job => job.agentId === agentId && job.sessionId === sessionId)) throw new PersonalError('이 세션의 요청이 이미 진행 중입니다.');
    this.seen.add(requestId); if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.jobs.set(requestId, { agentId, sessionId, requestId, exclusive, status: 'queued', create, resolve, reject, cancelled: false });
    this.changed(); this.drain();
    return promise;
  }
  drain() {
    if (this.closing) return;
    for (const job of this.jobs.values()) {
      if (job.status !== 'queued') continue;
      const running = [...this.jobs.values()].filter(item => item.status !== 'queued');
      if (running.some(item => item.exclusive) || running.length >= 2 || (job.exclusive && running.length)) break;
      job.status = 'running'; this.changed(); this.execute(job);
      if (job.exclusive) break;
    }
  }
  async execute(job) {
    try {
      job.client = job.create(() => job.cancelled);
      if (job.cancelled) throw new PersonalError('요청을 취소했습니다.');
      const result = await job.client.run();
      if (job.cancelled) throw new PersonalError('요청을 취소했습니다.');
      job.resolve(result);
    } catch (error) { job.reject(error); }
    finally {
      try { job.client?.close(); } catch {}
      this.jobs.delete(job.requestId); this.changed(); this.drain();
    }
  }
  cancel({ agentId, sessionId, requestId } = {}) {
    const job = this.jobs.get(requestId);
    if (!job || job.agentId !== agentId || job.sessionId !== sessionId) return { cancelled: false };
    job.cancelled = true;
    if (job.status === 'queued') {
      this.jobs.delete(requestId); job.reject(new PersonalError('요청을 취소했습니다.'));
      this.changed(); this.drain();
    } else {
      job.status = 'cancelling';
      try { job.client?.cancel(); } catch {}
      this.changed();
    }
    return { cancelled: true };
  }
  cancelAll(closing = false) {
    this.closing = true;
    // Cancel queued jobs first so finishing one cannot start another while shutting down.
    for (const job of [...this.jobs.values()].sort((a,b) => Number(b.status === 'queued') - Number(a.status === 'queued'))) this.cancel(job);
    this.closing = closing;
  }
}
module.exports = { Conversations };
