const fs = require('node:fs/promises');
const path = require('node:path');

async function writeInstallerPathLimit(directory, output) {
  const root = path.resolve(directory);
  const pending = [root];
  let longest = 0;
  while (pending.length) {
    const parent = pending.pop();
    for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
      const file = path.join(parent, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Installer paths cannot contain links');
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) longest = Math.max(longest, path.relative(root, file).length);
      else throw new Error('Unsupported installer file');
    }
  }
  if (longest < 1 || longest > 4096) throw new Error('Invalid installer path inventory');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'installer-path-limit.nsh'), `!define BTK_MAX_RELATIVE_PATH ${longest}\n`, 'utf8');
  return longest;
}
module.exports = { writeInstallerPathLimit };
