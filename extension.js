'use strict';

/**
 * BYOK Models — zero-touch dynamic language model provider for VS Code AI Chat.
 *
 * - Models are discovered live from `<baseUrl>/models` every time VS Code asks
 *   (provideLanguageModelChatInformation), so the picker always matches the server.
 * - Chat requests are streamed from `<baseUrl>/chat/completions` (SSE) and translated
 *   into LanguageModelTextPart / LanguageModelToolCallPart progress reports.
 * - The API key lives in VS Code secret storage (set via the "BYOK Models: Set API Key"
 *   command), with an optional plaintext fallback in `byokModels.apiKey`.
 * - Workspace context (active files, git info, project structure) is injected into
 *   system prompts to give models awareness of the user's project context.
 * - Tool results are logged and preserved across multi-turn interactions.
 */

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const VENDOR = 'byok-models';
const SECRET_KEY = 'byokModelsApiKey';
// Key name VS Code uses when storing credentials entered through the native
// "Add model" (Manage Models) UI — mirrors the opencodego pattern (<vendor>.<property>).
const MANAGED_SECRET_KEY = `${VENDOR}.apiKey`;

/** @type {vscode.OutputChannel | undefined} */
let channel;

function log(message) {
  if (!channel) {
    channel = vscode.window.createOutputChannel('BYOK Models');
  }
  channel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

// No built-in endpoint: users configure their own OpenAI-compatible server
// via `byokModels.baseUrl` or the Add-model UI (`byok-models.baseUrl` secret).
const DEFAULT_BASE_URL = '';

function trimUrl(url) {
  const value = String(url ?? '').trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Values entered through VS Code's native "Add model" UI are stored by VS Code
 * itself (secrets under internal `chat.lm.secret.*` keys, the rest in its
 * language-models config file) and handed to the provider via
 * `options.configuration` on every provideLanguageModelChatInformation call.
 * This is not in the stable vscode.d.ts yet, but the extension host forwards it.
 */
function uiConfiguration(options) {
  const c = options?.configuration;
  if (!c || typeof c !== 'object') {
    return { baseUrl: '', apiKey: '' };
  }
  return {
    baseUrl: trimUrl(c.baseUrl),
    apiKey: typeof c.apiKey === 'string' ? c.apiKey.trim() : '',
  };
}

async function resolveBaseUrl(context) {
  const managed = ((await context.secrets.get(`${VENDOR}.baseUrl`)) ?? '').trim();
  if (managed) {
    return { url: managed.endsWith('/') ? managed.slice(0, -1) : managed, source: `secret:${VENDOR}.baseUrl` };
  }
  const configured = String(settings().get('baseUrl', '') || '').trim();
  if (configured) {
    return { url: configured.endsWith('/') ? configured.slice(0, -1) : configured, source: 'setting:byokModels.baseUrl' };
  }
  return { url: DEFAULT_BASE_URL, source: 'default' };
}

function settings() {
  return vscode.workspace.getConfiguration('byokModels');
}

/**
 * Gather workspace context: active files, workspace folders, git info, project structure.
 * @returns {Promise<Object>} Context object with workspace metadata
 */
async function gatherWorkspaceContext() {
  const context = {
    workspaceFolders: [],
    activeFile: null,
    openFiles: [],
    gitInfo: null,
  };

  // Workspace folders
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    context.workspaceFolders = folders.map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
  }

  // Active editor
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const doc = editor.document;
    const fsPath = doc.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder.uri.fsPath, fsPath)
      : fsPath;
    context.activeFile = {
      path: fsPath,
      relativePath,
      language: doc.languageId,
      lineCount: doc.lineCount,
      isDirty: doc.isDirty,
    };
  }

  // Open tabs
  try {
    const openEditors = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    context.openFiles = openEditors
      .filter((t) => t.input instanceof vscode.TabInputText)
      .map((t) => {
        const uri = t.input.uri;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const relativePath = workspaceFolder
          ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
          : uri.fsPath;
        return {
          path: uri.fsPath,
          relativePath,
          language: t.input?.languageId || 'unknown',
        };
      });
  } catch {
    // Tab groups API may not be available in older VS Code versions
  }

  // Git info (if available)
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension?.isActive) {
      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories[0];
      if (repo) {
        const branch = repo.state.HEAD?.name || 'unknown';
        const status = repo.state.workingTreeChanges?.length ?? 0;
        const staged = repo.state.indexChanges?.length ?? 0;
        context.gitInfo = {
          branch,
          workingTreeChanges: status,
          stagedChanges: staged,
        };
      }
    }
  } catch {
    // Git extension not available
  }

  return context;
}

