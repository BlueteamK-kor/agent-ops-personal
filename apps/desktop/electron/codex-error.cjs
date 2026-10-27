const { PersonalError } = require('./personal.cjs');

// Classify structured diagnostics only; upstream messages and details may contain secrets.
function codexError(error, fallback) {
  const info = error?.codexErrorInfo ?? error?.data?.codexErrorInfo;
  let kind = typeof info === 'string' ? info : '';
  let status;
  if (info && typeof info === 'object') {
    for (const key of ['httpConnectionFailed', 'responseStreamConnectionFailed',
      'responseStreamDisconnected', 'responseTooManyFailedAttempts']) {
      if (Object.hasOwn(info, key)) { kind = key; status = info[key]?.httpStatusCode; break; }
    }
    status ??= info.httpStatusCode;
  }
  let message;
  if (kind === 'unauthorized' || status === 401) message = 'Codex 인증이 만료되었거나 유효하지 않습니다. 모델 연결에서 다시 로그인해 주세요.';
  else if (['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(kind) || status === 429) message = 'Codex 사용 한도에 도달했습니다. 모델 연결에서 사용 한도를 확인해 주세요.';
  else if (kind === 'contextWindowExceeded') message = '대화가 모델의 입력 한도를 초과했습니다. 새 대화에서 다시 시도해 주세요.';
  else if (status === 403 || status === 404) message = 'Codex 모델 접근을 확인하지 못했습니다. 모델 연결에서 사용할 수 있는 모델을 다시 선택해 주세요.';
  else if (kind === 'sandboxError') message = 'Codex 실행 환경을 시작하지 못했습니다. 작업 폴더와 실행 권한을 확인해 주세요.';
  else if (kind === 'badRequest' || error?.code === -32602) message = 'Codex 요청 설정이 올바르지 않습니다. 모델과 추론 강도 설정을 확인해 주세요.';
  else if (['internalServerError', 'serverOverloaded', 'flexUnavailable'].includes(kind) || (Number.isInteger(status) && status >= 500 && status < 600)) message = 'Codex 서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  else if (['httpConnectionFailed', 'responseStreamConnectionFailed', 'responseStreamDisconnected', 'responseTooManyFailedAttempts'].includes(kind)) message = 'Codex 연결이 끊겼습니다. 네트워크를 확인하고 이미 수행된 작업이 있는지 확인해 주세요.';
  return new PersonalError(message || fallback);
}

module.exports = { codexError };
