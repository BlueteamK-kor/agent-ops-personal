const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwol-brand-'));
const output = path.join(root, 'artifacts/azwol');

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.BTK_DESKTOP_TEST_EXE;
  if (executable) {
    const resources = NtExecutableResource.from(NtExecutable.from(fs.readFileSync(executable)));
    const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
    assert(groups.length > 0);
    assert(groups.every(group => group.icons.length === 9));
  }
  const app = await _electron.launch({ executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(executable ? [] : [root]), `--user-data-dir=${directory}`], env });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: '개인용 Personal' }).click();
    const mark = page.locator('.brand .azwol-mark');
    await mark.waitFor();
    assert(await mark.evaluate(image => image.complete && image.naturalWidth > 0));
    assert((await page.title()).startsWith('AZWOL'));
    await app.evaluate(({ app }) => {
      const updater = process.mainModule.require(app.getAppPath() + '/node_modules/electron-updater').autoUpdater;
      updater.emit('error', Object.assign(new Error('https://private.invalid/?token=fixture-only-secret'), { code: 'ENOTFOUND' }));
    });
    await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
    await page.getByText('업데이트 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.', { exact: true }).waitFor();
    assert(!(await page.locator('body').innerText()).includes('fixture-only-secret'));
    fs.mkdirSync(output, { recursive: true });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await page.getByRole('dialog').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width + 1);
      await page.screenshot({ path: path.join(output, `updates-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify({ status: 'passed', packaged: Boolean(executable),
      iconFrames: 9, decodedBrand: true, safeDiagnostics: true, widths: [1360,390], realProviderCalls: 0 }, null, 2));
    console.log('azwol-native-smoke passed');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
