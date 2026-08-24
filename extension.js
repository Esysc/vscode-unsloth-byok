'use strict';

/**
 * Unsloth BYOK — zero-touch dynamic language model provider for VS Code Copilot Chat.
 *
 * - Models are discovered live from `<baseUrl>/models` every time VS Code asks
 *   (provideLanguageModelChatInformation), so the picker always matches the server.
 * - Chat requests are streamed from `<baseUrl>/chat/completions` (SSE) and translated
 *   into LanguageModelTextPart / LanguageModelToolCallPart progress reports.
 * - The API key lives in VS Code secret storage (set via the "Unsloth BYOK: Set API Key"
 *   command), with an optional plaintext fallback in `unslothByok.apiKey`.
 */

const vscode = require('vscode');

const VENDOR = 'unsloth';
const SECRET_KEY = 'unslothByokApiKey';
// Key name VS Code uses when storing credentials entered through the native
// "Add model" (Manage Models) UI — mirrors the opencodego pattern (<vendor>.<property>).
const MANAGED_SECRET_KEY = `${VENDOR}.apiKey`;

/** @type {vscode.OutputChannel | undefined} */
let channel;

function log(message) {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Unsloth BYOK');
  }
  channel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

// No built-in endpoint: users configure their own OpenAI-compatible server
// via `unslothByok.baseUrl` or the Add-model UI (`unsloth.baseUrl` secret).
const DEFAULT_BASE_URL = '';

async function resolveBaseUrl(context) {
  const managed = ((await context.secrets.get(`${VENDOR}.baseUrl`)) ?? '').trim();
  if (managed) {
    return { url: managed.replace(/\/+$/, ''), source: `secret:${VENDOR}.baseUrl` };
  }
  const configured = String(settings().get('baseUrl', '') || '').trim();
  if (configured) {
    return { url: configured.replace(/\/+$/, ''), source: 'setting:unslothByok.baseUrl' };
  }
  return { url: DEFAULT_BASE_URL, source: 'default' };
}

function settings() {
  return vscode.workspace.getConfiguration('unslothByok');
}


class UnslothProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeLanguageModelChatInformation = this._emitter.event;
    /** @type {boolean} */
    this._nudged = false;
  }

  fireChanged() {
    this._emitter.fire();
  }

  dispose() {
    this._emitter.dispose();
  }

  async resolveApiKey() {
    const managed = ((await this.context.secrets.get(MANAGED_SECRET_KEY)) ?? '').trim();
    if (managed) {
      return managed;
    }
    const fromSetting = String(settings().get('apiKey', '') || '').trim();
    if (fromSetting) {
      return fromSetting;
    }
    const legacy = ((await this.context.secrets.get(SECRET_KEY)) ?? '').trim();
    return legacy;
  }

  async apiKeySource() {
    if (((await this.context.secrets.get(MANAGED_SECRET_KEY)) ?? '').trim()) {
      return `secret:${MANAGED_SECRET_KEY} (Add model UI)`;
    }
    if (String(settings().get('apiKey', '') || '').trim()) {
      return 'setting:unslothByok.apiKey';
    }
    if (((await this.context.secrets.get(SECRET_KEY)) ?? '').trim()) {
      return `secret:${SECRET_KEY} (legacy)`;
    }
    return 'NOT FOUND';
  }

  headers(apiKey, withBody) {
    const h = { Authorization: `Bearer ${apiKey}` };
    if (withBody) {
      h['Content-Type'] = 'application/json';
    }
    return h;
  }

  signal(token) {
    const controller = new AbortController();
    if (token) {
      token.onCancellationRequested(() => controller.abort());
    }
    return controller.signal;
  }

  /**
   * Called by VS Code whenever it builds the model picker — fetches the live catalog.
   *
   * @returns {Promise<vscode.LanguageModelChatInformation[]>}
   */
  async provideLanguageModelChatInformation(_options, token) {
    const { url: base, source: baseSource } = await resolveBaseUrl(this.context);
    const apiKey = await this.resolveApiKey();
    /** @type {vscode.LanguageModelChatInformation[]} */
    const models = [];
    if (!base || !apiKey) {
      log(
        `Not configured -> baseUrl: ${base || 'MISSING'} (${baseSource}), apiKey source: ${await this.apiKeySource()}`
      );
      if (!this._nudged) {
        this._nudged = true;
        void vscode.window
          .showInformationMessage('Unsloth BYOK is not configured yet.', 'Set API Key')
          .then((pick) => {
            if (pick) {
              void vscode.commands.executeCommand('unslothByok.setApiKey');
            }
          });
      }
      return models;
    }
    try {
      const res = await fetch(`${base}/models`, {
        headers: this.headers(apiKey, false),
        signal: this.signal(token),
      });
      if (!res.ok) {
        throw new Error(`/models failed: HTTP ${res.status}`);
      }
      const payload = await res.json();
      const maxIn = settings().get('maxInputTokens', 262144);
      const maxOut = settings().get('maxOutputTokens', 32768);
      const enableTools = settings().get('enableTools', true);
      for (const m of payload.data ?? []) {
        if (!m?.id) {
          continue;
        }
        models.push({
          id: String(m.id),
          name: String(m.id).split('/').pop(),
          family: VENDOR,
          version: m.created ? String(m.created) : '1',
          maxInputTokens: maxIn,
          maxOutputTokens: maxOut,
          capabilities: { toolCalling: enableTools, imageInput: false },
          isUserSelectable: true,
          detail: 'discovered dynamically from /v1/models',
        });
      }
      log(
        `Discovered ${models.length} model(s) from ${base}/models (url: ${baseSource}, key: ${await this.apiKeySource()}).`
      );
    } catch (err) {
      log(`Model discovery failed from ${base}/models: ${err?.message ?? err}`);
    }
    return models;
  }

  /**
   * Streams a chat completion and reports text/tool-call parts as they arrive.
   */
  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    const { url: base } = await resolveBaseUrl(this.context);
    const apiKey = await this.resolveApiKey();
    if (!base || !apiKey) {
      throw new Error('Unsloth BYOK is not configured (missing base URL or API key).');
    }

    const body = {
      model: model.id,
      messages: toOpenAiMessages(messages),
      stream: true,
    };
    const opts = options.modelOptions ?? {};
    if (typeof opts.temperature === 'number') {
      body.temperature = opts.temperature;
    }
    if (opts.maxTokens) {
      body.max_tokens = opts.maxTokens;
    }
    const enableTools = settings().get('enableTools', true);
    if (enableTools && options.tools?.length) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: t.inputSchema ?? { type: 'object' },
        },
      }));
      if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
        body.tool_choice = 'required';
      }
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: this.headers(apiKey, true),
      body: JSON.stringify(body),
      signal: this.signal(token),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`chat/completions failed: HTTP ${res.status} ${detail}`);
    }

    /** @type {Map<number, { id: string, name: string, args: string }>} */
    const toolAcc = new Map();
    for await (const data of sseData(res.body)) {
      if (data === '[DONE]') {
        break;
      }
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta ?? {};
      if (delta.content) {
        progress.report(new vscode.LanguageModelTextPart(delta.content));
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) {
          acc.id = tc.id;
        }
        if (tc.function?.name) {
          acc.name += tc.function.name;
        }
        if (tc.function?.arguments) {
          acc.args += tc.function.arguments;
        }
        toolAcc.set(idx, acc);
      }
    }
    for (const [, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      if (acc.name) {
        progress.report(new vscode.LanguageModelToolCallPart(acc.id || randomId(), acc.name, acc.args || '{}'));
      }
    }
  }

  /**
   * Cheap heuristic token count (~4 chars per token).
   */
  async provideTokenCount(_model, text, _token) {
    let value = '';
    if (typeof text === 'string') {
      value = text;
    } else if (Array.isArray(text)) {
      value = text
        .map((p) => (typeof p === 'string' ? p : p?.value ?? JSON.stringify(p) ?? ''))
        .join('');
    } else if (text && typeof text === 'object') {
      value = String(text.value ?? JSON.stringify(text));
    }
    return Math.ceil(value.length / 4);
  }
}

