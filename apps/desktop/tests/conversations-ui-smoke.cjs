// Standalone Personal regression: isolated app state, loopback model fixtures, and mocked Codex only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-conversations-'));
const requests = [], errors = [];
let app;
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  requests.push({ body: JSON.parse(body), res });
});
async function received(count) {
  for (let i = 0; i < 150 && requests.length < count; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(requests.length, count, 'expected fixture request count');
}
function reply(index, text) {
  const { res } = requests[index];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env };
  // Do not inherit production profile bindings, backend tokens or IDE Node mode.
  for (const key of Object.keys(env)) {
    if (/^(?:BTK_|MCP_|NUXT_PUBLIC_BTK_)/i.test(key) || /^(?:ELECTRON_RUN_AS_NODE|PYTHONHOME|PYTHONPATH)$/i.test(key)) delete env[key];
  }
  const packaged = process.env.BTK_DESKTOP_TEST_EXE;
  app = await _electron.launch({ executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(packaged ? [] : [root]), `--user-data-dir=${temporary}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForFunction(() => Boolean(window.btk));
  const other = await page.evaluate(async endpoint => {
    const p = window.btk.personal;
    await p.mode('personal'); await p.save({ provider: 'local', endpoint, model: 'model-A', maxTokens: 512 });
    const other = await p.agents.create('Agent B');
    await p.save({ provider: 'local', endpoint, model: 'model-B', maxTokens: 512 });
    await p.agents.select('default'); return other.agentId;
  }, `http://127.0.0.1:${server.address().port}/v1`);
  await page.reload();
  const composer = page.getByLabel('개인 메시지', { exact: true });
  await composer.waitFor();
  await composer.fill('Request A');
  await composer.evaluate(element => {
    for (let i = 0; i < 2; i++) element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  });
  await received(1);
  await page.getByRole('combobox', { name: '에이전트', exact: true }).selectOption(other);
  await page.waitForFunction(() => document.querySelector('.personal-agent-bar > span')?.textContent === 'model-B');
  assert.equal(await composer.isEnabled(), true);
  await composer.fill('Korean IME');
  await composer.evaluate(element => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, isComposing: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 229 }));
  });
  assert.equal(await composer.inputValue(), 'Korean IME'); assert.equal(requests.length, 1);
  await composer.fill('Request B'); await composer.press('Shift+Enter');
  assert.equal(await composer.inputValue(), 'Request B\n'); assert.equal(requests.length, 1);
  await composer.press('Enter'); await received(2);
  assert.deepEqual(requests.map(row => row.body.model), ['model-A', 'model-B']);
  await page.waitForFunction(async () => (await window.btk.personal.sessions.state()).length === 2);
  assert.equal(await page.getByRole('button', { name: '모델 연결', exact: true }).isDisabled(), true);
  const gates = await page.evaluate(async () => {
    const p = window.btk.personal; const results = [];
    for (const attempt of [() => p.mode('enterprise'), () => p.connection('codex'), () => p.agents.create('No mutation'), () => p.history.import('default')]) {
      try { await attempt(); results.push(false); } catch { results.push(true); }
    }
    return results;
  });
  assert.deepEqual(gates, [true, true, true, true]);
  await page.locator('.new-chat').click();
  await composer.fill('Queued C'); await composer.press('Enter');
  await page.waitForFunction(async () => (await window.btk.personal.sessions.state()).some(job => job.status === 'queued'));
  assert.equal(requests.length, 2);
  await page.locator('.personal-pending').getByText('대기', { exact: true }).waitFor();
  await page.getByRole('button', { name: '개인 답변 중단', exact: true }).click();
  await page.locator('.personal-message-error').filter({ hasText: '취소' }).waitFor();
  assert.equal(requests.length, 2, 'queued cancellation never calls the provider');
  reply(1, 'Response B only');
  await page.waitForFunction(async () => (await window.btk.personal.sessions.state()).length === 1);
  await page.locator('.session-select').filter({ hasText: 'Request B' }).click();
  await page.getByRole('log').getByText('Response B only', { exact: true }).waitFor();
  assert.equal((await page.getByRole('log').innerText()).includes('Request A'), false);
  await page.getByRole('combobox', { name: '에이전트', exact: true }).selectOption('default');
  await page.locator('.personal-pending').waitFor();
  reply(0, 'Response A only');
  await page.getByRole('log').getByText('Response A only', { exact: true }).waitFor();
  assert.equal((await page.getByRole('log').innerText()).includes('Response B only'), false);
  await page.locator('.new-chat').click(); await composer.fill('Cancel D'); await composer.press('Enter'); await received(3);
  await page.locator('.new-chat').click(); await composer.fill('Keep E'); await composer.press('Enter'); await received(4);
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/conversations-ko-1440.png') });
  await page.locator('.session-select').filter({ hasText: 'Cancel D' }).click();
  await page.getByRole('button', { name: '개인 답변 중단', exact: true }).click();
  await page.locator('.personal-message-error').filter({ hasText: '취소' }).waitFor();
  await page.locator('.session-select').filter({ hasText: 'Keep E' }).click();
  reply(3, 'E survives D cancellation');
  await page.getByRole('log').getByText('E survives D cancellation', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'another session error does not bleed into the selected session');
  // Reload interrupts live work and restores history, never replays provider requests.
  await page.locator('.new-chat').click(); await composer.fill('Interrupted F'); await composer.press('Enter'); await received(5);
  await page.locator('.new-chat').click(); await composer.fill('Interrupted G'); await composer.press('Enter'); await received(6);
  await page.locator('.new-chat').click(); await composer.fill('Interrupted queued H'); await composer.press('Enter');
  await page.waitForFunction(async () => (await window.btk.personal.sessions.state()).length === 3);
  await page.reload();
  await page.locator('.personal-message-error').waitFor();
  await page.waitForFunction(async () => (await window.btk.personal.sessions.state()).length === 0);
  await page.waitForTimeout(400); assert.equal(requests.length, 6);
  await page.getByLabel('언어 / Language').selectOption('en');
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0, 0); window.setSize(390, 900); });
  await page.waitForFunction(() => innerWidth <= 390); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await page.getByLabel('Personal message', { exact: true }).boundingBox();
  assert.ok(bounds && bounds.width > 150 && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.screenshot({ path: path.join(root, 'artifacts/conversations-en-390.png') });
  await page.getByLabel('언어 / Language').selectOption('ko');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForFunction(() => innerWidth > 900);
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  // Native admission owns session identity, not renderer-provided messages alone.
  const invalid = await page.evaluate(async () => {
    const p = window.btk.personal;
    try { await p.sessions.submit({ agentId: 'default', sessionId: 'missing', requestId: 'missing', access: 'chat', output: 'chat', messages: [{ role: 'user', content: 'not owned' }] }); return false; } catch { return true; }
  });
  assert.equal(invalid, true); assert.equal(requests.length, 6);
  const originalFolder = path.join(temporary, 'imported-workspace'), defaultFolder = path.join(temporary, 'default-workspace');
  fs.mkdirSync(originalFolder); fs.mkdirSync(defaultFolder);
  await app.evaluate(({ app, dialog }, folder) => {
    const base = app.getAppPath() + '/electron/';
    const { CodexConnection } = process.mainModule.require(base + 'codex.cjs');
    const { consumeExecution } = process.mainModule.require(base + 'execution-access.cjs');
    const { PersonalError } = process.mainModule.require(base + 'personal.cjs');
    global.sessionFixtureCalls = []; global.sessionFixtureDialogs = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBox = async (_window, options) => {
      global.sessionFixtureDialogs.push(options);
      if (global.holdSessionDialog) return new Promise(resolve => { global.releaseSessionDialog = resolve; });
      return { response: 1 };
    };
    CodexConnection.prototype.models = async () => [{ id: 'fixture-codex', name: 'Fixture' }];
    CodexConnection.prototype.complete = function (messages, model, _effort, grant) {
      const execution = consumeExecution(grant, model);
      return new Promise((resolve, reject) => {
        this.fixtureReject = reject;
        global.sessionFixtureCalls.push({ execution, messages, finish: () => resolve({ status: 'completed', text: 'Fixture isolated Codex' }) });
      });
    };
    CodexConnection.prototype.cancel = function () { this.fixtureReject?.(new PersonalError('요청을 취소했습니다.')); };
  }, defaultFolder);
  const fixtureSaved = await page.evaluate(async ({ originalFolder }) => {
    const p = window.btk.personal;
    await p.connection('codex'); await p.codex.model('fixture-codex'); await p.folder();
    const groups = await p.workspace.read();
    const session = id => ({ id, title: id, messages: [], draft: '' });
    const imported = session('full-imported');
    imported.importedFrom = { source: 'vscode', threadId: '00000000-0000-0000-0000-000000000001', archiveId: '00000000-0000-0000-0000-000000000002', cwd: originalFolder, model: 'old-model', importedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), sourceItems: 0, messages: 0, attachments: 0 };
    groups.default.items.push(imported, session('full-normal'), session('read-after'), session('cancel-prompt'));
    return p.workspace.flush(groups).saved;
  }, { originalFolder });
  assert.equal(fixtureSaved, true);
  // Awaited native jobs are held by this fixture only, with no real CLI invocation.
  const submitNative = (sessionId, access) => page.evaluate(({ sessionId, access }) => {
    const p = window.btk.personal;
    window.sessionFixtureResults ||= {};
    p.sessions.submit({ agentId: 'default', sessionId, requestId: sessionId, access, output: 'chat', messages: [{ role: 'user', content: sessionId }] }).then(result => { window.sessionFixtureResults[sessionId] = result.status; }, error => { window.sessionFixtureResults[sessionId] = error.message; });
  }, { sessionId, access });
  await submitNative('full-imported', 'full');
  await page.waitForFunction(async () => (await window.btk.personal.sessions.state()).some(job => job.status === 'running'));
  await submitNative('full-normal', 'full'); await submitNative('read-after', 'chat');
  await page.waitForFunction(async () => (await window.btk.personal.sessions.state()).filter(job => job.status === 'queued').length === 2);
  assert.equal(await app.evaluate(() => global.sessionFixtureCalls.length), 1);
  assert.equal(await app.evaluate(() => global.sessionFixtureDialogs.length), 1);
  assert.equal(await app.evaluate(() => global.sessionFixtureCalls[0].execution.cwd), fs.realpathSync(originalFolder));
  await app.evaluate(() => global.sessionFixtureCalls[0].finish());
  await page.waitForFunction(() => window.sessionFixtureResults['full-imported'] === 'completed');
  assert.equal(await app.evaluate(() => global.sessionFixtureCalls.length), 2);
  assert.equal(await app.evaluate(() => global.sessionFixtureDialogs.length), 2);
  assert.equal(await app.evaluate(() => global.sessionFixtureCalls[1].execution.cwd), fs.realpathSync(defaultFolder));
  await app.evaluate(() => global.sessionFixtureCalls[1].finish());
  await page.waitForFunction(() => window.sessionFixtureResults['full-normal'] === 'completed');
  assert.equal(await app.evaluate(() => Boolean(global.sessionFixtureCalls[2].execution)), false, 'full access never leaks to the next read-only request');
  await app.evaluate(() => global.sessionFixtureCalls[2].finish());
  await page.waitForFunction(() => window.sessionFixtureResults['read-after'] === 'completed');
  await app.evaluate(() => { global.holdSessionDialog = true; });
  await submitNative('cancel-prompt', 'full');
  await app.evaluate(async () => { for (let n = 0; n < 100 && !global.releaseSessionDialog; n++) await new Promise(resolve => setTimeout(resolve, 10)); });
  await page.evaluate(() => window.btk.personal.sessions.cancel({ agentId: 'default', sessionId: 'cancel-prompt', requestId: 'cancel-prompt' }));
  await app.evaluate(() => global.releaseSessionDialog({ response: 1 }));
  await page.waitForFunction(() => window.sessionFixtureResults['cancel-prompt']?.includes('취소'));
  assert.equal(await app.evaluate(() => global.sessionFixtureCalls.length), 3, 'cancellation while awaiting native approval prevents execution');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', packaged: Boolean(packaged), fixtureRequests: requests.length, stubCodexTurns: 3, realProviderCalls: 0, realHistoryImported: false, privateGatewayRequired: false, checks: ['parallel sessions', 'cross-agent model isolation', 'out-of-order replies', 'FIFO queued cancellation', 'targeted running cancellation', 'navigation during execution', 'native mutation gates', 'native session ownership', 'Enter sends', 'Shift+Enter newline', 'Korean IME preserved', 'reload interrupts without replay', 'Korean desktop and English mobile', 'native full-access serialization', 'per-request approval', 'imported workspace binding', 'no permission inheritance', 'cancel during native consent'] }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
