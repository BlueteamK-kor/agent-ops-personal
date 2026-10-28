const fs = require('node:fs/promises');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');

module.exports = async function clearUnconfiguredPublisher(context) {
  if (context.electronPlatformName !== 'win32') return;
  await require('./installer-paths.cjs').writeInstallerPathLimit(context.appOutDir, path.join(__dirname, 'stage'));
  const file = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const executable = NtExecutable.from(await fs.readFile(file));
  const resources = NtExecutableResource.from(executable);
  const icon = Data.IconFile.from(await fs.readFile(path.join(__dirname, 'branding/azwol.ico')));
  for (const group of Resource.IconGroupEntry.fromEntries(resources.entries)) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map(frame => frame.data));
  }
  // Electron's vendor is not the publisher of this unsigned product.
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValues(language, { CompanyName: require('./package.json').author?.name || '', ProductName: 'AZOWL Personal', FileDescription: 'AZOWL Personal' });
    }
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  await fs.writeFile(file, Buffer.from(executable.generate()));
};
