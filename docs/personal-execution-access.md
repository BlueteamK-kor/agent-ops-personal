# Personal Execution Access

Personal chat defaults to **Chat only**. With a ChatGPT / Codex connection,
the composer also offers **Full access**. Other providers and team workers do
not inherit this capability. This does not change Enterprise fleet policy.

## Consent and scope

- Select a working folder first. It is the initial working directory, not a
  filesystem boundary in Full access mode.
- Each full-access request requires a native confirmation naming the agent,
  model and working directory. Cancel is the default.
- Approval allows local file reads, edits, deletion, command execution and
  network access at the app's current OS user privilege level, including outside
  the working folder. It does not request administrator privileges or bypass UAC.
- Files and tool output can reach the model provider. The existing input
  transmission checks do not inspect every native Codex tool result.
- Approval is a single-use, in-memory main-process grant, not a renderer flag or
  stored preference. New conversations, agents, models, folders and app reloads
  reset the selection. Every subsequent full-access request still needs consent.

## Runtime

The approved request starts a separate-lifetime Codex app-server process using
the agent's existing isolated authentication home. Shell and image inspection
tools are enabled with `danger-full-access` only for that request. Apps, plugins,
hooks, automatic skill installation and native multi-agent delegation remain
disabled. Interactive permission changes are rejected, not auto-approved.
Managed Codex requirements still apply; a server refusal is not overridden.

The process is terminated on completion, failure, cancellation or a 15-minute
deadline. On Windows, shutdown targets the owned runtime PID and child tree.
Stopping cannot undo writes or external effects that already occurred, and
cannot guarantee termination of deliberately detached processes.

Plain chat, model connection probes, file-task proposals and team requests keep
their existing read-only/tool-disabled behavior. Full access is currently a
Codex capability, not a provider-independent tool execution runtime.

## Verification

Run `npm test`, `npm run build`, and `node tests/execution-access-smoke.cjs`
from `apps/desktop`. Unit tests cover grant forgery/replay, provider and edition
boundaries, process configuration, cleanup and return to read-only operation.
The Electron smoke test uses fixtures, not billable model calls, and checks
native consent, UI resets, Korean/English and desktop/mobile layouts.
