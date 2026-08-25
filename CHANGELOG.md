# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.4] - 2026-08-25

### Changed

- Retagged release: identical to v0.2.3, re-released to trigger a clean publish
  to both the VS Code Marketplace and Open VSX.

## [0.2.3] - 2026-08-25

### Fixed

- **"Sorry, no response was returned"**: workspace context injection introduced in
  `3389fc1` had no error handling around `gatherWorkspaceContext()`. When that
  function threw (e.g. unavailable workspace folders or active editor state), the
  entire `provideLanguageModelChatResponse` crashed before the fetch — silently
  returning no response. Now wrapped in a try-catch that logs and continues.
- **SSE buffer not flushed**: the SSE parser silently dropped the last `data:`
  line if the server omitted a trailing newline, causing empty/truncated responses.
- **Errors now surface in chat UI**: the entire response pipeline is wrapped so
  thrown errors are logged to the BYOK Models output channel and re-thrown with
  context instead of producing the generic "no response" message.

### Improved

- Language-model provider registration (`vscode.lm`) is wrapped defensively so
  a missing or failing `lm` API no longer kills the entire `activate()` function
  (which would also prevent all commands from being registered).

## [0.2.2] - 2026-08-24

### Fixed

- Extension activation now succeeds consistently: fixed an invalid JavaScript class
  identifier in `extension.js` that could prevent command registration at startup.
- `BYOK Models: Clear API Key` now clears both credential locations used by this
  extension (`byok-models.apiKey` and legacy `byokModelsApiKey`).

## [0.2.1] - 2026-08-24

### Added

- Compatible providers section: documents support for Ollama, LM Studio, vLLM,
  LocalAI, llama.cpp, Text Generation WebUI, Unsloth, OpenRouter, and any
  OpenAI-compatible endpoint.
- Designed for local inference — point at any `/v1`-compatible endpoint and models
  are discovered automatically.

### Changed

- VSIX contains only runtime files — repo tooling and dev configs excluded.
- Neutralized listing metadata for Marketplace compliance.

## [0.1.7] - 2026-08-24

### Fixed

- Models configured through VS Code's native **Add model** UI now appear correctly.
  Values entered there (API key, base URL) are stored by VS Code core and forwarded
  to the provider via `options.configuration`; the extension reads them first and
  falls back to secret storage / settings.
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

- Zero-touch dynamic language model provider for VS Code AI Chat:
  models are discovered live from `<baseUrl>/models` every time the picker builds,
  so server-side model changes reflect automatically.
- SSE streaming from `<baseUrl>/chat/completions` translated into text and
  tool-call progress parts; tool calling passed through for agent mode.
- API key stored in VS Code secret storage via the **Set API Key**
  command, with an optional plaintext settings fallback.
- Workspace context injection (active file, open tabs, workspace folders, git
  branch/status) into system prompts, plus a **Show Workspace Context** command.
- Silent-mode handling for background resolutions, a 15s discovery timeout, and
  logging of discovered model IDs to the output channel.
