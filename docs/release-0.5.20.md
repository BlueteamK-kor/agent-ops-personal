# AEGIS Agent Ops 0.5.20

## What's Changed

- Add **Chat only / Full access** to the Personal chat composer for ChatGPT /
  Codex connections. Full access requires a working folder and a native approval
  for every request; Chat only remains the default.
- Approved full-access requests can read, modify and delete files, execute
  commands and use the network at the current OS user's privilege level,
  including outside the working folder. No automatic administrator elevation.
- Approval is single-use and kept only in the main process. Requests terminate
  their Codex runtime when done, cancelled, failed or timed out. Team workers,
  model connection tests and other providers do not inherit Full access.
- Render assistant replies, team synthesis and worker output as safe Markdown,
  including lists, tables and code blocks. Raw HTML stays disabled; user messages
  remain literal text and remote Markdown images are not loaded.
- Add **File task** for one selected text/code file: review a generated proposal,
  then approve saving in a separate native dialog. Conflict and path checks
  protect ordinary edits. This workflow is separate from Full access.

## Upgrade

In Personal, open **App updates**, check for updates, download **0.5.20**, then
confirm **Restart and install**. Save or export important work first. Versions
before 0.5.15 need the Windows x64 installer from this release.

The installer, blockmap and latest.yml are generated from the same build.
**The Windows installer is unsigned.** Checksums verify integrity, not publisher
identity. Do not disable Windows security controls.

## Local Validation

- 183 Node tests and 113 Python tests passed.
- The packaged Windows application passed the 15-suite desktop regression
  chain, fresh-profile startup without development runtimes, and separate
  full-access, file-task, Markdown and update-control checks.
- The unpacked 0.5.19-to-0.5.20 upgrade test preserved agents, models, encrypted
  test credentials, teams, role prompts, memory, language and conversations.
- Installer size (168,141,152 bytes) and SHA-512 matched latest.yml. Authenticode
  reported NotSigned. SHA-256 digests are attached in SHA256SUMS.txt.
- Source-change secret scanning found no leaks. No live provider inference was
  performed. npm audit reports zero high/critical and 10 moderate findings;
  the remaining dependency-chain risk is described below.
- The first CI run found a timing race in the new-conversation smoke assertion.
  The test now waits for the React permission reset before checking its value;
  the runtime permission boundary and default are unchanged.

## Scope and Limits

- Dependency audit: compatible updates to `http-cache-semantics` 4.3.0 and
  `source-map-js` 1.2.2 remove the two reported high-severity findings. The
  unresolved `sprintf-js` advisory (GHSA-hp3w-g68c-fv3c) still produces moderate
  dependency-chain findings in Mammoth's CLI dependencies and build tooling.
  Loading the application's Mammoth library did not load argparse or sprintf-js;
  this is an observed code path, not a claim that the dependency is patched.

- Full access is currently Codex-only. Gemini and API-based models still use
  their existing text/image and approved single-file proposal paths.
- Full access is not a folder sandbox or comprehensive DLP. Native tool outputs
  and file contents may reach the model provider without automatic sensitive-data
  checks. Stopping cannot undo completed writes, network requests or other effects.
- Full-access requests have a 15-minute deadline. Windows cleanup targets the
  owned runtime process tree, not unrelated services. Deliberately detached
  processes cannot be guaranteed to stop. Managed Codex requirements still apply.
- File task supports one UTF-8 text/code file, at most 24,000 characters. It has
  no persistent proposal history, backup/undo, Office editor or multi-file
  transaction. Filesystem checks are not an OS sandbox against a hostile actor.
- Automated provider responses use fixtures. Live account inference and fresh-PC
  installation still require validation; packaged executable upgrade checks do
  not prove an NSIS installation upgrade.

## 한국어

- 대화창의 **실행 권한 → 전체 접근**을 선택하고 작업 폴더를 지정합니다.
  전송할 때마다 앱 확인창에서 승인해야 하며, 현재 ChatGPT/Codex만 지원합니다.
- 작업 폴더 밖 파일 수정·삭제, 명령 실행과 네트워크 접근도 가능하므로 신뢰하는
  작업에만 허용하세요. 관리자 권한을 자동으로 부여하지 않습니다.
- Markdown 답변 표시와 별도 **파일 작업 → 수정안 생성 → 검토 후 저장**을 추가했습니다.
- **앱 업데이트 → 업데이트 확인 → 다운로드 → 재시작 및 설치**로 업데이트합니다.
  미서명 Windows 설치본이며 자동 검증은 실제 계정 대신 테스트 응답을 사용합니다.
