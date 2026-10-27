# AEGIS Agent Ops Personal 0.5.21 — local candidate

Status: **local build candidate, not published**. The candidate installer name
is `AEGIS-Agent-Ops-Setup-0.5.21.exe`. Building it does not change GitHub Releases
or the in-app update feed.

## Selected Personal changes

- Separate live conversation jobs by agent, session and request. Show queued,
  running and cancelling states while allowing users to switch sessions.
- Run at most two ordinary conversation jobs concurrently. Requests that need
  exclusive access wait for other jobs; duplicate work in one session is refused.
- Cancellation addresses the selected job. Restoring saved conversation history
  never resumes an interrupted model request or replays a previous queue.
- Explicitly import recent VS Code Codex history from supported local databases.
  The source databases are read-only, duplicate imports are skipped, and capacity
  errors preserve existing conversations. Import is not a running-session handoff.
- An imported conversation's original working folder must still exist when it
  is used. If that folder moved or was removed, restore the original folder or
  continue in a new conversation with a chosen workspace. The app does not
  silently substitute another folder or change the original Codex database.
- Correct the English and Korean descriptions of conversation storage, deletion,
  imported archives and uninstall behavior.

These changes use the local Personal coordinator. They do not require an AEGIS
organization account, central MCP server or an operational PC runner. Existing
per-request approval for Codex Full access and the separate approved file-save
workflow still apply.

## Storage and privacy

Personal saves conversations, drafts, attached source excerpts and images in
`agent-ops-personal/workspace.enc` under the app's user-data directory using OS
encryption. Check the visible save status before closing the app. An unreadable
store is preserved; encryption does not make provider requests offline.

The history import selects VS Code threads active within the previous seven
days. It creates encrypted archive snapshots of source execution items and a
workspace backup. Deleting a copied conversation does not delete those archives,
the original Codex database, exported files or provider/CLI records. The Windows
uninstaller retains application data. No automatic retention expiry or secure
erasure is promised.

## Validation and distribution limits

Dependency updates, unit tests, UI fixtures and Windows packaging are part of
the candidate review. Their results must be recorded against the actual final
source and installer; this document does not claim they have passed.

No live provider inference, fresh-PC installation or real installed-version
upgrade is certified by these notes. Fixture tests do not prove provider account
access or model quality. A packaged executable smoke check is not an NSIS upgrade.

The planned Windows build is **unsigned**. A checksum verifies matching bytes,
not publisher identity. Do not disable Windows security controls. Publication,
code signing and update-feed promotion remain separate release actions.

## 한국어

0.5.21은 공개 전 로컬 빌드 후보입니다. 여러 대화의 대기·실행·취소 상태와
최근 VS Code Codex 이력 가져오기를 개인용에 선별 적용합니다. 원본 DB와 기존
대화는 보존하며 중단된 작업을 자동 재개하지 않습니다. 대화와 첨부 자료는
암호화 저장되고, 대화 삭제·앱 제거가 보관본·외부 이력 삭제를 뜻하지 않습니다.

가져온 대화의 원래 작업 폴더가 이동·삭제됐다면 원래 경로를 복구하거나,
작업 폴더를 지정한 새 대화에서 이어가야 합니다. 다른 폴더로 자동 대체하거나
원본 Codex DB를 변경하지 않습니다.

검증 결과는 최종 소스와 설치 파일을 기준으로 별도 기록해야 합니다. 실제
공급자 호출이나 새 PC 설치 성공은 아직 주장하지 않으며, 미서명 설치본의
빌드와 공개·업데이트 피드 등록도 구분합니다.
