# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.20] - 2026-08-31

### Added

- **Multiple provider endpoints**: the extension was limited to a single endpoint
  per vendor — VS Code only stores one `baseUrl`/API key per vendor. A new
  `byokModels.endpoints` setting (array of `{baseUrl, apiKey, name?}`) plus
  **BYOK Models: Add Endpoint** and **BYOK Models: Remove Endpoint** commands
  let you register any number of OpenAI-compatible endpoints (Ollama, LM Studio,
  vLLM, …). Models from every endpoint are aggregated into the picker, each
  labelled with its endpoint name (or the URL host when unnamed).
- **Named endpoints**: **Add Endpoint** asks for a display name first, then the
  base URL, then the key. The name becomes the model label suffix (e.g. `llama3 · My Ollama`).
- **Native Add-model dialog collects a name**: the `languageModelChatProviders`
  configuration schema includes an optional `name` field, so the native **Add model**
  dialog also accepts a display name alongside base URL and API key.
- **Keyless local endpoints**: the `Authorization` header is only sent when a key
  is actually present, so keyless servers (Ollama, LM Studio) work without a
  dummy key.

### Changed

- **Native "Add model" button always opens Add Endpoint form**: clicking the
  native **Add model** button runs the **BYOK Models: Add Endpoint** name-first
  form directly (no intermediate notification). Works even when endpoints already
  exist — the form runs async and `fireChanged()` refreshes the picker after
  adding.
- **Endpoints persist reliably**: `byokModels.endpoints` is stored at
  **application scope** and written with error handling, so added endpoints
  survive across workspaces instead of being silently dropped. The provider
  **Manage** button opens the Add Endpoint flow.
- **Single source of truth**: model discovery reads endpoints only from
  `byokModels.endpoints`. VS Code's native Add-model UI store
  (`options.configuration` / `chat.lm.secret.*`) is ignored — it's opaque,
  can't be cleared from extension code, and would keep feeding stale values.
- **Default `requestTimeoutMs`**: `120000` → `300000` (5 min) so slow local
  models aren't cut off mid-generation.

### Fixed

- **Abort error message not translated**: the friendly timeout/cancellation hint
  now matches Node/undici's `'This operation was aborted'` message (regex covers
  all variants) instead of leaking the raw error.
- **Legacy secret storage no longer shadows discovery**: the fallback to the old
  single-endpoint secret (`byok-models.baseUrl`) was removed, so a stale junk
  URL from an earlier test can't block the Add Endpoint form or fail discovery.

## [0.2.9] - 2026-08-26

### Added

- **Dynamic context window adaptation**: Model context window is now read from
  `/v1/models` metadata (supports `context_window`, `max_context_length`,
  `max_tokens`, `n_ctx` fields from vLLM, Ollama, LM Studio, etc.). The
  extension automatically:
  - Sets `maxInputTokens`/`maxOutputTokens` per-model based on declared limits
  - Calculates workspace context budget as 25% of context window (capped by
    `maxWorkspaceContextChars` setting)
  - Disables workspace context injection by default for safer local inference
- **Per-model context window display**: Model detail in picker now shows
  discovered context window (e.g., "context: 112,896 tokens")

### Changed

- **Default `injectWorkspaceContext`**: `true` → `false` (opt-in for local models)
- **Default `maxWorkspaceContextChars`**: `2000` → `500` (conservative for small models)

## [0.2.7] - 2026-08-26

### Fixed

- **Tool call arguments passed as string instead of object**: `LanguageModelToolCallPart`
  requires the `args` parameter to be a parsed JavaScript object, but the
  extension was passing the accumulated JSON string. This caused VS Code to
  reject every tool call with "must be object". Now the arguments are parsed into
  an object before being reported.

## [0.2.6] - 2026-08-26

### Added

- **Request timeout**: configurable `requestTimeoutMs` (default 120000ms / 2 min)
- **Context cap**: `maxInputTokens`/`maxOutputTokens` settings with model-declared limits
- **Tool call validation**: stricter parsing of tool call arguments

## [0.2.5] - 2026-08-25

### Added

- **Model discovery cache**: 30s TTL to avoid redundant `/v1/models` fetches
- **Silent call log suppression**: background refresh calls don't produce noisy output
- **Management command**: native UI gear button opens BYOK Models: Set API Key

## [0.2.4] - 2026-08-24

### Changed

- Clean marketplace publish with neutral branding

## [0.2.3] - 2026-08-24

### Fixed

- Surface response errors properly
- Flush SSE buffer on stream completion
- Protect activation against missing config

## [0.2.2] - 2026-08-23

### Fixed

- Command registration for VS Code marketplace

## [0.2.1] - 2026-08-22

### Added

- Initial release: zero-touch dynamic model provider for OpenAI-compatible endpoints
- Live model discovery from `/v1/models`
- Workspace context injection
- Tool calling pass-through
