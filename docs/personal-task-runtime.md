# Personal Model-Independent Tasks

## Direction

The console owns tools, user consent, execution state and artifacts. A model
connection produces proposals; replacing the model must not replace these
boundaries. This is not a claim of ChatGPT feature parity or identical quality
across providers. Models must support the requested inputs and response format.

## Included in 0.5.20

The File task view uses the existing selected workspace and agent. Enter a
relative path and request. The main process reads that one file, asks for native
consent to send its content and the request to the selected model, and creates an
in-memory proposal. Existing enabled role/memory context is included through the
same completion path as chat. No directory crawl or unrelated chat is included.

The console displays original and proposed contents as literal text. A separate
native approval is required to save. The model never chooses a write path or
executes a command. Switching from an API adapter to a login adapter preserves
the same proposal/review/save protocol. The console does not scrape websites or
borrow authentication from another product.

- UTF-8 text only, up to 24,000 characters per file; one file per proposal.
- Supported extensions: TXT, MD, CSV, JSON, HTML, CSS, JS/JSX, TS/TSX, Python,
  SQL and YAML. Reading CSV does not provide a calculation engine.
- Parent folders must already exist. The console does not create directories,
  delete files, run generated code, install dependencies or commit to Git.
- Hidden components, reserved paths, credential-like names, dependency/build
  directories, symlinks/junctions and hard-linked files are rejected.
- Existing transmission checks apply. Pattern checks are not comprehensive DLP.
- Partial or malformed model responses are not saveable. A model that cannot
  return the required JSON object fails explicitly; no guessed extraction.
- Proposals are main-process-owned, bound to agent/workspace and expire after
  30 minutes. Renderer-supplied replacement content is never accepted on save.
- The filesystem is authoritative. Hash/existence checks reject ordinary edits
  made after generation and during approval. New files use exclusive creation;
  existing files use a sibling temporary file and rename, followed by hash check.
- This is not an OS sandbox against a hostile concurrent local filesystem actor.
  Reparse-point checks and hash checks do not eliminate every filesystem race.
- A proposal is consumed after save. Approval cancellation does not write.
  Proposals/drafts are transient and lost on leaving the view or restarting.
  There is no persistent task audit, automatic backup, undo or multi-file transaction.

## Next Stages

1. Conversation integration: durable task records, tool-step timeline, proposal
   restoration, artifact references and explicit model/capability display.
2. Multiple files: bounded source selection, line diff, backups/undo and
   transactional save with recovery. No implicit whole-repository upload.
3. Development execution: isolated working directory, approved command/argument
   policies, time/output/resource limits, cancellation and reproducible test logs.
   Do not enable a general shell by merely removing the current provider guards.
4. Documents and data: DOCX/XLSX/PPTX generation, structured tables/calculations,
   large-document indexing, page/source citations and export validation.
5. Images and research: explicit image-edit/OCR adapters, web retrieval with
   source attribution and export. Capabilities remain provider-dependent.
6. Team tools: give workers scoped console capabilities through the same executor,
   then test conflict handling and master/worker artifact handoff. Team mode is
   currently still text-only; this file-task slice does not change it.

## Verification

- `node --test tests/file-task.test.cjs`: consent, immutable proposals, one-use
  saves, path restrictions, junctions/hard links, format limits, conflicts,
  expiry, cancellation and concurrent-request rejection.
- `npm run test:file-task`: native Electron UI, actual temporary-file writes,
  loopback API fixture and login-adapter fixture, edition/agent guards,
  transmission/save refusal, HTML inertness, Korean/English and 390/1440 widths.
- Tests use temporary workspaces, never user files. No live provider quota is
  used; model quality and account access have not been verified by these fixtures.

Separately, [Codex Full access](personal-execution-access.md) enables native
Codex tools after per-request approval. It is not a provider-independent sandbox
or a change to the File task review/save protocol.

Operator summary: 단일 파일 읽기·생성·수정·검토·승인 저장을 지원한다. Codex 대화의
전체 접근은 별도 요청별 승인 기능이며, 범용 다중 파일·Office 편집·팀 도구 실행은 남아 있다.
