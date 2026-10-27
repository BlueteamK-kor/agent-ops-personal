const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../installer-preflight.ps1');

test('Personal installer refuses integrated releases and active runtimes without terminating them', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azwol-installer-'));
  const resources = path.join(root, 'resources');
  fs.mkdirSync(resources);
  const check = processes => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `function Get-CimInstance { ${processes ? "[pscustomobject]@{Name='btk-agent-runtime.exe'}" : '@()'} }; function Get-ChildItem { @() }; & '${script}' -InstallDirectory '${root}'; exit $LASTEXITCODE`],
    { windowsHide: true, timeout: 30000 }).status;
  assert.equal(check(false), 0);
  fs.writeFileSync(path.join(resources, 'desktop-release.json'), JSON.stringify({ schema: 'btk.desktop.release.v1', harness_runtime: { version: '5.186' } }));
  assert.equal(check(false), 2);
  fs.writeFileSync(path.join(resources, 'desktop-release.json'), JSON.stringify({ schema: 'btk.desktop.release.v1' }));
  assert.equal(check(false), 0);
  assert.equal(check(true), 2);
  const source = fs.readFileSync(script, 'utf8');
  assert(!/Stop-Process|taskkill|Terminate|Remove-Item/.test(source));
});