function randomId() {
  return `call_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * VS Code roles are numeric (User=1, Assistant=2, System=3 [proposed]); OpenAI wants strings.
 */
function toOpenAiRole(role) {
  switch (role) {
    case 2:
    case 'assistant':
      return 'assistant';
    case 3:
    case 'system':
    case 'developer':
      return 'system';
    case 1:
    case 'user':
    default:
      return 'user';
  }
}

function partValue(part) {
  return typeof part === 'string' ? part : part?.value;
}

function isToolUsePart(part) {
  return part && typeof part === 'object' && 'callId' in part && 'name' in part && 'input' in part;
}

function isToolResultPart(part) {
  return part && typeof part === 'object' && 'callId' in part && 'content' in part && !('name' in part);
}

/**
 * Translate VS Code language-model messages into OpenAI chat-completions format.
 * Text parts are joined; tool use/result parts are mapped to tool_calls / role:"tool".
 */
function toOpenAiMessages(messages) {
  /** @type {object[]} */
  const out = [];
  for (const msg of messages ?? []) {
    const raw = msg.content;
    const parts = Array.isArray(raw)
      ? raw
      : raw === undefined || raw === null
        ? []
        : [raw];
    const texts = [];
    const toolUses = [];
    const toolResults = [];
    for (const part of parts) {
      if (isToolUsePart(part)) {
        toolUses.push(part);
      } else if (isToolResultPart(part)) {
        toolResults.push(part);
      } else {
        texts.push(String(partValue(part) ?? JSON.stringify(part ?? '')));
      }
    }
    if (toolUses.length) {
      out.push({
        role: 'assistant',
        content: texts.join('') || null,
        tool_calls: toolUses.map((tc) => ({
          id: tc.callId ?? tc.name,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? {}),
          },
        })),
      });
      continue;
    }
    if (toolResults.length) {
      for (const tr of toolResults) {
        const trRaw = tr.content;
        const trParts = Array.isArray(trRaw) ? trRaw : trRaw === undefined || trRaw === null ? [] : [trRaw];
        const content = trParts
          .map((p) => String(partValue(p) ?? JSON.stringify(p ?? '')))
          .join('');
        out.push({ role: 'tool', tool_call_id: tr.callId, content });
      }
      if (texts.length) {
        out.push({ role: toOpenAiRole(msg.role), content: texts.join('') });
      }
      continue;
    }
    out.push({ role: toOpenAiRole(msg.role), content: texts.join('') });
  }
  return out;
}

/**
 * Parse an SSE byte stream and yield the payload of each `data:` line.
 */
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) {
        yield line.slice(5).trim();
      }
    }
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  channel = vscode.window.createOutputChannel('Unsloth BYOK');
  context.subscriptions.push(channel);

  const provider = new UnslothProvider(context);
  context.subscriptions.push(provider);
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('unslothByok.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: `API key for the "${VENDOR}" model provider`,
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) {
        return;
      }
      const trimmed = key.trim();
      if (!trimmed) {
        log('Set API Key cancelled: input was empty; nothing stored.');
        void vscode.window.showWarningMessage('Unsloth BYOK: empty key — nothing stored.');
        return;
      }
      await context.secrets.store(MANAGED_SECRET_KEY, trimmed);
      const readBack = await context.secrets.get(MANAGED_SECRET_KEY);
      log(`API key stored (read-back: ${readBack && readBack.length ? `ok len=${readBack.length}` : 'FAILED'}).`);
      provider.fireChanged();
      void vscode.window.showInformationMessage('Unsloth BYOK: API key stored. Model list will refresh automatically.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('unslothByok.clearApiKey', async () => {
      await context.secrets.delete(SECRET_KEY);
      provider.fireChanged();
      log('API key cleared.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('unslothByok.refreshModels', () => {
      provider.fireChanged();
      log('Manual refresh requested.');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('unslothByok')) {
        provider.fireChanged();
      }
    })
  );

  // Refresh the model list as soon as a key is stored via the native Add-model UI.
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
        if (e.key === MANAGED_SECRET_KEY || e.key === SECRET_KEY || e.key === `${VENDOR}.baseUrl`) {
        log(`Secret changed: ${e.key} — refreshing model list.`);
        provider.fireChanged();
      }
    })
  );

  log('Unsloth BYOK provider activated.');
}

function deactivate() {}

module.exports = { activate, deactivate };
