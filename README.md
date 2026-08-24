# vscode-unsloth-byok

Zero-touch dynamic language model provider for VS Code Copilot Chat, pointing at any
OpenAI-compatible endpoint you configure.

Unlike a static BYOK entry in `chatLanguageModels.json`, this extension **discovers models
live from `/v1/models` every time VS Code builds the model picker** — when the server adds,
removes, or renames a model, Copilot Chat reflects it automatically. No scripts, no manual
syncing.

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

## Notes

- Vendor id is `unsloth`; diagnostics go to the **Unsloth BYOK** output channel.
- Once this extension works, the old static `UNSLOTH` customendpoint entry in
  `chatLanguageModels.json` can be removed to avoid duplicate model listings.
