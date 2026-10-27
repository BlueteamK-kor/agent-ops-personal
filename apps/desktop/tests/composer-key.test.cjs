const { test } = require('node:test');
const assert = require('node:assert/strict');
test('Enter submits only an enabled send button', async () => {
  const { submitOnEnter } = await import('../src/composer-key.mjs');
  for (const disabled of [false, true]) {
    let sent = 0, prevented = 0; const button = { disabled };
    const form = { querySelector: () => button, requestSubmit: target => { assert.equal(target, button); sent++; } };
    submitOnEnter({ key: 'Enter', currentTarget: { form }, preventDefault: () => prevented++ });
    assert.equal(prevented, 1); assert.equal(sent, disabled ? 0 : 1);
  }
});
test('Shift+Enter, modifiers, Korean IME composition and key code 229 do not submit', async () => {
  const { submitOnEnter } = await import('../src/composer-key.mjs');
  for (const value of [{ key: 'a' }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) {
    submitOnEnter({ key: 'Enter', ...value, currentTarget: { form: { querySelector() { assert.fail('must not inspect form'); } } }, preventDefault() { assert.fail('must preserve composition/newline'); } });
  }
});
test('Enter never triggers a stop button or submits an unowned form', async () => {
  const { submitOnEnter } = await import('../src/composer-key.mjs');
  submitOnEnter({ key: 'Enter', currentTarget: { form: { querySelector: () => null, requestSubmit() { assert.fail(); } } }, preventDefault() {} });
  submitOnEnter({ key: 'Enter', currentTarget: {}, preventDefault() {} });
});