/**
 * Build a workspace context system prompt segment.
 * @param {Object} ctx - Workspace context from gatherWorkspaceContext()
 * @returns {string} System prompt segment
 */
function buildWorkspaceContextPrompt(ctx) {
  const lines = ['=== Workspace Context ==='];

  if (ctx.workspaceFolders?.length) {
    lines.push(`Workspace folders: ${ctx.workspaceFolders.map((f) => f.name).join(', ')}`);
    lines.push(`Root: ${ctx.workspaceFolders[0].path}`);
  }

  if (ctx.activeFile) {
    lines.push(`Active file: ${ctx.activeFile.relativePath} (${ctx.activeFile.language})`);
    lines.push(`  Lines: ${ctx.activeFile.lineCount}, Modified: ${ctx.activeFile.isDirty ? 'yes' : 'no'}`);
  }

  if (ctx.openFiles?.length) {
    const fileList = ctx.openFiles
      .map((f) => `${f.relativePath} (${f.language})`)
      .join('\n  ');
    lines.push(`Open files:\n  ${fileList}`);
  }

  if (ctx.gitInfo) {
    lines.push(`Git branch: ${ctx.gitInfo.branch}`);
    if (ctx.gitInfo.workingTreeChanges > 0 || ctx.gitInfo.stagedChanges > 0) {
      lines.push(`  Changes: ${ctx.gitInfo.workingTreeChanges} modified, ${ctx.gitInfo.stagedChanges} staged`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract snippet from active editor around cursor position.
 * Useful for providing relevant code context to the model.
 * @param {number} lines - Number of lines to include
 * @returns {Promise<string>} Code snippet with context
 */
async function getActiveFileContext(lines = 10) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return '';

  const doc = editor.document;
  const cursor = editor.selection.active.line;
  const start = Math.max(0, cursor - lines);
  const end = Math.min(doc.lineCount, cursor + lines);

  const snippet = doc
    .getText(new vscode.Range(start, 0, end, 0))
    .split('\n')
    .map((line, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === cursor + 1 ? '> ' : '  ';
      return `${marker}${String(lineNum).padStart(3)} | ${line}`;
    })
    .join('\n');

  return `\n=== Active File Context ===\nFile: ${doc.uri.fsPath}\n\`\`\`${doc.languageId}\n${snippet}\n\`\`\``;
}


class BYOKModelsProvider {
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
      return 'setting:byokModels.apiKey';
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

  signal(token, timeoutMs = 0) {
    const controller = new AbortController();
    let timer;
    if (timeoutMs > 0) {
      // ponytail: single dangling setTimeout is fine; discovery calls are short-lived
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    if (token) {
      token.onCancellationRequested(() => {
        clearTimeout(timer);
        controller.abort();
      });
    }
    return controller.signal;
  }

  /**
   * Called by VS Code whenever it builds the model picker — fetches the live catalog.
   *
   * @returns {Promise<vscode.LanguageModelChatInformation[]>}
   */
  async provideLanguageModelChatInformation(options, token) {
    // Prefer the values entered in the native Add-model UI (options.configuration),
    // then fall back to secret storage / settings.
    const ui = uiConfiguration(options);
    let base = ui.baseUrl;
    let baseSource = 'add-model UI (options.configuration)';
    if (!base) {
      const resolved = await resolveBaseUrl(this.context);
      base = resolved.url;
      baseSource = resolved.source;
    }
    let apiKey = ui.apiKey;
    let keySource = 'add-model UI (options.configuration)';
    if (!apiKey) {
      apiKey = await this.resolveApiKey();
      keySource = await this.apiKeySource();
    }
    /** @type {vscode.LanguageModelChatInformation[]} */
    const models = [];
    if (!base || !apiKey) {
      log(
        `Not configured -> baseUrl: ${base || 'MISSING'} (${baseSource}), apiKey source: ${keySource}`
      );
      // Docs: honor options.silent — background resolutions must not prompt.
      if (!options.silent && !this._nudged) {
        this._nudged = true;
        void vscode.window
          .showInformationMessage('BYOK Models is not configured yet.', 'Set API Key')
          .then((pick) => {
            if (pick) {
              void vscode.commands.executeCommand('byokModels.setApiKey');
            }
          });
      }
      return models;
    }
    try {
      const res = await fetch(`${base}/models`, {
        headers: this.headers(apiKey, false),
        // ponytail: 15s cap so an unreachable baseUrl can't hang model resolution
        signal: this.signal(token, 15000),
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
          // Ride-along credentials (same pattern as VS Code's built-in BYOK
          // providers): extra properties survive the extension-host round trip
          // and come back on `model` in provideLanguageModelChatResponse.
          baseUrl: base,
          apiKey,
        });
      }
      log(
        `Discovered ${models.length} model(s) from ${base}/models (url: ${baseSource}, key: ${keySource}). ids: ${models.map((m) => m.id).join(', ') || '(none)'}`
      );
    } catch (err) {
      log(`Model discovery failed from ${base}/models: ${err?.message ?? err}`);
    }
    return models;
  }

  /**
   * Streams a chat completion and reports text/tool-call parts as they arrive.
   * Injects workspace context into the request when enabled.
   */
  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    try {
      return await this._doChatResponse(model, messages, options, progress, token);
    } catch (err) {
      const msg = err?.message ?? String(err);
      log(`provideLanguageModelChatResponse FAILED: ${msg}`);
      // Re-throw so VS Code surfaces the error in the chat UI instead of
      // the generic "Sorry, no response was returned."
      throw new Error(`BYOK Models: ${msg}`);
    }
  }

  /** @private */
  async _doChatResponse(model, messages, options, progress, token) {
    // Credentials discovered during provideLanguageModelChatInformation ride along
    // on the model object; fall back to secret storage / settings if absent.
    let base = trimUrl(model?.baseUrl);
    let apiKey = String(model?.apiKey ?? '').trim();
    if (!base) {
      base = (await resolveBaseUrl(this.context)).url;
    }
    if (!apiKey) {
      apiKey = await this.resolveApiKey();
    }
    if (!base || !apiKey) {
      throw new Error('BYOK Models is not configured (missing base URL or API key).');
    }

    // Gather and optionally inject workspace context
    const injectContext = settings().get('injectWorkspaceContext', true);
    let workspaceContextStr = '';
    if (injectContext) {
      try {
        const wsCtx = await gatherWorkspaceContext();
        workspaceContextStr = buildWorkspaceContextPrompt(wsCtx);
        log(`Workspace context collected: ${wsCtx.workspaceFolders.length} folders, ${wsCtx.openFiles.length} open files`);
      } catch (ctxErr) {
        log(`Workspace context gathering failed (continuing without): ${ctxErr?.message ?? ctxErr}`);
      }
    }

    // Build messages with workspace context injected into the first system/user message
    let messagesForModel = toOpenAiMessages(messages);
    if (workspaceContextStr) {
      const hasSystemMsg = messagesForModel.length > 0 && messagesForModel[0].role === 'system';
      if (hasSystemMsg) {
        messagesForModel[0].content = (messagesForModel[0].content || '') + '\n\n' + workspaceContextStr;
      } else {
        messagesForModel.unshift({
          role: 'system',
          content: workspaceContextStr,
        });
      }
    }

    const body = {
      model: model.id,
      messages: messagesForModel,
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
      log(`Tools available: ${options.tools.map((t) => t.name).join(', ')}`);
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
    let textContent = '';
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
        textContent += delta.content;
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

    // Log tool calls for debugging/tracing
    if (toolAcc.size > 0) {
      for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
        if (acc.name) {
          log(`Tool call ${idx}: ${acc.name}(${acc.args.length > 100 ? acc.args.slice(0, 100) + '...' : acc.args})`);
          progress.report(new vscode.LanguageModelToolCallPart(acc.id || randomId(), acc.name, acc.args || '{}'));
        }
      }
    }

    // Log text response summary
    if (textContent) {
      log(`Response: ${textContent.length} characters`);
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
 * Logs tool results for debugging multi-turn flows.
 */
function toOpenAiMessages(messages) {
  /** @type {object[]} */
  const out = [];
  for (const msg of messages ?? []) {
    const raw = msg.content;
    let parts;
    if (Array.isArray(raw)) {
      parts = raw;
    } else if (raw === undefined || raw === null) {
      parts = [];
    } else {
      parts = [raw];
    }
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
        let trParts;
        if (Array.isArray(trRaw)) {
          trParts = trRaw;
        } else if (trRaw === undefined || trRaw === null) {
          trParts = [];
        } else {
          trParts = [trRaw];
        }
        const content = trParts
          .map((p) => String(partValue(p) ?? JSON.stringify(p ?? '')))
          .join('');
        // Log tool results for transparency in multi-turn flows
        const resultPreview = content.length > 150 ? content.slice(0, 150) + '...' : content;
        const singleLine = resultPreview.replaceAll('\n', ' ');
        log(`Tool result: ${tr.callId} → ${singleLine}`);
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
  // Flush remaining buffer — some servers omit the trailing newline on the
  // last data line, which would otherwise be silently dropped.
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    yield tail.slice(5).trim();
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  channel = vscode.window.createOutputChannel('BYOK Models');
  context.subscriptions.push(channel);

  const provider = new BYOKModelsProvider(context);
  context.subscriptions.push(provider);

  // Register the language-model provider (requires VS Code ≥ 1.102).
  // Wrap defensively: if lm API is unavailable, commands still register.
  try {
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
  } catch (err) {
    log(`Failed to register language model provider (lm API may not be available): ${err?.message ?? err}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('byokModels.setApiKey', async () => {
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
        void vscode.window.showWarningMessage('BYOK Models: empty key — nothing stored.');
        return;
      }
      await context.secrets.store(MANAGED_SECRET_KEY, trimmed);
      const readBack = await context.secrets.get(MANAGED_SECRET_KEY);
      const readStatus = readBack?.length ? `ok len=${readBack.length}` : 'FAILED';
      log(`API key stored (read-back: ${readStatus}).`);
      provider.fireChanged();
      void vscode.window.showInformationMessage('BYOK Models: API key stored. Model list will refresh automatically.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('byokModels.clearApiKey', async () => {
      await context.secrets.delete(MANAGED_SECRET_KEY);
      await context.secrets.delete(SECRET_KEY);
      provider.fireChanged();
      log('API key cleared (managed + legacy).');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('byokModels.refreshModels', () => {
      provider.fireChanged();
      log('Manual refresh requested.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('byokModels.showWorkspaceContext', async () => {
      const wsCtx = await gatherWorkspaceContext();
      const contextStr = buildWorkspaceContextPrompt(wsCtx);
      log('=== Workspace Context Snapshot ===');
      log(contextStr);
      await vscode.window.showInformationMessage(
        `Workspace context gathered: ${wsCtx.openFiles.length} open files, ${wsCtx.workspaceFolders.length} folders. Check BYOK Models output channel for details.`
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('byokModels')) {
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

  log('BYOK Models provider activated.');
}

function deactivate() {
  // Cleanup handled by VS Code's subscription management
}

module.exports = { activate, deactivate };
