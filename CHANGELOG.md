# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.9] - 2026-08-24

### Changed

- VSIX now contains only runtime files — repo tooling and dev configs are excluded.
- Listing metadata (display name, description, keywords) updated for Marketplace.

### Added

- Compatible providers section: documents support for Ollama, LM Studio, vLLM,
  LocalAI, llama.cpp, Text Generation WebUI, Unsloth, OpenRouter, and any
  OpenAI-compatible endpoint. Designed for local inference.

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
