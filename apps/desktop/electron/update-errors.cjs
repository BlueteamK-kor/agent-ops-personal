// Never send raw updater exceptions, signed URLs or credentials to the renderer.
function updateErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message.slice(0, 4096) : '';
  if (/checksum|signature|Invalid update|Invalid installer/i.test(message) || /SHA|SIGNATURE|CHECKSUM/.test(code)) return 'integrity';
  if (/profile|enroll|registration|registered device|organization credentials.*required|operator.*(required|expired)|unauthorized|HTTP.*40[13]/i.test(message)) return 'connection_required';
  if (['ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'].includes(code) || /404|No published versions|latest\.yml.*not found/i.test(message)) return 'feed_unavailable';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|ERR_(?:INTERNET|NAME|CONNECTION|PROXY|CERT)/.test(code) || /net::ERR_|timed? ?out|network/i.test(message)) return 'network';
  return 'unavailable';
}
module.exports = { updateErrorCode };
