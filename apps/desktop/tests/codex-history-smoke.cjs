const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { _electron } = require('playwright');
const { fixture, now, recentId } = require('./codex-history-fixture.cjs');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-history-smoke-'));
const source = path.join(profile, 'codex-fixture');
fixture(source, profile);
const sourceHashes = () => Object.fromEntries(fs.readdirSync(source).sort().map(name =>
  [name, createHash('sha256').update(fs.readFileSync(path.join(source, name))).digest('hex')]));
const beforeSource = sourceHashes();
let app, server, calls = 0;
(async () => {
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      calls++;
      const payload = JSON.parse(body);
      assert.ok(payload.messages.every(row => !row.content.includes('Private progress note')));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '# Continued fixture' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const env = { ...process.env };
  // These fixtures never inherit a developer's organization identity or credentials.
  for (const key of Object.keys(env)) if (key.startsWith('BTK_') || ['MCP_TOKEN', 'ELECTRON_RUN_AS_NODE', 'PYTHONPATH', 'PYTHONHOME'].includes(key)) delete env[key];
  env.BTK_CONFIG_HOME = path.join(profile, 'empty-core-config');
  app = await _electron.launch({ executablePath: process.env.BTK_DESKTOP_TEST_EXE || path.join(root,'node_modules/electron/dist/electron.exe'), args: [...(process.env.BTK_DESKTOP_TEST_EXE ? [] : [root]), `--user-data-dir=${profile}`], env });
  await app.evaluate(({ app, dialog }, { source, now }) => {
    const originalDialog = dialog.showMessageBox;
    global.historyConfirm = 0; global.historyConfirmations = [];
    dialog.showMessageBox = async (window, options) => {
      if (!['VS Code 세션 가져오기', 'Import VS Code sessions'].includes(options.title)) return originalDialog.call(dialog, window, options);
      global.historyConfirmations.push(options);
      return { response: global.historyConfirm };
    };
    const { CodexHistory } = process.mainModule.require(app.getAppPath()+'/electron/codex-history.cjs');
    const original = CodexHistory.prototype.import;
    global.historyImporterCalls = 0;
    CodexHistory.prototype.import = function(...args) { global.historyImporterCalls++; this.home=source; this.now=()=>now; return original.apply(this,args); };
  }, {source,now});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(()=>Boolean(window.btk));
  await page.evaluate(async endpoint => {
    await window.btk.personal.mode('personal');
    await window.btk.personal.save({provider:'local',endpoint,model:'fixture-model',maxTokens:512});
    await window.btk.preferences.save('ko');
  },`http://127.0.0.1:${server.address().port}/v1`);
  await page.reload();
  const composer=page.getByLabel('개인 메시지',{exact:true});
  await composer.fill('Existing draft stays');
  // Native consent is required before the importer can read even the synthetic DBs.
  await page.getByRole('button',{name:'VS Code 세션 가져오기',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'가져오기를 취소했습니다.'}).waitFor();
  assert.equal(await app.evaluate(() => global.historyImporterCalls),0);
  assert.equal(calls,0);
  assert.deepEqual(sourceHashes(),beforeSource);
  assert.equal(fs.existsSync(path.join(profile,'agent-ops-personal/imported-sessions')),false);
  assert.equal(await composer.inputValue(),'Existing draft stays');
  const confirmation = await app.evaluate(() => global.historyConfirmations.at(-1));
  assert.equal(confirmation.defaultId,0); assert.equal(confirmation.cancelId,0);
  assert.match(confirmation.message,/최근 7일/);
  assert.match(confirmation.detail,/도구 실행 기록/);
  assert.match(confirmation.detail,/모델 요청은 보내지 않습니다/);
  await app.evaluate(() => { global.historyConfirm = 1; });
  await page.getByRole('button',{name:'VS Code 세션 가져오기',exact:true}).click();
  await page.getByRole('status').filter({hasText:'2개 세션 가져옴'}).waitFor();
  assert.equal(await composer.inputValue(),'Existing draft stays');
  assert.equal(calls,0);
  assert.equal(await app.evaluate(() => global.historyImporterCalls),1);
  assert.deepEqual(sourceHashes(),beforeSource);
  let groups=await page.evaluate(()=>window.btk.personal.workspace.read());
  assert.equal(Object.values(groups)[0].items.length,3);
  await page.getByRole('button',{name:'VS Code 세션 가져오기',exact:true}).click();
  await page.getByRole('status').filter({hasText:'0개 세션 가져옴 · 2개 기존 세션'}).waitFor();
  assert.equal(await app.evaluate(() => global.historyImporterCalls),2);
  await page.getByRole('button',{name:'Recent work',exact:true}).click();
  assert.equal(await page.locator('.personal-message').count(),40);
  await page.getByRole('button',{name:'이전 메시지',exact:true}).click();
  assert.equal(await page.locator('.history-pages small').textContent(),'443-482 / 522');
  await page.getByRole('button',{name:'최근 메시지',exact:true}).click();
  await page.getByRole('button',{name:'원본 작업 폴더 적용',exact:true}).click();
  await page.waitForFunction(async expected=>(await window.btk.personal.state()).workspace===expected,profile);
  await page.reload();
  await page.locator('.history-toolbar').waitFor();
  assert.equal(await page.locator('.personal-message').count(),40);
  assert.equal((await page.evaluate(()=>window.btk.personal.state())).model,'fixture-model');
  for (const [language,width] of [['ko',1440],['en',390]]) {
    await page.evaluate(language=>window.btk.preferences.save(language),language); await page.reload();
    await app.evaluate(({BrowserWindow},width)=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(0,0);win.setSize(width,900);},width);
    // Hosted desktops can clamp native bounds. The existing window suite covers native sizes.
    await page.setViewportSize({width,height:900});
    await page.keyboard.press('Escape');
    await page.locator('.history-toolbar').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const toolbar=await page.locator('.history-toolbar').boundingBox(), transcript=await page.locator('.personal-transcript').boundingBox();
    assert.ok(transcript.y>=toolbar.y+toolbar.height-1);
    fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
    await page.screenshot({path:path.join(root,'artifacts',`codex-history-${language}-${width}.png`)});
  }
  await page.getByLabel('Personal message',{exact:true}).fill('Continue imported work');
  await page.getByRole('button',{name:'Send personal message',exact:true}).click();
  await page.getByText('Continued fixture',{exact:true}).waitFor();
  assert.equal(calls,1);
  await page.waitForTimeout(500);
  groups=await page.evaluate(()=>window.btk.personal.workspace.read());
  const imported=Object.values(groups)[0].items.find(item=>item.importedFrom?.threadId===recentId);
  assert.equal(imported.messages.length,524); assert.equal(imported.title,'Recent work');
  for (let i=0;i<12;i++) {
    await page.reload();
    await page.waitForFunction(()=>Boolean(window.btk));
    await page.evaluate(()=>window.btk.personal.workspace.read());
  }
  await page.locator('.history-toolbar').waitFor();
  const restarted=await page.evaluate(()=>window.btk.personal.workspace.read());
  assert.equal(Object.values(restarted)[0].items.find(item=>item.importedFrom?.threadId===recentId).messages.length,524);
  assert.equal(Object.values(restarted)[0].items.find(item=>!item.importedFrom).draft,'Existing draft stays');
  assert.deepEqual(sourceHashes(),beforeSource);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.btk.personal.mode('enterprise'));
  const denied=await page.evaluate(async()=>{try{await window.btk.personal.history.import('default');return false;}catch{return true;}});
  assert.ok(denied);
  await page.evaluate(()=>window.btk.personal.mode('personal'));
  await page.waitForTimeout(400);
  console.log(JSON.stringify({status:'passed',imported:2,duplicatesSkipped:2,persisted:true,paginated:true,sourceFolderApplied:true,existingDraftPreserved:true,enterpriseDenied:true,nativeConsentCancellation:true,defaultConsentDenied:true,sourceDatabasesUnchanged:true,automaticModelCalls:0,realProviderCalls:0,explicitLocalFixtureCalls:calls,languages:['ko','en'],viewports:[1440,390]}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await app?.close(); server?.closeAllConnections();
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep));
  assert.ok(path.basename(profile).startsWith('aegis-history-smoke-'));
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});
});
