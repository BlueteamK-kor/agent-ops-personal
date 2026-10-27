const { test } = require('node:test');
const assert = require('node:assert/strict');

test('failed-message diagnostics strip the Electron wrapper and retain only known local messages', async () => {
  const { requestError } = await import('../src/request-error.mjs');
  const reason = '전체 접근을 시작할 작업 폴더를 선택해 주세요.';
  assert.equal(requestError(reason), reason);
  assert.equal(requestError(`Error invoking remote method 'btk:personal:chat': Error: ${reason}`), reason);
  const http = 'HTTP 429: 요청 한도 또는 잔액을 확인해 주세요.';
  assert.equal(requestError(http), http);
  const fallback = '요청을 처리하지 못했습니다. 연결 설정을 확인한 뒤 다시 시도해 주세요.';
  for (const unknown of [undefined, null, {}, '', 'private-upstream-content',
    'HTTP 429: private-upstream-content', reason + '\nprivate-upstream-content',
    'https://example.test/?token=private', 'a'.repeat(10000)]) {
    assert.equal(requestError(unknown), fallback);
  }
});
