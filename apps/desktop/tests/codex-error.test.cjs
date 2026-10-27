const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codexError } = require('../electron/codex-error.cjs');
const english = require('../electron/locales/en.json');

test('structured Codex errors provide translated recovery guidance without upstream details', () => {
  const cases = [
    ['unauthorized', /인증/], ['usageLimitExceeded', /사용 한도/],
    ['rateLimitExceeded', /사용 한도/], ['sessionBudgetExceeded', /사용 한도/],
    ['contextWindowExceeded', /입력 한도/], ['sandboxError', /작업 폴더/],
    ['badRequest', /추론 강도/], ['internalServerError', /일시적/],
    ['serverOverloaded', /일시적/], ['flexUnavailable', /일시적/],
    [{ httpConnectionFailed: { httpStatusCode: 401 } }, /인증/],
    [{ httpConnectionFailed: { httpStatusCode: 403 } }, /모델 접근/],
    [{ httpConnectionFailed: { httpStatusCode: 404 } }, /모델 접근/],
    [{ httpConnectionFailed: { httpStatusCode: 429 } }, /사용 한도/],
    [{ httpConnectionFailed: { httpStatusCode: 503 } }, /일시적/],
    [{ httpConnectionFailed: { httpStatusCode: null } }, /연결이 끊겼/],
    [{ responseStreamConnectionFailed: { httpStatusCode: null } }, /연결이 끊겼/],
    [{ responseStreamDisconnected: { httpStatusCode: null } }, /연결이 끊겼/],
    [{ responseTooManyFailedAttempts: { httpStatusCode: null } }, /연결이 끊겼/],
    [{ httpStatusCode: 401 }, /인증/],
  ];
  for (const [codexErrorInfo, expected] of cases) {
    const error = codexError({ codexErrorInfo, message: 'private-upstream-content', additionalDetails: 'private-details' }, 'fallback');
    assert.match(error.message, expected);
    assert.equal(Object.hasOwn(english, error.message), true);
    assert.equal(error.message.includes('private'), false);
  }
});

test('RPC metadata is classified; unknown or malformed errors never expose raw values', () => {
  assert.match(codexError({ data: { codexErrorInfo: 'unauthorized' } }, 'fallback').message, /인증/);
  assert.match(codexError({ code: -32602 }, 'fallback').message, /추론 강도/);
  for (const error of [undefined, null, 'private-raw', { message: 'private-raw' },
    { codexErrorInfo: 'private-raw' }, { codexErrorInfo: { private: 'raw' } },
    { codexErrorInfo: { httpConnectionFailed: null } }]) {
    const result = codexError(error, 'fallback');
    assert.equal(result.message.includes('private'), false);
    assert.ok(result.message === 'fallback' || /연결이 끊겼/.test(result.message));
  }
});
