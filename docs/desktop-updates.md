# Desktop Updates

Windows Personal 0.5.15 introduces in-app updates using electron-updater and the
public `aegisintelmetry/agent-ops-personal` GitHub Releases feed. Older versions
must install 0.5.15 manually once; they do not contain an update client.

The 0.5.21 working tree is a **local build candidate**, not a published update.
Building an installer does not change the public feed or update installed apps.

- Opening Personal starts a check after 15 seconds, then every six hours.
- App updates in the sidebar also supports manual checks and retries.
- Downloads require a click. Restart/install requires native confirmation.
- Active work, sign-in and setup prevent installation. Workspace conversations,
  drafts, source excerpts and images have their own OS-encrypted save/restore
  mechanism. Check that saving succeeded before restarting; the updater itself
  does not save or recover failed writes. Export/copy important content first.
- Closing the app does not automatically install a downloaded update.
- The updater rejects prereleases/downgrades and verifies the download against
  release metadata. This checksum is NOT an independent publisher signature.
- Current Windows builds are unsigned. Do not disable OS security controls.
- No GitHub token or account is required. Update checks contact GitHub; model
  credentials, conversations and profiles are not sent in update requests.
- Development and isolated smoke profiles do not perform scheduled checks.
  Enterprise deployment and fleet bundle updates are separate mechanisms.

An update does not resume interrupted requests or replay queued work after
restart. The Windows uninstaller preserves application data, including saved
conversations and imported history archives. Neither updating nor uninstalling
revokes provider credentials or deletes external Codex/Gemini history.

## Release Procedure

Build with `build-windows.ps1`. Upload the installer, its `.blockmap`, and
`latest.yml` from the SAME build into a draft GitHub release. Verify all files
and hashes before publishing as a non-prerelease. Do not replace an installer
without regenerating its metadata. Never publish an update manifest before its
referenced installer is available. Keep older release assets for delta updates.

Reference: [electron-builder auto updates](https://www.electron.build/v26/docs/features/auto-update/).
