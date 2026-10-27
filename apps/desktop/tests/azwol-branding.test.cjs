const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Data } = require('resedit');
const root = path.resolve(__dirname, '..');

test('AZWOL icon frames and physical update identities are preserved', () => {
  const icon = Data.IconFile.from(fs.readFileSync(path.join(root, 'branding/azwol.ico')));
  assert.deepEqual(icon.icons.map(frame => frame.width || 256), [16,20,24,32,40,48,64,128,256]);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.json')));
  assert.equal(config.appId, 'aegis.agentops.preview');
  assert.equal(config.productName, 'AEGIS Agent Ops');
  assert.equal(config.win.icon, 'branding/azwol.ico');
  assert.equal(config.nsis.installerIcon, config.win.icon);
  assert(config.files.includes('branding/**'));
  assert.equal(config.publish.repo, 'agent-ops-personal');
  assert.equal(config.publish.owner, 'BlueteamK-kor');
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  assert(main.includes("icon: path.join(__dirname, '../branding/azwol.ico')"));
  assert(!/setFeedURL[\s\S]*data\.mode/.test(main));
});
