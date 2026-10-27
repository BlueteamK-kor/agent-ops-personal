const test = require('node:test');
const assert = require('node:assert/strict');

test('public update failures never instruct a Personal user to log in to an organization', async () => {
  const { updateErrorLabel } = await import('../src/update-error-labels.mjs');
  for (const code of ['connection_required','feed_unavailable','integrity','network','unavailable','unknown']) {
    assert(!/조직|운영자|프로파일|로그인/.test(updateErrorLabel(code)));
  }
});
