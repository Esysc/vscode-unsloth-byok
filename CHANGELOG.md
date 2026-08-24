# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] - 2026-08-24

### Changed

- **Vendor id renamed** from `unsloth` to `unsloth-byok` to guarantee uniqueness on
  the Visual Studio Marketplace / Open VSX. Model identifiers change accordingly
  (`unsloth:<model>` → `unsloth-byok:<model>`); pinned or recently-used model
  references reset once.
- Prepared the extension for marketplace publishing: removed `private` flag, added
  repository URL, icon, keywords and categories.

### Fixed

- Existing provider groups configured through the Add-model UI must use the new
  vendor value; update `"vendor"` in your language models configuration file if
  you set it up manually.

## [0.1.7] - 2026-08-24

### Fixed

- Models configured through VS Code's native **Add model** UI now appear correctly.
  Values entered there (API key, base URL) are stored by VS Code core and forwarded
  to the provider via `options.configuration`; the extension reads them first and
  falls back to secret storage / settings. Previously the extension only looked for
  secrets named `unsloth.apiKey` / `unsloth.baseUrl`, which VS Code never writes,
  so discovery always returned an empty list.
- Chat requests reuse the credentials resolved during model discovery (ride-along
  `baseUrl` / `apiKey` on each returned model), mirroring the pattern used by the
  built-in BYOK providers.
- Diagnostics log the resolved source of both the base URL and the API key
  (`add-model UI (options.configuration)`, `secret:…`, or `setting:…`).

### Added

- Troubleshooting section covering the native Add-model UI flow and stale
  duplicate provider entries.

## [0.1.0] – [0.1.6] - Initial development

### Added

- Zero-touch dynamic language model provider for Copilot Chat (`unsloth` vendor):
  models are discovered live from `<baseUrl>/models` every time the picker builds,
  so server-side model changes reflect automatically.
- SSE streaming from `<baseUrl>/chat/completions` translated into text and
  tool-call progress parts; tool calling passed through for agent mode.
- API key stored in VS Code secret storage via the **Unsloth BYOK: Set API Key**
  command, with an optional plaintext settings fallback.
- Workspace context injection (active file, open tabs, workspace folders, git
  branch/status) into system prompts, plus a **Show Workspace Context** command.
- Silent-mode handling for background resolutions, a 15s discovery timeout, and
  logging of discovered model IDs to the **Unsloth BYOK** output channel.

[0.1.7]: https://github.com/Esysc/vscode-unsloth-byok/releases/tag/v0.1.7
