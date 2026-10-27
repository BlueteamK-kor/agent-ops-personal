export function updateErrorLabel(code) {
  return ({
    connection_required: '업데이트 서버 접근이 거부되었습니다. 공개 배포 채널을 확인해 주세요.',
    feed_unavailable: '업데이트 채널에 설치 파일이 없습니다. 잠시 후 다시 확인해 주세요.',
    integrity: '업데이트 파일 검증에 실패했습니다. 설치하지 않았습니다.',
    network: '업데이트 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.',
    unavailable: '업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    receiver_unavailable: '상주 업데이터의 상태를 확인할 수 없습니다.',
  })[code] || '업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
