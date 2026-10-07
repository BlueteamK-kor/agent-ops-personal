const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-markdown-'));
const content = [
  '## Slack integration', '', '1. **Create Slack App**', '   - Add `app_mentions:read`', '   - Add `chat:write`',
  '2. **Create webhook**', '   - Verify the signature.', '',
  '```js', 'const message = "' + 'long-source-'.repeat(50) + '";', 'console.log(message);', '```', '',
  '| Stage | Owner | State | Evidence | Next |', '| --- | --- | --- | --- | --- |', '| Connect | Master | Ready | Report | Review |', '',
  '> Review before sharing.', '', '- [x] Ready', '',
  '[Reference](https://example.invalid/reference)', '![Remote image](https://example.invalid/tracker.png)', '',
  '<script>window.untrustedMarkdown = true</script>', '<img src="https://example.invalid/raw.png" onerror="window.untrustedMarkdown=true">',
].join('\n');
let app;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const exe = process.env.BTK_DESKTOP_TEST_EXE;
  app = await _electron.launch({ executablePath: exe || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(exe ? [] : [root]), `--user-data-dir=${profile}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = [], remote = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (req.url().includes('example.invalid')) remote.push(req.url()); });
  await page.waitForFunction(() => Boolean(window.btk));
  await page.evaluate(async content => {
    const p = window.btk.personal;
    await p.mode('personal');
    await p.save({ provider: 'local', endpoint: 'http://127.0.0.1:11434/v1', model: 'markdown-fixture', maxTokens: 512 });
    await p.workspace.read();
    await p.workspace.save({ default: { selected: 's1', items: [{ id: 's1', title: 'Formatting', draft: '', sources: [], output: 'chat', messages: [
      { id: 'u1', role: 'user', content: '**Keep user text literal**', state: 'completed' },
      { id: 'a1', role: 'assistant', content, state: 'completed', model: 'Fixture' },
      { id: 'a2', role: 'assistant', content: '```js\nconst partial = true;', state: 'partial', model: 'Fixture' },
    ] }] } });
  }, content);
  await page.reload();
  const markdown = page.locator('.personal-message.assistant .message-markdown').first();
  await markdown.locator('h2').waitFor();
  assert.equal(await markdown.locator('ol > li').count(), 2);
  assert.equal(await markdown.locator('ol ul li').count(), 3);
  assert.equal(await markdown.locator('strong').first().innerText(), 'Create Slack App');
  assert.equal(await markdown.locator('table tbody tr').count(), 1);
  assert.equal(await markdown.locator('input[type=checkbox]').isDisabled(), true);
  assert.equal(await markdown.locator('script, img, iframe, a[href]').count(), 0);
  assert.equal(await page.evaluate(() => window.untrustedMarkdown), undefined);
  assert.deepEqual(remote, []);
  assert.equal(await page.locator('.personal-message.user p').innerText(), '**Keep user text literal**');
  assert.equal(await page.locator('.personal-message.assistant').last().locator('pre code').innerText(), 'const partial = true;\n');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.keyboard.press('Escape');
    await markdown.locator('h2').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await markdown.locator('pre').evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto'), true);
    assert.equal(await markdown.locator('strong').first().evaluate(el => getComputedStyle(el).fontSize), '14px');
    assert.equal(await markdown.locator('p').first().evaluate(el => getComputedStyle(el).whiteSpace), 'normal');
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, `artifacts/message-markdown-${width}.png`) });
  }
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.reload();
  await page.locator('.message-markdown h2').waitFor();
  const groups = await page.evaluate(() => window.btk.personal.workspace.read());
  assert.equal(groups.default.items[0].messages[1].content, content);
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  console.log(JSON.stringify({ status: 'passed', checks: ['headings', 'nested lists', 'bold', 'code fences', 'tables', 'partial fence', 'literal user text', 'no HTML or remote resources', 'desktop/mobile', 'unchanged stored content'], realProviderCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await app?.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); });
