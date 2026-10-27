const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DesktopUpdates } = require('../electron/updates.cjs');
const { updateErrorCode } = require('../electron/update-errors.cjs');

test('updater diagnostics use bounded codes, never raw URLs or authentication values', async () => {
  const cases = [
    [{ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }, 'feed_unavailable'],
    [{ code: 'ENOTFOUND' }, 'network'],
    [new Error('Operator authentication required'), 'connection_required'],
    [new Error('Organization credentials are required for updates'), 'connection_required'],
    [new Error('Invalid update signature'), 'integrity'],
    [new Error('https://private.invalid/?token=fixture-secret'), 'unavailable'],
  ];
  for (const [error, expected] of cases) {
    assert.equal(updateErrorCode(error), expected);
    const updater = new EventEmitter();
    updater.checkForUpdates = async () => { throw error; };
    const service = new DesktopUpdates({ updater, version: '0.5.92', enabled: true });
    await service.check();
    assert.equal(service.state().errorCode, expected);
    assert(!JSON.stringify(service.state()).includes('fixture-secret'));
    updater.checkForUpdates = async () => updater.emit('update-not-available');
    await service.check();
    assert.equal(service.state().errorCode, '');
    assert.equal(service.state().status, 'current');
  }
});

test('asynchronous idle refusal prevents the installer and confirmation', async () => {
  const updater = new EventEmitter();
  let confirmed = false, installed = false;
  updater.quitAndInstall = () => { installed = true; };
  const service = new DesktopUpdates({ updater, enabled: true,
    assertIdle: async () => { await Promise.resolve(); throw new Error('active operation'); },
    confirmInstall: async () => { confirmed = true; return true; } });
  updater.emit('update-downloaded');
  await assert.rejects(service.install(), /active operation/);
  assert.equal(confirmed, false);
  assert.equal(installed, false);
  assert.equal(service.locked, false);
});
