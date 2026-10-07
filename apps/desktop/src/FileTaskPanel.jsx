import React, { useState } from 'react';
import { FileText, Play, Save, Square, X } from 'lucide-react';
import { useI18n } from './Language';
import './file-task.css';

const errors = {
  file_task_path: ['기존 하위 폴더 안의 문서·코드 경로를 입력해 주세요. 숨김·인증 파일과 링크는 사용할 수 없습니다.', 'Choose a document or code path in an existing subfolder. Hidden files, credential files and links are not allowed.'],
  file_task_size: ['파일은 24,000자 이하여야 합니다.', 'Files must contain at most 24,000 characters.'],
  file_task_encoding: ['UTF-8 텍스트 파일만 지원합니다.', 'Only UTF-8 text files are supported.'],
  file_task_request: ['작업 요청을 확인해 주세요.', 'Check the task request.'],
  file_task_busy: ['진행 중인 작업이나 확인 창을 먼저 완료해 주세요.', 'Finish the active task or confirmation first.'],
  file_task_cancelled: ['작업을 취소했습니다.', 'Task cancelled.'],
  file_task_incomplete: ['응답이 불완전하여 수정안을 만들지 않았습니다.', 'Incomplete response. No proposal was created.'],
  file_task_format: ['모델 응답 형식이 올바르지 않습니다. 다시 요청해 주세요.', 'Invalid model response format. Please retry.'],
  file_task_unchanged: ['원본과 변경 내용이 같습니다.', 'The proposed content is unchanged.'],
  file_task_expired: ['수정안이 만료되었거나 에이전트·폴더가 변경되었습니다. 다시 생성해 주세요.', 'The proposal expired or the agent/folder changed. Generate it again.'],
  file_task_conflict: ['원본 파일이 외부에서 변경되었습니다. 덮어쓰지 않았습니다. 다시 생성해 주세요.', 'The source file changed. It was not overwritten. Generate a new proposal.'],
  file_task_verify: ['저장 후 파일 확인에 실패했습니다. 파일을 직접 확인해 주세요.', 'Post-save verification failed. Inspect the file.'],
  file_task_failed: ['파일 작업을 완료하지 못했습니다. 폴더·권한·모델 연결을 확인해 주세요.', 'File task failed. Check the folder, permissions and model connection.'],
};
export default function FileTaskPanel({ state, busy, run }) {
  const { language, errorText } = useI18n();
  const tr = (ko, en) => language === 'en' ? en : ko;
  const [path, setPath] = useState('');
  const [objective, setObjective] = useState('');
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  async function act(action) {
    setError('');
    await run(async () => {
      try { await action(); }
      catch (e) { const code = e.message.match(/file_task_[a-z_]+/)?.[0]; setError(code && errors[code] ? errors[code][language === 'en' ? 1 : 0] : errorText(e.message)); }
    });
  }
  const reset = () => { setProposal(null); setStatus(''); };
  return <section className="file-task-panel">
    <header><FileText size={20} /><h1>{tr('파일 작업', 'File task')}</h1><span>{state.workspace || tr('작업 폴더 미선택', 'No workspace folder')}</span></header>
    <form onSubmit={event => { event.preventDefault(); act(async () => {
      reset(); setStatus('running');
      try { setProposal(await window.btk.personal.fileTask.generate(state.agentId, path, objective)); setStatus('review'); }
      finally { setStatus(value => value === 'running' ? '' : value); }
    }); }}>
      <label>{tr('파일 경로', 'File path')}<input aria-label={tr('파일 경로', 'File path')} required maxLength={240} disabled={busy} value={path} placeholder="notes.md" onChange={event => { setPath(event.target.value); reset(); }} /></label>
      <label>{tr('작업 요청', 'Task request')}<textarea aria-label={tr('작업 요청', 'Task request')} required maxLength={4000} disabled={busy} value={objective} onChange={event => { setObjective(event.target.value); reset(); }} /></label>
      <div className="file-task-actions"><button className="outline-button" disabled={busy || !state.workspace || !state.model || !objective.trim() || !path.trim()}><Play size={16} />{tr('수정안 생성', 'Generate proposal')}</button>
        {status === 'running' && <button type="button" className="icon-button" title={tr('중단', 'Stop')} aria-label={tr('중단', 'Stop')} onClick={() => window.btk.personal.fileTask.cancel(state.agentId).catch(e => setError(errorText(e.message)))}><Square size={16} /></button>}
        <span role="status">{status === 'running' ? tr('생성 중', 'Generating') : status === 'saved' ? tr('저장 완료 · 실행 안 함', 'Saved · not executed') : proposal ? tr('검토 대기 · 미저장', 'Awaiting review · not saved') : ''}</span>
      </div>
    </form>
    {error && <p role="alert" className="file-task-error">{error}</p>}
    {proposal && <section className="file-task-review" aria-label={tr('변경 비교', 'Review changes')}>
      <div className="file-task-comparison"><div><h2>{tr('원본', 'Original')}</h2><pre tabIndex={0}>{proposal.before || tr('(빈 파일 또는 새 파일)', '(Empty or new file)')}</pre></div><div><h2>{tr('수정안', 'Proposed')}</h2><pre tabIndex={0}>{proposal.after || tr('(빈 파일)', '(Empty file)')}</pre></div></div>
      <div className="file-task-actions"><button className="outline-button" disabled={busy || status === 'saved'} onClick={() => act(async () => { const result = await window.btk.personal.fileTask.apply(state.agentId, proposal.id); if (result.status === 'saved') setStatus('saved'); })}><Save size={16} />{tr('검토 후 저장', 'Review and save')}</button>
        <button className="icon-button" disabled={busy} title={tr('수정안 닫기', 'Dismiss proposal')} aria-label={tr('수정안 닫기', 'Dismiss proposal')} onClick={reset}><X size={16} /></button></div>
    </section>}
  </section>;
}
