# BYOK Models — OpenAI-Compatible Provider

Zero-touch dynamic language model provider for VS Code AI Chat, designed for
**local inference** — point it at any OpenAI-compatible endpoint you configure.

Unlike a static BYOK entry in `chatLanguageModels.json`, this extension **discovers models
live from `/v1/models` every time VS Code builds the model picker** — when the server adds,
removes, or renames a model, the picker reflects it automatically. No scripts, no manual
syncing.

**Enhanced with project context:** Your models receive workspace metadata (active files,
git branch, project structure) automatically, enabling more relevant and context-aware
assistance.

## History

Originally, I wrote this extension to connect to my Unsloth instance, but then I realized that the extension is quite generic for OpenAI-compatible endpoints. This extension allows you to connect to any OpenAI-compatible API endpoint, making it versatile for various AI model providers that support the OpenAI API format.

## Compatible providers

Works with **any** OpenAI-compatible endpoint — just point it at a base URL ending in `/v1`
and it will discover models automatically. Designed for local inference, but works with
remote endpoints too. Tested and compatible with:

- **[Ollama](https://ollama.com/)** — `http://localhost:11434/v1`
- **[LM Studio](https://lmstudio.ai/)** — `http://localhost:1234/v1`
- **[vLLM](https://github.com/vllm-project/vllm)** — `http://localhost:8000/v1`
- **[LocalAI](https://localai.io/)** — `http://localhost:8080/v1`
- **[llama.cpp server](https://github.com/ggerganov/llama.cpp)** — `http://localhost:8080/v1`
- **[Text Generation WebUI](https://github.com/oobabooga/text-generation-webui)** — `http://localhost:5000/v1`
- **[Unsloth](https://github.com/unslothai/unsloth)** — any self-hosted or cloud endpoint
- **[OpenRouter](https://openrouter.ai/)** — `https://openrouter.ai/api/v1`
- Any cloud provider with an OpenAI-compatible API (Azure, together.ai, fireworks.ai, etc.)

If it serves `/v1/models` and `/v1/chat/completions`, it works.

## Install

```bash
npx @vscode/vsce package --allow-missing-repository
```

Then in VS Code: Extensions view → `⋯` → **Install from VSIX…** → pick the generated
`byok-models-<version>.vsix`, and reload the window.

## Configure (one time)

1. Set `byokModels.baseUrl` to your OpenAI-compatible endpoint (must end with `/v1`) —
   either in Settings or via the native **Add model** UI.
2. Command Palette → **BYOK Models: Set API Key** (stored in VS Code secret storage).
3. Optionally adjust the token-limit settings if your endpoint differs from the defaults.

## Use
Open AI Chat → model picker → your configured provider section. All models reported by the
endpoint appear there dynamically. Tool calling is passed through (agent mode works) when the
endpoint supports it; disable via `byokModels.enableTools`.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `byokModels.baseUrl` | *(empty)* | OpenAI-compatible base URL, ending with `/v1` (required) |
| `byokModels.apiKey` | *(empty)* | Plaintext fallback (prefer the secret-storage command) |
| `byokModels.maxInputTokens` | `262144` | Reported context window |
| `byokModels.maxOutputTokens` | `32768` | Reported max output |
| `byokModels.enableTools` | `true` | Advertise + pass through tool calling |
| `byokModels.injectWorkspaceContext` | `true` | Inject workspace metadata (files, git, project structure) into system prompts |
| `byokModels.debugLogging` | `false` | Enable verbose logging of tool calls and workspace context |

## Workspace Context Injection

When `byokModels.injectWorkspaceContext` is enabled (default: true), the extension automatically
injects workspace metadata into your model's system prompt:

- **Active file** — current editor, language, line count
- **Open files** — tabs currently visible in VS Code
- **Workspace folders** — project structure and root paths
- **Git info** — current branch, uncommitted changes count

This allows your models to provide **context-aware assistance** without requiring you to manually
describe your project. The model understands:

- Which files you're working on
- Your project structure
- Your git branch and uncommitted work
- Your code organization

### Example System Prompt with Context

```
=== Workspace Context ===
Workspace folders: my-app
Root: /home/user/projects/my-app
Active file: src/components/Button.tsx (typescript)
  Lines: 45, Modified: yes
Open files:
  src/components/Button.tsx (typescript)
  src/styles/Button.css (css)
  tests/Button.test.tsx (typescript)
Git branch: feature/dark-mode
  Changes: 3 modified, 1 staged
```

### Debugging Workspace Context

Use the command **BYOK Models: Show Workspace Context** (Command Palette → search "BYOK Models")
to see exactly what context will be injected. This is useful for understanding why models respond
the way they do, or for troubleshooting if context isn't being picked up.

## Tool Calling & Multi-Turn Interactions

The extension logs all tool calls and results for better debugging:

- **Tool calls** — logged when your model requests a tool execution
- **Tool results** — logged when VS Code returns tool output back to the model
- **Multi-turn flows** — full conversation state preserved, enabling iterative problem-solving

Check the **BYOK Models** output channel (View → Output → select "BYOK Models") to trace
the full interaction flow.

## Advanced: MCP Server Integration (Future)

Model Context Protocol (MCP) support is on the roadmap for providing even richer tool access:
- File system operations beyond basic listing
- Custom project-specific tools
- Standardized tool schemas for consistent behavior

For now, tools are limited to what VS Code provides natively. Stay tuned for MCP server support!

## Troubleshooting

### I added the model via the native "Add model" UI but nothing happens

Values entered there are stored by VS Code itself and passed to this extension as
`options.configuration` on every model refresh — supported since v0.1.7. If models still
don't appear:

1. Check the **BYOK Models** output channel: it logs the base URL/key source used for
   discovery (`add-model UI (options.configuration)`, `secret:...`, or `setting:...`).
2. Run **BYOK Models: Refresh Model List** after changing the configuration.
3. Duplicate empty entries named e.g. `byok-models 2` come from re-adding before v0.1.7;
   delete the stale ones via the gear icon next to the provider in **Manage Models**.

### Models aren't receiving workspace context

1. Check that `byokModels.injectWorkspaceContext` is set to `true` in settings.
2. Run **BYOK Models: Show Workspace Context** to verify context is being detected.
3. Check the **BYOK Models** output channel for errors or warnings.

### Tool calls aren't working

1. Verify `byokModels.enableTools` is `true`.
2. Ensure your endpoint supports OpenAI's tool-calling format.
3. Check the **BYOK Models** output channel for tool call logs and errors.

### Enable debug logging

Set `byokModels.debugLogging` to `true` in settings for verbose output of all operations.

## Notes

- Vendor id is `byok-models`; diagnostics go to the **BYOK Models** output channel.
- Once this extension works, any old static custom endpoint entries in
  `chatLanguageModels.json` can be removed to avoid duplicate model listings.
- Workspace context is injected as a system message, so it counts toward your token limit.
