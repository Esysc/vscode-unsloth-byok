# vscode-unsloth-byok

Zero-touch dynamic language model provider for VS Code Copilot Chat, pointing at any
OpenAI-compatible endpoint you configure.

Unlike a static BYOK entry in `chatLanguageModels.json`, this extension **discovers models
live from `/v1/models` every time VS Code builds the model picker** — when the server adds,
removes, or renames a model, Copilot Chat reflects it automatically. No scripts, no manual
syncing.

**Enhanced with workspace context injection:** Your models now receive information about your
workspace (active files, git branch, project structure) automatically, enabling them to provide
more relevant and context-aware assistance.

## Install

```bash
npx @vscode/vsce package --allow-missing-repository
```

Then in VS Code: Extensions view → `⋯` → **Install from VSIX…** → pick the generated
`unsloth-byok-<version>.vsix`, and reload the window.

## Configure (one time)

1. Set `unslothByok.baseUrl` to your OpenAI-compatible endpoint (must end with `/v1`) —
   either in Settings or via the native **Add model** UI.
2. Command Palette → **Unsloth BYOK: Set API Key** (stored in VS Code secret storage).
3. Optionally adjust the token-limit settings if your endpoint differs from the defaults.

## Use
Open Copilot Chat → model picker → **Unsloth** section. All models reported by the endpoint
appear there dynamically. Tool calling is passed through (agent mode works) when the
endpoint supports it; disable via `unslothByok.enableTools`.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `unslothByok.baseUrl` | *(empty)* | OpenAI-compatible base URL, ending with `/v1` (required) |
| `unslothByok.apiKey` | *(empty)* | Plaintext fallback (prefer the secret-storage command) |
| `unslothByok.maxInputTokens` | `262144` | Reported context window |
| `unslothByok.maxOutputTokens` | `32768` | Reported max output |
| `unslothByok.enableTools` | `true` | Advertise + pass through tool calling |
| `unslothByok.injectWorkspaceContext` | `true` | Inject workspace metadata (files, git, project structure) into system prompts |
| `unslothByok.debugLogging` | `false` | Enable verbose logging of tool calls and workspace context |

## Workspace Context Injection

When `unslothByok.injectWorkspaceContext` is enabled (default: true), the extension automatically
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

Use the command **Unsloth BYOK: Show Workspace Context** (Command Palette → search "Unsloth BYOK")
to see exactly what context will be injected. This is useful for understanding why models respond
the way they do, or for troubleshooting if context isn't being picked up.

## Tool Calling & Multi-Turn Interactions

The extension now logs all tool calls and results for better debugging:

- **Tool calls** — logged when your model requests a tool execution
- **Tool results** — logged when VS Code returns tool output back to the model
- **Multi-turn flows** — full conversation state preserved, enabling iterative problem-solving

Check the **Unsloth BYOK** output channel (View → Output → select "Unsloth BYOK") to trace
the full interaction flow.

## Advanced: MCP Server Integration (Future)

Model Context Protocol (MCP) support is on the roadmap for providing even richer tool access:
- File system operations beyond basic listing
- Custom project-specific tools
- Standardized tool schemas for consistent behavior

For now, tools are limited to what VS Code provides natively. Stay tuned for MCP server support!

## Troubleshooting

### Models aren't receiving workspace context

1. Check that `unslothByok.injectWorkspaceContext` is set to `true` in settings.
2. Run **Unsloth BYOK: Show Workspace Context** to verify context is being detected.
3. Check the **Unsloth BYOK** output channel for errors or warnings.

### Tool calls aren't working

1. Verify `unslothByok.enableTools` is `true`.
2. Ensure your endpoint supports OpenAI's tool-calling format.
3. Check the **Unsloth BYOK** output channel for tool call logs and errors.

### Enable debug logging

Set `unslothByok.debugLogging` to `true` in settings for verbose output of all operations.

## Notes

- Vendor id is `unsloth`; diagnostics go to the **Unsloth BYOK** output channel.
- Once this extension works, the old static `UNSLOTH` customendpoint entry in
  `chatLanguageModels.json` can be removed to avoid duplicate model listings.
- Workspace context is injected as a system message, so it counts toward your token limit.
