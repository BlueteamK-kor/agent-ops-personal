import english from '../electron/locales/en.json' with { type: 'json' };

export function requestError(message) {
  const detail = typeof message === 'string' ? message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '';
  const match = detail.match(/^(HTTP (?:[1-5]\d\d): )?(.*)$/s);
  const key = match?.[2];
  return key && Object.hasOwn(english, key) ? (match[1] || '') + key :
    '요청을 처리하지 못했습니다. 연결 설정을 확인한 뒤 다시 시도해 주세요.';
}
