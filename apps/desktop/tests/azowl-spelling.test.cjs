const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('window, onboarding, workspace and update copy use AZOWL without changing installation identity', () => {
  for (const file of ['index.html', 'src/PersonalApp.jsx', 'src/main.jsx', 'src/UpdateControl.jsx', 'electron/main.cjs', 'after-pack.cjs', 'installer.nsh']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /AZOWL/);
    assert.doesNotMatch(source, /AZWOL/);
  }
  const builder = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
  assert.equal(builder.appId, 'aegis.agentops.preview');
  assert.equal(builder.productName, 'AEGIS Agent Ops');
  assert.equal(builder.publish.repo, 'agent-ops-personal');
  assert.equal(builder.win.artifactName, 'AEGIS-Agent-Ops-Setup-${version}.${ext}');
});
