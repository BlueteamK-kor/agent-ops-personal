const fs = require('node:fs');
const path = require('node:path');
const { PersonalError } = require('./personal.cjs');

// Only native confirmation creates a grant. Grants are volatile and single-use.
const grants = new WeakSet();
async function authorizeExecution(mode, state, confirm) {
  if (mode === undefined || mode === 'chat') return undefined;
  if (mode !== 'full') throw new PersonalError('지원하지 않는 실행 권한입니다.');
  if (state.mode !== 'personal' || state.connection !== 'codex') throw new PersonalError('전체 접근은 ChatGPT / Codex 연결에서만 지원됩니다.');
  if (!state.model) throw new PersonalError('Codex 모델을 선택해 주세요.');
  let cwd;
  try {
    if (!path.isAbsolute(state.workspace)) throw new Error();
    cwd = fs.realpathSync(state.workspace);
    if (!fs.statSync(cwd).isDirectory()) throw new Error();
  } catch { throw new PersonalError('전체 접근을 시작할 작업 폴더를 선택해 주세요.'); }
  if (!await confirm({ cwd, agentName: state.agentName, model: state.model })) throw new PersonalError('전체 접근 실행을 취소했습니다.');
  const grant = Object.freeze({ cwd, model: state.model });
  grants.add(grant);
  return grant;
}

function consumeExecution(grant, model) {
  if (grant === undefined) return undefined;
  if (!grants.delete(grant) || grant.model !== model) throw new PersonalError('전체 접근 승인이 만료되었습니다. 다시 승인해 주세요.');
  return grant;
}

module.exports = { authorizeExecution, consumeExecution };
