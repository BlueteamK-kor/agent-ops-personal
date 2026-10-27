const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-access-ui-'));
const folder = path.join(temporary, 'workspace'); fs.mkdirSync(folder);
let app;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const exe = process.env.BTK_DESKTOP_TEST_EXE;
  app = await _electron.launch({ executablePath: exe || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(exe ? [] : [root]), `--user-data-dir=${path.join(temporary, 'profile')}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ app, dialog }, folder) => {
    global.accessConfirm = 0; global.accessDialogs = []; global.accessCalls = [];
    global.accessFolderDialogs = []; global.accessFolderCancel = true;
    dialog.showOpenDialog = async (_window, options) => {
      global.accessFolderDialogs.push(options);
      return { canceled: global.accessFolderCancel, filePaths: global.accessFolderCancel ? [] : [folder] };
    };
    dialog.showMessageBox = async (_window, options) => { global.accessDialogs.push(options); return { response: global.accessConfirm }; };
    const { CodexConnection } = process.mainModule.require(app.getAppPath() + '/electron/codex.cjs');
    const { consumeExecution } = process.mainModule.require(app.getAppPath() + '/electron/execution-access.cjs');
    CodexConnection.prototype.models = async () => [{ id: 'fixture-codex', name: 'Fixture' }];
    CodexConnection.prototype.state = async () => ({ connected: true, pending: false, plan: 'fixture' });
    CodexConnection.prototype.complete = async (_messages, model, _effort, grant) => {
      const execution = consumeExecution(grant, model);
      global.accessLastGrant = grant;
      global.accessCalls.push({ full: Boolean(execution), cwd: execution?.cwd });
      return { status: 'completed', text: 'Fixture complete', checkedAt: new Date().toISOString() };
    };
  }, folder);
  await page.waitForFunction(() => Boolean(window.btk));
  await page.evaluate(async () => {
    const p = window.btk.personal;
    await p.mode('personal'); await p.connection('codex'); await p.codex.model('fixture-codex');
  });
  await page.reload();
  const access = page.getByRole('combobox', { name: '실행 권한', exact: true });
  await access.waitFor(); assert.equal(await access.inputValue(), 'chat');
  const attempt = mode => page.evaluate(async access => {
    const p = window.btk.personal, state = await p.state();
    try { return await p.chat([{ role: 'user', content: 'Fixture request' }], state.agentId, access); }
    catch (error) { return { error: error.message }; }
  }, mode);
  assert.match((await attempt('full')).error, /취소/);
  assert.equal(await app.evaluate(() => global.accessFolderDialogs.length), 1);
  assert.equal(await app.evaluate(() => global.accessDialogs.length), 0);
  assert.equal(await app.evaluate(() => global.accessCalls.length), 0, 'Declining the folder picker never invokes a model');
  await app.evaluate(() => { global.accessFolderCancel = false; });
  assert.match((await attempt('full')).error, /취소/);
  assert.equal(await app.evaluate(() => global.accessFolderDialogs.length), 2);
  assert.equal(await page.evaluate(async () => (await window.btk.personal.state()).workspace), fs.realpathSync(folder));
  assert.deepEqual(await app.evaluate(() => global.accessFolderDialogs.map(options => options.properties)), [['openDirectory'], ['openDirectory']]);
  assert.equal(await app.evaluate(() => global.accessCalls.length), 0, 'Selecting a folder does not grant execution without separate consent');
  await page.reload();
  assert.match((await attempt('full')).error, /취소/);
  assert.equal(await app.evaluate(() => global.accessFolderDialogs.length), 2, 'A persisted valid folder is reused without a second picker');
  assert.equal(await app.evaluate(() => global.accessCalls.length), 0);
  await app.evaluate(() => { global.accessConfirm = 1; });
  await access.selectOption('full');
  await page.getByLabel('개인 메시지', { exact: true }).fill('Fixture request');
  await page.getByRole('button', { name: '개인 메시지 전송', exact: true }).click();
  await page.getByRole('log').getByText('Fixture complete', { exact: true }).waitFor();
  const calls = await app.evaluate(() => global.accessCalls);
  assert.deepEqual(calls, [{ full: true, cwd: fs.realpathSync(folder) }]);
  const usedGrantRejected = await app.evaluate(({ app }) => {
    const { consumeExecution } = process.mainModule.require(app.getAppPath() + '/electron/execution-access.cjs');
    try { consumeExecution(global.accessLastGrant, 'fixture-codex'); return false; } catch { return true; }
  });
  assert.equal(usedGrantRejected, true, 'A native execution grant cannot be reused');
  assert.match((await attempt('admin')).error, /권한/);
  await attempt('chat');
  assert.equal(await app.evaluate(() => global.accessCalls.at(-1).full), false);
  const confirms = await app.evaluate(() => global.accessDialogs.length);
  await attempt('full');
  assert.equal(await app.evaluate(() => global.accessDialogs.length), confirms + 1);
  await page.evaluate(() => window.btk.personal.test());
  assert.equal(await app.evaluate(() => global.accessCalls.at(-1).full), false);
  await page.getByRole('button', { name: '새 대화', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.execution-access select')?.value === 'chat');
  assert.equal(await access.inputValue(), 'chat');
  await access.selectOption('full');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const box = await access.boundingBox(); assert.ok(box && box.width > 100 && box.x >= 0 && box.x + box.width <= width);
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, `artifacts/execution-access-${width}.png`) });
  }
  await page.getByLabel('언어 / Language').selectOption('en');
  assert.equal(await page.getByLabel('Execution access', { exact: true }).inputValue(), 'full');
  await attempt('full');
  const dialogs = await app.evaluate(() => global.accessDialogs);
  assert.equal(dialogs.at(-1).title, 'Approve full access');
  assert.match(dialogs.at(-1).detail, /outside the working folder/);
  assert.equal(dialogs.every(item => item.defaultId === 0 && item.cancelId === 0), true);
  await page.reload();
  assert.equal(await page.getByLabel('Execution access', { exact: true }).inputValue(), 'chat');
  await page.evaluate(() => window.btk.personal.connection('api'));
  assert.match((await attempt('full')).error, /Codex/);
  await page.evaluate(async () => {
    await window.btk.personal.save({ provider: 'local', endpoint: 'http://127.0.0.1:19999/v1', model: 'fixture', maxTokens: 1024 });
  });
  await page.reload();
  assert.equal(await page.getByLabel('Execution access', { exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', checks: ['default denied', 'missing folder picker', 'folder picker cancellation', 'folder selection requires separate consent', 'persisted folder reused', 'native cancel', 'native approval', 'single-use execution grant', 'approval each request', 'no probe inheritance', 'invalid access', 'new conversation reset', 'reload reset', 'unsupported provider', 'English/Korean', 'desktop/mobile'], realProviderCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
});
